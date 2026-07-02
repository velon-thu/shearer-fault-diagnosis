// collector：共享内存 → SQLite 采集器。
//
// 启动流程（每次启动回到确定的初始状态）：
//  1. 清空业务表（sensor_hyper/state_hyper/device_action/fault_normal/fault_internal/fifo_state）；
//  2. 预载：直接解析 org 文件，把同步点（-sync-org-ts，默认 2026-06-30 00:00）之前
//     -preload（默认 24h）的数据经同一套引擎灌入数据库，org 时间轴平移到"现在"结尾；
//  3. 直播：100ms 扫描共享内存（replayer 从同步点开始续播），沿用同一套引擎。
//
// 采集策略：
//   - sensor（值型）：工程值 = 原始值×accuracy（signed 列先转 int16）；值变化才写，
//     另每 -snapshot（默认 60s）强制写一次全量快照保证曲线连续。
//   - state（布尔型）：同上策略，存 0/1。
//   - 操作：10 个来源组各 32 位操作码做沿变检测，按下(0→1)/松开(1→0) 逐条入库。
//   - 普通故障：按 fault_map 的 trigger 判定激活；激活沿→newfault，消除沿→delfault。
//   - 内部故障：BOC/HPC/MOC 三组 FIFO 整体后移判定新码；基准持久化在 fifo_state 表。
package main

import (
	"database/sql"
	"flag"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"syscall"
	"time"

	"shearer/dataplane/internal/defs"
	"shearer/dataplane/internal/orgfile"
	"shearer/dataplane/internal/shm"
	"shearer/dataplane/internal/store"
)

