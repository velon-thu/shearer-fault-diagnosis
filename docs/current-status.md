# 当前项目状态

更新日期：2026-04-07

## 已完成页面
- `/login` 登录页
- `/` 主页面
- `/sensors` 传感器页
- `/fault-codes` 故障代码查询页
- `/settings` 系统设置页
- `/analysis/pump` 泵分析页
- `/analysis/traction` 牵引部分析页
- `/analysis/cutting` 截割部分析页
- `/rankings` 近期故障排名页
- `/checkins` 日常检修打卡页
- `/knowledge` 采煤机知识库页
- `/run-cycle` 运行循环图页

## 已接通路由
- `/login`
- `/`
- `/sensors`
- `/fault-codes`
- `/settings`
- `/analysis/pump`
- `/analysis/traction`
- `/analysis/cutting`
- `/rankings`
- `/checkins`
- `/knowledge`
- `/run-cycle`

## 已实现接口
- `GET /api/health`
- `GET /api/bootstrap`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/home/summary`
- `GET /api/events/weekly`
- `GET /api/sensors`
- `GET /api/sensors/:id`
- `GET /api/sensors/:id/trend?range=24h`
- `GET /api/fault-codes/search?category=system&code=0x0094`
- `GET /api/rankings?start=2026-03-01&end=2026-03-31&system=all`
- `GET /api/checkins`
- `POST /api/checkins`
- `GET /api/knowledge/assets`
- `GET /api/run-cycle`
- `GET /api/analysis/pump?range=24h`
- `GET /api/analysis/cutting?range=24h`
- `GET /api/analysis/traction?range=24h`
- `GET /api/settings`
- `WS /ws/live`

## 已切到 SQLite 的链路
- `GET /api/checkins`
- `POST /api/checkins`
- `GET /api/knowledge/assets`
- `GET /api/settings`
- `GET /api/fault-codes/search`
- `GET /api/rankings`

## 当前数据库表
- `sensor_samples_raw`
  原始采样落库表，当前只建表，尚未接真实写入。
- `sensor_samples_1m`
  1 分钟聚合表，当前只建表，尚未接真实写入。
- `fault_events`
  故障/事件聚合来源表，当前已用于近期故障排名 seed 与查询。
- `fault_code_dict`
  故障代码词典表，当前已用于故障代码查询。
- `checkin_records`
  日常检修打卡表，当前已用于 GET/POST `/api/checkins`。
- `knowledge_assets`
  知识库资源表，当前已用于 GET `/api/knowledge/assets`。
- `system_config`
  系统配置表，当前已用于 GET `/api/settings`。

## 还没完成的重点任务
- 真实工控机采集数据接入：原始采样、事件流、实时订阅还未落到 SQLite。
- 传感器、首页摘要、分析页、运行循环图等接口仍主要使用 mock 数据。
- SQLite 迁移机制还比较轻量，后续需要补版本化 migration、seed 管理和回填策略。
- 登录认证仍是 mock auth，尚未切到正式工控机统一认证。
- 知识库、排名、设置目前是最小可用读模型，还未接入真实后台维护能力。
