// replayer：org 数据包 → 共享内存回放器。
//
// 丢弃 org 原始时间戳，按当前系统时间紧密逐行写入（间隔 -interval，默认 100ms），
// 不还原原始采样间隔与空洞；多个 org 文件按文件名顺序连播。
// 每次启动共享内存清零重写；尾部元数据字（心跳/计数/进度）供 collector 与监视页使用。
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
		interval = flag.Duration("interval", 100*time.Millisecond, "每条记录写入间隔")
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
	mem.Set(shm.MetaIntervalMs, uint16((*interval).Milliseconds()))

	log.Printf("共享内存 %s (%d words) 就绪，%d 个文件，间隔 %v，写入指令 %d 条",
		mem.Name(), mem.Len(), len(files), *interval, len(plan))

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	var total uint32
	tick := time.NewTicker(*interval)
	defer tick.Stop()

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
			log.Printf("[%d/%d] %s：%d 条记录（约 %s 播完）",
				fi+1, len(files), filepath.Base(path), len(records),
				(time.Duration(len(records)) * (*interval)).Round(time.Second))

			for ri := range records {
				select {
				case <-stop:
					log.Printf("收到退出信号，共写入 %d 条", total)
					return
				case <-tick.C:
				}
				rec := &records[ri]
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
		log.Printf("一轮播完（%d 条），-loop 开启，从头继续", total)
	}

	fmt.Println()
	log.Printf("回放完成，共写入 %d 条。保持共享内存驻留，Ctrl+C 退出。", total)
	<-stop
}
