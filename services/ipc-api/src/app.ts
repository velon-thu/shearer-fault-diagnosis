import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import {
  ApiErrorResponseSchema,
  BootstrapResponseSchema,
  FaultCodeResultSchema,
  FaultCodeSearchQuerySchema,
  HealthResponseSchema,
  HomeSummarySchema,
  LiveMessageSchema,
  PumpAnalysisQuerySchema,
  PumpAnalysisResponseSchema,
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
  createPumpAnalysis,
  createTractionAnalysis,
  createBootstrapPayload,
  createConnectionStatus,
  createHomeSummary,
  createSettingsSnapshot,
  findFaultCode,
  findSensorById,
  getSensorSummaries,
  weeklyEvents,
} from "./mock";

const BootstrapApiResponseSchema = createApiSuccessResponseSchema(BootstrapResponseSchema);
const HomeSummaryApiResponseSchema = createApiSuccessResponseSchema(HomeSummarySchema);
const WeeklyEventsApiResponseSchema = createApiSuccessResponseSchema(WeeklyEventSchema.array());
const SensorSummariesApiResponseSchema = createApiSuccessResponseSchema(SensorSummarySchema.array());
const SensorDetailApiResponseSchema = createApiSuccessResponseSchema(SensorDetailSchema);
const SensorTrendApiResponseSchema = createApiSuccessResponseSchema(SensorTrendPointSchema.array());
const FaultCodeResultApiResponseSchema = createApiSuccessResponseSchema(FaultCodeResultSchema);
const PumpAnalysisApiResponseSchema = createApiSuccessResponseSchema(PumpAnalysisResponseSchema);
const SettingsSnapshotApiResponseSchema = createApiSuccessResponseSchema(SettingsSnapshotSchema);
const TractionAnalysisApiResponseSchema = createApiSuccessResponseSchema(TractionAnalysisResponseSchema);
const HealthApiResponseSchema = createApiSuccessResponseSchema(HealthResponseSchema);

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

  app.get("/api/analysis/pump", async (request) => {
    const { range } = PumpAnalysisQuerySchema.parse(request.query);

    return PumpAnalysisApiResponseSchema.parse({
      success: true,
      data: createPumpAnalysis(range),
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
