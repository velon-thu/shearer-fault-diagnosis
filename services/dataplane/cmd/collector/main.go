// collector：共享内存 → SQLite 采集器，100ms 扫描。
//
// 采集策略（与用户约定）：
//   - sensor（值型）：工程值 = 原始值×accuracy（signed 列先转 int16）；值变化才写，
//     另每 -snapshot（默认 60s）强制写一次全量快照保证曲线连续。
//   - state（布尔型）：同上策略，存 0/1。
//   - 操作：10 个来源组各 32 位操作码做沿变检测，按下(0→1)/松开(1→0) 逐条入库。
//   - 普通故障：按 fault_map 的 trigger 判定激活；激活沿→newfault，消除沿→delfault。
//   - 内部故障：BOC/HPC/MOC 三组 FIFO 整体后移判定新码；基准持久化在 fifo_state 表。
//
// 数据库持续累积；启动时把上次遗留的未结束故障统一关闭（clear_ts=启动时刻）。
// 回放器尚未写入数据（记录计数=0）时所有引擎挂起，避免全零内存误判。
package main

import (
	"database/sql"
	"flag"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"shearer/dataplane/internal/defs"
	"shearer/dataplane/internal/shm"
	"shearer/dataplane/internal/store"
)

func main() {
	log.SetFlags(log.Ltime)
	var (
		shmName  = flag.String("shm", shm.DefaultName, "共享内存映射名")
		words    = flag.Int("words", shm.Words, "共享内存字数")
		dbPath   = flag.String("db", "services/dataplane/data/shearer.db", "SQLite 数据库路径")
		scan     = flag.Duration("scan", 100*time.Millisecond, "扫描周期")
		snapshot = flag.Duration("snapshot", 60*time.Second, "全量快照周期（变化存之外的心跳）")
	)
	flag.Parse()

	d, err := defs.Load()
	if err != nil {
		log.Fatalf("加载定义: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(*dbPath), 0o755); err != nil {
		log.Fatalf("建数据目录: %v", err)
	}
	db, err := store.Open(*dbPath)
	if err != nil {
		log.Fatalf("打开数据库: %v", err)
	}
	defer db.Close()
	if err := store.Init(db, d); err != nil {
		log.Fatalf("建表/灌种子: %v", err)
	}
	if n, err := store.CloseStaleFaults(db, time.Now().UnixMilli()); err != nil {
		log.Fatalf("关闭遗留故障: %v", err)
	} else if n > 0 {
		log.Printf("已关闭上次运行遗留的 %d 条未结束故障", n)
	}
	log.Printf("数据库 %s 就绪（sensor %d / status %d / fault %d / ops %d 组）",
		*dbPath, len(d.Sensors), len(d.Statuses), len(d.Faults), len(d.Ops))

	// 等待共享内存出现
	var mem *shm.Memory
	for {
		mem, err = shm.Open(*shmName, *words)
		if err == nil {
			break
		}
		log.Printf("等待共享内存 %s（%v）…", *shmName, err)
		time.Sleep(time.Second)
	}
	defer mem.Close()
	log.Printf("已连接共享内存 %s", *shmName)

	c := newCollector(db, d, *snapshot)
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	tick := time.NewTicker(*scan)
	defer tick.Stop()
	buf := make([]uint16, *words)
	statEvery := time.NewTicker(30 * time.Second)
	defer statEvery.Stop()

	for {
		select {
		case <-stop:
			log.Printf("退出。累计写入 sensor %d / state %d / action %d / fault %d / internal %d",
				c.nSensor, c.nState, c.nAction, c.nFault, c.nInternal)
			return
		case <-statEvery.C:
			log.Printf("累计 sensor %d / state %d / action %d / fault %d(开 %d) / internal %d",
				c.nSensor, c.nState, c.nAction, c.nFault, c.openFaults(), c.nInternal)
		case <-tick.C:
			mem.Snapshot(buf)
			if buf[shm.MetaRecordLo] == 0 && buf[shm.MetaRecordHi] == 0 {
				continue // 回放器尚未写入
			}
			if err := c.step(buf, time.Now().UnixMilli()); err != nil {
				log.Printf("采集写入失败: %v", err)
			}
		}
	}
}

// ---------------------------------------------------------------------------

type sensorState struct {
	inited  bool
	eng     float64
	wroteAt int64
}

type collector struct {
	db         *sql.DB
	d          *defs.Defs
	snapshotMs int64

	sensorLast map[int]*sensorState // key=地址
	stateLast  map[int]*sensorState // eng 存 0/1
	opsPrev    map[int]uint32       // key=group_no
	opsPrimed  bool
	faultOn    map[int]bool // key=fault_code
	faultInit  bool
	fifoBase   [12]uint16
	fifoPrimed bool

	nSensor, nState, nAction, nFault, nInternal int64
}

var fifoModules = [3]string{"BOC", "HPC", "MOC"}

const fifoBaseAddr = 3400

func newCollector(db *sql.DB, d *defs.Defs, snapshot time.Duration) *collector {
	c := &collector{
		db: db, d: d, snapshotMs: snapshot.Milliseconds(),
		sensorLast: map[int]*sensorState{}, stateLast: map[int]*sensorState{},
		opsPrev: map[int]uint32{}, faultOn: map[int]bool{},
	}
	// FIFO 基准：优先取库里持久化的值
	var loaded [12]uint16
	all := true
	for gi, m := range fifoModules {
		w, ok, err := store.LoadFifoState(db, m)
		if err != nil || !ok {
			all = false
			break
		}
		copy(loaded[gi*4:gi*4+4], w[:])
		_ = gi
	}
	if all {
		c.fifoBase = loaded
		c.fifoPrimed = true
		log.Printf("FIFO 基准已从数据库恢复")
	}
	return c
}

func (c *collector) openFaults() int {
	n := 0
	for _, on := range c.faultOn {
		if on {
			n++
		}
	}
	return n
}

// step 处理一拍快照。所有写入合并进一个事务。
func (c *collector) step(buf []uint16, ts int64) error {
	tx, err := c.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	wrote := false

	// ---- sensor（值变化 或 到达快照周期）----
	for i := range c.d.Sensors {
		s := &c.d.Sensors[i]
		eng := s.Engineering(buf[s.Add])
		st := c.sensorLast[s.Add]
		if st == nil {
			st = &sensorState{}
			c.sensorLast[s.Add] = st
		}
		if !st.inited || eng != st.eng || ts-st.wroteAt >= c.snapshotMs {
			if _, err := tx.Exec(`INSERT INTO sensor_hyper(ts,std_tag,value) VALUES(?,?,?)`,
				ts, s.StdTag, eng); err != nil {
				return err
			}
			st.inited, st.eng, st.wroteAt = true, eng, ts
			c.nSensor++
			wrote = true
		}
	}

	// ---- state（0/1，同策略）----
	for i := range c.d.Statuses {
		s := &c.d.Statuses[i]
		v := float64(0)
		if buf[s.Add] != 0 {
			v = 1
		}
		st := c.stateLast[s.Add]
		if st == nil {
			st = &sensorState{}
			c.stateLast[s.Add] = st
		}
		if !st.inited || v != st.eng || ts-st.wroteAt >= c.snapshotMs {
			if _, err := tx.Exec(`INSERT INTO state_hyper(ts,std_tag,state_code) VALUES(?,?,?)`,
				ts, s.StdTag, int(v)); err != nil {
				return err
			}
			st.inited, st.eng, st.wroteAt = true, v, ts
			c.nState++
			wrote = true
		}
	}

	// ---- 操作沿变（首拍只建基准，不产生动作）----
	for _, g := range c.d.Ops {
		cur := uint32(buf[g.AddrHi])<<16 | uint32(buf[g.AddrLo])
		if !c.opsPrimed {
			c.opsPrev[g.GroupNo] = cur
			continue
		}
		prev := c.opsPrev[g.GroupNo]
		if diff := cur ^ prev; diff != 0 {
			for bit := 0; bit < 32; bit++ {
				if diff&(1<<bit) == 0 {
					continue
				}
				name, ok := defs.OpNames[bit]
				if !ok {
					continue
				}
				action := "按下"
				if cur&(1<<bit) == 0 {
					action = "松开"
				}
				if _, err := tx.Exec(`INSERT INTO device_action(occur_ts,source_type,source_name,op_name,action)
					VALUES(?,?,?,?,?)`, ts, g.SourceType, g.SourceName, name, action); err != nil {
					return err
				}
				c.nAction++
				wrote = true
			}
		}
		c.opsPrev[g.GroupNo] = cur
	}
	c.opsPrimed = true

	// ---- 普通故障（首拍：当前激活的直接记 newfault）----
	for i := range c.d.Faults {
		f := &c.d.Faults[i]
		if f.Trigger == "fifo" {
			continue
		}
		act := f.Active(buf[f.Code])
		prev, seen := c.faultOn[f.Code]
		if (!c.faultInit && act) || (seen && act && !prev) {
			if _, err := tx.Exec(`INSERT INTO fault_normal(fault_code,occur_ts,clear_ts,status)
				VALUES(?,?,NULL,1)`, f.Code, ts); err != nil {
				return err
			}
			c.nFault++
			wrote = true
		} else if seen && !act && prev {
			if _, err := tx.Exec(`UPDATE fault_normal SET clear_ts=?, status=0
				WHERE fault_code=? AND status=1`, ts, f.Code); err != nil {
				return err
			}
			wrote = true
		}
		c.faultOn[f.Code] = act
	}
	c.faultInit = true

	// ---- FIFO 内部故障（整体后移一位判定，基准变化即随本事务持久化）----
	saveFifo := func(module string, w []uint16) error {
		_, err := tx.Exec(`INSERT INTO fifo_state(module_name,w0,w1,w2,w3,updated_ts) VALUES(?,?,?,?,?,?)
			ON CONFLICT(module_name) DO UPDATE SET w0=?,w1=?,w2=?,w3=?,updated_ts=?`,
			module, w[0], w[1], w[2], w[3], ts, w[0], w[1], w[2], w[3], ts)
		if err == nil {
			wrote = true
		}
		return err
	}
	var curr [12]uint16
	for i := 0; i < 12; i++ {
		curr[i] = buf[fifoBaseAddr+i]
	}
	if !c.fifoPrimed {
		c.fifoBase = curr
		c.fifoPrimed = true
		for gi, m := range fifoModules {
			if err := saveFifo(m, curr[gi*4:gi*4+4]); err != nil {
				return err
			}
		}
	} else {
		for gi, m := range fifoModules {
			off := gi * 4
			cu := curr[off : off+4]
			ol := c.fifoBase[off : off+4]
			if cu[0] == ol[0] && cu[1] == ol[1] && cu[2] == ol[2] && cu[3] == ol[3] {
				continue
			}
			// 队列整体后移一位且新首位非 0 → 压入了一个新码
			if cu[1] == ol[0] && cu[2] == ol[1] && cu[3] == ol[2] && cu[0] != 0 {
				if _, err := tx.Exec(`INSERT INTO fault_internal(fault_code,occur_ts,module_name)
					VALUES(?,?,?)`, cu[0], ts, m); err != nil {
					return err
				}
				c.nInternal++
			}
			copy(c.fifoBase[off:off+4], cu) // 变了就 resync，防失步
			if err := saveFifo(m, cu); err != nil {
				return err
			}
		}
	}

	if !wrote {
		return nil
	}
	return tx.Commit()
}
