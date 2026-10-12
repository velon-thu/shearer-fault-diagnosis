import { z } from "zod";

export const LinkStatusSchema = z.enum(["connected", "disconnected"]);
export const DeviceStatusSchema = z.enum(["ok", "warn", "error", "offline"]);
export const FaultCategorySchema = z.enum(["system", "inverter"]);
export const KeyValueFieldSchema = z.object({
  label: z.string(),
  value: z.string(),
});

export const ConnectionStatusSchema = z.object({
  tabletToIpc: LinkStatusSchema,
  hpc: DeviceStatusSchema,
  moc: DeviceStatusSchema,
  boc: DeviceStatusSchema,
  axi: DeviceStatusSchema,
  wcr: DeviceStatusSchema,
  sgc: DeviceStatusSchema,
  bp1: DeviceStatusSchema,
  bp2: DeviceStatusSchema,
  syncAt: z.string().datetime(),
});

export const BootstrapResponseSchema = z.object({
  machineModel: z.string(),
  machineName: z.string(),
  connected: z.boolean(),
  connection: ConnectionStatusSchema,
});

export const WeeklyEventSchema = z.object({
  time: z.string(),
  text: z.string(),
  target: z.string(),
});

export const HomeSummarySchema = z.object({
  weeklyEventCount: z.number().int().nonnegative(),
  latestWeeklyEvent: WeeklyEventSchema,
  topFault: z.object({
    name: z.string(),
    count: z.number().int().nonnegative(),
    lastOccurredAt: z.string(),
  }),
  topSensor: z.object({
    name: z.string(),
    count: z.number().int().nonnegative(),
    lastOccurredAt: z.string(),
  }),
});

export const SensorSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  location: z.string(),
  state: z.string(),
  valid: z.boolean(),
  failures30d: z.number().int().nonnegative(),
  lastSeen: z.string(),
  unit: z.string(),
});

export const SensorDetailSchema = SensorSummarySchema.extend({
  averageValue: z.number(),
  peakValue: z.number(),
  averageDisplay: z.string(),
  peakDisplay: z.string(),
});

export const SensorTrendPointSchema = z.object({
  time: z.string(),
  value: z.number(),
  unit: z.string(),
  ts: z.number().optional(), // Unix 毫秒（时间轴缩放用；mock 数据可缺省）
});

export const PumpAnalysisRangeSchema = z.enum(["24h"]);

export const PumpAnalysisSeriesSchema = z.object({
  name: z.string(),
  color: z.string(),
  values: z.array(z.number()),
});

export const PumpAnalysisLogEntrySchema = z.object({
  time: z.string(),
  text: z.string(),
});

export const PumpAnalysisResponseSchema = z.object({
  range: PumpAnalysisRangeSchema,
  labels: z.array(z.string()),
  trendSeries: z.array(PumpAnalysisSeriesSchema),
  stats: z.array(KeyValueFieldSchema),
  logs: z.array(PumpAnalysisLogEntrySchema),
  alerts: z.array(PumpAnalysisLogEntrySchema),
});

export const CuttingAnalysisRangeSchema = z.enum(["24h"]);

export const CuttingAnalysisSeriesSchema = z.object({
  name: z.string(),
  color: z.string(),
  values: z.array(z.number()),
});

export const CuttingAnalysisStatsRowSchema = z.object({
  part: z.string(),
  averageLoadPower: z.string(),
  averageLoadTemperature: z.string(),
  todayLoadedRuntime: z.string(),
  todayOverloadTime: z.string(),
  todayOverTemperatureTime: z.string(),
});

export const CuttingAnalysisLogEntrySchema = z.object({
  time: z.string(),
  text: z.string(),
});

export const CuttingAnalysisResponseSchema = z.object({
  range: CuttingAnalysisRangeSchema,
  labels: z.array(z.string()),
  motorSeries: z.array(CuttingAnalysisSeriesSchema),
  armSeries: z.array(CuttingAnalysisSeriesSchema),
  stats: z.array(CuttingAnalysisStatsRowSchema),
  logs: z.array(CuttingAnalysisLogEntrySchema),
  alerts: z.array(CuttingAnalysisLogEntrySchema),
});

export const TractionAnalysisRangeSchema = z.enum(["24h"]);

export const TractionAnalysisSeriesSchema = z.object({
  name: z.string(),
  color: z.string(),
  values: z.array(z.number()),
});

export const TractionAnalysisStatsRowSchema = z.object({
  part: z.string(),
  averageLoadPower: z.string(),
  averageLoadTemperature: z.string(),
  todayLoadedRuntime: z.string(),
  todayOverloadTime: z.string(),
  todayOverTemperatureTime: z.string(),
});

export const TractionAnalysisLogEntrySchema = z.object({
  time: z.string(),
  text: z.string(),
});

