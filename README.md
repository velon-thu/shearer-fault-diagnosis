# 采煤机故障诊断点检仪（shearer-fault-diagnosis）

面向井下工作面的便携式采煤机故障诊断与点检系统。工控机负责采集、入库并提供接口，平板用浏览器全屏访问，
维修人员在一块屏上完成"看机况 → 查故障 → 定位原因 → 做点检"的闭环。

- **前端**：Next.js App Router + TypeScript + ECharts（静态导出，工业暗色风，全触屏大控件）
- **后端**：Fastify + WebSocket + SQLite（Node 内置 `node:sqlite`）
- **数据面**：两个 Go 程序（org 回放器 + 共享内存采集器），把现场 org 数据包变成实时数据流
- **共享协议**：`packages/contracts` 里的 zod schema，前后端同一份类型

---

## 一、功能

### 主页面（Launchpad）

单屏不滚动。左上角机况胶囊 3s 轮询 `/api/machine-status`，实时显示**割煤中 / 牵引调度 / 停机 / 离线**
四种机况和当前牵引速度；中间大时钟；下方 11 个功能宫格。

### 页面间导航

子页面顶部是一条固定的导航栏（`AppShell`，高度 `--nav-h`），不覆盖内容：

- **左：退一层**。标签直接写目的地——在页面第一层写「‹ 主页面」，在页内子视图写上一级的名字（如「‹ 选择信号」）。
- **中：面包屑**「页面 › 当前子视图」，随时知道自己在第几层。
- **右：「主页面」直达键**，只在子视图里出现（第一层时左边的返回就是主页面，不重复放）。

页面自己声明层级：`<AppShell back={{ label, onClick }} viewTitle="…" />`，不传 `back` 就是第一层。
页内不再各写各的返回按钮；弹窗仍由自己的关闭键收起，导航栏在遮罩之下（点遮罩即关）。

### 功能页面

| 页面 | 路由 | 说明 |
| --- | --- | --- |
| 登录 | `/login` | 工号 + 密码，内置屏幕软键盘（Ubuntu 平板不易唤起系统键盘），确认键自动跳下一项 |
| 传感器 | `/sensors` | 7 个分组总览（压力/流量/油位、速度/位置、温度、电流…）⇄ 全屏详情；详情图可框选任意时间段，缩放到秒级 |
| 信号对比 | `/signals` | 最多勾选 4 路测点叠加到同一张图，联动缩放，用于判断相关性 |
| 实时故障 | `/live-faults` | LIVE 故障流（3s 轮询）：进行中/已消除分区、停机/警告/内部三色分级、"已持续"秒级跳动；点开条目看处理建议，并可进**故障现场**（见下节） |
| 引导性故障排查 | `/guide` | 两条入口。**按故障码**：① 选起点（进行中故障，或按变频器/电机/模块/传感器/自动化/内部六个部位）→ ② 定位故障（按"进行中 → 发生过 → 频次"排序）→ ③ 按步排查（`fault_rule.handle` 拆条打勾 + 进度条，直接调故障现场/时间线/信号对比/体检）。**按诊断树**：厂家诊断树原样进系统（见下节），调高 / 系统牵引 / 电机启停三棵，逐问作答，节点旁挂机器数据旁证 |
| 事件时间线 | `/timeline` | 双滑块选时间段，把故障、消除、操作指令、状态切换按时序拉成一条线，还原"人做了什么 → 机器怎么反应" |
| 一键体检 | `/health` | 八个分项各自计分（模块通讯 18／停机故障 20／警告故障 14／数据链路 8／传感器 12／牵引对称性 10／温度余量 10／运行稳定性 8），点开任一项看**扣分理由**；由未接测点与配置提示引发的常驻报警单列「不计分」；详情分页看需处理故障、常驻报警、牵引对称性、模块与测点 |
| 停机分析 | `/downtime` | 状态机四分类（割煤/牵引调度/停机/断电）＋ 归因引擎（故障停机 / 人工停机 / 空闲）；KPI 按故障停机口径统计次数、总时长、最长单次、割煤时长占比；时间带可视化 + 明细弹窗 |
| 近期故障排名 | `/rankings` | 先用大号双滑块选时间范围（限库内实际数据窗），再看全宽排名条目；点条目弹出处理建议；"故障设置"可搜索并显隐特定故障 |
| 故障代码查询 | `/fault-codes` | 系统故障（BOC/HPC 三级解析 + MOC 来源码，一律十六进制呈现）与 ACS880 变频器故障码全量目录二选一；20 个常用代码方块 + 大键盘自定义查询 |
| 日常检修打卡 | `/checkins` | 四个打卡项大卡，底部历史记录日历弹窗 |
| 知识库 | `/knowledge` | 左目录 + 右阅读双栏（macOS 边栏风格）：整机与型号 / 液压系统 / 截割部 正文资料（内容写在 `apps/tablet/src/app/knowledge/content.ts`，加条目自动进目录），最后一组是后端下发的图纸图册与安装、排查视频清单 |
| 系统设置 | `/settings` | 连接总览（8 个模块通讯位）＋ **数据源实况**（库大小、覆盖时长、数据滞后、各表记录数、诊断树装载情况）＋ 机型与工作面 ＋ **工控机实况**（主机名、网卡地址、系统、Node、服务已运行）＋ 版本记录 ＋ **界面风格切换**（暗色/亮色）。运行信息全部现读，不是配置里写死的 |

