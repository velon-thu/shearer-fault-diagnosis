import {
  type BootstrapResponse,
  type ConnectionStatus,
  type FaultCategory,
  type FaultCodeResult,
  type HomeSummary,
  type KeyValueField,
  type PumpAnalysisLogEntry,
  type PumpAnalysisRange,
  type PumpAnalysisResponse,
  type PumpAnalysisSeries,
  type SensorDetail,
  type SensorSummary,
  type SensorTrendPoint,
  type SettingsSnapshot,
  type SettingsVersionHistoryItem,
  type WeeklyEvent,
} from "@shearer/contracts";

type RankingEntry = {
  name: string;
  count: number;
  last: string;
};

type FaultDictionaryEntry = {
  description: string;
  tip: string;
};

type FaultDictionary = Record<FaultCategory, Record<string, FaultDictionaryEntry>>;

export const createConnectionStatus = (): ConnectionStatus => ({
  tabletToIpc: "connected",
  hpc: "ok",
  moc: "ok",
  boc: Math.random() > 0.65 ? "warn" : "ok",
  syncAt: new Date().toISOString(),
});

export const createBootstrapPayload = (): BootstrapResponse => ({
  machineModel: "MG500/1180-WD",
  machineName: "西翼 2305 工作面采煤机",
  connected: true,
  connection: createConnectionStatus(),
});

export const weeklyEvents: WeeklyEvent[] = [
  { time: "2026-03-09 12:10:23", text: "左泵电机异常停机", target: "pump-analysis" },
  { time: "2026-03-10 14:10:23", text: "左牵引电机异常停机", target: "traction-analysis" },
  { time: "2026-03-11 18:10:23", text: "左截割电机频繁过载，本日过载 8 次", target: "cutting-analysis" },
  { time: "2026-03-11 12:10:23", text: "左牵引电机发生断轴", target: "traction-analysis" },
  { time: "2026-03-12 18:10:23", text: "左截割电机今日持续过温", target: "cutting-analysis" },
  { time: "2026-03-14 19:11:23", text: "左摇臂今日持续过温", target: "cutting-analysis" },
  { time: "2026-03-15 20:11:23", text: "泵箱油位过低", target: "pump-analysis" },
  { time: "2026-03-16 15:11:36", text: "变频器冷却水道水流量过小", target: "traction-analysis" },
];

const monthlyFaultRanking: RankingEntry[] = [
  { name: "摇臂过温", count: 20, last: "2026-03-10 14:10:23" },
  { name: "左牵引电机异常停机", count: 16, last: "2026-03-11 14:10:23" },
  { name: "左截割电机过载", count: 14, last: "2026-03-12 14:10:23" },
];

const monthlySensorFailures: RankingEntry[] = [
  { name: "右牵引箱温度传感器", count: 12, last: "2026-03-10 14:10:23" },
  { name: "水路压力传感器", count: 8, last: "2026-03-11 14:10:23" },
  { name: "左牵引电机温度传感器", count: 5, last: "2026-03-12 14:10:23" },
];

const toNumericValue = (value: string) => Number(value.replace(/[^\d.-]/g, ""));

const generateSeries = (
  length: number,
  base: number,
  amplitude: number,
  shift = 0,
  noise = 0.35,
): number[] =>
  Array.from({ length }, (_, index) => {
    const sin = Math.sin((index + shift) / 3.3);
    const cos = Math.cos((index + shift) / 5.2);
    const drift = (index / length) * amplitude * 0.18;
    const wobble = ((index % 5) - 2) * amplitude * noise * 0.08;

    return Number((base + sin * amplitude + cos * amplitude * 0.35 + drift + wobble).toFixed(1));
  });

const parseLogEntries = (rows: string[]): PumpAnalysisLogEntry[] =>
  rows.map((row) => ({
    time: row.slice(0, 19),
    text: row.slice(20),
  }));