export const TractionAnalysisResponseSchema = z.object({
  range: TractionAnalysisRangeSchema,
  labels: z.array(z.string()),
  motorSeries: z.array(TractionAnalysisSeriesSchema),
  inverterSeries: z.array(TractionAnalysisSeriesSchema),
  stats: z.array(TractionAnalysisStatsRowSchema),
  logs: z.array(TractionAnalysisLogEntrySchema),
  alerts: z.array(TractionAnalysisLogEntrySchema),
});

export const FaultCodeResultSchema = z.object({
  category: FaultCategorySchema,
  code: z.string(),
  found: z.boolean(),
  description: z.string().nullable(),
  tip: z.string().nullable(),
});

export const RankingSystemFilterSchema = z.enum(["all", "hydraulic", "cutting", "traction"]);

export const RankingItemSchema = z.object({
  name: z.string(),
  count: z.number().int().nonnegative(),
  lastOccurredAt: z.string(),
});

export const RankingsResponseSchema = z.object({
  start: z.string(),
  end: z.string(),
  system: RankingSystemFilterSchema,
  systemFaultRankings: z.array(RankingItemSchema),
  inverterFaultRankings: z.array(RankingItemSchema),
  sensorFaultRankings: z.array(RankingItemSchema),
});

export const CheckinStatusSchema = z.enum(["done", "partial", "missed"]);

export const CheckinItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  checked: z.boolean(),
});

export const CheckinHistoryEntrySchema = z.object({
  date: z.string(),
  shift: z.string(),
  person: z.string(),
  result: z.string(),
  note: z.string(),
});

export const CheckinCalendarRecordSchema = z.object({
  status: CheckinStatusSchema,
  shift: z.string(),
  person: z.string(),
  result: z.string(),
  note: z.string(),
  detail: z.string(),
});

export const CheckinsResponseSchema = z.object({
  todayDate: z.string(),
  todayItems: z.array(CheckinItemSchema),
  historyData: z.array(CheckinHistoryEntrySchema),
  calendarRecords: z.record(z.string(), CheckinCalendarRecordSchema),
});

export const CheckinsSubmitRequestSchema = z.object({
  checkedItemIds: z.array(z.string()),
});

export const KnowledgeAssetSchema = z.object({
  title: z.string(),
  meta: z.string(),
});

export const KnowledgeAssetsResponseSchema = z.object({
  drawing: z.array(KnowledgeAssetSchema),
  install: z.array(KnowledgeAssetSchema),
  troubleshoot: z.array(KnowledgeAssetSchema),
});

export const RunCycleChartConfigSchema = z.object({
  xAxis: z.string(),
  yAxes: z.array(z.string()).min(1),
});

export const RunCycleSeriesSchema = z.object({
  name: z.string(),
  color: z.string(),
  values: z.array(z.number()),
});

export const RunCycleResponseSchema = z.object({
  xAxisOptions: z.array(z.string()),
  yAxisOptions: z.array(z.string()),
  defaultCharts: z.object({
    A: RunCycleChartConfigSchema,
    B: RunCycleChartConfigSchema,
  }),
  labelSets: z.record(z.string(), z.array(z.string())),
  seriesCatalog: z.record(z.string(), RunCycleSeriesSchema),
});

export const AuthUserSchema = z.object({
  employeeNo: z.string(),
  displayName: z.string(),
  role: z.string(),
});

export const AuthLoginRequestSchema = z.object({
  employeeNo: z.string().min(1),
  password: z.string().min(1),
});

export const AuthLoginResponseSchema = z.object({
  accessToken: z.string(),
  expiresAt: z.string().datetime(),
  user: AuthUserSchema,
});

export const AuthMeResponseSchema = z.object({
  expiresAt: z.string().datetime(),
  user: AuthUserSchema,
});

export const AuthLogoutResponseSchema = z.object({
  loggedOut: z.literal(true),
});

export const SettingsVersionHistoryItemSchema = z.object({
  date: z.string(),
  desc: z.string(),
});

// 数据源实况：库在哪、多大、覆盖到什么时候、采集还在不在跑
export const SettingsDataSourceSchema = z.object({
  dbPath: z.string(),
  dbSizeMb: z.number().nullable(),
  fromMs: z.number().nullable(),
  toMs: z.number().nullable(),
  lagMs: z.number().nullable(),
  collecting: z.boolean(),
  tables: z.array(z.object({ name: z.string(), rows: z.number() })),
  trees: z.array(z.object({ name: z.string(), modules: z.number(), nodes: z.number() })),
});
export const SettingsSnapshotSchema = z.object({
  connected: z.boolean(),
  connection: ConnectionStatusSchema,
  workFaceFields: z.array(KeyValueFieldSchema),
  machineFields: z.array(KeyValueFieldSchema),
  versionHistoryData: z.array(SettingsVersionHistoryItemSchema),
  networkInfoData: z.array(KeyValueFieldSchema),
  // 下面两组是工控机上真实读出来的，不是配置里写死的
  runtimeInfo: z.array(KeyValueFieldSchema).optional(),
  dataSource: SettingsDataSourceSchema.optional(),
});

