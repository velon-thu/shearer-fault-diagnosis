import { randomUUID } from "node:crypto";
import {
  type AuthLoginRequest,
  type AuthLoginResponse,
  type AuthLogoutResponse,
  type AuthMeResponse,
  type AuthUser,
  type BootstrapResponse,
  type CheckinCalendarRecord,
  type CheckinHistoryEntry,
  type CheckinItem,
  type CheckinsResponse,
  type CheckinsSubmitRequest,
  type CheckinStatus,
  type CuttingAnalysisLogEntry,
  type CuttingAnalysisRange,
  type CuttingAnalysisResponse,
  type CuttingAnalysisSeries,
  type CuttingAnalysisStatsRow,
  type ConnectionStatus,
  type FaultCategory,
  type FaultCodeResult,
  type HomeSummary,
  type KnowledgeAsset,
  type KnowledgeAssetsResponse,
  type KeyValueField,
  type PumpAnalysisLogEntry,
  type PumpAnalysisRange,
  type PumpAnalysisResponse,
  type PumpAnalysisSeries,
  type RankingItem,
  type RankingsResponse,
  type RankingSystemFilter,
  type RunCycleResponse,
  type RunCycleSeries,
  type SensorDetail,
  type SensorSummary,
  type SensorTrendPoint,
  type SettingsSnapshot,
  type SettingsVersionHistoryItem,
  type TractionAnalysisLogEntry,
  type TractionAnalysisRange,
  type TractionAnalysisResponse,
  type TractionAnalysisSeries,
  type TractionAnalysisStatsRow,
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

const mockAuthUser: AuthUser = {
  employeeNo: "tiandi",
  displayName: "点检员",
  role: "operator",
};

const mockAuthCredentials: AuthLoginRequest = {
  employeeNo: "tiandi",
  password: "tiandi",
};

const authSessions = new Map<
  string,
  {
    expiresAt: string;
    user: AuthUser;
  }
>();

const createAuthExpiry = () => new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

export const getMockAuthCredentials = () => ({
  ...mockAuthCredentials,
});

export const loginWithMockAuth = ({
  employeeNo,
  password,
}: AuthLoginRequest): AuthLoginResponse | null => {
  if (
    employeeNo !== mockAuthCredentials.employeeNo ||
    password !== mockAuthCredentials.password
  ) {
    return null;
  }

  const accessToken = randomUUID();
  const expiresAt = createAuthExpiry();

  authSessions.set(accessToken, {
    expiresAt,
    user: mockAuthUser,
  });

  return {
    accessToken,
    expiresAt,
    user: mockAuthUser,
  };
};

export const getMockAuthSession = (accessToken: string): AuthMeResponse | null => {
  const session = authSessions.get(accessToken);

  if (!session) {
    return null;
  }

  if (Date.parse(session.expiresAt) <= Date.now()) {
    authSessions.delete(accessToken);
    return null;
  }

  return {
    expiresAt: session.expiresAt,
    user: session.user,
  };
};

export const logoutMockAuth = (accessToken: string): AuthLogoutResponse => {
  authSessions.delete(accessToken);

  return {
    loggedOut: true,
  };
};

export const createConnectionStatus = (): ConnectionStatus => ({
  tabletToIpc: "connected",
  hpc: "ok",
  moc: "ok",
  boc: Math.random() > 0.65 ? "warn" : "ok",
  axi: "ok",
  wcr: "ok",
  sgc: "ok",
  bp1: "ok",
  bp2: "ok",
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

const toKnowledgeAsset = (title: string, meta: string): KnowledgeAsset => ({
  title,
  meta,
});

export const knowledgeAssets: KnowledgeAssetsResponse = {
  drawing: [
    toKnowledgeAsset("MG500/1180-WD 机械总图", "PDF · 28 页 · 机身 / 截割部 / 牵引部"),
    toKnowledgeAsset("MG500 电控系统接线图册", "PDF · 42 页 · HPC/MOC/BOC 接线"),
    toKnowledgeAsset("泵站油路原理图", "PDF · 12 页 · 维护常用"),
  ],
  install: [
    toKnowledgeAsset("摇臂总成安装指导", "视频 · 18 分钟 · 含注意事项"),
    toKnowledgeAsset("牵引电机更换与复位", "视频 · 14 分钟 · 适用于井下更换"),
    toKnowledgeAsset("变频器冷却水路安装检查", "视频 · 9 分钟 · 联调示例"),
  ],
  troubleshoot: [
    toKnowledgeAsset("左截割电机过载排查流程", "视频 · 11 分钟 · 过载闭环"),
    toKnowledgeAsset("泵电机异常停机诊断案例", "视频 · 13 分钟 · 现场复盘"),
    toKnowledgeAsset("4210 冷却水流量不足排查", "视频 · 8 分钟 · 典型故障"),
  ],
};

export const cycleXAxisOptions = ["时间", "工作面", "温度"] as const;
export const cycleYAxisOptions = [
  "采煤机速度",
  "左截割电机温度",
  "右截割电机温度",
  "左截割电机电流",
  "左牵引电机电流",
  "泵电机温度",
] as const;

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

const toRunCycleSeries = (
  name: string,
  color: string,
  base: number,
  amplitude: number,
  shift = 0,
  noise = 0.12,
): RunCycleSeries => ({
  name,
  color,
  values: generateSeries(20, base, amplitude, shift, noise),
});

const cycleSeriesCatalog: RunCycleResponse["seriesCatalog"] = {
  采煤机速度: toRunCycleSeries("采煤机速度", "#48c7ff", 4.2, 1.8, 0, 0.15),
  左截割电机温度: toRunCycleSeries("左截割电机温度", "#ffb14a", 72, 10.5, 1, 0.11),
  右截割电机温度: toRunCycleSeries("右截割电机温度", "#f7d65c", 69, 8.6, 2, 0.1),
  左截割电机电流: toRunCycleSeries("左截割电机电流", "#4f8cff", 198, 42, 3, 0.11),
  左牵引电机电流: toRunCycleSeries("左牵引电机电流", "#38d889", 156, 28, 1, 0.12),
  泵电机温度: toRunCycleSeries("泵电机温度", "#9f86ff", 66, 8.4, 2, 0.09),
};

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

export const systemFaultRankings: RankingItem[] = [
  { name: "0x0094 右无线遥控总停", count: 11, lastOccurredAt: "2026-03-12 10:20:11" },
  { name: "0x00C7 泵站启动失败", count: 7, lastOccurredAt: "2026-03-14 08:42:18" },
  { name: "0x0147 控制箱按钮反馈异常", count: 5, lastOccurredAt: "2026-03-15 12:08:51" },
];

export const inverterFaultRankings: RankingItem[] = [
  { name: "4210 冷却水流量不足", count: 9, lastOccurredAt: "2026-03-16 09:33:02" },
  { name: "3130 中间直流电压振荡", count: 6, lastOccurredAt: "2026-03-11 13:55:26" },
  { name: "4110 IGBT 温度超限", count: 4, lastOccurredAt: "2026-03-13 18:20:41" },
];

export const sensorFaultRankings: RankingItem[] = monthlySensorFailures.map((item) => ({
  name: item.name,
  count: item.count,
  lastOccurredAt: item.last,
}));

export const checkinTodayDate = "2026-03-16";

export const initialCheckinItems: CheckinItem[] = [
  { id: "checkin-1", label: "检查主电缆损耗情况，确保无明显破损。", checked: true },
  { id: "checkin-2", label: "检查压力接点引出电缆，确保无明显破损。", checked: true },
  { id: "checkin-3", label: "检查压力接点上刻度，并作记录，确保没有松动变化。", checked: true },
  {
    id: "checkin-4",
    label: "检查控制箱盖板上按钮，确保可靠通断；检查紧固螺钉是否松动，并及时紧固。",
    checked: false,
  },
];

export const initialCheckinHistoryData: CheckinHistoryEntry[] = [
  { date: "2026-03-15", shift: "早班", person: "张工", result: "已完成", note: "4/4 项已确认" },
  {
    date: "2026-03-14",
    shift: "中班",
    person: "张工",
    result: "已完成",
    note: "发现 1 处螺钉松动并紧固",
  },
  { date: "2026-03-13", shift: "夜班", person: "李工", result: "已完成", note: "压力接点刻度正常" },
];

export const initialCheckinCalendarRecords: Record<string, CheckinCalendarRecord> = {
  "2026-03-01": {
    status: "done",
    shift: "早班",
    person: "张工",
    result: "已完成",
    note: "4/4 项已确认",
    detail: "主电缆、压力接点、按钮和紧固件检查正常。",
  },
  "2026-03-02": {
    status: "done",
    shift: "中班",
    person: "张工",
    result: "已完成",
    note: "4/4 项已确认",
    detail: "控制箱盖板按钮可靠通断。",
  },
  "2026-03-03": {
    status: "partial",
    shift: "夜班",
    person: "王工",
    result: "补检完成",
    note: "3/4 项完成",
    detail: "压力接点引出电缆外护套有磨损，已登记观察。",
  },
  "2026-03-04": {
    status: "done",
    shift: "早班",
    person: "李工",
    result: "已完成",
    note: "4/4 项已确认",
    detail: "主电缆无明显破损。",
  },
  "2026-03-05": {
    status: "done",
    shift: "中班",
    person: "李工",
    result: "已完成",
    note: "4/4 项已确认",
    detail: "压力接点刻度记录正常。",
  },
  "2026-03-06": {
    status: "missed",
    shift: "夜班",
    person: "-",
    result: "未打卡",
    note: "无记录",
    detail: "当日未提交点检表。",
  },
  "2026-03-07": {
    status: "done",
    shift: "早班",
    person: "张工",
    result: "已完成",
    note: "4/4 项已确认",
    detail: "盖板紧固螺钉无松动。",
  },
  "2026-03-08": {
    status: "partial",
    shift: "中班",
    person: "王工",
    result: "部分完成",
    note: "3/4 项完成",
    detail: "发现 1 处螺钉松动并及时紧固。",
  },
  "2026-03-09": {
    status: "done",
    shift: "夜班",
    person: "李工",
    result: "已完成",
    note: "4/4 项已确认",
    detail: "压力接点引出电缆检查正常。",
  },
  "2026-03-10": {
    status: "done",
    shift: "早班",
    person: "张工",
    result: "已完成",
    note: "4/4 项已确认",
    detail: "控制箱按钮、刻度记录均正常。",
  },
  "2026-03-11": {
    status: "partial",
    shift: "中班",
    person: "张工",
    result: "部分完成",
    note: "2/4 项完成",
    detail: "设备处理中途停机，后续补检。",
  },
  "2026-03-12": {
    status: "done",
    shift: "夜班",
    person: "李工",
    result: "已完成",
    note: "4/4 项已确认",
    detail: "控制箱盖板与紧固螺钉状态正常。",
  },
  "2026-03-13": {
    status: "done",
    shift: "早班",
    person: "李工",
    result: "已完成",
    note: "4/4 项已确认",
    detail: "主电缆及压力接点无异常。",
  },
  "2026-03-14": {
    status: "done",
    shift: "中班",
    person: "张工",
    result: "已完成",
    note: "发现 1 处螺钉松动并紧固",
    detail: "复查后确认已恢复正常。",
  },
  "2026-03-15": {
    status: "done",
    shift: "早班",
    person: "张工",
    result: "已完成",
    note: "4/4 项已确认",
    detail: "压力接点刻度正常，按钮可靠通断。",
  },
  "2026-03-16": {
    status: "done",
    shift: "早班",
    person: "张工",
    result: "已完成",
    note: "4/4 项已确认",
    detail: "今日打卡完成并已上传。",
  },
};

let todayCheckinItemsStore: CheckinItem[] = initialCheckinItems.map((item) => ({ ...item }));
let checkinHistoryStore: CheckinHistoryEntry[] = initialCheckinHistoryData.map((item) => ({ ...item }));
let checkinCalendarStore: Record<string, CheckinCalendarRecord> = Object.fromEntries(
  Object.entries(initialCheckinCalendarRecords).map(([date, record]) => [date, { ...record }]),
);

export const getInitialCheckinItems = (): CheckinItem[] =>
  initialCheckinItems.map((item) => ({ ...item }));

const pumpStats: KeyValueField[] = toFields([
  ["平均带载功率", "298 kW"],
  ["平均带载温度", "69.8℃"],
  ["今日带载运行时间", "7h 58m"],
  ["今日过载时间", "22m"],
  ["今日过温时间", "36m"],
]);

const cuttingStats: CuttingAnalysisStatsRow[] = [
  {
    part: "左截割电机",
    averageLoadPower: "352 kW",
    averageLoadTemperature: "78.5℃",
    todayLoadedRuntime: "6h 42m",
    todayOverloadTime: "38m",
    todayOverTemperatureTime: "1h 18m",
  },
  {
    part: "右截割电机",
    averageLoadPower: "344 kW",
    averageLoadTemperature: "75.2℃",
    todayLoadedRuntime: "6h 18m",
    todayOverloadTime: "25m",
    todayOverTemperatureTime: "52m",
  },
  {
    part: "左摇臂",
    averageLoadPower: "118 kW",
    averageLoadTemperature: "64.8℃",
    todayLoadedRuntime: "5h 56m",
    todayOverloadTime: "12m",
    todayOverTemperatureTime: "44m",
  },
  {
    part: "右摇臂",
    averageLoadPower: "122 kW",
    averageLoadTemperature: "66.3℃",
    todayLoadedRuntime: "5h 49m",
    todayOverloadTime: "18m",
    todayOverTemperatureTime: "51m",
  },
];

const tractionStats: TractionAnalysisStatsRow[] = [
  {
    part: "左牵引电机",
    averageLoadPower: "264 kW",
    averageLoadTemperature: "72.4℃",
    todayLoadedRuntime: "7h 12m",
    todayOverloadTime: "16m",
    todayOverTemperatureTime: "42m",
  },
  {
    part: "右牵引电机",
    averageLoadPower: "257 kW",
    averageLoadTemperature: "70.8℃",
    todayLoadedRuntime: "7h 06m",
    todayOverloadTime: "14m",
    todayOverTemperatureTime: "38m",
  },
];

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

const cuttingLogs: CuttingAnalysisLogEntry[] = parseLogEntries([
  "2026-03-10 14:10:23 记忆截割1右升",
  "2026-03-10 14:10:23 系统执行1右升",
  "2026-03-10 14:10:42 记忆截割1左升",
  "2026-03-10 14:10:42 系统执行1左升",
  "2026-03-10 14:11:23 记忆截割2左降",
]);

const cuttingAlerts: CuttingAnalysisLogEntry[] = parseLogEntries([
  "2026-03-10 14:10:23 EDCR泵箱温度高报警！",
  "2026-03-10 14:10:23 EDCR流量检测通道1报警！",
  "2026-03-10 14:10:42 RDCR流量通道1保护！",
  "2026-03-10 14:10:42 EDCR流量监测通道2保护！",
  "2026-03-10 14:11:23 EDCR流量监测通道2报警！",
]);

const tractionLogs: TractionAnalysisLogEntry[] = parseLogEntries([
  "2026-03-10 14:10:23 左牵引系统收到启动指令",
  "2026-03-10 14:10:23 左牵引电机进入带载运行",
  "2026-03-10 14:10:42 右牵引系统执行扭矩补偿",
  "2026-03-10 14:10:42 变频器输出转矩上升至 76%",
  "2026-03-10 14:11:23 牵引速度反馈恢复稳定",
]);

const tractionAlerts: TractionAnalysisLogEntry[] = parseLogEntries([
  "2026-03-10 14:10:23 4210 冷却水流量不足，变频器降额运行！",
  "2026-03-10 14:10:23 左牵引电机温度接近上限，建议降低带载速度！",
  "2026-03-10 14:10:42 3130 中间直流电压振荡，牵引控制进入观察状态！",
  "2026-03-10 14:10:42 输出转矩波动偏大，检查机械阻滞与负载差异！",
]);

const cloneCheckinItems = () => todayCheckinItemsStore.map((item) => ({ ...item }));

const cloneCheckinHistory = () => checkinHistoryStore.map((item) => ({ ...item }));

const cloneCheckinCalendarRecords = (): Record<string, CheckinCalendarRecord> =>
  Object.fromEntries(
    Object.entries(checkinCalendarStore).map(([date, record]) => [date, { ...record }]),
  );

// 兜底值：真实运行信息由 DataplaneDataSourceAdapter 现读后覆盖（runtimeInfo）
export const networkInfoData: KeyValueField[] = toFields([
  ["工控机主机名", "未读取"],
  ["工控机地址", "未读取"],
  ["数据服务", "HTTP + WebSocket"],
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

export const createKnowledgeAssetsSnapshot = (): KnowledgeAssetsResponse => knowledgeAssets;

export const createRunCycleSnapshot = (): RunCycleResponse => ({
  xAxisOptions: [...cycleXAxisOptions],
  yAxisOptions: [...cycleYAxisOptions],
  defaultCharts: {
    A: {
      xAxis: "时间",
      yAxes: ["采煤机速度", "左截割电机温度"],
    },
    B: {
      xAxis: "工作面",
      yAxes: ["左截割电机电流", "左牵引电机电流", "泵电机温度"],
    },
  },
  labelSets: {
    时间: Array.from({ length: 20 }, (_, index) => `${String(index).padStart(2, "0")}:00`),
    工作面: Array.from({ length: 20 }, (_, index) => `段 ${index + 1}`),
    温度: Array.from({ length: 20 }, (_, index) => `${40 + index * 3}℃`),
  },
  seriesCatalog: cycleSeriesCatalog,
});

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

export const createRankings = ({
  end = "2026-03-31",
  start = "2026-03-01",
  system = "all",
}: {
  start?: string;
  end?: string;
  system?: RankingSystemFilter;
} = {}): RankingsResponse => ({
  start,
  end,
  system,
  systemFaultRankings,
  inverterFaultRankings,
  sensorFaultRankings,
});

export const createCheckinsSnapshot = (): CheckinsResponse => ({
  todayDate: checkinTodayDate,
  todayItems: cloneCheckinItems(),
  historyData: cloneCheckinHistory(),
  calendarRecords: cloneCheckinCalendarRecords(),
});

export const submitCheckins = ({
  checkedItemIds,
}: CheckinsSubmitRequest): CheckinsResponse => {
  todayCheckinItemsStore = initialCheckinItems.map((item) => ({
    ...item,
    checked: checkedItemIds.includes(item.id),
  }));

  const checkedCount = todayCheckinItemsStore.filter((item) => item.checked).length;
  const total = todayCheckinItemsStore.length;
  const status: CheckinStatus =
    checkedCount === total ? "done" : checkedCount > 0 ? "partial" : "missed";
  const result =
    status === "done" ? "已完成" : status === "partial" ? "部分完成" : "未打卡";
  const note = `${checkedCount}/${total} 项已确认`;

  checkinCalendarStore = {
    ...checkinCalendarStore,
    [checkinTodayDate]: {
      status,
      shift: "当前班次",
      person: "当前点检员",
      result,
      note,
      detail: "由平板端提交的当日点检记录（原型示意）。",
    },
  };

  const nextHistoryEntry: CheckinHistoryEntry = {
    date: checkinTodayDate,
    shift: "当前班次",
    person: "当前点检员",
    result,
    note,
  };

  checkinHistoryStore = [
    nextHistoryEntry,
    ...checkinHistoryStore.filter((item) => item.date !== checkinTodayDate),
  ];

  return createCheckinsSnapshot();
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

export const createCuttingAnalysis = (
  range: CuttingAnalysisRange = "24h",
): CuttingAnalysisResponse => {
  const labels = Array.from({ length: range === "24h" ? 24 : 24 }, (_, index) =>
    `${String(index).padStart(2, "0")}:00`,
  );

  const motorSeries: CuttingAnalysisSeries[] = [
    {
      name: "左截割电机温度",
      color: "#ffb14a",
      values: generateSeries(24, 78, 10.2, 1, 0.1),
    },
    {
      name: "右截割电机温度",
      color: "#f7d65c",
      values: generateSeries(24, 74, 9.0, 2, 0.1),
    },
    {
      name: "左截割电机电流",
      color: "#4f8cff",
      values: generateSeries(24, 208, 44, 0, 0.09),
    },
    {
      name: "右截割电机电流",
      color: "#48c7ff",
      values: generateSeries(24, 196, 38, 1, 0.08),
    },
  ];

  const armSeries: CuttingAnalysisSeries[] = [
    {
      name: "左摇臂温度",
      color: "#38d889",
      values: generateSeries(24, 65, 7.2, 0, 0.1),
    },
    {
      name: "右摇臂温度",
      color: "#9f86ff",
      values: generateSeries(24, 66.5, 7.8, 1, 0.1),
    },
    {
      name: "左摇臂电流",
      color: "#ffb14a",
      values: generateSeries(24, 116, 18, 2, 0.09),
    },
    {
      name: "右摇臂电流",
      color: "#4f8cff",
      values: generateSeries(24, 121, 21, 1, 0.09),
    },
  ];

  return {
    range,
    labels,
    motorSeries,
    armSeries,
    stats: cuttingStats,
    logs: cuttingLogs,
    alerts: cuttingAlerts,
  };
};

export const createTractionAnalysis = (
  range: TractionAnalysisRange = "24h",
): TractionAnalysisResponse => {
  const labels = Array.from({ length: range === "24h" ? 24 : 24 }, (_, index) =>
    `${String(index).padStart(2, "0")}:00`,
  );

  const motorSeries: TractionAnalysisSeries[] = [
    {
      name: "左牵引电机温度",
      color: "#ffb14a",
      values: generateSeries(24, 73, 7.5, 1, 0.1),
    },
    {
      name: "右牵引电机温度",
      color: "#f7d65c",
      values: generateSeries(24, 70.5, 6.8, 2, 0.1),
    },
    {
      name: "左牵引电机电流",
      color: "#4f8cff",
      values: generateSeries(24, 168, 28, 1, 0.1),
    },
    {
      name: "右牵引电机电流",
      color: "#48c7ff",
      values: generateSeries(24, 162, 26, 0, 0.09),
    },
  ];

  const inverterSeries: TractionAnalysisSeries[] = [
    {
      name: "输入电压",
      color: "#38d889",
      values: generateSeries(24, 1140, 32, 0, 0.06),
    },
    {
      name: "直流电压",
      color: "#4f8cff",
      values: generateSeries(24, 1550, 55, 1, 0.06),
    },
    {
      name: "输出转矩",
      color: "#ffb14a",
      values: generateSeries(24, 72, 16, 2, 0.1),
    },
    {
      name: "IGBT温度",
      color: "#ff5f57",
      values: generateSeries(24, 68, 11, 1, 0.1),
    },
  ];

  return {
    range,
    labels,
    motorSeries,
    inverterSeries,
    stats: tractionStats,
    logs: tractionLogs,
    alerts: tractionAlerts,
  };
};
