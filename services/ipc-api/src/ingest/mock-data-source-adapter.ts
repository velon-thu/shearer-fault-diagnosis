import type {
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
  createRankings,
  createRunCycleSnapshot,
  createSettingsSnapshot,
  createTractionAnalysis,
  findFaultCode,
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
  initializeKnowledgeStore,
  readKnowledgeAssetsFromSqlite,
} from "../db/knowledge";
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
    initializeKnowledgeStore();
  }

  async getLatestSnapshot(): Promise<LatestSnapshot> {
    const connection = createConnectionStatus();

    return {
      connection,
      bootstrap: buildBootstrapWithConnection(connection),
      homeSummary: createHomeSummary(),
      weeklyEvents: [...weeklyEvents],
      settings: {
        ...createSettingsSnapshot(),
        connected: connection.tabletToIpc === "connected",
        connection,
      },
    };
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

  async getRankings(params: RankingsParams) {
    return createRankings(params);
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
    return findFaultCode(category, code);
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