// ===== 共享内存监视（/api/shm/live） =====
export const ShmVariableSchema = z.object({
  add: z.number(),
  kind: z.enum(["sensor", "status"]),
  category: z.string(),
  name: z.string(),
  stdTag: z.string(),
  org: z.string(), // ORG 映射表达式，空串=未映射（恒 0）
  raw: z.number(), // 共享内存原始 uint16
  value: z.number(), // sensor=工程值(原始×accuracy)，status=0/1
  unit: z.string(),
  sheet: z.string(),
});

export const ShmOpsGroupSchema = z.object({
  groupNo: z.number(),
  sourceName: z.string(),
  sourceType: z.string(), // 输入/输出
  hex: z.string(), // 32 位操作码，如 0x00000200
  activeOps: z.array(z.string()), // 当前为 1 的指令名
});

export const ShmFaultSchema = z.object({
  code: z.number(),
  name: z.string(),
  trigger: z.string(), // bit / bit_inv / eq:N / neq:N
  raw: z.number(),
  active: z.boolean(),
});

export const ShmFifoSchema = z.object({
  module: z.string(), // BOC/HPC/MOC
  words: z.array(z.number()).length(4),
});

export const ShmLiveMetaSchema = z.object({
  heartbeat: z.number(),
  records: z.number(), // 回放器已写记录总数
  fileIndex: z.number(),
  fileTotal: z.number(),
  intervalMs: z.number(),
  replayerAlive: z.boolean(), // 心跳近 3 秒内有变化
});

export const ShmLiveResponseSchema = z.object({
  available: z.boolean(), // 共享内存是否存在
  shmName: z.string(),
  meta: ShmLiveMetaSchema.nullable(),
  variables: ShmVariableSchema.array(),
  ops: ShmOpsGroupSchema.array(),
  faults: ShmFaultSchema.array(),
  fifos: ShmFifoSchema.array(),
});

export const ApiSuccessResponseSchema = z.object({
  success: z.literal(true),
  data: z.unknown(),
});

export const ApiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string().datetime(),
});

export const LiveMessageSchema = z.object({
  type: z.literal("connection_status"),
  data: ConnectionStatusSchema,
});

export const createApiSuccessResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  ApiSuccessResponseSchema.extend({
    data: dataSchema,
  });

export const SensorIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const SensorTrendRangeSchema = z.enum(["10m", "1h", "6h", "24h", "all"]);

export const SensorTrendQuerySchema = z.object({
  range: SensorTrendRangeSchema.default("all"),
  // 自定义窗口（毫秒时间戳），二者同时给出时优先于 range
  from: z.coerce.number().int().positive().optional(),
  to: z.coerce.number().int().positive().optional(),
});

export const FaultCodeSearchQuerySchema = z.object({
  category: FaultCategorySchema.default("system"),
  code: z.string().min(1).default("0x0094"),
});

export const RankingsQuerySchema = z.object({
  start: z.string().default("2026-03-01"),
  end: z.string().default("2026-03-31"),
  system: RankingSystemFilterSchema.default("all"),
  // 毫秒级窗口（时间滑块选择），给出时优先于 start/end 日期串
  from: z.coerce.number().int().positive().optional(),
  to: z.coerce.number().int().positive().optional(),
});

// 数据库现有数据的时间窗（时间选择滑块的可选边界）
export const DataWindowSchema = z.object({
  fromMs: z.number().nullable(),
  toMs: z.number().nullable(),
});

// 故障目录条目（故障设置用）
export const FaultRuleItemSchema = z.object({
  code: z.number(),
  name: z.string(),
  type: z.number(), // 0提示 1警告 2停机
  kind: z.number(), // 1变频器 2电机 3模块 4传感器 5自动化 6内部 7来源
  handle: z.string().optional(), // 处理建议（fault_rule 独有）
});
export const FaultRulesResponseSchema = z.array(FaultRuleItemSchema);