> 后端仍保留 `/api/analysis/*`（截割部/牵引部/泵）与 `/api/run-cycle` 三组接口，但对应页面已在
> `f6929ab` 下线，当前无前端入口。

### 故障现场

故障时刻 **前后各 5 分钟**的三样东西，顶部先给一段结论：

- **12 路关键信号曲线**（2 秒一格）。点任一张进放大子视图，可捏合/滚轮缩放、拖滑块选区间，
  故障时刻标红竖线。曲线颜色按变化类型走：掉零红、涨跌橙、平稳蓝、测点无效灰。
- **操作记录**：窗口内每一条按下，区分「操作」（人按的）与「输出」（主控发的），按相对故障时刻
  的偏移（`-2m26s` / `+19s`）对齐，故障之前的行左侧压一条竖线。
- **异常与状态**：同期其他故障的发生/消除、关键电机启停。

**结论是规则推出来的，不是模型编的**，三路证据各自独立判断后合成一句话：

| 判据 | 怎么算 |
| --- | --- |
| 曲线变化 | 每路比故障前 60s 与后 60s 的均值：掉到基准 8% 以内=掉零，降 35%=下降，涨 50%=上升，其余不报 |
| 人为停机 | 故障前 60s 内有停类操作，**且**紧接着有电机停止状态位/信号掉零 → 判为"停机操作带出来的连锁报警" |
| 间歇性故障 | 同名故障在 10 分钟窗口内重复出现 ≥3 次 → 判为接插件松动/线路虚接/通讯受扰 |
| 多路同时掉零 | 无停机操作却有 ≥3 路掉零 → 倾向供电中断或模块通讯丢失 |

拿不准的一律写进「说不准」一行（无效测点数、窗口内无操作记录、2 秒聚合看不到瞬时波动），
不把"可能"写成"就是"。判"机器真停了"以电机停止状态位为准，不能只看信号掉零——牵引速度会反向、
负荷会降到低位但不为零，只看掉零会把明明停了的判成"没跟着掉"。

### 诊断树 + 数据旁证

厂家诊断树以 `docs/*诊断树*/diagnosis-tree(s).yaml` 为**唯一数据源**，保留节点、选项与跳转逻辑。
`tools/build-diagnosis-trees.py` 把 YAML 转成后端种子文件，并在展示措辞替换前做三重校验：逐字段无损比对
（节点文本、选项、`status`、`note`、`source_page` 全部带走）、孤儿节点检查、以及重放
`acceptance-tests.md` 里的全部验收路径。任何一项不过就直接退出，不写坏种子。
校验通过后，脚本按固定规则将外部入口名称替换为本机功能名称，并调整资料来源相关措辞；
YAML 原件保持不变，诊断判据与安全提示保留。