export const sensors: SensorDetail[] = [
  {
    id: "sensor-1",
    name: "右牵引箱温度传感器",
    type: "温度",
    state: "失效频发",
    valid: false,
    failures30d: 12,
    lastSeen: "2026-03-10 14:10:23",
    unit: "℃",
    averageDisplay: "58.3℃",
    peakDisplay: "73.6℃",
    averageValue: toNumericValue("58.3℃"),
    peakValue: toNumericValue("73.6℃"),
    location: "右牵引箱",
  },
  {
    id: "sensor-2",
    name: "水路压力传感器",
    type: "压力",
    state: "正常",
    valid: true,
    failures30d: 8,
    lastSeen: "2026-03-16 13:08:11",
    unit: "MPa",
    averageDisplay: "4.2MPa",
    peakDisplay: "5.1MPa",
    averageValue: toNumericValue("4.2MPa"),
    peakValue: toNumericValue("5.1MPa"),
    location: "水路总管",
  },
  {
    id: "sensor-3",
    name: "左牵引电机温度传感器",
    type: "温度",
    state: "正常",
    valid: true,
    failures30d: 5,
    lastSeen: "2026-03-16 13:09:42",
    unit: "℃",
    averageDisplay: "67.1℃",
    peakDisplay: "81.0℃",
    averageValue: toNumericValue("67.1℃"),
    peakValue: toNumericValue("81.0℃"),
    location: "左牵引电机",
  },
  {
    id: "sensor-4",
    name: "左截割电机温度传感器",
    type: "温度",
    state: "过温关注",
    valid: true,
    failures30d: 3,
    lastSeen: "2026-03-16 13:09:17",
    unit: "℃",
    averageDisplay: "74.6℃",
    peakDisplay: "92.4℃",
    averageValue: toNumericValue("74.6℃"),
    peakValue: toNumericValue("92.4℃"),
    location: "左截割电机",
  },
  {
    id: "sensor-5",
    name: "泵箱油位传感器",
    type: "液位",
    state: "低位预警",
    valid: true,
    failures30d: 2,
    lastSeen: "2026-03-16 13:10:03",
    unit: "%",
    averageDisplay: "37%",
    peakDisplay: "61%",
    averageValue: toNumericValue("37%"),
    peakValue: toNumericValue("61%"),
    location: "泵箱",
  },
  {
    id: "sensor-6",
    name: "变频器冷却水流量传感器",
    type: "流量",
    state: "波动",
    valid: true,
    failures30d: 4,
    lastSeen: "2026-03-16 13:10:01",
    unit: "L/min",
    averageDisplay: "26.3L/min",
    peakDisplay: "34.8L/min",
    averageValue: toNumericValue("26.3L/min"),
    peakValue: toNumericValue("34.8L/min"),
    location: "变频器水路",
  },
  {
    id: "sensor-7",
    name: "右摇臂温度传感器",
    type: "温度",
    state: "正常",
    valid: true,
    failures30d: 1,
    lastSeen: "2026-03-16 13:09:58",
    unit: "℃",
    averageDisplay: "63.8℃",
    peakDisplay: "79.0℃",
    averageValue: toNumericValue("63.8℃"),
    peakValue: toNumericValue("79.0℃"),
    location: "右摇臂",
  },
];

