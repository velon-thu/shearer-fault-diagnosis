import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import {
  BootstrapResponseSchema,
  HealthResponseSchema,
  LiveMessageSchema,
  createApiSuccessResponseSchema,
} from "@shearer/contracts";
import { createBootstrapPayload, createConnectionStatus } from "./mock";

const BootstrapApiResponseSchema = createApiSuccessResponseSchema(BootstrapResponseSchema);
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
