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
  createCheckinsSnapshot,
  createConnectionStatus,
  createCuttingAnalysis,
  createHomeSummary,
  createKnowledgeAssetsSnapshot,
  createPumpAnalysis,
  createRankings,
  createRunCycleSnapshot,
  createSettingsSnapshot,
  createTractionAnalysis,
  findFaultCode,
  findSensorById,
  getSensorSummaries,
  submitCheckins,
  weeklyEvents,
} from "../mock";
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
    return createCheckinsSnapshot();
  }

  async saveCheckin(payload: CheckinsSubmitRequest) {
    return submitCheckins(payload);
  }

  async getKnowledgeAssets() {
    return createKnowledgeAssetsSnapshot();
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
