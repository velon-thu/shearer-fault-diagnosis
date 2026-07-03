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
| replayer | `-interval` | 0 | 固定写入间隔；0=按原始时间戳 1:1 实时回放 |
| replayer | `-gap-cap` / `-gap-wait` | 60s / 5s | 超过 gap-cap 的停机空洞压缩为 gap-wait 等待 |
| replayer | `-loop` | false | 播完 5 个文件后从头循环 |
| replayer | `-shm` | td3sharemem | 共享内存映射名 |
| collector | `-scan` | 100ms | 扫描周期 |
| collector | `-snapshot` | 60s | 值未变化时的强制快照周期 |

## 行为约定

- **每次启动重置**：collector 启动即清空业务表（-reset=true），随后预载、
  再直播——重开系统总是回到同步点时刻的状态。
- **预载 + 直播**：同步点默认 org 时间 2026-06-30 20:45（defs.DefaultSyncOrgTsMs，
  选点：采煤机运行中且故障种类峰值时段）。collector 直接解析 org 把同步点前
  全部数据（-preload 默认 150h，即 06-26 起约 4.9 天）灌库（时间轴平移到"现在"结尾）；
  replayer 从同步点起播（-start-org-ts），按 org 原始时间戳 1:1 实时写共享内存
  （与真实数据源同速率，故障持续时长保真；长空洞压缩，见上表）。
  start-services.sh 会先等预载完成再起回放器，保证历史与直播无缝衔接。
- **BOC 展示性覆盖**：现有 org 数据第 285 列（BOC 通讯值，地址 2000）几乎全程为 0，
  为满足"启动即 BOC 正常"的演示需求，WritePlan 末尾固定写 1（defs.go，接真实数据源后删除）。
- **存储策略**：sensor/state 值变化才写 + 每 60s 全量快照；操作与故障按
  沿变记录；FIFO 基准持久化在 fifo_state 表。
- 表结构与解析规则详见 `docs/org解析规则.md` 与 `internal/store/store.go`。

## 种子数据更新

Excel《运维系统中的共享内存定义.xlsx》有改动时：

```bash
python3 tools/extract-shm-defi.py   # 重新生成 seed/*.csv
cd services/dataplane && go build -o bin/ ./cmd/...   # CSV 是 go:embed，需重编译
```