func main() {
	log.SetFlags(log.Ltime)
	var (
		shmName   = flag.String("shm", shm.DefaultName, "共享内存映射名")
		words     = flag.Int("words", shm.Words, "共享内存字数")
		dbPath    = flag.String("db", "services/dataplane/data/shearer.db", "SQLite 数据库路径")
		scan      = flag.Duration("scan", 100*time.Millisecond, "扫描周期")
		snapshot  = flag.Duration("snapshot", 60*time.Second, "全量快照周期（变化存之外的心跳）")
		dir       = flag.String("dir", "testdata", "org 文件目录（预载用）")
		syncTs    = flag.Int64("sync-org-ts", defs.DefaultSyncOrgTsMs, "同步点 org 毫秒时间戳")
		preload   = flag.Duration("preload", 24*time.Hour, "预载时长（0 关闭预载）")
		resetData = flag.Bool("reset", true, "启动时清空业务表（每次启动回到同一初始状态）")
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
	if *resetData {
		if err := wipeBusinessTables(db); err != nil {
			log.Fatalf("清空业务表: %v", err)
		}
		log.Printf("业务表已清空（-reset=true，每次启动重置到同步点状态）")
	}
	log.Printf("数据库 %s 就绪（sensor %d / status %d / fault %d / ops %d 组）",
		*dbPath, len(d.Sensors), len(d.Statuses), len(d.Faults), len(d.Ops))

	c := newCollector(db, d, *snapshot)

	if *preload > 0 {
		if err := c.preload(*dir, *syncTs, *preload, *words); err != nil {
			log.Fatalf("预载失败: %v", err)
		}
	}
	log.Printf("预载完成，进入直播采集")

	// 等待共享内存出现（replayer 从同步点续播）
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

// wipeBusinessTables 清空全部业务数据（定义/规则表保留，由种子重灌）。
func wipeBusinessTables(db *sql.DB) error {
	for _, t := range []string{"sensor_hyper", "state_hyper", "device_action",
		"fault_normal", "fault_internal", "fifo_state"} {
		if _, err := db.Exec("DELETE FROM " + t); err != nil {
			return err
		}
	}
	_, err := db.Exec(`DELETE FROM sqlite_sequence WHERE name IN
		('sensor_hyper','state_hyper','device_action','fault_normal','fault_internal')`)
	return err
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
	// FIFO 基准：优先取库里持久化的值（-reset 清空后为空，首拍现场初始化）
	var loaded [12]uint16
	all := true
	for gi, m := range fifoModules {
		w, ok, err := store.LoadFifoState(db, m)
		if err != nil || !ok {
			all = false
			break
		}
		copy(loaded[gi*4:gi*4+4], w[:])
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

// preload 预载：解析 org 文件，把 [syncMs-dur, syncMs) 的记录经同一套引擎灌库，
// 时间轴平移为"预载结束 == 现在"。
func (c *collector) preload(dir string, syncMs int64, dur time.Duration, words int) error {
	files, err := filepath.Glob(filepath.Join(dir, "*.org"))
	if err != nil || len(files) == 0 {
		log.Printf("预载：目录 %s 下没有 org 文件，跳过", dir)
		return nil
	}
	sort.Strings(files)

	lo := syncMs - dur.Milliseconds()
	bootNow := time.Now().UnixMilli()
	plan := c.d.WritePlan()
	buf := make([]uint16, words)
	total := 0

	var tx *sql.Tx
	batch := 0
	commit := func() error {
		if tx == nil {
			return nil
		}
		err := tx.Commit()
		tx = nil
		batch = 0
		return err
	}

	for _, path := range files {
		records, err := orgfile.ParseFile(path)
		if err != nil {
			return err
		}
		records = orgfile.Clean(records)
		if len(records) == 0 || records[len(records)-1].TimestampMs < lo || records[0].TimestampMs >= syncMs {
			continue
		}
		log.Printf("预载 %s …", filepath.Base(path))
		for ri := range records {
			rec := &records[ri]
			if rec.TimestampMs < lo || rec.TimestampMs >= syncMs {
				continue
			}
			for _, ins := range plan {
				buf[ins.Addr] = ins.Expr.Eval(rec)
			}
			ts := bootNow - (syncMs - rec.TimestampMs)
			if tx == nil {
				if tx, err = c.db.Begin(); err != nil {
					return err
				}
			}
			if _, err := c.stepTx(tx, buf, ts); err != nil {
				_ = tx.Rollback()
				return err
			}
			total++
			batch++
			if batch >= 5000 {
				if err := commit(); err != nil {
					return err
				}
			}
		}
	}
	if err := commit(); err != nil {
		return err
	}
	log.Printf("预载入库 %d 条 org 记录（窗口 %s，同步点前 %v），"+
		"累计 sensor %d / state %d / action %d / fault %d / internal %d",
		total, time.UnixMilli(lo).Format("01-02 15:04")+"~"+time.UnixMilli(syncMs).Format("01-02 15:04"),
		dur, c.nSensor, c.nState, c.nAction, c.nFault, c.nInternal)
	return nil
}

// step 处理一拍快照（直播路径），单独一个事务。
func (c *collector) step(buf []uint16, ts int64) error {
	tx, err := c.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	wrote, err := c.stepTx(tx, buf, ts)
	if err != nil {
		return err
	}
	if !wrote {
		return nil
	}
	return tx.Commit()
}

// stepTx 处理一拍快照，写入给定事务；返回本拍是否产生写入。
func (c *collector) stepTx(tx *sql.Tx, buf []uint16, ts int64) (bool, error) {
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
				return wrote, err
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
				return wrote, err
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
					return wrote, err
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
				return wrote, err
			}
			c.nFault++
			wrote = true
		} else if seen && !act && prev {
			if _, err := tx.Exec(`UPDATE fault_normal SET clear_ts=?, status=0
				WHERE fault_code=? AND status=1`, ts, f.Code); err != nil {
				return wrote, err
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
				return wrote, err
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
					return wrote, err
				}
				c.nInternal++
			}
			copy(c.fifoBase[off:off+4], cu) // 变了就 resync，防失步
			if err := saveFifo(m, cu); err != nil {
				return wrote, err
			}
		}
	}

	return wrote, nil
}