| 树 | id | 规模 | 结构 |
| --- | --- | --- | --- |
| 采煤机调高故障 | `arm-height` | 6 机型 · 169 节点（94 问 / 75 结论）· 9 个待补录分支 | 多模块，先选机型 |
| 采煤机系统牵引故障 | `traction` | 53 节点（27 问 / 26 结论）· 0 待补录 · 38 条验收路径全通 | 单模块，直接进第一问 |
| 采煤机电机启停故障 | `motor-start-stop` | 4 模块 · 133 节点（69 问 / 64 结论）· 3 个待补录 · 79 条验收路径全通 | 多模块（泵/截割/破碎/自启动油泵） |

三种 YAML 布局都支持，转换时统一收敛成"树 → 模块 → 节点"：

- 调高树：顶层 `modules[]`，`nodes` 是 `{id: node}` 字典
- 牵引树：顶层 `system{}` + 扁平 `nodes{}`，包成单模块，前端跳过选机型那一屏
- 电机启停树：顶层 `modules[]`，但 `nodes` 是列表、模块不带 `index`，`safety_notice` 是条目数组

`introduction`（原理说明）与 `safety_notice`（安全须知）在第一问展示一次。`next: null` 的分支照实
显示"待补录"，不允许程序自行推断结论。

在树不动的前提下，每个节点旁边挂一张**数据证据卡**，按树走各自的证据接口：

| 策略 | 调高（`arm-evidence`） | 牵引（`traction-evidence`） | 电机启停（`motor-evidence`） |
| --- | --- | --- | --- |
| **链式定位** | 指令段（`device_action` 输入侧）→ 输出段（"系统输出"）→ 效果段（采高变化） | 同口径，效果段换成实测速度 | 启动链五位：启动预警 → 启动过程中 → 接触器吸合 → 运行中（＋漏电闭锁） |
| **直接作答** | q01「单边还是双侧」左右分别判 | HPC / 牵电 / 牵启 / 泵 / 方向，全是现成状态位 | 启动提示、是否起来、闭锁提示、接触器吸合，一问一位 |
| **来源分布** | 端头站、遥控器分别统计带动比例 | 牵停与减速指令按来源分组 | 总停/急停/泵停/截停/破停 按来源分组，正是"停止信号来自哪里"那一问 |
| **复盘** | 结论页给调高效率基线对比 | 三段链 + 松闸链 + 左右负荷对称 | 累计运行时长与掉停次数（对应"能否持续平稳运转"） |
| **诚实兜底** | 调高高低压、端子 24V、手动阀、总阀阀杆 | 端子电压、绝缘摇测、变频器面板；牵引接触器无独立反馈位，改用母线电压当旁证 | MOC 端子 24V、短接试吸合（高风险带电，卡片保留安全提醒）、控制变压器、绝缘；破碎机五位全 0 判为本机未配备 |

数据只做**建议**：命中的选项打「数据倾向」标记，永不自动跳转，且同一问只会命中一个选项。

两条容易踩的口径：

- `sensor_hyper` 是沿变 + 60s 快照存储，**指令窗口内查不到记录等于"值没变"（没动），不是缺数据**。
- 状态位与实际运行矛盾时以运行为准：本机 `brake_release_ack`（松闸确认）长期为 0，但同期变频器在
  输出、实测速度 8.6 m/min——这种情况判**该位无效**并写明，绝不能反过来报制动回路故障。
- 状态位全程为 0 的设备判"未配备"而不是"故障"：本机破碎电机五位全 0，卡片直说数据帮不上忙。

同一条口径也贯穿一键体检的评分：

- **未接测点引发的常驻报警不扣分**。本机水路流量、泵箱油位、背压根本没接线，读数恒定，
  系统里常年挂着二十多条"流量检测通道保护""泵箱油位低"。照单扣分会让一台好机器永远六十分，
  所以按名称匹配到对应测点、确认该测点读数恒定后，把这些归入「存疑报警」单列不计分。