// ===== 故障冻结帧 =====
export const FreezeFrameSignalSchema = z.object({
  name: z.string(),
  unit: z.string(),
  points: z.array(z.object({ ts: z.number(), value: z.number() })),
  // 故障时刻前后各 1 分钟的均值对比，用来判断这一路有没有跟着变
  beforeAvg: z.number().nullable(),
  afterAvg: z.number().nullable(),
  changePct: z.number().nullable(),
  // none=没明显变化 / drop-zero=掉到零 / drop=下降 / surge=上升 / invalid=测点无效
  change: z.enum(["none", "drop-zero", "drop", "surge", "invalid"]),
  changeText: z.string(),
});
export const FreezeFrameOperationSchema = z.object({
  ts: z.number(),
  offsetMs: z.number(), // 相对故障时刻，负数=故障前
  source: z.string(), // 左遥控器 / 电控箱按钮 / 系统输出 …
  op: z.string(),
  input: z.boolean(), // true=人按的，false=主控输出
});
export const FreezeFrameEventSchema = z.object({
  ts: z.number(),
  offsetMs: z.number(),
  kind: z.enum(["fault", "clear", "state"]),
  text: z.string(),
  tone: z.enum(["stop", "warn", "ok", "state"]),
});
export const FreezeFrameSummarySchema = z.object({
  headline: z.string(), // 一句话结论
  findings: z.array(z.string()), // 曲线上看到的
  context: z.array(z.string()), // 前后的操作与其他异常
  caveats: z.array(z.string()), // 数据说不准的地方，宁可写明
});
export const FreezeFrameSchema = z.object({
  ts: z.number(), // 故障时刻
  fromMs: z.number(),
  toMs: z.number(),
  faultName: z.string().nullable(),
  // 同一秒一起报出来的其他故障：现场常见一按停机十几条齐发，得让人看见
  concurrentFaults: z.array(z.string()),
  signals: z.array(FreezeFrameSignalSchema),
  operations: z.array(FreezeFrameOperationSchema),
  events: z.array(FreezeFrameEventSchema),
  summary: FreezeFrameSummarySchema,
});

// ===== 一键体检 =====
export const HealthSymmetrySchema = z.object({
  item: z.string(),
  left: z.number(),
  right: z.number(),
  unit: z.string(),
  diffText: z.string(),
  judge: z.enum(["normal", "attention", "invalid"]),
});
// 体检分项：每项独立满分，扣分要说得出理由，前端逐项展开
export const HealthCheckItemSchema = z.object({
  key: z.string(),
  name: z.string(),
  status: z.enum(["ok", "attention", "bad", "skipped"]),
  score: z.number(), // 实得分
  maxScore: z.number(),
  summary: z.string(),
  details: z.array(z.string()),
});
export const HealthReportSchema = z.object({
  scannedAt: z.number(),
  score: z.number(),
  grade: z.enum(["优", "良", "注意", "异常"]),
  items: z.array(HealthCheckItemSchema),
  modules: z.array(z.object({ name: z.string(), ok: z.boolean() })),
  sensors: z.object({
    total: z.number(),
    valid: z.number(),
    notInstalled: z.number(),
    invalid: z.array(z.object({ name: z.string(), state: z.string() })),
  }),
  activeFaults: z.array(z.object({ name: z.string(), type: z.number(), occurTs: z.number() })),
  // 由未配备/无效测点引发的常驻报警：单列出来，不参与扣分
  suspectFaults: z.array(z.object({ name: z.string(), reason: z.string() })),
  symmetry: z.array(HealthSymmetrySchema),
  dataLagMs: z.number().nullable(), // 库内最新数据距now，判数据链路是否在跑
});

// ===== 引导性诊断树 =====
// 数据源是 docs/*诊断树*/diagnosis-trees.yaml，经 tools/build-diagnosis-trees.py
// 原样搬运成 JSON。这里的字段与 YAML 一一对应，后端不做任何裁剪或改写。
export const DiagnosisOptionStatusSchema = z.enum([
  "observed", // 录屏中直接看到跳转
  "recorded", // 同上，电机启停树的写法
  "inferred_from_backtracking",
  "inferred_from_recorded_backtracking",
  "inferred_from_technical_logic",
  "unresolved_not_recorded", // 录屏未展示下一页：前端显示待补录，禁止编造
]);
export const DiagnosisOptionSchema = z.object({
  label: z.string(),
  next: z.string().nullable(),
  status: DiagnosisOptionStatusSchema,
  note: z.string().optional(),
});
export const DiagnosisNodeSchema = z.object({
  id: z.string(),
  type: z.enum(["question", "result"]),
  text: z.string(),
  options: z.array(DiagnosisOptionSchema),
  note: z.string().optional(),
  sourcePage: z.string().optional(),
  sourceTimestampS: z.number().optional(),
  sourceFrame: z.string().optional(),
  severity: z.string().optional(), // 结论节点的分级：diagnosis / warning
  confidence: z.string().optional(),
});
export const DiagnosisModuleSchema = z.object({
  id: z.string(),
  index: z.number().int(),
  name: z.string(),
  startNode: z.string(),
  sourceVideo: z.string().optional(),
  nodes: z.array(DiagnosisNodeSchema),
});
export const DiagnosisTreeSchema = z.object({
  id: z.string(), // arm-height / traction / motor-start-stop
  shortName: z.string(),
  title: z.string(),
  schemaVersion: z.string(),
  sourceDir: z.string(),
  extractionNotes: z.array(z.string()),
  // 部分树带原理说明与安全须知，前端在第一问展示（须知按条目给，逐条列出）
  introduction: z.string().optional(),
  safetyNotice: z.array(z.string()).optional(),
  modules: z.array(DiagnosisModuleSchema),
});
export const DiagnosisTreesResponseSchema = z.object({
  generatedAt: z.string(),
  trees: z.array(DiagnosisTreeSchema),
});

