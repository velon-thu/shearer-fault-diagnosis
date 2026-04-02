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
});

export const FaultCodeResultSchema = z.object({
  category: FaultCategorySchema,
  code: z.string(),
  found: z.boolean(),
  description: z.string().nullable(),
  tip: z.string().nullable(),
});

export const SettingsSnapshotSchema = z.object({
  workFaceFields: z.array(KeyValueFieldSchema),
  machineFields: z.array(KeyValueFieldSchema),
  networkInfoData: z.array(KeyValueFieldSchema),
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

export const SensorTrendQuerySchema = z.object({
  range: z.enum(["24h"]).default("24h"),
});

export const FaultCodeSearchQuerySchema = z.object({
  category: FaultCategorySchema.default("system"),
  code: z.string().min(1).default("0x0094"),
});

export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;
export type BootstrapResponse = z.infer<typeof BootstrapResponseSchema>;
export type WeeklyEvent = z.infer<typeof WeeklyEventSchema>;
export type HomeSummary = z.infer<typeof HomeSummarySchema>;
export type SensorSummary = z.infer<typeof SensorSummarySchema>;
export type SensorDetail = z.infer<typeof SensorDetailSchema>;
export type SensorTrendPoint = z.infer<typeof SensorTrendPointSchema>;
export type FaultCodeResult = z.infer<typeof FaultCodeResultSchema>;
export type SettingsSnapshot = z.infer<typeof SettingsSnapshotSchema>;
export type KeyValueField = z.infer<typeof KeyValueFieldSchema>;
export type FaultCategory = z.infer<typeof FaultCategorySchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type LiveMessage = z.infer<typeof LiveMessageSchema>;
export type ApiSuccessResponse<T> = {
  success: true;
  data: T;
};
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
