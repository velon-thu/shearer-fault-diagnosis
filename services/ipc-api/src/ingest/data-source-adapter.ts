import type {
  BootstrapResponse,
  DataWindow,
  DowntimeResponse,
  FaultRecurrence,
  FaultRuleItem,
  FreezeFrame,
  HealthReport,
  MachineStatus,
  TimelineResponse,
  InternalFaultRules,
  LiveFault,
  CheckinsResponse,
  CheckinsSubmitRequest,
  ConnectionStatus,
  CuttingAnalysisRange,
  CuttingAnalysisResponse,
  FaultCategory,
  FaultCodeResult,
  HomeSummary,
  KnowledgeAssetsResponse,
  PumpAnalysisRange,
  PumpAnalysisResponse,
  RankingsResponse,
  RankingSystemFilter,
  RunCycleResponse,
  SensorDetail,
  SensorSummary,
  SensorTrendPoint,
  SettingsSnapshot,
  TractionAnalysisRange,
  TractionAnalysisResponse,
  WeeklyEvent,
} from "@shearer/contracts";

export type LatestSnapshot = {
  bootstrap: BootstrapResponse;
  connection: ConnectionStatus;
  homeSummary: HomeSummary;
  weeklyEvents: WeeklyEvent[];
  settings: SettingsSnapshot;
};

export type RankingsParams = {
  start: string;
  end: string;
  system: RankingSystemFilter;
  fromMs?: number;
  toMs?: number;
};

export type DataSourceEvent = {
  type: "connection_status";
  data: ConnectionStatus;
};

export interface DataSourceAdapter {
  getLatestSnapshot(): Promise<LatestSnapshot>;
  getSettings(): Promise<SettingsSnapshot>;
  getSensorSummaries(): Promise<SensorSummary[]>;
  getSensorDetail(sensorId: string): Promise<SensorDetail | null>;
  getSensorTrend(sensorId: string, from: Date, to: Date): Promise<SensorTrendPoint[]>;
  getRankings(params: RankingsParams): Promise<RankingsResponse>;
  getDataWindow(): Promise<DataWindow>;
  getFaultRules(): Promise<FaultRuleItem[]>;
  getInternalFaultRules(): Promise<InternalFaultRules>;
  getLiveFaults(limit?: number): Promise<LiveFault[]>;
  getDowntime(fromMs?: number, toMs?: number): Promise<DowntimeResponse>;
  getMachineStatus(): Promise<MachineStatus>;
  getFreezeFrame(tsMs: number): Promise<FreezeFrame>;
  getHealthReport(): Promise<HealthReport>;
  getEventTimeline(fromMs: number, toMs: number): Promise<TimelineResponse>;
  getFaultRecurrence(code: number): Promise<FaultRecurrence>;
  getCheckins(): Promise<CheckinsResponse>;
  saveCheckin(payload: CheckinsSubmitRequest): Promise<CheckinsResponse>;
  getKnowledgeAssets(): Promise<KnowledgeAssetsResponse>;
  getRunCycle(): Promise<RunCycleResponse>;
  getFaultCodeResult(category: FaultCategory, code: string): Promise<FaultCodeResult>;
  getPumpAnalysis(range: PumpAnalysisRange): Promise<PumpAnalysisResponse>;
  getCuttingAnalysis(range: CuttingAnalysisRange): Promise<CuttingAnalysisResponse>;
  getTractionAnalysis(range: TractionAnalysisRange): Promise<TractionAnalysisResponse>;
  subscribe(onEvent: (event: DataSourceEvent) => void): () => void;
}