// ===== 调高证据（诊断树的数据侧旁证） =====
// 判定口径统一：三段 = 指令段（输入侧按下）→ 输出段（主控输出）→ 效果段（采高变化）。
export const ArmEvidenceVerdictSchema = z.enum([
  "ok", // 三段全通，摇臂动了
  "no-motion", // 主控已输出但采高不动 → 输出继电器之后
  "chain-broken", // 有输入无输出 → 遥控器/接收模块/主控
  "no-command", // 窗口内没有该侧升降指令，判不了
  "sensor-invalid", // 采高测点无效，效果段不可判
]);
export const ArmEvidenceSourceSchema = z.object({
  source: z.string(), // 左遥控器 / 右端头站 / 自动截割 / 上位机 …
  count: z.number().int().nonnegative(),
  movedCount: z.number().int().nonnegative(),
  lastTs: z.number().nullable(),
});
export const ArmEvidenceSideSchema = z.object({
  side: z.enum(["left", "right"]),
  label: z.string(),
  inputCount: z.number().int().nonnegative(),
  outputCount: z.number().int().nonnegative(),
  matchedCount: z.number().int().nonnegative(), // 输入后 2s 内有对应输出
  matchedRatePct: z.number().nullable(),
  movedCount: z.number().int().nonnegative(), // 输出后 8s 内采高有变化
  movedRatePct: z.number().nullable(),
  medianDeltaM: z.number().nullable(), // 单次指令位移中位数
  heightValid: z.boolean(),
  verdict: ArmEvidenceVerdictSchema,
  verdictText: z.string(),
  sources: z.array(ArmEvidenceSourceSchema),
  baselineMovedRatePct: z.number().nullable(), // 全库基线
  baselineMedianDeltaM: z.number().nullable(),
  efficiencyPct: z.number().nullable(), // 窗口位移 / 基线位移
});
export const ArmEvidenceProfileSchema = z.object({
  candidates: z.array(
    z.object({
      moduleId: z.string(),
      name: z.string(),
      reasons: z.array(z.string()),
    }),
  ),
  facts: z.array(z.object({ label: z.string(), value: z.string() })),
});
export const ArmEvidenceSchema = z.object({
  fromMs: z.number(),
  toMs: z.number(),
  windowLabel: z.string(),
  pump: z.object({
    running: z.boolean(),
    contactorOn: z.boolean(),
    lastChangeTs: z.number().nullable(),
    text: z.string(),
  }),
  sides: z.array(ArmEvidenceSideSchema),
  sideVerdict: z.enum(["both", "left", "right", "none", "unknown"]),
  sideVerdictText: z.string(),
  modules: z.array(z.object({ name: z.string(), ok: z.boolean(), note: z.string() })),
  profile: ArmEvidenceProfileSchema,
  // 诊断树里问到、但本机确实没有测点的项：宁可写明"请现场实测"，不许拿别的数糊弄
  unavailable: z.array(z.object({ topic: z.string(), reason: z.string() })),
});
export const ArmEvidenceQuerySchema = z.object({
  window: z.coerce.number().int().positive().optional(), // 毫秒，缺省 2 小时
});

