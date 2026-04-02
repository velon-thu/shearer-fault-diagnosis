## 技术栈

* **前端**：Next.js App Router + TypeScript
* **样式**：直接沿用设计稿coal_tablet_prototype_v3.html里的 CSS token 和工业暗色风，不要一开始重写成 Tailwind
* **图表**：ECharts
* **数据请求**：TanStack Query
* **轻状态**：Zustand
* **后端**：Fastify（TypeScript）+ WebSocket
* **数据库**：SQLite
* **部署方式**：工控机同时提供静态前端和 `/api` `/ws`；平板只开浏览器全屏访问

我不建议一上来就上 Tauri，原因不是它不好，而是我现在最重要的是**先把业务跑通**。浏览器全屏版最简单、更新最集中、调试最快。等 V1 稳定后，再把同一套静态前端包进 Tauri。
Tauri 后续也完全能接这套方案，而且它本身支持最小权限的 capability/permission 控制。
---
## 逐步开发流程

### 第 1 步：先定 MVP，不要全量一起上

先把功能分三批，不然很容易越做越散。

**M1 先做：**
登录、主页、传感器、故障代码查询、截割部分析、牵引部分析、泵分析、系统设置。

**M2 再做：**
近期故障排名、日常检修打卡、知识库。

**M3 最后做：**
运行循环图这种“多坐标可配置”的高级分析页。

coal_tablet_prototype_v3.html这个设计稿里已经有很多 mock 数据：`weeklyEvents`、`sensors`、`faultDictionary`、`logs`、`alerts`、`checkinCalendarRecords` 等。最正确的做法不是立刻接真数据，而是**先把这些 mock 数据搬进项目**，让页面先全跑起来，再逐页替换为真实接口。

---

### 第 2 步：先建一个 monorepo

目录直接这么建：

```bash
mkdir cm-diagnostic && cd cm-diagnostic

cat > pnpm-workspace.yaml <<'EOF'
packages:
  - apps/*
  - services/*
  - packages/*
EOF

pnpm create next-app apps/tablet --ts --app --eslint --src-dir --import-alias "@/*"

mkdir -p services/ipc-api
mkdir -p packages/contracts
mkdir -p docs
```

然后补依赖。

前端：

```bash
pnpm -C apps/tablet add @tanstack/react-query zustand zod echarts echarts-for-react clsx
```

后端：

```bash
cd services/ipc-api
pnpm init
pnpm add fastify @fastify/cors @fastify/websocket zod better-sqlite3 bcryptjs jsonwebtoken
pnpm add -D typescript tsx @types/node
cd ../..
```

共享 contracts：

```bash
cd packages/contracts
pnpm init
pnpm add zod
pnpm add -D typescript
cd ../..
```

最终仓库建议长这样：

```text
cm-diagnostic/
  apps/
    tablet/                 # Next.js 平板前端
  services/
    ipc-api/                # 工控机数据服务
  packages/
    contracts/              # 前后端共用类型与 zod schema
  docs/
    data-map.md
    api-design.md
    deployment.md
```

---

### 第 3 步：先定义共享数据协议，不要先写页面

这是成败关键。先在 `packages/contracts` 里把返回结构定死，前后端都按这套来。

至少先定义这些类型：

* `ConnectionStatus`
* `HomeSummary`
* `SensorSummary`
* `SensorTrendPoint`
* `FaultCodeResult`
* `AnalysisSnapshot`
* `RankingItem`
* `CheckinRecord`
* `KnowledgeAsset`
* `SettingsSnapshot`

例如：

```ts
// packages/contracts/src/index.ts
import { z } from "zod";

export const ConnectionStatusSchema = z.object({
  tabletToIpc: z.enum(["connected", "disconnected"]),
  hpc: z.enum(["ok", "warn", "error", "offline"]),
  moc: z.enum(["ok", "warn", "error", "offline"]),
  boc: z.enum(["ok", "warn", "error", "offline"]),
  syncAt: z.string(),
});

export const SensorSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  location: z.string(),
  state: z.string(),
  valid: z.boolean(),
  failures30d: z.number(),
  lastSeen: z.string(),
  unit: z.string(),
});
```

这样做有两个好处：

1. 你以后换后端实现，前端不用乱改。
2. Codex 很容易在这一层持续协作，不会前端字段叫 `lastSeen`，后端突然写成 `last_seen`。

---

### 第 4 步：先做“假后端”，把所有页面跑通

后端第一版不要接真实传感器，直接把设计稿里的 mock 数据搬进去。

建议先做这些接口：

```text
GET  /api/bootstrap
GET  /api/home/summary
GET  /api/events/weekly
GET  /api/sensors
GET  /api/sensors/:id
GET  /api/sensors/:id/trend?range=24h
GET  /api/fault-codes/search?category=system&code=0x0094
GET  /api/analysis/cutting?range=24h
GET  /api/analysis/traction?range=24h
GET  /api/analysis/pump?range=24h
GET  /api/rankings?start=2026-03-01&end=2026-03-31&system=all
GET  /api/checkins
POST /api/checkins
GET  /api/knowledge/assets
GET  /api/settings
WS   /ws/live
```

