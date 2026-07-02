import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import {
  ApiErrorResponseSchema,
  AuthLoginRequestSchema,
  AuthLoginResponseSchema,
  AuthLogoutResponseSchema,
  AuthMeResponseSchema,
  BootstrapResponseSchema,
  CheckinsQuerySchema,
  CheckinsResponseSchema,
  CheckinsSubmitRequestSchema,
  CuttingAnalysisQuerySchema,
  CuttingAnalysisResponseSchema,
  FaultCodeResultSchema,
  FaultCodeSearchQuerySchema,
  HealthResponseSchema,
  HomeSummarySchema,
  KnowledgeAssetsResponseSchema,
  LiveMessageSchema,
  PumpAnalysisQuerySchema,
  PumpAnalysisResponseSchema,
  RankingsQuerySchema,
  RankingsResponseSchema,
  RunCycleResponseSchema,
  SensorDetailSchema,
  SensorIdParamsSchema,
  SensorSummarySchema,
  SensorTrendPointSchema,
  SensorTrendQuerySchema,
  SettingsSnapshotSchema,
  ShmLiveResponseSchema,
  TractionAnalysisQuerySchema,
  TractionAnalysisResponseSchema,
  WeeklyEventSchema,
  createApiSuccessResponseSchema,
} from "@shearer/contracts";
import {
  getMockAuthSession,
  loginWithMockAuth,
  logoutMockAuth,
} from "./mock";
import { initializeSqlite } from "./db/sqlite";
import { readShmLive } from "./shm/live";
import {
  DataplaneDataSourceAdapter,
  type DataSourceAdapter,
} from "./ingest";

const AuthLoginApiResponseSchema = createApiSuccessResponseSchema(AuthLoginResponseSchema);
const AuthMeApiResponseSchema = createApiSuccessResponseSchema(AuthMeResponseSchema);
const AuthLogoutApiResponseSchema = createApiSuccessResponseSchema(AuthLogoutResponseSchema);
const BootstrapApiResponseSchema = createApiSuccessResponseSchema(BootstrapResponseSchema);
const HomeSummaryApiResponseSchema = createApiSuccessResponseSchema(HomeSummarySchema);
const WeeklyEventsApiResponseSchema = createApiSuccessResponseSchema(WeeklyEventSchema.array());
const SensorSummariesApiResponseSchema = createApiSuccessResponseSchema(SensorSummarySchema.array());
const SensorDetailApiResponseSchema = createApiSuccessResponseSchema(SensorDetailSchema);
const SensorTrendApiResponseSchema = createApiSuccessResponseSchema(SensorTrendPointSchema.array());
const FaultCodeResultApiResponseSchema = createApiSuccessResponseSchema(FaultCodeResultSchema);
const RankingsApiResponseSchema = createApiSuccessResponseSchema(RankingsResponseSchema);
const CheckinsApiResponseSchema = createApiSuccessResponseSchema(CheckinsResponseSchema);
const KnowledgeAssetsApiResponseSchema = createApiSuccessResponseSchema(KnowledgeAssetsResponseSchema);
const RunCycleApiResponseSchema = createApiSuccessResponseSchema(RunCycleResponseSchema);
const CuttingAnalysisApiResponseSchema = createApiSuccessResponseSchema(CuttingAnalysisResponseSchema);
const PumpAnalysisApiResponseSchema = createApiSuccessResponseSchema(PumpAnalysisResponseSchema);
const SettingsSnapshotApiResponseSchema = createApiSuccessResponseSchema(SettingsSnapshotSchema);
const TractionAnalysisApiResponseSchema = createApiSuccessResponseSchema(TractionAnalysisResponseSchema);
const HealthApiResponseSchema = createApiSuccessResponseSchema(HealthResponseSchema);
const ShmLiveApiResponseSchema = createApiSuccessResponseSchema(ShmLiveResponseSchema);

const getBearerToken = (authorizationHeader?: string) => {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
};