// ===== 牵引证据（系统牵引故障诊断树的数据侧） =====
// 三段口径同调高：指令段（输入按下）→ 输出段（主控输出）→ 效果段（实测速度变化）。
export const TractionStateSchema = z.object({
  label: z.string(),
  value: z.string(),
  // true=正常 / false=异常 / null=该位无效或判不了，前端据此上色
  ok: z.boolean().nullable(),
  note: z.string().optional(),
});
export const TractionCommandSourceSchema = z.object({
  op: z.string(), // 牵停 / 减速 / 牵启 …
  totalCount: z.number().int().nonnegative(),
  sources: z.array(
    z.object({
      source: z.string(),
      count: z.number().int().nonnegative(),
      lastTs: z.number().nullable(),
    }),
  ),
});
export const TractionInverterSchema = z.object({
  name: z.string(),
  busVoltageV: z.number().nullable(),
  outputFreqHz: z.number().nullable(),
  outputTorquePct: z.number().nullable(),
  igbtTemp: z.number().nullable(),
  running: z.boolean().nullable(),
  extFault: z.boolean().nullable(),
  invalidTags: z.array(z.string()), // 读数恒定判为无效的测点，明说别当证据用
});
export const TractionEvidenceSchema = z.object({
  fromMs: z.number(),
  toMs: z.number(),
  windowLabel: z.string(),
  states: z.array(TractionStateSchema),
  chain: z.object({
    inputCount: z.number().int().nonnegative(),
    outputCount: z.number().int().nonnegative(),
    matchedCount: z.number().int().nonnegative(),
    matchedRatePct: z.number().nullable(),
    movedCount: z.number().int().nonnegative(),
    movedRatePct: z.number().nullable(),
    maxSpeedMmin: z.number().nullable(),
    speedValid: z.boolean(),
    verdict: ArmEvidenceVerdictSchema,
    verdictText: z.string(),
  }),
  commandSources: z.array(TractionCommandSourceSchema),
  inverters: z.array(TractionInverterSchema),
  brake: z.object({
    cmd: z.boolean().nullable(),
    ack: z.boolean().nullable(),
    released: z.boolean().nullable(),
    // 松闸确认位与实际运行状态互相矛盾时判为不可信，宁可不给结论
    trustworthy: z.boolean(),
    text: z.string(),
  }),
  activeFaults: z.array(
    z.object({ name: z.string(), type: z.number(), occurTs: z.number() }),
  ),
  loadBalance: z.array(
    z.object({ label: z.string(), left: z.number(), right: z.number(), unit: z.string() }),
  ),
  unavailable: z.array(z.object({ topic: z.string(), reason: z.string() })),
});

// ===== 电机启停证据（电机启停故障诊断树的数据侧） =====
// 启动链就是共享内存里的五个状态位：启动预警 → 启动过程中 → 接触器吸合 → 运行中，
// 外加一个漏电闭锁。诊断树问的"断在哪一环"，这条链逐位都能答。
export const MotorStageSchema = z.object({
  label: z.string(), // 启动预警 / 启动过程中 / 接触器吸合 / 运行中 / 漏电闭锁
  on: z.boolean().nullable(), // null = 该位读不到
  lastOnTs: z.number().nullable(), // 窗口内最后一次置起的时刻
  onCount: z.number().int().nonnegative(), // 窗口内置起次数
});
export const MotorUnitSchema = z.object({
  id: z.string(), // pump / left-cutter / right-cutter / crusher
  name: z.string(),
  installed: z.boolean(), // 五位全程为 0 视为未配备/未接
  stages: z.array(MotorStageSchema),
  // 启动链断点：ok / never-started / start-failed / not-holding / leak-locked / not-installed / no-data
  verdict: z.string(),
  verdictText: z.string(),
  runSeconds: z.number().nullable(), // 窗口内累计运行时长
  restartCount: z.number().int().nonnegative(), // 窗口内"起来又掉"的次数
  currentA: z.number().nullable(),
  loadPct: z.number().nullable(),
  tempC: z.number().nullable(),
});
export const MotorEvidenceSchema = z.object({
  fromMs: z.number(),
  toMs: z.number(),
  windowLabel: z.string(),
  motors: z.array(MotorUnitSchema),
  // 树里反复问的"停止信号来自哪里"，按操作来源分组
  stopSources: z.array(TractionCommandSourceSchema),
  startSources: z.array(TractionCommandSourceSchema),
  activeFaults: z.array(
    z.object({ name: z.string(), type: z.number(), occurTs: z.number() }),
  ),
  moduleOk: z.array(z.object({ name: z.string(), ok: z.boolean() })),
  // 树里直接问到的系统标志位，如"牵引被泵电机闭锁"提示
  flags: z.array(z.object({ label: z.string(), on: z.boolean().nullable() })),
  unavailable: z.array(z.object({ topic: z.string(), reason: z.string() })),
});

// ===== 事件关联时间线 =====
export const TimelineEventSchema = z.object({
  ts: z.number(),
  kind: z.enum(["fault", "clear", "op", "state"]),
  text: z.string(),
  tone: z.enum(["stop", "warn", "ok", "op", "state"]),
});
export const TimelineResponseSchema = z.object({
  fromMs: z.number(),
  toMs: z.number(),
  events: z.array(TimelineEventSchema),
});
export const TimelineQuerySchema = z.object({
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
});

// 采煤机当前机况（主页状态胶囊）
export const MachineStatusSchema = z.object({
  state: z.enum(["cutting", "dispatch", "stopped", "offline"]),
  speedMmin: z.number(), // 当前牵引速度 m/min（无效读数按 0）
});

// ===== 停机分析 =====
export const DowntimeCauseSchema = z.enum(["fault", "manual", "idle"]);

export const DowntimeSegmentSchema = z.object({
  state: z.enum(["cutting", "dispatch", "stopped", "poweroff"]),
  fromMs: z.number(),
  toMs: z.number(),
  cause: DowntimeCauseSchema.optional(), // 仅 stopped
  causeText: z.string().optional(),
  faults: z
    .array(z.object({ name: z.string(), occurTs: z.number(), handle: z.string() }))
    .optional(),
  actions: z
    .array(z.object({ ts: z.number(), source: z.string(), op: z.string(), action: z.string() }))
    .optional(),
});