export const faultDictionary: FaultDictionary = {
  system: {
    "0x0094": {
      description: "来自右无线遥控总停操作。",
      tip: "建议优先检查右无线遥控器总停链路、急停恢复状态，以及总停输入点在 PLC/HPC 侧的采集状态。",
    },
    "0x0021": {
      description: "系统保护链路异常（原型示意）。",
      tip: "检查总停回路、保护链路与控制输入。",
    },
    "0x0028": {
      description: "截割系统互锁异常（原型示意）。",
      tip: "排查互锁条件、限位与控制反馈。",
    },
    "0x0035": {
      description: "液压子系统压力异常（原型示意）。",
      tip: "检查压力采样、液压站与管路泄漏。",
    },
    "0x0042": {
      description: "牵引使能链路异常（原型示意）。",
      tip: "检查牵引接触器、使能条件与安全回路。",
    },
    "0x0059": {
      description: "系统反馈超时（原型示意）。",
      tip: "确认 HPC 与现场 I/O 通讯时延。",
    },
    "0x0067": {
      description: "遥控优先级冲突（原型示意）。",
      tip: "检查遥控/手控切换状态。",
    },
    "0x0074": {
      description: "摇臂动作反馈异常（原型示意）。",
      tip: "检查位移反馈或电磁阀响应。",
    },
    "0x0081": {
      description: "截割保护触发（原型示意）。",
      tip: "检查电机电流、过载阈值与机械卡阻。",
    },
    "0x0098": {
      description: "系统急停历史记录（原型示意）。",
      tip: "查看急停来源并确认复位完成。",
    },
    "0x00A5": {
      description: "工控机与现场总线时钟偏差（原型示意）。",
      tip: "同步时间源并检查总线稳定性。",
    },
    "0x00B3": {
      description: "牵引侧状态位异常（原型示意）。",
      tip: "检查 MOC 返回状态与执行反馈。",
    },
    "0x00C7": {
      description: "泵站启动失败（原型示意）。",
      tip: "检查泵电机、电源和油位联锁。",
    },
    "0x00D9": {
      description: "摇臂过温保护历史（原型示意）。",
      tip: "检查温度传感器与负载工况。",
    },
    "0x00E2": {
      description: "水路压力不足（原型示意）。",
      tip: "检查供水压力与水路阻塞。",
    },
    "0x00F8": {
      description: "系统自检异常（原型示意）。",
      tip: "查看启动自检日志与模块状态。",
    },
    "0x0105": {
      description: "远程控制输入异常（原型示意）。",
      tip: "检查遥控接收模块与信号质量。",
    },
    "0x0119": {
      description: "位移采样异常（原型示意）。",
      tip: "排查编码器或位移传感器。",
    },
    "0x0126": {
      description: "保护阈值配置冲突（原型示意）。",
      tip: "检查配置文件与版本匹配性。",
    },
    "0x0138": {
      description: "工作面参数未加载（原型示意）。",
      tip: "确认系统设置页中的工作面信息已配置。",
    },
    "0x0147": {
      description: "控制箱按钮反馈异常（原型示意）。",
      tip: "检查按钮接点与盖板接线。",
    },
  },
  inverter: {
    "3130": {
      description: "由于电源缺相或熔丝熔断，中间直流电压振荡。",
      tip: "确认变频器电源无问题；若 31.21 供电缺相可临时关闭，并检查三相供电与熔丝。",
    },
    "2310": {
      description: "直流母线监测告警（原型示意）。",
      tip: "检查输入电压稳定性。",
    },
    "2330": {
      description: "整流单元预警（原型示意）。",
      tip: "检查整流桥与上电过程。",
    },
    "2340": {
      description: "输入侧谐波异常（原型示意）。",
      tip: "检查供电品质与滤波。",
    },
    "3210": {
      description: "输出过流（原型示意）。",
      tip: "排查电机负载突变或电缆短路。",
    },
    "3211": {
      description: "输出电流不平衡（原型示意）。",
      tip: "检查电机绕组与连接线。",
    },
    "3220": {
      description: "转矩限幅触发（原型示意）。",
      tip: "检查机械阻滞与参数整定。",
    },
    "4110": {
      description: "IGBT 温度超限（原型示意）。",
      tip: "检查散热器与冷却风道。",
    },
    "4210": {
      description: "冷却水流量不足（原型示意）。",
      tip: "检查冷却水道与流量传感器。",
    },
    "4290": {
      description: "冷却回路压差异常（原型示意）。",
      tip: "检查水路堵塞和泵状态。",
    },
    "4310": {
      description: "散热模块通信异常（原型示意）。",
      tip: "检查变频器内部通信模块。",
    },
    "5210": {
      description: "转速反馈异常（原型示意）。",
      tip: "检查编码器和反馈接口。",
    },
    "7000": {
      description: "变频器运行状态不一致（原型示意）。",
      tip: "检查上位控制命令与本地状态。",
    },
    "3181": {
      description: "输出相缺相（原型示意）。",
      tip: "检查输出电缆与端子。",
    },
    "5080": {
      description: "参数区校验失败（原型示意）。",
      tip: "核对参数版本并重新下装。",
    },
    "5682": {
      description: "外部故障输入触发（原型示意）。",
      tip: "检查外部联锁输入。",
    },
    "5690": {
      description: "保护停机历史记录（原型示意）。",
      tip: "结合故障时间轴追溯来源。",
    },
    "5692": {
      description: "控制板重启记录（原型示意）。",
      tip: "排查控制板供电与接插件。",
    },
  },
};

const toFields = (entries: Array<[string, string]>): KeyValueField[] =>
  entries.map(([label, value]) => ({ label, value }));

export const workFaceFields: KeyValueField[] = toFields([
  ["推进方向长度", "328 m"],
  ["煤层厚度", "2.8 m"],
  ["平均厚度", "2.6 m"],
  ["煤岩硬度", "f=3.2"],
  ["工作面编号", "3106"],
  ["工作面长度", "286 m"],
  ["工作面倾角", "8°"],
  ["工作面俯仰角", "2°"],
]);

export const machineFields: KeyValueField[] = toFields([
  ["机型名称", "MG500/1180-WD"],
  ["软件版本", "v2.6.4"],
  ["硬件版本", "HW-1.3"],
  ["滚筒截深", "800 mm"],
]);

export const versionHistoryData: SettingsVersionHistoryItem[] = [
  { date: "v2.6.4", desc: "新增运行循环图页面、主页面异常事件联动、连接状态集中展示。" },
  { date: "v2.6.3", desc: "增加牵引部变频器多曲线趋势图与近期故障排名筛选。" },
  { date: "v2.6.1", desc: "补充知识库分类与日常检修打卡历史记录。" },
];

const pumpStats: KeyValueField[] = toFields([
  ["平均带载功率", "298 kW"],
  ["平均带载温度", "69.8℃"],
  ["今日带载运行时间", "7h 58m"],
  ["今日过载时间", "22m"],
  ["今日过温时间", "36m"],
]);

