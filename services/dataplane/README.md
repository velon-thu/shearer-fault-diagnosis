# dataplane：org 回放 + 共享内存采集数据面

两个 Go 程序组成本项目的仿真数据链路：

```
testdata/*.org → [replayer] → 共享内存 td3sharemem → [collector] → data/shearer.db → ipc-api → 平板前端
```

## 构建

```bash
cd services/dataplane
go build -o bin/ ./cmd/...
```

Windows 交叉编译：`GOOS=windows GOARCH=amd64 go build -o bin/ ./cmd/...`
（共享内存自动切换为 CreateFileMapping 命名节，映射名不变。）

## 运行（在仓库根目录）

```bash
# 1. 回放器：org → 共享内存，默认每 100ms 写一条记录
services/dataplane/bin/replayer -dir testdata -interval 100ms

# 2. 采集器：100ms 扫描共享内存 → SQLite
services/dataplane/bin/collector -db services/dataplane/data/shearer.db

# 3. ipc-api / 前端照常启动
pnpm dev
```

常用参数：

| 程序 | 参数 | 默认 | 说明 |
|---|---|---|---|
| replayer | `-interval` | 100ms | 每条记录写入间隔（回放节奏） |
| replayer | `-loop` | false | 播完 5 个文件后从头循环 |
| replayer | `-shm` | td3sharemem | 共享内存映射名 |
| collector | `-scan` | 100ms | 扫描周期 |
| collector | `-snapshot` | 60s | 值未变化时的强制快照周期 |

## 行为约定

- **回放**：丢弃 org 原始时间戳，按当前系统时间紧密逐行写入；不还原原始
  采样间隔与空洞；每次启动共享内存清零重写。
- **采集**：数据库持续累积（重启不清空）；启动时把上次遗留的未结束故障
  统一关闭（clear_ts=启动时刻）；回放器未写入前所有引擎挂起。
- **存储策略**：sensor/state 值变化才写 + 每 60s 全量快照；操作与故障按
  沿变记录；FIFO 基准持久化在 fifo_state 表，跨重启不误报。
- 表结构与解析规则详见 `docs/org解析规则.md` 与 `internal/store/store.go`。

## 种子数据更新

Excel《运维系统中的共享内存定义.xlsx》有改动时：

```bash
python3 tools/extract-shm-defi.py   # 重新生成 seed/*.csv
cd services/dataplane && go build -o bin/ ./cmd/...   # CSV 是 go:embed，需重编译
```
