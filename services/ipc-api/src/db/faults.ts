import type {
  FaultCategory,
  FaultCodeResult,
  RankingItem,
  RankingsResponse,
  RankingSystemFilter,
} from "@shearer/contracts";
import { type DatabaseSync } from "node:sqlite";
import {
  faultDictionary,
  inverterFaultRankings,
  sensorFaultRankings,
  systemFaultRankings,
} from "../mock";
import { initializeSqlite } from "./sqlite";

type FaultEventCategory = FaultCategory | "sensor";

type FaultEventSeed = {
  category: FaultEventCategory;
  code: string;
  displayName: string;
  count: number;
  lastOccurredAt: string;
  system: RankingSystemFilter;
};

type RankingRow = {
  name: string;
  count: number;
  lastOccurredAt: string;
};

const FAULT_CODE_DICT_TABLE = "fault_code_dict";
const FAULT_EVENTS_TABLE = "fault_events";

const rankingSystemMap: Record<string, RankingSystemFilter> = {
  "0x0094 右无线遥控总停": "traction",
  "0x00C7 泵站启动失败": "hydraulic",
  "0x0147 控制箱按钮反馈异常": "cutting",
  "4210 冷却水流量不足": "traction",
  "3130 中间直流电压振荡": "traction",
  "4110 IGBT 温度超限": "traction",
  "右牵引箱温度传感器": "traction",
  "水路压力传感器": "hydraulic",
  "左牵引电机温度传感器": "traction",
};

const toSqliteTimestamp = (date: Date) => date.toISOString().slice(0, 19).replace("T", " ");

const buildOccurredAtSeries = (lastOccurredAt: string, count: number) => {
  const lastDate = new Date(lastOccurredAt.replace(" ", "T"));
  const intervalHours = 48;

  return Array.from({ length: count }, (_, index) => {
    const nextDate = new Date(lastDate.getTime() - index * intervalHours * 60 * 60 * 1000);
    return toSqliteTimestamp(nextDate);
  });
};

const buildFaultEventSeeds = (): FaultEventSeed[] => [
  ...systemFaultRankings.map((item) => ({
    category: "system" as const,
    code: item.name.split(" ")[0] ?? item.name,
    displayName: item.name,
    count: item.count,
    lastOccurredAt: item.lastOccurredAt,
    system: rankingSystemMap[item.name] ?? "all",
  })),
  ...inverterFaultRankings.map((item) => ({
    category: "inverter" as const,
    code: item.name.split(" ")[0] ?? item.name,
    displayName: item.name,
    count: item.count,
    lastOccurredAt: item.lastOccurredAt,
    system: rankingSystemMap[item.name] ?? "all",
  })),
  ...sensorFaultRankings.map((item, index) => ({
    category: "sensor" as const,
    code: `sensor-${index + 1}`,
    displayName: item.name,
    count: item.count,
    lastOccurredAt: item.lastOccurredAt,
    system: rankingSystemMap[item.name] ?? "all",
  })),
];

const upsertFaultCode = (
  db: DatabaseSync,
  category: FaultCategory,
  code: string,
  description: string,
  tip: string,
) => {
  db.prepare(
    `
      INSERT INTO ${FAULT_CODE_DICT_TABLE} (category, code, description, tip)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(category, code) DO UPDATE SET
        description = excluded.description,
        tip = excluded.tip,
        created_at = CURRENT_TIMESTAMP
    `,
  ).run(category, code, description, tip);
};

const insertFaultEvent = (db: DatabaseSync, seed: FaultEventSeed, occurredAt: string) => {
  db.prepare(
    `
      INSERT INTO ${FAULT_EVENTS_TABLE} (
        category,
        code,
        occurred_at,
        target,
        level,
        detail
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
  ).run(seed.category, seed.code, occurredAt, seed.system, "seed", seed.displayName);
};

export const initializeFaultStores = (db: DatabaseSync = initializeSqlite()) => {
  for (const category of ["system", "inverter"] as const) {
    for (const [code, entry] of Object.entries(faultDictionary[category])) {
      upsertFaultCode(db, category, code, entry.description, entry.tip);
    }
  }

  const eventRow = db.prepare(`SELECT COUNT(*) AS count FROM ${FAULT_EVENTS_TABLE}`).get() as {
    count: number;
  };

  if (eventRow.count === 0) {
    for (const seed of buildFaultEventSeeds()) {
      for (const occurredAt of buildOccurredAtSeries(seed.lastOccurredAt, seed.count)) {
        insertFaultEvent(db, seed, occurredAt);
      }
    }
  }

  return db;
};

export const readFaultCodeFromSqlite = (
  category: FaultCategory,
  code: string,
  db: DatabaseSync = initializeFaultStores(),
): FaultCodeResult => {
  const seededDb = initializeFaultStores(db);
  const row = seededDb
    .prepare(
      `
        SELECT description, tip
        FROM ${FAULT_CODE_DICT_TABLE}
        WHERE category = ? AND code = ?
      `,
    )
    .get(category, code) as { description: string; tip: string } | undefined;

  if (!row) {
    return {
      category,
      code,
      found: false,
      description: null,
      tip: null,
    };
  }

  return {
    category,
    code,
    found: true,
    description: row.description,
    tip: row.tip,
  };
};

const readRankingGroup = (
  db: DatabaseSync,
  category: FaultEventCategory,
  params: {
    start: string;
    end: string;
    system: RankingSystemFilter;
  },
): RankingItem[] => {
  const rows = db
    .prepare(
      `
        SELECT
          detail AS name,
          COUNT(*) AS count,
          MAX(occurred_at) AS lastOccurredAt
        FROM ${FAULT_EVENTS_TABLE}
        WHERE category = ?
          AND date(occurred_at) BETWEEN date(?) AND date(?)
          AND (? = 'all' OR target = ?)
        GROUP BY detail
        ORDER BY count DESC, lastOccurredAt DESC
        LIMIT 10
      `,
    )
    .all(category, params.start, params.end, params.system, params.system) as RankingRow[];

  return rows.map((row) => ({
    name: row.name,
    count: Number(row.count),
    lastOccurredAt: row.lastOccurredAt,
  }));
};

export const readRankingsFromSqlite = (
  params: {
    start: string;
    end: string;
    system: RankingSystemFilter;
  },
  db: DatabaseSync = initializeFaultStores(),
): RankingsResponse => {
  const seededDb = initializeFaultStores(db);

  return {
    start: params.start,
    end: params.end,
    system: params.system,
    systemFaultRankings: readRankingGroup(seededDb, "system", params),
    inverterFaultRankings: readRankingGroup(seededDb, "inverter", params),
    sensorFaultRankings: readRankingGroup(seededDb, "sensor", params),
  };
};
