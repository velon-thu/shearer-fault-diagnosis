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
  SensorDetailSchema,
  SensorIdParamsSchema,
  SensorSummarySchema,
  SensorTrendPointSchema,
  SensorTrendQuerySchema,
  SettingsSnapshotSchema,
  TractionAnalysisQuerySchema,
  TractionAnalysisResponseSchema,
  WeeklyEventSchema,
  createApiSuccessResponseSchema,
} from "@shearer/contracts";
import {
  buildSensorTrend,
  createCheckinsSnapshot,
  createCuttingAnalysis,
  createPumpAnalysis,
  createRankings,
  createTractionAnalysis,
  createBootstrapPayload,
  createConnectionStatus,
  createHomeSummary,
  createKnowledgeAssetsSnapshot,
  createSettingsSnapshot,
  findFaultCode,
  findSensorById,
  getMockAuthSession,
  getSensorSummaries,
  loginWithMockAuth,
  logoutMockAuth,
  submitCheckins,
  weeklyEvents,
} from "./mock";

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
const CuttingAnalysisApiResponseSchema = createApiSuccessResponseSchema(CuttingAnalysisResponseSchema);
const PumpAnalysisApiResponseSchema = createApiSuccessResponseSchema(PumpAnalysisResponseSchema);
const SettingsSnapshotApiResponseSchema = createApiSuccessResponseSchema(SettingsSnapshotSchema);
const TractionAnalysisApiResponseSchema = createApiSuccessResponseSchema(TractionAnalysisResponseSchema);
const HealthApiResponseSchema = createApiSuccessResponseSchema(HealthResponseSchema);

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

export const buildApp = () => {
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

  app.get("/api/bootstrap", async () =>
    BootstrapApiResponseSchema.parse({
      success: true,
      data: createBootstrapPayload(),
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
      data: createHomeSummary(),
    }),
  );

  app.get("/api/events/weekly", async () =>
    WeeklyEventsApiResponseSchema.parse({
      success: true,
      data: weeklyEvents,
    }),
  );

  app.get("/api/sensors", async () =>
    SensorSummariesApiResponseSchema.parse({
      success: true,
      data: getSensorSummaries(),
    }),
  );

  app.get("/api/sensors/:id", async (request, reply) => {
    const { id } = SensorIdParamsSchema.parse(request.params);
    const sensor = findSensorById(id);

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
    const { range } = SensorTrendQuerySchema.parse(request.query);
    const sensor = findSensorById(id);

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

    return SensorTrendApiResponseSchema.parse({
      success: true,
      data: buildSensorTrend(sensor, range),
    });
  });

  app.get("/api/fault-codes/search", async (request) => {
    const { category, code } = FaultCodeSearchQuerySchema.parse(request.query);

    return FaultCodeResultApiResponseSchema.parse({
      success: true,
      data: findFaultCode(category, code),
    });
  });

  app.get("/api/rankings", async (request) => {
    const { start, end, system } = RankingsQuerySchema.parse(request.query);

    return RankingsApiResponseSchema.parse({
      success: true,
      data: createRankings({ start, end, system }),
    });
  });

  app.get("/api/checkins", async (request) => {
    CheckinsQuerySchema.parse(request.query);

    return CheckinsApiResponseSchema.parse({
      success: true,
      data: createCheckinsSnapshot(),
    });
  });

  app.post("/api/checkins", async (request) =>
    CheckinsApiResponseSchema.parse({
      success: true,
      data: submitCheckins(CheckinsSubmitRequestSchema.parse(request.body)),
    }),
  );

  app.get("/api/knowledge/assets", async () =>
    KnowledgeAssetsApiResponseSchema.parse({
      success: true,
      data: createKnowledgeAssetsSnapshot(),
    }),
  );

  app.get("/api/analysis/pump", async (request) => {
    const { range } = PumpAnalysisQuerySchema.parse(request.query);

    return PumpAnalysisApiResponseSchema.parse({
      success: true,
      data: createPumpAnalysis(range),
    });
  });

  app.get("/api/analysis/cutting", async (request) => {
    const { range } = CuttingAnalysisQuerySchema.parse(request.query);

    return CuttingAnalysisApiResponseSchema.parse({
      success: true,
      data: createCuttingAnalysis(range),
    });
  });

  app.get("/api/analysis/traction", async (request) => {
    const { range } = TractionAnalysisQuerySchema.parse(request.query);

    return TractionAnalysisApiResponseSchema.parse({
      success: true,
      data: createTractionAnalysis(range),
    });
  });

  app.get("/api/settings", async () =>
    SettingsSnapshotApiResponseSchema.parse({
      success: true,
      data: createSettingsSnapshot(),
    }),
  );

  app.get("/ws/live", { websocket: true }, (socket) => {
    const sendMessage = () => {
      socket.send(
        JSON.stringify(
          LiveMessageSchema.parse({
            type: "connection_status",
            data: createConnectionStatus(),
          }),
        ),
      );
    };

    sendMessage();

    const timer = setInterval(sendMessage, 2000);

    socket.on("close", () => {
      clearInterval(timer);
    });
  });

  return app;
};
