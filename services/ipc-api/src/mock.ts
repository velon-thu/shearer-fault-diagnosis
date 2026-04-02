import { type BootstrapResponse, type ConnectionStatus } from "@shearer/contracts";

export const createConnectionStatus = (): ConnectionStatus => ({
  tabletToIpc: "connected",
  hpc: "ok",
  moc: "ok",
  boc: Math.random() > 0.65 ? "warn" : "ok",
  syncAt: new Date().toISOString(),
});

export const createBootstrapPayload = (): BootstrapResponse => ({
  machineModel: "MG500/1180-WD",
  machineName: "西翼 2305 工作面采煤机",
  connected: true,
  connection: createConnectionStatus(),
});
