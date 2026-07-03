import type {
  DataWindow,
  DowntimeResponse,
  FaultRuleItem,
  FreezeFrame,
  HealthReport,
  MachineStatus,
  TimelineResponse,
  InternalFaultRules,
  LiveFault,
  BootstrapResponse,
  CheckinsSubmitRequest,
  ConnectionStatus,
  CuttingAnalysisRange,
  FaultCategory,
  PumpAnalysisRange,
  TractionAnalysisRange,
} from "@shearer/contracts";
import {
  buildSensorTrend,
  createBootstrapPayload,
  createConnectionStatus,
  createCuttingAnalysis,
  createHomeSummary,
  createPumpAnalysis,
  createRunCycleSnapshot,
  createTractionAnalysis,
  findSensorById,
  getSensorSummaries,
  weeklyEvents,
} from "../mock";
import {
  initializeCheckinStore,
  readCheckinsFromSqlite,
  saveCheckinToSqlite,
} from "../db/checkins";
import {
  initializeFaultStores,
  readFaultCodeFromSqlite,
  readRankingsFromSqlite,
} from "../db/faults";
import {
  initializeKnowledgeStore,
  readKnowledgeAssetsFromSqlite,
} from "../db/knowledge";
import {
  initializeSettingsStore,
  readSettingsFromSqlite,
} from "../db/settings";
import type {
  DataSourceAdapter,
  DataSourceEvent,
  LatestSnapshot,
  RankingsParams,
} from "./data-source-adapter";

const buildBootstrapWithConnection = (connection: ConnectionStatus): BootstrapResponse => {
  const bootstrap = createBootstrapPayload();

  return {
    ...bootstrap,
    connected: connection.tabletToIpc === "connected",
    connection,
  };
};

export class MockDataSourceAdapter implements DataSourceAdapter {
  constructor() {
    initializeCheckinStore();
    initializeFaultStores();
    initializeKnowledgeStore();
    initializeSettingsStore();
  }

  async getLatestSnapshot(): Promise<LatestSnapshot> {
    const connection = createConnectionStatus();
    const settings = await this.getSettings();

    return {
      connection,
      bootstrap: buildBootstrapWithConnection(connection),
      homeSummary: createHomeSummary(),
      weeklyEvents: [...weeklyEvents],
      settings,
    };
  }

  async getSettings() {
    return readSettingsFromSqlite();
  }

  async getSensorSummaries() {
    return getSensorSummaries();
  }

  async getSensorDetail(sensorId: string) {
    return findSensorById(sensorId) ?? null;
  }

  async getSensorTrend(sensorId: string, _from: Date, _to: Date) {
    const sensor = findSensorById(sensorId);

    if (!sensor) {
      return [];
    }

    return buildSensorTrend(sensor, "24h");
  }

  async getDataWindow(): Promise<DataWindow> {
    return { fromMs: null, toMs: null };
  }

  async getFaultRules(): Promise<FaultRuleItem[]> {
    return [];
  }

  async getInternalFaultRules(): Promise<InternalFaultRules> {
    return { bocHpc: [], moc: [] };
  }

  async getMachineStatus(): Promise<MachineStatus> {
    return { state: "offline", speedMmin: 0 };
  }

  async getFreezeFrame(tsMs: number): Promise<FreezeFrame> {
    return { ts: tsMs, signals: [] };
  }

  async getHealthReport(): Promise<HealthReport> {
    return {
      scannedAt: Date.now(),
      score: 0,
      grade: "异常",
      modules: [],
      sensors: { total: 0, valid: 0, notInstalled: 0, invalid: [] },
      activeFaults: [],
      symmetry: [],
    };
  }

  async getEventTimeline(fromMs: number, toMs: number): Promise<TimelineResponse> {
    return { fromMs, toMs, events: [] };
  }

  async getLiveFaults(): Promise<LiveFault[]> {
    return [];
  }

  async getDowntime(): Promise<DowntimeResponse> {
    return {
      fromMs: 0,
      toMs: 0,
      kpis: {
        cuttingMs: 0,
        dispatchMs: 0,
        stoppedMs: 0,
        poweroffMs: 0,
        stoppedCount: 0,
        longestStoppedMs: 0,
        cuttingRatePct: 0,
      },
      segments: [],
    };
  }

  async getRankings(params: RankingsParams) {
    return readRankingsFromSqlite(params);
  }

  async getCheckins() {
    return readCheckinsFromSqlite();
  }

  async saveCheckin(payload: CheckinsSubmitRequest) {
    return saveCheckinToSqlite(payload);
  }

  async getKnowledgeAssets() {
    return readKnowledgeAssetsFromSqlite();
  }

  async getRunCycle() {
    return createRunCycleSnapshot();
  }

  async getFaultCodeResult(category: FaultCategory, code: string) {
    return readFaultCodeFromSqlite(category, code);
  }

  async getPumpAnalysis(range: PumpAnalysisRange) {
    return createPumpAnalysis(range);
  }

  async getCuttingAnalysis(range: CuttingAnalysisRange) {
    return createCuttingAnalysis(range);
  }

  async getTractionAnalysis(range: TractionAnalysisRange) {
    return createTractionAnalysis(range);
  }

  subscribe(onEvent: (event: DataSourceEvent) => void) {
    const emit = () => {
      onEvent({
        type: "connection_status",
        data: createConnectionStatus(),
      });
    };

    emit();

    const timer = setInterval(emit, 2000);

    return () => {
      clearInterval(timer);
    };
  }
}
