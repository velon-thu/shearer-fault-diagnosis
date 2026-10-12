import { ConnectionStatusSchema, type SettingsSnapshot } from "@shearer/contracts";
import { type DatabaseSync } from "node:sqlite";
import { createSettingsSnapshot } from "../mock";
import { initializeSqlite } from "./sqlite";

const SYSTEM_CONFIG_TABLE = "system_config";

const SETTINGS_KEYS = {
  connected: "settings.connected",
  connection: "settings.connection",
  workFaceFields: "settings.workFaceFields",
  machineFields: "settings.machineFields",
  versionHistoryData: "settings.versionHistoryData",
  networkInfoData: "settings.networkInfoData",
} as const;

type SystemConfigRow = {
  config_key: string;
  config_value: string | null;
};

const upsertSystemConfig = (db: DatabaseSync, configKey: string, configValue: unknown) => {
  db.prepare(
    `
      INSERT INTO ${SYSTEM_CONFIG_TABLE} (config_key, config_value)
      VALUES (?, ?)
      ON CONFLICT(config_key) DO UPDATE SET
        config_value = excluded.config_value,
        updated_at = CURRENT_TIMESTAMP
    `,
  ).run(configKey, JSON.stringify(configValue));
};

const readSystemConfigValue = <T>(rows: Map<string, string | null>, key: string, fallback: T): T => {
  const raw = rows.get(key);

  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const initializeSettingsStore = (db: DatabaseSync = initializeSqlite()) => {
  const current = db
    .prepare(
      `
        SELECT config_key, config_value
        FROM ${SYSTEM_CONFIG_TABLE}
        WHERE config_key LIKE 'settings.%'
      `,
    )
    .all() as SystemConfigRow[];

  const existingKeys = new Set(current.map((row) => row.config_key));
  const snapshot = createSettingsSnapshot();

  const seedEntries: Array<[string, unknown]> = [
    [SETTINGS_KEYS.connected, snapshot.connected],
    [SETTINGS_KEYS.connection, snapshot.connection],
    [SETTINGS_KEYS.workFaceFields, snapshot.workFaceFields],
    [SETTINGS_KEYS.machineFields, snapshot.machineFields],
    [SETTINGS_KEYS.versionHistoryData, snapshot.versionHistoryData],
    [SETTINGS_KEYS.networkInfoData, snapshot.networkInfoData],
  ];

  for (const [key, value] of seedEntries) {
    if (!existingKeys.has(key)) {
      upsertSystemConfig(db, key, value);
    }
  }

  return db;
};

export const readSettingsFromSqlite = (
  db: DatabaseSync = initializeSettingsStore(),
): SettingsSnapshot => {
  const seededDb = initializeSettingsStore(db);
  const rows = seededDb
    .prepare(
      `
        SELECT config_key, config_value
        FROM ${SYSTEM_CONFIG_TABLE}
        WHERE config_key LIKE 'settings.%'
      `,
    )
    .all() as SystemConfigRow[];

  const snapshot = createSettingsSnapshot();
  const rowMap = new Map(rows.map((row) => [row.config_key, row.config_value]));
  const storedConnection = ConnectionStatusSchema.partial().safeParse(
    readSystemConfigValue(rowMap, SETTINGS_KEYS.connection, {}),
  );

  return {
    connected: readSystemConfigValue(rowMap, SETTINGS_KEYS.connected, snapshot.connected),
    connection: {
      ...snapshot.connection,
      // 旧库只有 HPC/MOC/BOC；新增模块未记录时显示无数据，并保留已有状态。
      axi: "offline",
      wcr: "offline",
      sgc: "offline",
      bp1: "offline",
      bp2: "offline",
      ...(storedConnection.success ? storedConnection.data : {}),
    },
    workFaceFields: readSystemConfigValue(
      rowMap,
      SETTINGS_KEYS.workFaceFields,
      snapshot.workFaceFields,
    ),
    machineFields: readSystemConfigValue(
      rowMap,
      SETTINGS_KEYS.machineFields,
      snapshot.machineFields,
    ),
    versionHistoryData: readSystemConfigValue(
      rowMap,
      SETTINGS_KEYS.versionHistoryData,
      snapshot.versionHistoryData,
    ),
    networkInfoData: readSystemConfigValue(
      rowMap,
      SETTINGS_KEYS.networkInfoData,
      snapshot.networkInfoData,
    ),
  };
};
