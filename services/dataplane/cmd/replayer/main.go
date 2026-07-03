// replayer：org 数据包 → 共享内存回放器。
//
// 按 org 原始时间戳 1:1 实时回放（保持与真实数据源相同的速率，
// 故障持续时长与原始数据一致）；记录间隔超过 -gap-cap（默认 60s）的
// 停机空洞压缩为 -gap-wait（默认 5s）等待。多个 org 文件按文件名顺序连播。
// 每次启动共享内存清零重写；尾部元数据字（心跳/计数/进度）供 collector 使用。
package main

import (
	"flag"
	"fmt"
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
)

func main() {
	log.SetFlags(log.Ltime)
	var (
		shmName  = flag.String("shm", shm.DefaultName, "共享内存映射名")
		words    = flag.Int("words", shm.Words, "共享内存字数")
		dir      = flag.String("dir", "testdata", "org 文件目录")
		interval = flag.Duration("interval", 0, "固定写入间隔（0=按原始时间戳实时回放）")
		gapCap   = flag.Duration("gap-cap", 60*time.Second, "视为停机空洞的间隔阈值")
		gapWait  = flag.Duration("gap-wait", 5*time.Second, "停机空洞的压缩等待时长")
		loop     = flag.Bool("loop", false, "播完后从头循环")
		startTs  = flag.Int64("start-org-ts", defs.DefaultSyncOrgTsMs, "起播 org 毫秒时间戳（之前的记录跳过，由 collector 预载）")
	)
	flag.Parse()

	d, err := defs.Load()
	if err != nil {
		log.Fatalf("加载定义: %v", err)
	}
	plan := d.WritePlan()

	files, err := filepath.Glob(filepath.Join(*dir, "*.org"))
	if err != nil || len(files) == 0 {
		log.Fatalf("目录 %s 下没有 .org 文件", *dir)
	}
	sort.Strings(files)

	mem, err := shm.Create(*shmName, *words)
	if err != nil {
		log.Fatalf("创建共享内存: %v", err)
	}
	defer mem.Close()
	mem.Zero()
	mem.Set(shm.MetaFileTotal, uint16(len(files)))
	mem.Set(shm.MetaIntervalMs, uint16((*interval).Milliseconds())) // 0=实时节奏

	paceDesc := "原始时间戳实时(1:1)"
	if *interval > 0 {
		paceDesc = (*interval).String() + "/条(固定)"
	}
	log.Printf("共享内存 %s (%d words) 就绪，%d 个文件，节奏 %s，写入指令 %d 条",
		mem.Name(), mem.Len(), len(files), paceDesc, len(plan))

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	var total uint32
	var prevTs int64 // 上一条记录的 org 时间戳（跨文件延续）

	// 等待到下一条记录的时刻；返回 false 表示收到退出信号
	wait := func(d time.Duration) bool {
		if d <= 0 {
			return true
		}
		select {
		case <-stop:
			return false
		case <-time.After(d):
			return true
		}
	}

replay:
	for {
		for fi, path := range files {
			records, err := orgfile.ParseFile(path)
			if err != nil {
				log.Fatalf("解析 %s: %v", path, err)
			}
			records = orgfile.Clean(records)
			if *startTs > 0 {
				kept := records[:0]
				for _, r := range records {
					if r.TimestampMs >= *startTs {
						kept = append(kept, r)
					}
				}
				records = kept
			}
			if len(records) == 0 {
				log.Printf("[%d/%d] %s：全部早于起播点，跳过", fi+1, len(files), filepath.Base(path))
				continue
			}
			mem.Set(shm.MetaFileIndex, uint16(fi+1))
			log.Printf("[%d/%d] %s：%d 条记录", fi+1, len(files), filepath.Base(path), len(records))

			for ri := range records {
				rec := &records[ri]
				// 节奏控制：固定间隔 或 按原始时间戳 1:1（长空洞压缩）
				var d time.Duration
				if *interval > 0 {
					d = *interval
				} else if prevTs > 0 {
					d = time.Duration(rec.TimestampMs-prevTs) * time.Millisecond
					if d > *gapCap {
						log.Printf("停机空洞 %v（%s 处），压缩为 %v",
							d.Round(time.Second), time.UnixMilli(rec.TimestampMs).Format("15:04:05"), *gapWait)
						d = *gapWait
					}
				}
				if !wait(d) {
					log.Printf("收到退出信号，共写入 %d 条", total)
					return
				}
				prevTs = rec.TimestampMs
				for _, ins := range plan {
					mem.Set(ins.Addr, ins.Expr.Eval(rec))
				}
				total++
				mem.Set(shm.MetaHeartbeat, uint16(total))
				mem.Set(shm.MetaRecordLo, uint16(total))
				mem.Set(shm.MetaRecordHi, uint16(total>>16))
				if total%3000 == 0 {
					log.Printf("已写入 %d 条（当前文件 %d/%d）", total, ri+1, len(records))
				}
			}
		}
		if !*loop {
			break replay
		}
		prevTs = 0
		log.Printf("一轮播完（%d 条），-loop 开启，从头继续", total)
	}

	fmt.Println()
	log.Printf("回放完成，共写入 %d 条。保持共享内存驻留，Ctrl+C 退出。", total)
	<-stop
}