export const DowntimeResponseSchema = z.object({
  fromMs: z.number(),
  toMs: z.number(),
  kpis: z.object({
    cuttingMs: z.number(),
    dispatchMs: z.number(),
    stoppedMs: z.number(), // 故障停机总时长
    poweroffMs: z.number(),
    stoppedCount: z.number(), // 故障停机次数
    longestStoppedMs: z.number(), // 最长单次故障停机
    cuttingRatePct: z.number(), // 割煤时长占比（通电时间口径）
  }),
  segments: z.array(DowntimeSegmentSchema),
});

export const DowntimeQuerySchema = z.object({
  from: z.coerce.number().int().positive().optional(),
  to: z.coerce.number().int().positive().optional(),
});

// 实时故障流条目（普通故障[警告/停机] + 内部故障[BOC/HPC/MOC]）
export const LiveFaultSchema = z.object({
  id: z.string(),
  source: z.enum(["normal", "internal"]),
  code: z.string(),
  name: z.string(),
  type: z.number(), // 1警告 2停机（内部故障按 2 处理）
  kind: z.number(),
  module: z.string(), // 内部故障：BOC/HPC/MOC；普通故障为空
  occurTs: z.number(),
  clearTs: z.number().nullable(), // null=进行中；内部故障为瞬时事件=occurTs
  handle: z.string(), // 处理建议/解析说明
});
export const LiveFaultsResponseSchema = z.array(LiveFaultSchema);

// 内部故障目录（BOC/HPC 现成解析条目 + MOC 来源代码表）
export const InternalFaultRulesSchema = z.object({
  bocHpc: FaultRulesResponseSchema,
  moc: FaultRulesResponseSchema,
});

export const CheckinsQuerySchema = z.object({});

export const PumpAnalysisQuerySchema = z.object({
  range: PumpAnalysisRangeSchema.default("24h"),
});

export const CuttingAnalysisQuerySchema = z.object({
  range: CuttingAnalysisRangeSchema.default("24h"),
});

export const TractionAnalysisQuerySchema = z.object({
  range: TractionAnalysisRangeSchema.default("24h"),
});