Fastify 起步代码可以直接这样写：

```ts
// services/ipc-api/src/server.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(websocket);

app.get("/api/bootstrap", async () => {
  return {
    machineModel: "MG500/1180-WD",
    connection: {
      tabletToIpc: "connected",
      hpc: "ok",
      moc: "ok",
      boc: "warn",
      syncAt: new Date().toISOString(),
    },
  };
});

app.get("/api/sensors", async () => {
  return [
    {
      id: "sensor-1",
      name: "右牵引箱温度传感器",
      type: "温度",
      location: "右牵引箱",
      state: "失效频发",
      valid: false,
      failures30d: 12,
      lastSeen: "2026-03-10 14:10:23",
      unit: "℃",
    },
  ];
});

app.get("/ws/live", { websocket: true }, (socket) => {
  const timer = setInterval(() => {
    socket.send(JSON.stringify({
      type: "connection_status",
      payload: {
        tabletToIpc: "connected",
        hpc: "ok",
        moc: "ok",
        boc: Math.random() > 0.7 ? "warn" : "ok",
        syncAt: new Date().toISOString(),
      },
    }));
  }, 1000);

  socket.on("close", () => clearInterval(timer));
});

app.listen({ host: "0.0.0.0", port: 18080 });
```

---

### 第 5 步：把设计稿拆成 Next.js 组件，不要整页硬塞

你的 HTML 设计稿现在是“一个大文件 + 全局脚本”。这个只能当原型，不能直接当生产结构。正确迁移顺序是：

1. 把 `:root` 变量和通用暗色 token 搬到 `globals.css`
2. 把外层壳子拆成 `AppShell`
3. 再拆状态芯片、统计卡片、表格、图表容器
4. 最后拆页面

建议的前端目录：

```text
apps/tablet/src/
  app/
    layout.tsx
    page.tsx
    sensors/page.tsx
    fault-codes/page.tsx
    analysis/
      cutting/page.tsx
      traction/page.tsx
      pump/page.tsx
    rankings/page.tsx
    checkins/page.tsx
    knowledge/page.tsx
    settings/page.tsx
    run-cycle/page.tsx
  components/
    shell/AppShell.tsx
    status/StatusChip.tsx
    cards/SummaryCard.tsx
    charts/TrendChart.tsx
    lists/RankingList.tsx
    tables/DataTable.tsx
    checkin/CheckinCalendar.tsx
```

这里有一个非常重要的点：**因为你要用 static export，所有实时数据都必须在客户端拉。** Next.js 文档说明，静态导出下 `app` 目录里的 Server Components 是在 `next build` 时运行的；所以主页、传感器页、分析页不要把实时采集数据写成构建期 fetch，而要用 client component + TanStack Query + WebSocket。([Next.js][1])

Next 配置直接这样：

```js
// apps/tablet/next.config.mjs
const nextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
```

你原型里已经有完整的工业风 token 和交互结构，所以**别急着上 Tailwind、Ant Design、shadcn 之类的重 UI 方案**。这类项目最快的路子就是：保留现有视觉 token，做组件化重构。

---

### 第 6 步：把真实数据接进工控机服务

到这一步，页面已经全是活的，但还是假数据。接真数据时，只做一件事：**把已有采集源适配成统一接口。**

我建议你在 `services/ipc-api/src/ingest` 里只定义一个抽象：

```ts
export interface DataSourceAdapter {
  getLatestSnapshot(): Promise<unknown>;
  getSensorTrend(sensorId: string, from: string, to: string): Promise<unknown[]>;
  subscribe(onEvent: (event: unknown) => void): () => void;
}
```

然后再写一个你现场专用的适配器：

* 如果工控机已经有 SQLite / CSV / 本地日志，就读它
* 如果工控机上有现成 TCP/UDP/串口转发，就接它
* 如果已经有别的采集程序在落库，就不要重复采集，只做读取和聚合

数据落库建议这样分层：

* `sensor_samples_raw`：原始点，短保留
* `sensor_samples_1m`：1 分钟聚合，画 24h 曲线
* `fault_events`：诊断后的故障事件
* `fault_code_dict`：故障代码词典
* `checkin_records`：点检记录
* `knowledge_assets`：知识库索引
* `system_config`：工作面与机型信息

你这台工控机只有 64G，别把所有高频原始数据无限保留。实际工程里建议：

* 原始点：保留 72 小时
* 1 分钟聚合：保留 90 天
* 日统计：长期保留

这样磁盘不会炸，平板画图也会更快。

---

### 第 7 步：把诊断规则写在工控机，不要写在平板

你已经明确说了“所有计算都放工控机上”，这点非常对。

所以平板只做展示，诊断逻辑全部在工控机服务里，例如：