const logs: PumpAnalysisLogEntry[] = parseLogEntries([
  "2026-03-10 14:10:23 记忆截割1右升",
  "2026-03-10 14:10:23 系统执行1右升",
  "2026-03-10 14:10:42 记忆截割1左升",
  "2026-03-10 14:10:42 系统执行1左升",
  "2026-03-10 14:11:23 记忆截割2左降",
]);

const alerts: PumpAnalysisLogEntry[] = parseLogEntries([
  "2026-03-10 14:10:23 EDCR泵箱温度高报警！",
  "2026-03-10 14:10:23 EDCR流量检测通道1报警！",
  "2026-03-10 14:10:42 RDCR流量通道1保护！",
  "2026-03-10 14:10:42 EDCR流量监测通道2保护！",
  "2026-03-10 14:11:23 EDCR流量监测通道2报警！",
]);

export const networkInfoData: KeyValueField[] = toFields([
  ["工控机主机名", "cm-ipc-3106"],
  ["工控机 IP", "192.168.10.36"],
  ["平板 IP", "192.168.10.102"],
  ["局域网状态", "同一子网 / RTT 6ms"],
  ["Ubuntu 版本", "22.04 LTS"],
  ["数据服务", "gRPC + WebSocket"],
  ["上次握手时间", "2026-03-16 13:10:23"],
  ["系统运行时长", "12 天 06 小时"],
]);

export const createHomeSummary = (): HomeSummary => {
  const latestWeeklyEvent = weeklyEvents[weeklyEvents.length - 1]!;
  const topFault = monthlyFaultRanking[0]!;
  const topSensor = monthlySensorFailures[0]!;

  return {
    weeklyEventCount: weeklyEvents.length,
    latestWeeklyEvent,
    topFault: {
      name: topFault.name,
      count: topFault.count,
      lastOccurredAt: topFault.last,
    },
    topSensor: {
      name: topSensor.name,
      count: topSensor.count,
      lastOccurredAt: topSensor.last,
    },
  };
};

export const createSettingsSnapshot = (): SettingsSnapshot => {
  const connection = createConnectionStatus();

  return {
    connected: connection.tabletToIpc === "connected",
    connection,
    workFaceFields,
    machineFields,
    versionHistoryData,
    networkInfoData,
  };
};

export const getSensorSummaries = (): SensorSummary[] =>
  sensors.map(
    ({
      averageDisplay: _averageDisplay,
      averageValue: _averageValue,
      peakDisplay: _peakDisplay,
      peakValue: _peakValue,
      ...summary
    }) => summary,
  );

export const findSensorById = (id: string): SensorDetail | undefined =>
  sensors.find((sensor) => sensor.id === id);

const sensorSeries = (sensor: SensorDetail): number[] => {
  switch (sensor.type) {
    case "压力":
      return generateSeries(24, 4.2, 0.55, 1, 0.18);
    case "液位":
      return generateSeries(24, 44, 11, 2, 0.14);
    case "流量":
      return generateSeries(24, 28, 4.6, 0, 0.18);
    default:
      return generateSeries(
        24,
        sensor.name.includes("截割") ? 76 : 62,
        sensor.name.includes("截割") ? 8.8 : 6.3,
        1,
        0.12,
      );
  }
};

export const buildSensorTrend = (sensor: SensorDetail, range = "24h"): SensorTrendPoint[] => {
  const points = sensorSeries(sensor);
  const labels = Array.from({ length: range === "24h" ? 24 : 24 }, (_, index) =>
    `${String(index).padStart(2, "0")}:00`,
  );

  return labels.map((time, index) => ({
    time,
    value: points[index] ?? points[points.length - 1] ?? sensor.averageValue,
    unit: sensor.unit,
  }));
};

export const findFaultCode = (category: FaultCategory, code: string): FaultCodeResult => {
  const entry = faultDictionary[category][code];

  if (!entry) {
    return {
      category,
      code,
      found: false,
      description: null,
      tip: null,
    };
  }

  return {
    category,
    code,
    found: true,
    description: entry.description,
    tip: entry.tip,
  };
};

export const createPumpAnalysis = (range: PumpAnalysisRange = "24h"): PumpAnalysisResponse => {
  const labels = Array.from({ length: range === "24h" ? 24 : 24 }, (_, index) =>
    `${String(index).padStart(2, "0")}:00`,
  );

  const trendSeries: PumpAnalysisSeries[] = [
    {
      name: "泵电机温度",
      color: "#ffb14a",
      values: generateSeries(24, 70, 8.0, 1, 0.09),
    },
    {
      name: "泵电机电流",
      color: "#48c7ff",
      values: generateSeries(24, 184, 34, 2, 0.09),
    },
    {
      name: "估算带载功率",
      color: "#4f8cff",
      values: generateSeries(24, 298, 42, 0, 0.08),
    },
  ];

  return {
    range,
    labels,
    trendSeries,
    stats: pumpStats,
    logs,
    alerts,
  };
};
