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

export const SettingsSnapshotSchema = z.object({
  connected: z.boolean(),
  connection: ConnectionStatusSchema,
  workFaceFields: z.array(KeyValueFieldSchema),
  machineFields: z.array(KeyValueFieldSchema),
  versionHistoryData: z.array(SettingsVersionHistoryItemSchema),
  networkInfoData: z.array(KeyValueFieldSchema),
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