- **"参数组未通过验证""泵电机配置为…"这类是配置状态，不是故障**，同样单列。
- **只做牵引电机的左右对称性**。采煤机左右真正同规格同工况的只有牵引部；截割两侧割的煤不一样、
  水路右侧压力测点已坏，硬比出来的"关注"全是噪声。
- **数据滞后时跳过传感器项**。数据一停所有测点都会显示"读数过期"，那是链路的问题，数据链路项
  已经扣过，不能再按"传感器全坏"扣第二遍。

新增诊断树把目录放进 `docs/` 再跑一次脚本即可，前端 `/guide` 自动多出入口：

```bash
python3 tools/build-diagnosis-trees.py   # → services/ipc-api/seed/diagnosis-trees.json
```

节点与证据的绑定表在 `apps/tablet/src/app/guide/evidence/`（`index.ts` 是注册表，一棵树一个
provider，按节点文本匹配）。树本身不带任何业务标注，换树不影响绑定层。绑定正则要锚定"这一问实际
在问什么"，不是"正文提到了什么"——牵引树 q03 正文里出现"牵引电机绝缘"，但它问的是接触器吸没吸合。

---

## 二、架构

### 分层

```
┌──────────────────────────────────────────────────────────┐
│  平板浏览器（全屏）                                        │
│  apps/tablet  Next.js App Router + ECharts               │
│  · 全部实时数据客户端拉取，不做构建期 fetch                 │
│  · HTTP 轮询 /api/*  +  WebSocket /ws/live                │
└───────────────┬──────────────────────────────────────────┘
                │ HTTP :18080 / WS
┌───────────────▼──────────────────────────────────────────┐
│  工控机 IPC                                               │
│  services/ipc-api   Fastify + @fastify/websocket          │
│  · 出入参一律用 packages/contracts 的 zod schema 校验      │
│  · DataplaneDataSourceAdapter 读 shearer.db（真实数据），   │
│    继承 MockDataSourceAdapter（打卡/知识库/设置/认证兜底）  │
│  · 自有 ipc.db 存打卡、知识库、设置等业务数据               │
└───────────────┬──────────────────────────────────────────┘
                │ 只读 SQLite  +  /dev/shm 直读
┌───────────────▼──────────────────────────────────────────┐
│  数据面 services/dataplane（Go）                          │
│  replayer   org 文件 → 共享内存 td3sharemem                │
│  collector  共享内存 → shearer.db（沿变记录 + 60s 快照）    │
└──────────────────────────────────────────────────────────┘
```

### 数据链路

```
testdata/*.org → [replayer] → 共享内存 td3sharemem → [collector] → shearer.db → ipc-api → 平板
```

- **org 数据包**：`c2026-06-26 ~ c2026-06-30`，zlib 压缩，定长 1226 字节/记录，1 个毫秒时间戳 + 609 个
  uint16（解析规则见 `docs/org解析规则.md`）。
- **同步点定格**：默认同步点为 org 时间 `2026-06-30 20:47:50`（`defs.DefaultSyncOrgTsMs`，选点在运行中 +
  故障峰值时段）。collector 启动即**清库**，先把同步点之前约 150h 的数据预载入库（时间轴平移到"现在"结尾），
  再由 replayer 从同步点起按 org 原始时间戳 **1:1 实时**续灌——每次重启系统都回到同一个演示场景，
  故障持续时长与真实数据完全一致。
- **存储策略**：传感器/状态值变化才写 + 每 60s 强制全量快照；操作与故障按沿变记录；FIFO 基准持久化。

### 目录结构