export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;
export type BootstrapResponse = z.infer<typeof BootstrapResponseSchema>;
export type WeeklyEvent = z.infer<typeof WeeklyEventSchema>;
export type HomeSummary = z.infer<typeof HomeSummarySchema>;
export type SensorSummary = z.infer<typeof SensorSummarySchema>;
export type SensorDetail = z.infer<typeof SensorDetailSchema>;
export type SensorTrendPoint = z.infer<typeof SensorTrendPointSchema>;
export type PumpAnalysisSeries = z.infer<typeof PumpAnalysisSeriesSchema>;
export type PumpAnalysisLogEntry = z.infer<typeof PumpAnalysisLogEntrySchema>;
export type PumpAnalysisResponse = z.infer<typeof PumpAnalysisResponseSchema>;
export type CuttingAnalysisSeries = z.infer<typeof CuttingAnalysisSeriesSchema>;
export type CuttingAnalysisStatsRow = z.infer<typeof CuttingAnalysisStatsRowSchema>;
export type CuttingAnalysisLogEntry = z.infer<typeof CuttingAnalysisLogEntrySchema>;
export type CuttingAnalysisResponse = z.infer<typeof CuttingAnalysisResponseSchema>;
export type TractionAnalysisSeries = z.infer<typeof TractionAnalysisSeriesSchema>;
export type TractionAnalysisStatsRow = z.infer<typeof TractionAnalysisStatsRowSchema>;
export type TractionAnalysisLogEntry = z.infer<typeof TractionAnalysisLogEntrySchema>;
export type TractionAnalysisResponse = z.infer<typeof TractionAnalysisResponseSchema>;
export type FaultCodeResult = z.infer<typeof FaultCodeResultSchema>;
export type RankingItem = z.infer<typeof RankingItemSchema>;
export type DataWindow = z.infer<typeof DataWindowSchema>;
export type FaultRuleItem = z.infer<typeof FaultRuleItemSchema>;
export type InternalFaultRules = z.infer<typeof InternalFaultRulesSchema>;
export type LiveFault = z.infer<typeof LiveFaultSchema>;
export type MachineStatus = z.infer<typeof MachineStatusSchema>;
export type FreezeFrameSignal = z.infer<typeof FreezeFrameSignalSchema>;
export type FreezeFrameOperation = z.infer<typeof FreezeFrameOperationSchema>;
export type FreezeFrameEvent = z.infer<typeof FreezeFrameEventSchema>;
export type FreezeFrameSummary = z.infer<typeof FreezeFrameSummarySchema>;
export type FreezeFrame = z.infer<typeof FreezeFrameSchema>;
export type HealthCheckItem = z.infer<typeof HealthCheckItemSchema>;
export type HealthReport = z.infer<typeof HealthReportSchema>;
export type DiagnosisOptionStatus = z.infer<typeof DiagnosisOptionStatusSchema>;
export type DiagnosisOption = z.infer<typeof DiagnosisOptionSchema>;
export type DiagnosisNode = z.infer<typeof DiagnosisNodeSchema>;
export type DiagnosisModule = z.infer<typeof DiagnosisModuleSchema>;
export type DiagnosisTree = z.infer<typeof DiagnosisTreeSchema>;
export type DiagnosisTreesResponse = z.infer<typeof DiagnosisTreesResponseSchema>;
export type ArmEvidenceVerdict = z.infer<typeof ArmEvidenceVerdictSchema>;
export type ArmEvidenceSource = z.infer<typeof ArmEvidenceSourceSchema>;
export type ArmEvidenceSide = z.infer<typeof ArmEvidenceSideSchema>;
export type ArmEvidenceProfile = z.infer<typeof ArmEvidenceProfileSchema>;
export type ArmEvidence = z.infer<typeof ArmEvidenceSchema>;
export type TractionState = z.infer<typeof TractionStateSchema>;
export type TractionCommandSource = z.infer<typeof TractionCommandSourceSchema>;
export type TractionInverter = z.infer<typeof TractionInverterSchema>;
export type TractionEvidence = z.infer<typeof TractionEvidenceSchema>;
export type MotorStage = z.infer<typeof MotorStageSchema>;
export type MotorUnit = z.infer<typeof MotorUnitSchema>;
export type MotorEvidence = z.infer<typeof MotorEvidenceSchema>;
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
export type TimelineResponse = z.infer<typeof TimelineResponseSchema>;
export type DowntimeSegment = z.infer<typeof DowntimeSegmentSchema>;
export type DowntimeResponse = z.infer<typeof DowntimeResponseSchema>;
export type RankingsResponse = z.infer<typeof RankingsResponseSchema>;
export type CheckinStatus = z.infer<typeof CheckinStatusSchema>;
export type CheckinItem = z.infer<typeof CheckinItemSchema>;
export type CheckinHistoryEntry = z.infer<typeof CheckinHistoryEntrySchema>;
export type CheckinCalendarRecord = z.infer<typeof CheckinCalendarRecordSchema>;
export type CheckinsResponse = z.infer<typeof CheckinsResponseSchema>;
export type CheckinsSubmitRequest = z.infer<typeof CheckinsSubmitRequestSchema>;
export type KnowledgeAsset = z.infer<typeof KnowledgeAssetSchema>;
export type KnowledgeAssetsResponse = z.infer<typeof KnowledgeAssetsResponseSchema>;
export type RunCycleChartConfig = z.infer<typeof RunCycleChartConfigSchema>;
export type RunCycleSeries = z.infer<typeof RunCycleSeriesSchema>;
export type RunCycleResponse = z.infer<typeof RunCycleResponseSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
export type AuthLoginRequest = z.infer<typeof AuthLoginRequestSchema>;
export type AuthLoginResponse = z.infer<typeof AuthLoginResponseSchema>;
export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;
export type AuthLogoutResponse = z.infer<typeof AuthLogoutResponseSchema>;
export type SettingsVersionHistoryItem = z.infer<typeof SettingsVersionHistoryItemSchema>;
export type SettingsDataSource = z.infer<typeof SettingsDataSourceSchema>;
export type SettingsSnapshot = z.infer<typeof SettingsSnapshotSchema>;
export type KeyValueField = z.infer<typeof KeyValueFieldSchema>;
export type FaultCategory = z.infer<typeof FaultCategorySchema>;
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;
export type RankingSystemFilter = z.infer<typeof RankingSystemFilterSchema>;
export type PumpAnalysisRange = z.infer<typeof PumpAnalysisRangeSchema>;
export type CuttingAnalysisRange = z.infer<typeof CuttingAnalysisRangeSchema>;
export type TractionAnalysisRange = z.infer<typeof TractionAnalysisRangeSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type LiveMessage = z.infer<typeof LiveMessageSchema>;
export type ShmVariable = z.infer<typeof ShmVariableSchema>;
export type ShmOpsGroup = z.infer<typeof ShmOpsGroupSchema>;
export type ShmFault = z.infer<typeof ShmFaultSchema>;
export type ShmFifo = z.infer<typeof ShmFifoSchema>;
export type ShmLiveMeta = z.infer<typeof ShmLiveMetaSchema>;
export type ShmLiveResponse = z.infer<typeof ShmLiveResponseSchema>;
export type ApiSuccessResponse<T> = {
  success: true;
  data: T;
};
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