* 连续 N 秒无新值 → `stale`
* 值超阈值超过 T 秒 → `warn`
* 同类告警 24h 内累计超过 K 次 → `fault_event`
* 某传感器最近 30 天失效次数 → 排名
* 截割/牵引/泵分析页的数据都由后端聚合成页面所需结构

这样平板收到的不是“原始混乱点位”，而是已经整理好的页面数据：

```json
{
  "avgPower": "352 kW",
  "avgTemp": "78.5℃",
  "runTimeToday": "6h 42m",
  "overloadTime": "38m",
  "overTempTime": "1h 18m"
}
```

平板就会非常流畅。

---

### 第 8 步：部署方式这样做最稳

#### 工控机部署

工控机同时跑两样东西：

1. `ipc-api`：Fastify 服务，监听 `127.0.0.1:18080`
2. `nginx`：对外提供统一入口

Nginx 配置建议这样：

```nginx
server {
  listen 80;
  server_name _;

  root /opt/cm-diagnostic/ui;
  index index.html;

  location / {
    try_files $uri $uri.html $uri/ /index.html;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:18080;
  }

  location /ws/ {
    proxy_pass http://127.0.0.1:18080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

前端构建后放到：

```bash
pnpm -C apps/tablet build
cp -r apps/tablet/out/* /opt/cm-diagnostic/ui/
```

后端做成 systemd 服务：

```ini
[Unit]
Description=Coal Machine IPC API
After=network.target

[Service]
WorkingDirectory=/opt/cm-diagnostic/ipc-api
ExecStart=/usr/bin/node dist/server.js
Restart=always
User=ubuntu

[Install]
WantedBy=multi-user.target
```

#### 平板部署

第一版最简单：

* Ubuntu 平板安装 Chromium
* 开机自启浏览器全屏访问工控机地址

例如：

```bash
chromium --kiosk http://192.168.10.36
```

这就是我最推荐的 V1。原因很现实：**更新集中、维护最轻、调试最方便。**

---

### 第 9 步：Tauri 作为第二阶段，而不是第一阶段

等浏览器版稳定以后，再考虑 Tauri。原因是：

* 你已经有一套 Next.js 静态前端了
* Tauri 官方 Next 集成就是基于 `output: 'export'`
* 开发期通过 `devUrl` + `beforeDevCommand` 联动前端 dev server
* 生产期用 `out` 目录作为 `frontendDist`
* 安全上只给需要的 capability / permission，不要全开。([Tauri][2])

后面要包 Tauri 时，按官方手动集成流程就行：

```bash
cd apps/tablet
pnpm add -D @tauri-apps/cli@latest
pnpm tauri init
pnpm tauri dev
```

Tauri 官方也说明了：你可以把它加到现有前端项目里，`tauri init` 时填 dev server 地址、前端构建命令，生成 `src-tauri`。([Tauri][3])

---

## 最适合你现在的 Codex 用法

你别让 Codex 一口气“把整个项目做完”，而是按下面这种粒度发任务：

### 任务 1：搭骨架

> 按仓库说明创建 monorepo。实现 `apps/tablet`、`services/ipc-api`、`packages/contracts` 的最小可运行版本。不要做真实采集，只用 mock 数据。完成后运行 `pnpm build`，列出新增文件。

### 任务 2：迁移主页

> 阅读设计稿，先实现主页与顶栏状态区。保留现有工业暗色 token，不引入 UI 组件库。主页数据来自 `/api/home/summary` 和 `/ws/live`。完成后给出 smoke test。

### 任务 3：迁移传感器页

> 只做 `/sensors` 页面。左侧传感器列表，右侧详情与 24h 曲线。先接 mock 接口，不动别的页面。完成后跑 lint、build。

### 任务 4：接真实数据

> 读取 `docs/data-map.md` 和当前工控机已有数据源，实现 `DataSourceAdapter`。不要改前端 contracts。完成后列出真实数据字段和无法映射的字段。

### 任务 5：部署

> 生成 nginx 配置、systemd 服务文件和部署脚本。要求工控机统一提供 `/` `/api` `/ws`。

这种粒度最稳，因为符合 Codex 官方建议：任务小、上下文清楚、完成标准清楚、能验证。([OpenAI Developers][5])

---

## 最后给你的决策建议

对你这个项目，我的最终建议是：

**V1：Next.js 静态前端 + Fastify 后端 + SQLite + 浏览器全屏**

**V2：在 V1 稳定后，再把前端包成 Tauri**

这条路线最符合你当前条件：

* 你熟悉 Next.js，开发速度快
* 你要和 Codex 协作，全 TypeScript 对协作最友好
* 所有计算留在工控机，平板只展示，性能最稳
* 更新集中在工控机，井下维护成本最低

下一步最省时间的做法，是直接先把 **monorepo 骨架、`packages/contracts`、`AGENTS.md`、首页/传感器页的首批样板文件** 一次搭出来。