```
shearer-fault-diagnosis/
├── apps/tablet/              # 平板前端（Next.js，静态导出 output: "export"）
│   └── src/app/*/page.tsx    # 各功能页
├── services/
│   ├── ipc-api/              # 工控机数据服务（Fastify，:18080）
│   │   ├── seed/             # 诊断树种子（由 docs 的 YAML 生成，随仓库走）
│   │   └── src/
│   │       ├── app.ts        # 全部路由
│   │       ├── ingest/       # 数据源适配器（dataplane / real / mock）
│   │       ├── diagnosis/    # 诊断树加载（只读种子、只校验、不改写）
│   │       ├── db/           # ipc.db：打卡、知识库、设置、故障字典
│   │       └── shm/live.ts   # /dev/shm 直读，共享内存实时快照
│   └── dataplane/            # Go 数据面
│       ├── cmd/replayer/     # org → 共享内存
│       ├── cmd/collector/    # 共享内存 → shearer.db
│       ├── internal/         # org 解析、shm 读写、store、定义与规则
│       └── seed/*.csv        # go:embed 的种子表（测点定义、故障规则、操作码）
├── packages/contracts/       # 前后端共享 zod schema 与类型
├── testdata/*.org            # 5 天现场 org 数据包
├── scripts/                  # 一键启动脚本（含残留进程/端口自愈）
├── tools/                    # Excel/CSV → seed 的 Python 提取脚本
└── docs/                     # 解析规则、数据台账、设计稿与设计说明书
```

### 工程规则（摘自 `AGENTS.md`）

- 不允许把业务后端写进 Next API Routes；后端只在 `services/ipc-api`。
- 实时数据一律客户端拉取，不做构建期 fetch。
- 不引入大型 UI 组件库，优先复用设计稿 `docs/reference/coal_tablet_prototype_v3.html` 的样式 token。
- **不写死颜色**：一律用 `globals.css` 顶部的 token。三个 RGB 三元组撑起整套换肤——
  `--ink`（叠加色：描边、分隔线、半透明底）、`--fg`（文字）、`--surf`（实心面板底）；
  语义色走 `--blue/--green/--red/…` 与配套的 `--*-text`、`--*-soft`。
  写 `rgba(255,255,255,.06)` 这种在亮色下会直接消失。
- 图表颜色从 CSS 变量读（`lib/chart-theme.ts` 的 `readChartTheme()`），并监听
  `THEME_CHANGE_EVENT` 重绘；ECharts 不认 CSS 变量，必须在 `setOption` 前取好值。
- 所有接口返回结构先写进 `packages/contracts`，再写前后端。
- 不允许明文把密码存到 localStorage（平板只保存短期 token）。

---

## 三、启动

### 前置依赖

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 22（开发机 v24） | ipc-api 用内置 `node:sqlite` |
| pnpm | 10.15.0 | 见 `package.json` 的 `packageManager` |
| Go | ≥ 1.22 | 只有数据面需要；不跑仿真数据可跳过 |
| Python / PyYAML | Python ≥ 3.10 | 仅重新生成诊断树种子时需要；PyYAML 用于解析原始 YAML，运行服务不需要 |
| 操作系统 | Linux / WSL2 | 共享内存走 `/dev/shm/td3sharemem` |

```bash
pnpm install
export PATH="$HOME/.local/go/bin:$PATH"   # 若 go 不在 PATH
```

### 一键启动（两个终端）

```bash
# 终端 1：数据侧全家桶 —— 编译 Go → 构建 contracts → collector（清库+预载）→ replayer → ipc-api
pnpm services

# 终端 2：平板前端开发服务器
pnpm frontend
```

- 前端：http://localhost:3000 （监听 `0.0.0.0`，平板直接开 `http://<工控机IP>:3000`）
- 后端：http://localhost:18080
- 登录账号：`tiandi` / `tiandi`
- `pnpm services` 会等 collector 打出"预载完成"再拉起 replayer，保证历史与直播无缝衔接；`Ctrl+C`
  一次性停掉三个服务。两个脚本都会**自动清理残留进程和被占端口**，不用手动 `pkill`。
- 日志：`logs/collector.log`、`logs/replayer.log`。

### 平板通过局域网访问（WSL 开发机）

跑 `bash scripts/lan-url.sh` 会打印平板该开的地址，并自检两个端口是否放行。两个前提：