const RANGE_MS: Record<string, number> = {
  "10m": 10 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

const getRangeWindow = (range: string) => {
  const to = new Date();

  if (range === "all") {
    // from=0 表示"数据库里该测点的全部数据"，由适配器按实际最早数据收窄
    return { from: new Date(0), to };
  }

  const spanMs = RANGE_MS[range] ?? RANGE_MS["24h"];
  return { from: new Date(to.getTime() - spanMs), to };
};

export const buildApp = ({
  adapter = new DataplaneDataSourceAdapter(),
}: {
  adapter?: DataSourceAdapter;
} = {}) => {
  initializeSqlite();

  const app = Fastify({
    logger: true,
  });

  app.register(cors, {
    origin: true,
  });

  app.register(websocket);

  app.get("/api/health", async () =>
    HealthApiResponseSchema.parse({
      success: true,
      data: {
        status: "ok",
        timestamp: new Date().toISOString(),
      },
    }),
  );

  app.get("/api/shm/live", async () =>
    ShmLiveApiResponseSchema.parse({
      success: true,
      data: readShmLive(),
    }),
  );

  app.get("/api/bootstrap", async () =>
    BootstrapApiResponseSchema.parse({
      success: true,
      data: (await adapter.getLatestSnapshot()).bootstrap,
    }),
  );

  app.post("/api/auth/login", async (request, reply) => {
    const payload = AuthLoginRequestSchema.parse(request.body);
    const session = loginWithMockAuth(payload);

    if (!session) {
      return reply.code(401).send(
        ApiErrorResponseSchema.parse({
          success: false,
          error: {
            code: "AUTH_INVALID_CREDENTIALS",
            message: "工号或密码错误。",
          },
        }),
      );
    }

    return AuthLoginApiResponseSchema.parse({
      success: true,
      data: session,
    });
  });

  app.get("/api/auth/me", async (request, reply) => {
    const token = getBearerToken(request.headers.authorization);
    const session = token ? getMockAuthSession(token) : null;

    if (!session) {
      return reply.code(401).send(
        ApiErrorResponseSchema.parse({
          success: false,
          error: {
            code: "AUTH_UNAUTHORIZED",
            message: "当前登录状态无效，请重新登录。",
          },
        }),
      );
    }

    return AuthMeApiResponseSchema.parse({
      success: true,
      data: session,
    });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = getBearerToken(request.headers.authorization);
    const session = token ? getMockAuthSession(token) : null;

    if (!session || !token) {
      return reply.code(401).send(
        ApiErrorResponseSchema.parse({
          success: false,
          error: {
            code: "AUTH_UNAUTHORIZED",
            message: "当前登录状态无效，请重新登录。",
          },
        }),
      );
    }

    return AuthLogoutApiResponseSchema.parse({
      success: true,
      data: logoutMockAuth(token),
    });
  });

  app.get("/api/home/summary", async () =>
    HomeSummaryApiResponseSchema.parse({
      success: true,
      data: (await adapter.getLatestSnapshot()).homeSummary,
    }),
  );

  app.get("/api/events/weekly", async () =>
    WeeklyEventsApiResponseSchema.parse({
      success: true,
      data: (await adapter.getLatestSnapshot()).weeklyEvents,
    }),
  );

  app.get("/api/sensors", async () =>
    SensorSummariesApiResponseSchema.parse({
      success: true,
      data: await adapter.getSensorSummaries(),
    }),
  );

  app.get("/api/sensors/:id", async (request, reply) => {
    const { id } = SensorIdParamsSchema.parse(request.params);
    const sensor = await adapter.getSensorDetail(id);

    if (!sensor) {
      return reply.code(404).send(
        ApiErrorResponseSchema.parse({
          success: false,
          error: {
            code: "SENSOR_NOT_FOUND",
            message: `未找到传感器 ${id}`,
          },
        }),
      );
    }

    return SensorDetailApiResponseSchema.parse({
      success: true,
      data: sensor,
    });
  });

  app.get("/api/sensors/:id/trend", async (request, reply) => {
    const { id } = SensorIdParamsSchema.parse(request.params);
    const { range, from: fromMs, to: toMs } = SensorTrendQuerySchema.parse(request.query);
    const sensor = await adapter.getSensorDetail(id);

    if (!sensor) {
      return reply.code(404).send(
        ApiErrorResponseSchema.parse({
          success: false,
          error: {
            code: "SENSOR_NOT_FOUND",
            message: `未找到传感器 ${id}`,
          },
        }),
      );
    }

    // 显式 from/to（图表缩放细化）优先于 range 预设
    const { from, to } =
      fromMs !== undefined && toMs !== undefined && toMs > fromMs
        ? { from: new Date(fromMs), to: new Date(toMs) }
        : getRangeWindow(range);

    return SensorTrendApiResponseSchema.parse({
      success: true,
      data: await adapter.getSensorTrend(id, from, to),
    });
  });

  app.get("/api/fault-codes/search", async (request) => {
    const { category, code } = FaultCodeSearchQuerySchema.parse(request.query);

    return FaultCodeResultApiResponseSchema.parse({
      success: true,
      data: await adapter.getFaultCodeResult(category, code),
    });
  });

  app.get("/api/rankings", async (request) => {
    const { start, end, system } = RankingsQuerySchema.parse(request.query);

    return RankingsApiResponseSchema.parse({
      success: true,
      data: await adapter.getRankings({ start, end, system }),
    });
  });

  app.get("/api/checkins", async (request) => {
    CheckinsQuerySchema.parse(request.query);

    return CheckinsApiResponseSchema.parse({
      success: true,
      data: await adapter.getCheckins(),
    });
  });

  app.post("/api/checkins", async (request) =>
    CheckinsApiResponseSchema.parse({
      success: true,
      data: await adapter.saveCheckin(CheckinsSubmitRequestSchema.parse(request.body)),
    }),
  );

  app.get("/api/knowledge/assets", async () =>
    KnowledgeAssetsApiResponseSchema.parse({
      success: true,
      data: await adapter.getKnowledgeAssets(),
    }),
  );

  app.get("/api/run-cycle", async () =>
    RunCycleApiResponseSchema.parse({
      success: true,
      data: await adapter.getRunCycle(),
    }),
  );

  app.get("/api/analysis/pump", async (request) => {
    const { range } = PumpAnalysisQuerySchema.parse(request.query);

    return PumpAnalysisApiResponseSchema.parse({
      success: true,
      data: await adapter.getPumpAnalysis(range),
    });
  });

  app.get("/api/analysis/cutting", async (request) => {
    const { range } = CuttingAnalysisQuerySchema.parse(request.query);

    return CuttingAnalysisApiResponseSchema.parse({
      success: true,
      data: await adapter.getCuttingAnalysis(range),
    });
  });

  app.get("/api/analysis/traction", async (request) => {
    const { range } = TractionAnalysisQuerySchema.parse(request.query);

    return TractionAnalysisApiResponseSchema.parse({
      success: true,
      data: await adapter.getTractionAnalysis(range),
    });
  });

  app.get("/api/settings", async () =>
    SettingsSnapshotApiResponseSchema.parse({
      success: true,
      data: await adapter.getSettings(),
    }),
  );

  app.get("/ws/live", { websocket: true }, (socket) => {
    const unsubscribe = adapter.subscribe((event) => {
      socket.send(
        JSON.stringify(
          LiveMessageSchema.parse({
            type: event.type,
            data: event.data,
          }),
        ),
      );
    });

    socket.on("close", () => {
      unsubscribe();
    });
  });

  return app;
};
