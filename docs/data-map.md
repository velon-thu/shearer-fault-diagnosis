# 数据映射台账

更新日期：2026-04-07

## 使用说明
- 本文档用于梳理“现场真实数据源 -> IPC 入库 -> `packages/contracts` -> 前端页面”的映射关系。
- 当前第一批只覆盖“传感器总览 / 传感器详情 / 传感器趋势”链路。
- 对于暂时拿不到或语义不明确的字段，先记录在“暂时无法映射的字段”里，不要跳过。

## 字段模板

| 数据源名称 | 文件/表位置 | 字段名 | 字段含义 | 单位 | 采样周期 | 映射到前端 contracts | 暂时无法映射的字段 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 示例：牵引温度采样 | `sensor_samples_raw` | `sensor_id` | 传感器唯一标识 | - | 实时/事件驱动 | `SensorSummary.id` / `SensorDetail.id` | 若现场编码与前端 `sensor.id` 不一致，需补映射表 |
| 示例：牵引温度采样 | `sensor_samples_raw` | `sampled_at` | 原始采样时间 | ISO 时间 | 原始采样 | `SensorSummary.lastSeen` / `SensorTrendPoint.time` | 时区、毫秒精度待确认 |
| 示例：牵引温度采样 | `sensor_samples_raw` | `value` | 原始采样值 | 待确认 | 原始采样 | `SensorTrendPoint.value` / `SensorDetail.averageValue` / `SensorDetail.peakValue` | 若原始值需要换算，需补换算规则 |
| 示例：牵引温度采样 | `sensor_samples_raw` | `quality` | 采样质量/有效性 | - | 原始采样 | `SensorSummary.valid` / `SensorSummary.state` / `SensorSummary.failures30d` | 质量枚举值尚未与现场对齐 |
| 示例：牵引温度采样 | `sensor_samples_1m` | `avg_value` | 1 分钟平均值 | 待确认 | 1 分钟 | `SensorTrendPoint.value` / `SensorDetail.averageValue` | 聚合窗口定义待确认 |
| 示例：牵引温度采样 | `sensor_samples_1m` | `max_value` | 1 分钟峰值 | 待确认 | 1 分钟 | `SensorDetail.peakValue` | 峰值是否需要按日/月再聚合待确认 |

## 当前第一批接入范围

### 1. 传感器总览
- 目标接口：`GET /api/sensors`
- 目标 contracts：`SensorSummary`
- 当前 RealDataSourceAdapter 假设：
  - `sensor_samples_raw.sensor_id` 与前端 `sensor.id` 一致
  - `quality` 可用于推导 `valid / state / failures30d`
  - 近 30 天失败次数先按“质量非 good/ok/valid”做近似统计

### 2. 传感器详情
- 目标接口：`GET /api/sensors/:id`
- 目标 contracts：`SensorDetail`
- 当前 RealDataSourceAdapter 假设：
  - `averageValue` 来自近 30 天原始值均值
  - `peakValue` 来自近 30 天原始值峰值
  - `averageDisplay / peakDisplay` 由数值与单位拼装

### 3. 传感器趋势
- 目标接口：`GET /api/sensors/:id/trend`
- 目标 contracts：`SensorTrendPoint[]`
- 当前 RealDataSourceAdapter 假设：
  - 优先读取 `sensor_samples_1m`
  - 若 1 分钟聚合表暂无数据，则回退读取 `sensor_samples_raw`
  - 若 SQLite 仍无数据，则回退到 mock 数据

## 待现场补齐的信息
- 真实 `sensor_id` 编码规则
- `quality` 的枚举值定义与故障判定规则
- 每类传感器的工程单位与换算规则
- 原始采样周期、聚合周期、补点策略
- “失效次数”在现场系统中的精确定义

## 暂时无法映射的字段
- 原始载荷中的附加诊断位、报警位、校准系数
- 现场采样源中的设备地址/寄存器地址
- 传感器安装位与工作面工艺位置的正式编码
- 多数据源时间戳对齐规则