1. **WSL 需要镜像网络**。`C:\Users\<用户>\.wslconfig` 里写 `[wsl2]` + `networkingMode=mirrored`，
   否则 WSL 在 NAT 后面，局域网设备够不着（改完要 `wsl --shutdown` 重启）。
2. **Windows 防火墙要放行 3000 与 18080**，以管理员身份 PowerShell 执行一次即可：

   ```powershell
   New-NetFirewallRule -DisplayName '诊断仪-前端' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -Profile Any
   New-NetFirewallRule -DisplayName '诊断仪-数据服务' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 18080 -Profile Any
   ```

   手机热点通常被判为「公用网络」，`-Profile Any` 不能省。

前端的 API 地址由 `apps/tablet/src/lib/api-base.ts` 统一解析：**只看端口不看主机名**——
访问端口是 3000（dev）就把 API 指到同主机的 18080。早先按主机名判断，平板用 IP 访问时
API 会打到 3000 上全部 404。

### 其他命令

```bash
pnpm dev           # 只起 ipc-api + tablet（不含 Go 数据面，走库里已有数据）
pnpm dev:tablet    # 只起前端
pnpm dev:ipc-api   # 只起后端
pnpm build         # 全量构建（contracts → ipc-api → tablet 静态导出到 apps/tablet/out）
pnpm lint          # 全量 tsc --noEmit
```

### 手工启动数据面

```bash
cd services/dataplane && go build -o bin/ ./cmd/...        # Windows: GOOS=windows GOARCH=amd64
services/dataplane/bin/collector -db services/dataplane/data/shearer.db -dir testdata
services/dataplane/bin/replayer  -dir testdata
```

常用参数：

| 程序 | 参数 | 默认 | 说明 |
| --- | --- | --- | --- |
| replayer | `-interval` | 0 | 固定写入间隔；0 = 按原始时间戳 1:1 实时回放 |
| replayer | `-gap-cap` / `-gap-wait` | 60s / 5s | 超过 gap-cap 的停机空洞压缩为 gap-wait 等待 |
| replayer | `-loop` | false | 播完 5 个文件后从头循环 |
| replayer | `-shm` | td3sharemem | 共享内存映射名 |
| collector | `-scan` | 100ms | 扫描周期 |
| collector | `-snapshot` | 60s | 值未变化时的强制快照周期 |
| collector | `-preload` | 150h | 同步点前预载时长；0 关闭预载 |
| collector | `-sync-org-ts` | 2026-06-30 20:47:50 | 回放同步点 |

### 环境变量

| 变量 | 作用域 | 默认 |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | 前端 | 空。本地 3000 端口时自动指向 `:18080`，其余情况用当前 host（同源部署） |
| `SHEARER_SHM_NAME` | ipc-api | `td3sharemem` |
| `SHEARER_DATAPLANE_DB` | ipc-api | `services/dataplane/data/shearer.db` |

### 冒烟测试（3 步）

```bash
# 1. 后端活着
curl -s http://localhost:18080/api/health

# 2. 机况在跳（state 为 cutting/dispatch/stopped 之一，speedMmin 随时间变化）
curl -s http://localhost:18080/api/machine-status

# 3. 实时故障流有数据（同步点场景下应有进行中的变频器故障）
curl -s http://localhost:18080/api/live-faults
```

浏览器侧：打开 http://localhost:3000 → 用 `tiandi/tiandi` 登录 → 主页机况胶囊有颜色和速度 →
进"实时故障"能看到 LIVE 计数跳动。

本次功能的手工验收步骤：

1. 进入「引导性故障排查」，确认调高、牵引、电机启停三棵树均可打开；选择选项后进入下一问，
   返回可回到上一问，待补录分支明确提示，数据旁证不会自动替用户作答。
2. 在「实时故障」打开一条故障的「故障现场」，确认选中的故障名称、曲线、操作记录和异常状态可查看，
   点击曲线能放大并缩放，返回后仍在该故障现场。
3. 在「系统设置」检查诊断树装载信息与工控机运行信息，切换亮色/暗色后进入趋势图，
   确认图表配色跟随主题；刷新页面后主题保留，导航返回目的地正确。

---

## 四、接口清单

统一返回 `{ success: true, data }` 或 `{ success: false, error: { code, message } }`，
全部由 `packages/contracts` 的 schema 校验。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/bootstrap` | 启动引导（连接状态、机型等） |
| POST/GET | `/api/auth/login`、`/api/auth/logout`、`/api/auth/me` | 认证（当前为 mock auth） |
| GET | `/api/machine-status` | 主页机况胶囊 |
| GET | `/api/home/summary`、`/api/events/weekly` | 首页摘要与周事件 |
| GET | `/api/sensors`、`/api/sensors/:id`、`/api/sensors/:id/trend` | 传感器总览/详情/趋势（`range=10m\|1h\|6h\|24h\|all`，或显式 `from`&`to`） |
| GET | `/api/data-window` | 库内数据时间窗（时间滑块边界） |
| GET | `/api/live-faults` | 实时故障流（普通 + 内部） |
| GET | `/api/freeze-frame?ts=` | 故障现场（±5 分钟：12 路信号带变化判定、操作记录、其他异常与状态、规则生成的结论） |
| GET | `/api/health-check` | 一键体检报告 |
| GET | `/api/diagnosis-trees` | 引导性诊断树（原样下发 `seed/diagnosis-trees.json`） |
| GET | `/api/diagnosis/arm-evidence?window=` | 调高数据旁证（三段定位 / 来源分布 / 效率基线 / 机型收敛 / 无测点声明），`window` 毫秒，缺省 2 小时 |
| GET | `/api/diagnosis/traction-evidence?window=` | 牵引数据旁证（系统状态板 / 三段链 / 指令来源 / 变频器 / 松闸链 / 无测点声明） |
| GET | `/api/diagnosis/motor-evidence?window=` | 电机启停数据旁证（四台电机启动链五位 / 停启指令来源 / 闭锁标志 / 无测点声明） |
| GET | `/api/event-timeline?from=&to=` | 事件关联时间线 |
| GET | `/api/downtime?from=&to=` | 停机分析（KPI + 状态段 + 归因） |
| GET | `/api/rankings?start=&end=&system=` | 近期故障排名 |
| GET | `/api/fault-rules`、`/api/internal-fault-rules` | 故障目录 / 内部故障目录 |
| GET | `/api/fault-codes/search?category=&code=` | 故障代码查询（`category=system\|inverter`） |
| GET/POST | `/api/checkins` | 日常检修打卡 |
| GET | `/api/knowledge/assets` | 知识库资源 |
| GET | `/api/settings` | 系统设置快照 |
| GET | `/api/shm/live` | 共享内存实时快照（调试用，直读 `/dev/shm`） |
| GET | `/api/analysis/pump`、`/api/analysis/cutting`、`/api/analysis/traction`、`/api/run-cycle` | 保留接口，暂无前端页面 |
| WS | `/ws/live` | 实时推送（`AppShell` 用于连接状态与实时事件） |

---

## 五、数据库

### `services/dataplane/data/shearer.db`（Go 采集器写，ipc-api 只读）

| 表 | 内容 |
| --- | --- |
| `sensor_data_defi` / `status_data_defi` | 测点与状态字定义（种子表，`go:embed`） |
| `fault_map` / `ops_map` | 故障码与操作码映射 |
| `fault_rule` / `fault_boc_hpc_rule` / `fault_moc_rule` | 故障规则与处理建议 |
| `sensor_hyper` / `state_hyper` | 传感器、状态字时序数据（沿变 + 60s 快照） |
| `device_action` | 操作指令沿变记录 |
| `fault_normal` / `fault_internal` | 普通故障（带 status/clear）与内部故障事件 |
| `fifo_state` | FIFO 基准持久化 |

### `services/ipc-api/data/ipc.db`（后端自建）

`checkin_records`、`knowledge_assets`、`system_config`、`fault_code_dict`、`fault_events`、
`sensor_samples_raw`、`sensor_samples_1m`（后两张为早期原始/聚合表，目前未接写入）。

### 种子数据更新

Excel《运维系统中的共享内存定义.xlsx》有改动时：

```bash
python3 tools/extract-shm-defi.py                       # 重新生成 seed/*.csv
cd services/dataplane && go build -o bin/ ./cmd/...     # CSV 是 go:embed，必须重编译
```

诊断树 YAML 有增改时（`services/ipc-api/seed/diagnosis-trees.json` 是运行时读取，不是编译期嵌入，
重跑脚本 + 重启 ipc-api 即可生效）：

```bash
python3 tools/build-diagnosis-trees.py                  # 无损校验失败会直接退出，不写坏种子
```

首次生成前若缺少 PyYAML，可在 Python 虚拟环境中运行 `python3 -m pip install PyYAML`。

构建后可运行设置兼容性回归测试（使用内存数据库，不修改本地业务数据）：

```bash
pnpm --filter @shearer/ipc-api exec node --test test/settings.test.cjs
```

---

## 六、部署

当前形态：工控机上跑 `ipc-api`（`:18080`）与前端；平板只开浏览器全屏访问，不装客户端。

```bash
pnpm build                       # 产出 apps/tablet/out（静态） + services/ipc-api/dist
node services/ipc-api/dist/server.js
```

`apps/tablet/out` 是纯静态导出，可由任意静态服务器托管；同源部署时前端会自动把 API 指向当前 host，
无需配置 `NEXT_PUBLIC_API_BASE_URL`。目标形态是 IPC 同时提供 `/`、`/api`、`/ws`——静态托管尚未挂进
Fastify，需要时补 `@fastify/static`。V1 稳定后可把同一套静态前端打进 Tauri，见
`docs/reference/software-design.md`。

---

## 七、常见问题

- **端口被占**：`pnpm services` / `pnpm frontend` 已内置自愈，会自动清理 18080、3000 上的残留进程。
- **前端 dev 时不要跑 `next build`**：两者共用 `.next` 目录，同时跑会把它写坏。要构建就先停 dev server。
- **每次启动数据都被清空**：这是设计——collector 默认 `-reset=true`，重启即回到同步点演示场景。
  想保留历史需显式关掉预载/重置。
- **Windows 部署**：共享内存自动切到 `CreateFileMapping` 命名节，映射名不变；但 `/api/shm/live`
  目前只实现了 Linux `/dev/shm` 直读，Windows 上需改由采集器侧转发。
- **认证仍是 mock**：`tiandi/tiandi` 为演示账号，正式版要换成工控机统一认证 + 平板短期 token。
- **BOC 展示性覆盖**：现有 org 数据第 285 列（BOC 通讯值）几乎全程为 0，为满足"启动即 BOC 正常"的演示
  需求，`defs.go` 的 WritePlan 末尾固定写 1，接真实数据源后需删除。

---

## 八、文档索引

| 文档 | 内容 |
| --- | --- |
| `AGENTS.md` | 技术栈、目录约定、工程规则、完成标准 |
| `docs/reference/software-design.md` | 系统设计说明书（分期规划与技术选型） |
| `docs/reference/coal_tablet_prototype_v3.html` | UI 设计稿（样式 token 来源） |
| `docs/org解析规则.md` | 本项目版 org 解析规则（含 → 共享内存映射） |
| `docs/ORG数据包Go解析说明.md` | 原始 org 数据包解析说明 |
| `docs/data-map.md` | 现场数据源 → 入库 → contracts → 页面的映射台账 |
| `docs/采煤机调高故障诊断树/` | 厂家诊断资料原件（YAML 为唯一数据源，另附 md/json 与配图） |
| `docs/采煤机系统牵引故障诊断树/` | 同上，另有 `acceptance-tests.md`（38 条验收路径，构建时会重放） |
| `docs/采煤机电机启停故障诊断树/` | 同上，4 个模块 + 79 条验收路径 |
| `docs/current-status.md` | 阶段性状态记录（更新于 2026-04-07，部分内容已滞后） |
| `services/dataplane/README.md` | 数据面构建、运行参数与行为约定 |
