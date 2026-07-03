/**
 * DataplaneDataSourceAdapter：真实数据适配器。
 *
 * 数据源为 dataplane 采集器落库的 shearer.db（sensor_hyper / state_hyper /
 * device_action / fault_normal / fault_internal + 定义与规则表）。
 * 继承 MockDataSourceAdapter：org 数据支撑不到的板块（打卡、知识库、
 * 设置静态字段、认证）沿用原实现；数据库不可用时逐方法回退 mock。
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ConnectionStatus,
  CuttingAnalysisRange,
  CuttingAnalysisResponse,
  DeviceStatus,
  FaultCategory,
  FaultCodeResult,
  DowntimeResponse,
  DowntimeSegment,
  HomeSummary,
  LiveFault,
  PumpAnalysisRange,
  PumpAnalysisResponse,
  RunCycleResponse,
  SensorDetail,
  SensorSummary,
  SensorTrendPoint,
  TractionAnalysisRange,
  TractionAnalysisResponse,
  WeeklyEvent,
} from "@shearer/contracts";
import type { DataSourceEvent, LatestSnapshot, RankingsParams } from "./data-source-adapter";
import { MockDataSourceAdapter } from "./mock-data-source-adapter";

const packageRoot = resolve(__dirname, "..", "..");
const DATAPLANE_DB =
  process.env.SHEARER_DATAPLANE_DB ??
  resolve(packageRoot, "..", "dataplane", "data", "shearer.db");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const pad = (n: number) => String(n).padStart(2, "0");

const fmtTs = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const fmtHm = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

type SensorDefRow = {
  add: number;
  category: string;
  name: string;
  std_tag: string;
  accuracy: number;
  unit: string;
  org: string;
  sheet: string;
};

const unitToType = (unit: string, name: string): string => {
  if (unit === "℃") return "温度";
  if (unit === "MPa") return "压力";
  if (unit === "L/Min") return "流量";
  if (unit === "A") return "电流";
  if (unit === "V") return "电压";
  if (unit === "cm") return "油位";
  if (unit === "m/min") return "速度";
  if (unit === "°") return "角度";
  if (unit === "mm") return "距离";
  if (unit === "%") return "负荷";
  if (unit === "Hz") return "频率";
  if (name.includes("位置")) return "位置";
  return "数值";
};

// 已知无效哨兵：温度 -40/200（未接），速度 ≥600（uint16 上限区）
const isSentinel = (unit: string, value: number): boolean => {
  if (unit === "℃") return value <= -39.9 || value >= 199.9;
  if (unit === "m/min") return value >= 600 || value < 0;
  return false;
};

const faultKeywordSystem = (name: string): "hydraulic" | "cutting" | "traction" | "other" => {
  if (/泵|液压|水路|油位|背压/.test(name)) return "hydraulic";
  if (/截割|摇臂/.test(name)) return "cutting";
  if (/牵引|行走/.test(name)) return "traction";
  return "other";
};

const analysisTarget = (name: string): string => {
  const s = faultKeywordSystem(name);
  if (s === "hydraulic") return "pump-analysis";
  if (s === "traction") return "traction-analysis";
  return "cutting-analysis";
};

// BOC/HPC 0x22xx~0x26xx 停机操作解码
const BOC_HPC_SOURCES: Record<number, string> = {
  0x22: "左端头站",
  0x23: "右端头站",
  0x24: "左遥控器",
  0x25: "右遥控器",
  0x26: "顺槽远程",
};
const BOC_HPC_CMD_BITS: Array<[number, string]> = [
  [7, "急停"],
  [6, "总停"],
  [5, "左截割停"],
  [4, "右截割停"],
  [3, "破停"],
  [1, "泵停"],
];
// MOC Bit8-0 停止代码
const MOC_STOP_BITS: Array<[number, string]> = [
  [0, "左截割电机停"],
  [1, "右截割电机停"],
  [2, "泵电机停"],
  [3, "破碎机停"],
  [4, "牵引停止"],
  [7, "总停"],
  [8, "断电急停"],
];

export class DataplaneDataSourceAdapter extends MockDataSourceAdapter {
  private db: DatabaseSync | null = null;

  // 传感器汇总缓存：慢统计（恒零/30天哨兵计数）60s，整表汇总 3s
  private slowStats: { at: number; allZero: Set<string>; sentinel: Map<string, number> } | null =
    null;
  private summariesCache: { at: number; data: SensorSummary[] } | null = null;

  private openDb(): DatabaseSync | null {
    if (this.db) {
      return this.db;
    }
    if (!existsSync(DATAPLANE_DB)) {
      return null;
    }
    try {
      this.db = new DatabaseSync(DATAPLANE_DB, { readOnly: true });
      return this.db;
    } catch {
      return null;
    }
  }

  /** 包一层：库不可用或查询失败时回退 fallback（通常是 mock 实现）。 */
  private async withDb<T>(
    fn: (db: DatabaseSync) => T | Promise<T>,
    fallback: () => T | Promise<T>,
  ): Promise<T> {
    const db = this.openDb();
    if (!db) {
      return fallback();
    }
    try {
      return await fn(db);
    } catch {
      this.db = null; // 连接可能失效（库被重建），下次重开
      return fallback();
    }
  }

  // ---------------------------------------------------------------- 基础查询

  private sensorDefs(db: DatabaseSync): SensorDefRow[] {
    return db
      .prepare(
        `SELECT "add" AS "add", category, name, std_tag, accuracy, unit, org, sheet
         FROM sensor_data_defi ORDER BY sheet, "add"`,
      )
      .all() as unknown as SensorDefRow[];
  }

  /** 每个测点的最新值：逐测点走 (std_tag, ts) 索引，远快于全表 GROUP BY。 */
  private latestValues(
    db: DatabaseSync,
    tags: string[],
  ): Map<string, { value: number; ts: number }> {
    const stmt = db.prepare(
      `SELECT value, ts FROM sensor_hyper WHERE std_tag = ? ORDER BY ts DESC LIMIT 1`,
    );
    const map = new Map<string, { value: number; ts: number }>();
    for (const tag of tags) {
      const row = stmt.get(tag) as { value: number; ts: number } | undefined;
      if (row) {
        map.set(tag, row);
      }
    }
    return map;
  }

  /** 把某 tag 在 [from,to) 的数据按 buckets 段取均值；空段沿用上一段（seed=窗口前最后值）。 */
  private bucketSeries(
    db: DatabaseSync,
    tag: string,
    fromMs: number,
    toMs: number,
    buckets: number,
    seed = 0,
  ): number[] {
    const span = toMs - fromMs;
    const rows = db
      .prepare(
        `SELECT CAST((ts - ?) * ? / ? AS INTEGER) AS bucket, AVG(value) AS avg_value
         FROM sensor_hyper WHERE std_tag = ? AND ts >= ? AND ts < ?
         GROUP BY bucket`,
      )
      .all(fromMs, buckets, span, tag, fromMs, toMs) as unknown as Array<{
      bucket: number;
      avg_value: number;
    }>;
    const byBucket = new Map(rows.map((r) => [r.bucket, r.avg_value]));
    const out: number[] = [];
    let prev = seed;
    for (let i = 0; i < buckets; i += 1) {
      const v = byBucket.get(i);
      if (v !== undefined) {
        prev = Number(v.toFixed(2));
      }
      out.push(prev);
    }
    return out;
  }

  private hourLabels(fromMs: number, buckets: number, stepMs: number): string[] {
    return Array.from({ length: buckets }, (_, i) => fmtHm(fromMs + i * stepMs));
  }

  private connectionFromDb(db: DatabaseSync): ConnectionStatus {
    const stateOf = (tag: string): number | null => {
      const row = db
        .prepare(
          `SELECT state_code FROM state_hyper WHERE std_tag = ? ORDER BY id DESC LIMIT 1`,
        )
        .get(tag) as { state_code: number } | undefined;
      return row ? row.state_code : null;
    };
    const bocRow = db
      .prepare(`SELECT value FROM sensor_hyper WHERE std_tag='boc_comm_value' ORDER BY id DESC LIMIT 1`)
      .get() as { value: number } | undefined;

    const toStatus = (v: number | null): DeviceStatus =>
      v === null ? "offline" : v === 1 ? "ok" : "error";

    return {
      tabletToIpc: "connected",
      hpc: toStatus(stateOf("hpc_comm_ok")),
      moc: toStatus(stateOf("moc_comm_ok")),
      // BOC 通讯状态取地址 2000（boc_comm_value），值 != 0 即正常
      boc: bocRow ? (bocRow.value !== 0 ? "ok" : "error") : "offline",
      axi: toStatus(stateOf("axi_comm_ok")),
      wcr: toStatus(stateOf("wcr_comm_ok")),
      sgc: toStatus(stateOf("sgc_comm_ok")),
      bp1: toStatus(stateOf("bp1_comm_ok")),
      bp2: toStatus(stateOf("bp2_comm_ok")),
      syncAt: new Date().toISOString(),
    };
  }

  private weeklyEventsFromDb(db: DatabaseSync): WeeklyEvent[] {
    const rows = db
      .prepare(
        `SELECT fn.occur_ts, fr.name FROM fault_normal fn
         JOIN fault_rule fr ON fr.fault_code = fn.fault_code
         WHERE fn.occur_ts >= ? ORDER BY fn.occur_ts DESC LIMIT 20`,
      )
      .all(Date.now() - 7 * DAY) as unknown as Array<{ occur_ts: number; name: string }>;
    return rows.map((r) => ({
      time: fmtTs(r.occur_ts),
      text: r.name,
      target: analysisTarget(r.name),
    }));
  }

  private homeSummaryFromDb(db: DatabaseSync): HomeSummary {
    const since = Date.now() - 7 * DAY;
    const weekly = this.weeklyEventsFromDb(db);
    const top = (kindFilter: string) =>
      db
        .prepare(
          `SELECT fr.name AS name, COUNT(*) AS cnt, MAX(fn.occur_ts) AS last_ts
           FROM fault_normal fn JOIN fault_rule fr ON fr.fault_code = fn.fault_code
           WHERE fn.occur_ts >= ? AND ${kindFilter}
           GROUP BY fn.fault_code ORDER BY cnt DESC LIMIT 1`,
        )
        .get(since) as { name: string; cnt: number; last_ts: number } | undefined;

    const topFault = top("fr.kind != 4");
    const topSensor = top("fr.kind = 4");

    return {
      weeklyEventCount: weekly.length,
      latestWeeklyEvent:
        weekly[0] ?? { time: "--", text: "近 7 天无故障事件", target: "cutting-analysis" },
      topFault: {
        name: topFault?.name ?? "近 7 天无故障",
        count: topFault?.cnt ?? 0,
        lastOccurredAt: topFault ? fmtTs(topFault.last_ts) : "--",
      },
      topSensor: {
        name: topSensor?.name ?? "近 7 天无传感器故障",
        count: topSensor?.cnt ?? 0,
        lastOccurredAt: topSensor ? fmtTs(topSensor.last_ts) : "--",
      },
    };
  }

  // ---------------------------------------------------------------- 覆写接口

  async getLatestSnapshot(): Promise<LatestSnapshot> {
    const base = await super.getLatestSnapshot();
    return this.withDb(
      (db) => {
        const connection = this.connectionFromDb(db);
        return {
          ...base,
          connection,
          bootstrap: { ...base.bootstrap, connected: true, connection },
          homeSummary: this.homeSummaryFromDb(db),
          weeklyEvents: this.weeklyEventsFromDb(db),
        };
      },
      () => base,
    );
  }

  async getSettings() {
    const base = await super.getSettings();
    return this.withDb(
      (db) => {
        const connection = this.connectionFromDb(db);
        return { ...base, connected: true, connection };
      },
      () => base,
    );
  }

  /** 恒零判定 + 30 天哨兵计数：开销大，60s 缓存一次。 */
  private computeSlowStats(db: DatabaseSync, defs: SensorDefRow[]): NonNullable<typeof this.slowStats> {
    const now = Date.now();
    if (this.slowStats && now - this.slowStats.at < 60_000) {
      return this.slowStats;
    }

    // 全程恒为 0 的测点视为未配备：逐测点 EXISTS（有非零值即刻返回）
    const allZero = new Set<string>();
    const nonZeroStmt = db.prepare(
      `SELECT 1 FROM sensor_hyper WHERE std_tag = ? AND value != 0 LIMIT 1`,
    );
    const anyStmt = db.prepare(`SELECT 1 FROM sensor_hyper WHERE std_tag = ? LIMIT 1`);
    for (const d of defs) {
      if (!nonZeroStmt.get(d.std_tag) && anyStmt.get(d.std_tag)) {
        allZero.add(d.std_tag);
      }
    }

    // 近 30 天哨兵值次数（仅温度/速度类，走 (std_tag, ts) 索引）
    const since30d = now - 30 * DAY;
    const sentinel = new Map<string, number>();
    for (const [cond, tags] of [
      ["(value <= -39.9 OR value >= 199.9)", defs.filter((d) => d.unit === "℃").map((d) => d.std_tag)],
      ["(value >= 600 OR value < 0)", defs.filter((d) => d.unit === "m/min").map((d) => d.std_tag)],
    ] as Array<[string, string[]]>) {
      const stmt = db.prepare(
        `SELECT COUNT(*) AS cnt FROM sensor_hyper WHERE std_tag = ? AND ts >= ? AND ${cond}`,
      );
      for (const tag of tags) {
        const r = stmt.get(tag, since30d) as { cnt: number };
        if (r.cnt > 0) {
          sentinel.set(tag, r.cnt);
        }
      }
    }

    this.slowStats = { at: now, allZero, sentinel };
    return this.slowStats;
  }

  async getSensorSummaries(): Promise<SensorSummary[]> {
    if (this.summariesCache && Date.now() - this.summariesCache.at < 3_000) {
      return this.summariesCache.data;
    }
    return this.withDb(
      (db) => {
        const defs = this.sensorDefs(db);
        const now = Date.now();
        const latest = this.latestValues(db, defs.map((d) => d.std_tag));
        const { allZero, sentinel: sentinelCounts } = this.computeSlowStats(db, defs);

        const result = defs.map((d) => {
          const lv = latest.get(d.std_tag);
          const stale = !lv || now - lv.ts > 5 * 60_000;
          const sentinel = lv ? isSentinel(d.unit, lv.value) : false;
          const zero = allZero.has(d.std_tag);
          const state = !lv
            ? "无数据"
            : zero
              ? "恒为0 · 视为未配备"
              : sentinel
                ? "传感器无效"
                : stale
                  ? "数据中断"
                  : `正常 · ${lv.value}${d.unit}`;
          return {
            id: d.std_tag,
            name: d.name,
            type: unitToType(d.unit, d.name),
            location: d.category,
            state,
            valid: Boolean(lv) && !sentinel && !stale && !zero,
            failures30d: sentinelCounts.get(d.std_tag) ?? 0,
            lastSeen: lv ? fmtTs(lv.ts) : "--",
            unit: d.unit,
          };
        });
        this.summariesCache = { at: Date.now(), data: result };
        return result;
      },
      () => super.getSensorSummaries(),
    );
  }

  async getSensorDetail(sensorId: string): Promise<SensorDetail | null> {
    return this.withDb(
      (db) => {
        const def = db
          .prepare(
            `SELECT "add" AS "add", category, name, std_tag, accuracy, unit, org, sheet
             FROM sensor_data_defi WHERE std_tag = ?`,
          )
          .get(sensorId) as SensorDefRow | undefined;
        if (!def) {
          return null;
        }
        const now = Date.now();
        const stats = db
          .prepare(
            `SELECT AVG(value) AS avg_v, MAX(value) AS max_v FROM sensor_hyper
             WHERE std_tag = ? AND ts >= ?`,
          )
          .get(sensorId, now - DAY) as { avg_v: number | null; max_v: number | null };

        const lv = db
          .prepare(`SELECT value, ts FROM sensor_hyper WHERE std_tag=? ORDER BY id DESC LIMIT 1`)
          .get(sensorId) as { value: number; ts: number } | undefined;
        const stale = !lv || now - lv.ts > 5 * 60_000;
        const sentinel = lv ? isSentinel(def.unit, lv.value) : false;
        const zero =
          !db.prepare(`SELECT 1 FROM sensor_hyper WHERE std_tag = ? AND value != 0 LIMIT 1`).get(sensorId) &&
          Boolean(db.prepare(`SELECT 1 FROM sensor_hyper WHERE std_tag = ? LIMIT 1`).get(sensorId));

        // 近 30 天哨兵值次数（与总览口径一致）
        let failures30d = 0;
        const sentinelCond =
          def.unit === "℃"
            ? "(value <= -39.9 OR value >= 199.9)"
            : def.unit === "m/min"
              ? "(value >= 600 OR value < 0)"
              : null;
        if (sentinelCond) {
          const r = db
            .prepare(
              `SELECT COUNT(*) AS n FROM sensor_hyper WHERE std_tag = ? AND ts >= ? AND ${sentinelCond}`,
            )
            .get(sensorId, now - 30 * DAY) as { n: number };
          failures30d = r.n;
        }

        const avg = stats.avg_v === null ? 0 : Number(stats.avg_v.toFixed(2));
        const peak = stats.max_v === null ? 0 : Number(stats.max_v.toFixed(2));
        return {
          id: def.std_tag,
          name: def.name,
          type: unitToType(def.unit, def.name),
          location: def.category,
          state: !lv
            ? "无数据"
            : zero
              ? "恒为0 · 视为未配备"
              : sentinel
                ? "传感器无效"
                : stale
                  ? "数据中断"
                  : "正常",
          valid: Boolean(lv) && !sentinel && !stale && !zero,
          failures30d,
          lastSeen: lv ? fmtTs(lv.ts) : "--",
          unit: def.unit,
          averageValue: avg,
          peakValue: peak,
          averageDisplay: `${avg}${def.unit}`,
          peakDisplay: `${peak}${def.unit}`,
        };
      },
      () => super.getSensorDetail(sensorId),
    );
  }

  async getSensorTrend(sensorId: string, from: Date, to: Date): Promise<SensorTrendPoint[]> {
    return this.withDb(
      (db) => {
        const def = db
          .prepare(`SELECT unit FROM sensor_data_defi WHERE std_tag = ?`)
          .get(sensorId) as { unit: string } | undefined;
        if (!def) {
          return [];
        }
        let fromMs = from.getTime();
        const toMs = to.getTime();
        // from=0 表示"全部数据"：收窄到该测点实际最早的数据点
        if (fromMs <= 0) {
          const first = db
            .prepare(`SELECT MIN(ts) AS t FROM sensor_hyper WHERE std_tag = ?`)
            .get(sensorId) as { t: number | null };
          if (first.t === null) {
            return [];
          }
          fromMs = first.t;
        }
        if (toMs - fromMs < 1_000) {
          return [];
        }

        const spanMs = toMs - fromMs;
        // 分桶粒度下限 1 秒（"尽可能秒级"），上限 1500 点保证渲染流畅；
        // 跨度大时缩放图表会按窗口重新请求，从而逐级细化到 1s。
        const buckets = Math.min(1500, Math.max(1, Math.floor(spanMs / 1000)));
        // 标签粒度随跨度自适应：<2h 到秒，<=26h 到分，更长带日期
        const label = (ms: number) => {
          const d = new Date(ms);
          if (spanMs < 2 * HOUR) {
            return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
          }
          if (spanMs <= 26 * HOUR) {
            return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
          }
          return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        };

        // 窗口起点之前的最后一个值作为填充种子，避免窗口开头出现虚假的 0
        const seedRow = db
          .prepare(
            `SELECT value FROM sensor_hyper WHERE std_tag = ? AND ts < ? ORDER BY ts DESC LIMIT 1`,
          )
          .get(sensorId, fromMs) as { value: number } | undefined;

        const values = this.bucketSeries(db, sensorId, fromMs, toMs, buckets, seedRow?.value ?? 0);
        const step = spanMs / buckets;
        return values.map((v, i) => ({
          time: label(fromMs + i * step),
          value: v,
          unit: def.unit,
          ts: Math.round(fromMs + i * step),
        }));
      },
      () => super.getSensorTrend(sensorId, from, to),
    );
  }

  async getDataWindow() {
    return this.withDb(
      (db) => {
        const r = db
          .prepare(`SELECT MIN(ts) AS lo, MAX(ts) AS hi FROM sensor_hyper`)
          .get() as { lo: number | null; hi: number | null };
        return { fromMs: r.lo, toMs: r.hi };
      },
      () => super.getDataWindow(),
    );
  }

  async getFaultRules() {
    return this.withDb(
      (db) =>
        (db
          .prepare(
            `SELECT fault_code AS code, name, type, kind, handle FROM fault_rule ORDER BY fault_code`,
          )
          .all() as unknown as Array<{
          code: number;
          name: string;
          type: number;
          kind: number;
          handle: string;
        }>),
      () => super.getFaultRules(),
    );
  }

  async getInternalFaultRules() {
    return this.withDb(
      (db) => ({
        bocHpc: db
          .prepare(`SELECT code, name, type, kind FROM fault_boc_hpc_rule ORDER BY code`)
          .all() as unknown as Array<{ code: number; name: string; type: number; kind: number }>,
        moc: db
          .prepare(`SELECT code, name, type, kind FROM fault_moc_rule ORDER BY code`)
          .all() as unknown as Array<{ code: number; name: string; type: number; kind: number }>,
      }),
      () => super.getInternalFaultRules(),
    );
  }

  async getRankings(params: RankingsParams) {
    return this.withDb(
      (db) => {
        // 时间滑块给出的毫秒窗口优先于日期串
        const startMs =
          params.fromMs ?? new Date(`${params.start}T00:00:00`).getTime();
        const endMs = params.toMs ?? new Date(`${params.end}T23:59:59.999`).getTime();
        const rows = db
          .prepare(
            `SELECT fr.name AS name, COUNT(*) AS cnt, MAX(fn.occur_ts) AS last_ts
             FROM fault_normal fn JOIN fault_rule fr ON fr.fault_code = fn.fault_code
             WHERE fn.occur_ts BETWEEN ? AND ?
             GROUP BY fn.fault_code ORDER BY cnt DESC`,
          )
          .all(startMs, endMs) as unknown as Array<{
          name: string;
          cnt: number;
          last_ts: number;
        }>;

        // 普通故障总排名（完整列表，占比由前端按显示配置过滤后计算）
        return {
          start: params.start,
          end: params.end,
          system: params.system,
          systemFaultRankings: rows.map((r) => ({
            name: r.name,
            count: r.cnt,
            lastOccurredAt: fmtTs(r.last_ts),
          })),
          inverterFaultRankings: [],
          sensorFaultRankings: [],
        };
      },
      () => super.getRankings(params),
    );
  }

  async getRunCycle(): Promise<RunCycleResponse> {
    return this.withDb(
      (db) => {
        const now = Date.now();
        const from = now - 2 * HOUR;
        const buckets = 40;
        const step = (now - from) / buckets;
        const catalogDef: Array<[string, string, string]> = [
          // [展示名, std_tag, 颜色]
          ["采煤机速度", "left_speed_measured", "#48c7ff"],
          ["采煤机位置", "left_position", "#8ad3ff"],
          ["左截割电机温度", "left_cutter_temp", "#ffb14a"],
          ["右截割电机温度", "right_cutter_temp", "#f7d65c"],
          ["左截割电机电流", "left_cutter_current_u", "#4f8cff"],
          ["右截割电机电流", "right_cutter_current_u", "#7fa8ff"],
          ["左截割负荷", "left_cutter_load_pct", "#ff8a5c"],
          ["右截割负荷", "right_cutter_load_pct", "#ffad85"],
          ["左牵引电机电流", "left_haul_current_u", "#38d889"],
          ["右牵引电机电流", "right_haul_current_u", "#6fe3a8"],
          ["泵电机温度", "left_pump_temp", "#9f86ff"],
          ["左水路压力", "left_water_pressure", "#5cd6d0"],
        ];
        const seriesCatalog: RunCycleResponse["seriesCatalog"] = {};
        for (const [name, tag, color] of catalogDef) {
          seriesCatalog[name] = {
            name,
            color,
            values: this.bucketSeries(db, tag, from, now, buckets),
          };
        }
        return {
          xAxisOptions: ["时间"],
          yAxisOptions: catalogDef.map(([name]) => name),
          defaultCharts: {
            A: { xAxis: "时间", yAxes: ["采煤机速度", "左截割电机温度"] },
            B: { xAxis: "时间", yAxes: ["左截割电机电流", "左牵引电机电流", "泵电机温度"] },
          },
          labelSets: {
            时间: this.hourLabels(from, buckets, step),
          },
          seriesCatalog,
        };
      },
      () => super.getRunCycle(),
    );
  }

  async getFaultCodeResult(category: FaultCategory, code: string): Promise<FaultCodeResult> {
    return this.withDb(
      (db) => {
        const trimmed = code.trim();
        const num = trimmed.toLowerCase().startsWith("0x")
          ? Number.parseInt(trimmed.slice(2), 16)
          : Number.parseInt(trimmed, 10);

        const notFound: FaultCodeResult = {
          category,
          code,
          found: false,
          description: null,
          tip: null,
        };
        if (!Number.isFinite(num)) {
          return notFound;
        }

        if (category === "system") {
          const row = db
            .prepare(`SELECT name, type, kind, handle FROM fault_rule WHERE fault_code = ?`)
            .get(num) as { name: string; type: number; kind: number; handle: string } | undefined;
          if (!row) {
            return notFound;
          }
          const typeText = ["提示", "警告", "停机"][row.type] ?? String(row.type);
          return {
            category,
            code,
            found: true,
            description: `[${typeText}] ${row.name}`,
            tip: row.handle,
          };
        }

        // category === "inverter"：按内部故障码解析（BOC/HPC → 0x22xx 规则 → MOC）
        const decoded = this.decodeInternalCode(db, num);
        if (decoded) {
          return { category, code, found: true, description: decoded.title, tip: decoded.tip };
        }
        return notFound;
      },
      () => super.getFaultCodeResult(category, code),
    );
  }

  /** 内部故障码三级解码：BOC/HPC 表 → 0x22xx~0x26xx 停机操作码 → MOC 位解析。 */
  private decodeInternalCode(
    db: DatabaseSync,
    num: number,
  ): { title: string; tip: string | null } | null {
    const bocHpc = db
      .prepare(`SELECT name, type FROM fault_boc_hpc_rule WHERE code = ?`)
      .get(num) as { name: string; type: number } | undefined;
    if (bocHpc) {
      const typeText = ["提示", "警告", "停机"][bocHpc.type] ?? "";
      return { title: `[BOC/HPC${typeText ? " · " + typeText : ""}] ${bocHpc.name}`, tip: null };
    }

    const high = (num >> 8) & 0xff;
    if (high >= 0x22 && high <= 0x26) {
      const source = BOC_HPC_SOURCES[high];
      const cmds = BOC_HPC_CMD_BITS.filter(([bit]) => (num & (1 << bit)) !== 0).map(
        ([, label]) => label,
      );
      return {
        title: `来自${source}停机操作${cmds.length ? "：" + cmds.join("、") : ""}`,
        tip: "0x22xx~0x26xx：Bit15-8 操作来源，Bit7-0 停止命令。",
      };
    }

    const mocSource = (num >> 9) & 0x7f;
    const mocRow = db
      .prepare(`SELECT name FROM fault_moc_rule WHERE code = ?`)
      .get(mocSource) as { name: string } | undefined;
    if (mocRow) {
      const stops = MOC_STOP_BITS.filter(([bit]) => (num & (1 << bit)) !== 0).map(
        ([, label]) => label,
      );
      return {
        title: `[MOC] ${mocRow.name}${stops.length ? "：" + stops.join("、") : ""}`,
        tip: "MOC 码：Bit15-9 来源代码（系统代码表），Bit8-0 停止代码。",
      };
    }
    return null;
  }

  /** 实时故障流：普通故障（仅警告/停机）+ 内部故障（FIFO 事件），按发生时间倒序。 */
  async getLiveFaults(limit = 80) {
    return this.withDb(
      (db) => {
        const normals = db
          .prepare(
            `SELECT fn.id AS id, fn.fault_code, fn.occur_ts, fn.clear_ts,
                    fr.name, fr.type, fr.kind, fr.handle
             FROM fault_normal fn JOIN fault_rule fr ON fr.fault_code = fn.fault_code
             WHERE fr.type IN (1, 2)
             ORDER BY fn.occur_ts DESC LIMIT ?`,
          )
          .all(limit) as unknown as Array<{
          id: number;
          fault_code: number;
          occur_ts: number;
          clear_ts: number | null;
          name: string;
          type: number;
          kind: number;
          handle: string;
        }>;
        const internals = db
          .prepare(
            `SELECT id, fault_code, occur_ts, module_name FROM fault_internal
             ORDER BY occur_ts DESC LIMIT ?`,
          )
          .all(limit) as unknown as Array<{
          id: number;
          fault_code: number;
          occur_ts: number;
          module_name: string;
        }>;

        const items: LiveFault[] = normals.map((n) => ({
          id: `n${n.id}`,
          source: "normal" as const,
          code: String(n.fault_code),
          name: n.name,
          type: n.type,
          kind: n.kind,
          module: "",
          occurTs: n.occur_ts,
          clearTs: n.clear_ts,
          handle: n.handle ?? "",
        }));
        for (const i of internals) {
          const hex = `0x${i.fault_code.toString(16).toUpperCase().padStart(4, "0")}`;
          const decoded = this.decodeInternalCode(db, i.fault_code);
          items.push({
            id: `i${i.id}`,
            source: "internal" as const,
            code: hex,
            name: decoded?.title ?? `内部故障码 ${hex}`,
            type: 2,
            kind: 6,
            module: i.module_name,
            // FIFO 内部故障是瞬时事件，视为发生即结束
            occurTs: i.occur_ts,
            clearTs: i.occur_ts,
            handle: decoded?.tip ?? "记录完整故障码，结合模块指示灯与故障记录进一步定位。",
          });
        }
        items.sort((a, b) => b.occurTs - a.occurTs);
        return items.slice(0, limit);
      },
      () => super.getLiveFaults(),
    );
  }

  /**
   * 停机分析：把时间线切成 割煤/调度移机/停机/断电检修 四种状态段。
   *
   * 判定（与用户约定）：
   *   停机   = 左右截割电机都停 且 牵引停(haul_started=0) 且 速度<0.1，持续≥30s
   *   割煤   = 任一截割电机运行
   *   调度移机 = 截割停但机器在走（牵引启 或 速度≥0.1）
   *   断电检修 = 数据流中断 >10 分钟（检修班断电，连数据都没有）
   * 归因（仅停机段）：停机时刻激活的停机级故障 → 故障停机；
   *   无故障但停机前 2 分钟内有停类操作 → 人工停机（含操作来源）；否则待机。
   */
  async getDowntime(fromMs?: number, toMs?: number): Promise<DowntimeResponse> {
    return this.withDb(
      (db) => {
        // 窗口缺省 = 库内全部数据
        const win = db
          .prepare(`SELECT MIN(ts) AS lo, MAX(ts) AS hi FROM sensor_hyper`)
          .get() as { lo: number | null; hi: number | null };
        const lo = fromMs ?? win.lo ?? 0;
        const hi = toMs ?? win.hi ?? 0;
        const empty: DowntimeResponse = {
          fromMs: lo,
          toMs: hi,
          kpis: {
            cuttingMs: 0, dispatchMs: 0, stoppedMs: 0, poweroffMs: 0,
            stoppedCount: 0, longestStoppedMs: 0, cuttingRatePct: 0,
          },
          segments: [],
        };
        if (hi - lo < 1_000) {
          return empty;
        }

        const STATE_TAGS = ["left_cutter_running", "right_cutter_running", "haul_started"];
        const SPEED_TAG = "left_speed_measured";
        const GAP_MS = 10 * 60_000; // 断电检修阈值
        const MIN_STOP_MS = 30_000; // 停机最短时长（重启间隙不算）

        // 事件流：状态位 + 速度，按时间归并
        type Ev = { ts: number; tag: string; v: number };
        const events: Ev[] = [];
        const stStmt = db.prepare(
          `SELECT ts, state_code AS v FROM state_hyper WHERE std_tag = ? AND ts >= ? AND ts <= ? ORDER BY ts`,
        );
        for (const tag of STATE_TAGS) {
          for (const r of stStmt.all(tag, lo, hi) as unknown as Array<{ ts: number; v: number }>) {
            events.push({ ts: r.ts, tag, v: r.v });
          }
        }
        for (const r of db
          .prepare(
            `SELECT ts, value AS v FROM sensor_hyper WHERE std_tag = ? AND ts >= ? AND ts <= ? ORDER BY ts`,
          )
          .all(SPEED_TAG, lo, hi) as unknown as Array<{ ts: number; v: number }>) {
          events.push({ ts: r.ts, tag: SPEED_TAG, v: r.v });
        }
        if (events.length === 0) {
          return { ...empty, segments: [{ state: "poweroff", fromMs: lo, toMs: hi }] };
        }
        events.sort((a, b) => a.ts - b.ts);

        // 窗口起点的初始状态：各信号取窗口前最后一个值
        const cur: Record<string, number> = {};
        const seedState = db.prepare(
          `SELECT state_code AS v FROM state_hyper WHERE std_tag = ? AND ts < ? ORDER BY ts DESC LIMIT 1`,
        );
        for (const tag of STATE_TAGS) {
          cur[tag] = (seedState.get(tag, lo) as { v: number } | undefined)?.v ?? 0;
        }
        cur[SPEED_TAG] =
          (
            db
              .prepare(
                `SELECT value AS v FROM sensor_hyper WHERE std_tag = ? AND ts < ? ORDER BY ts DESC LIMIT 1`,
              )
              .get(SPEED_TAG, lo) as { v: number } | undefined
          )?.v ?? 0;

        const classify = (): DowntimeSegment["state"] => {
          const cutting = cur.left_cutter_running === 1 || cur.right_cutter_running === 1;
          if (cutting) {
            return "cutting";
          }
          const speed = cur[SPEED_TAG];
          const speedValid = speed >= 0 && speed < 600; // 哨兵/负值视为无效（不动）
          const moving = cur.haul_started === 1 || (speedValid && speed >= 0.1);
          return moving ? "dispatch" : "stopped";
        };

        // 扫描事件流生成状态段（数据空洞 >10min 插入断电段）
        const raw: DowntimeSegment[] = [];
        let segStart = lo;
        let segState = classify();
        let prevTs = lo;
        const pushSeg = (endTs: number) => {
          if (endTs > segStart) {
            raw.push({ state: segState, fromMs: segStart, toMs: endTs });
          }
        };
        for (const ev of events) {
          if (ev.ts - prevTs > GAP_MS) {
            pushSeg(prevTs);
            raw.push({ state: "poweroff", fromMs: prevTs, toMs: ev.ts });
            segStart = ev.ts;
          }
          cur[ev.tag] = ev.v;
          const next = classify();
          if (next !== segState && ev.ts > segStart) {
            pushSeg(ev.ts);
            segStart = ev.ts;
          }
          if (next !== segState || ev.ts - prevTs > GAP_MS) {
            segState = next;
          }
          prevTs = ev.ts;
        }
        if (hi - prevTs > GAP_MS) {
          pushSeg(prevTs);
          raw.push({ state: "poweroff", fromMs: prevTs, toMs: hi });
        } else {
          pushSeg(hi);
        }

        // 30s 门槛：过短的停机并入前段状态，然后合并相邻同状态段
        for (const seg of raw) {
          if (seg.state === "stopped" && seg.toMs - seg.fromMs < MIN_STOP_MS) {
            seg.state = "cutting";
          }
        }
        const segments: DowntimeSegment[] = [];
        for (const seg of raw) {
          const last = segments[segments.length - 1];
          if (last && last.state === seg.state) {
            last.toMs = seg.toMs;
          } else {
            segments.push({ ...seg });
          }
        }

        // 归因（仅停机段）
        const faultStmt = db.prepare(
          `SELECT fr.name, fn.occur_ts, fr.handle FROM fault_normal fn
           JOIN fault_rule fr ON fr.fault_code = fn.fault_code
           WHERE fr.type = 2 AND fn.occur_ts <= ? AND (fn.clear_ts IS NULL OR fn.clear_ts >= ?)
           ORDER BY fn.occur_ts DESC LIMIT 6`,
        );
        const actionStmt = db.prepare(
          `SELECT occur_ts, source_name, op_name, action FROM device_action
           WHERE occur_ts BETWEEN ? AND ? AND action = '按下'
             AND op_name IN ('急停','总停','左截停','右截停','牵停')
             AND source_type = '输入'
           ORDER BY occur_ts DESC LIMIT 6`,
        );
        for (const seg of segments) {
          if (seg.state !== "stopped") {
            continue;
          }
          const edge = seg.fromMs;
          const faults = faultStmt.all(edge + 60_000, edge - 60_000) as unknown as Array<{
            name: string;
            occur_ts: number;
            handle: string;
          }>;
          const actions = actionStmt.all(edge - 120_000, edge + 60_000) as unknown as Array<{
            occur_ts: number;
            source_name: string;
            op_name: string;
            action: string;
          }>;
          seg.faults = faults.map((f) => ({ name: f.name, occurTs: f.occur_ts, handle: f.handle ?? "" }));
          seg.actions = actions.map((a) => ({
            ts: a.occur_ts,
            source: a.source_name,
            op: a.op_name,
            action: a.action,
          }));
          if (faults.length > 0) {
            seg.cause = "fault";
            seg.causeText = `故障停机：${faults[0].name}`;
          } else if (actions.length > 0) {
            seg.cause = "manual";
            seg.causeText = `人工停机：${actions[0].source_name} ${actions[0].op_name}`;
          } else {
            seg.cause = "idle";
            seg.causeText = "待机（无故障与操作记录，疑似工序性等待）";
          }
        }

        // KPI（停机三项只统计"故障停机"）
        const kpis = { ...empty.kpis };
        for (const seg of segments) {
          const dur = seg.toMs - seg.fromMs;
          if (seg.state === "cutting") kpis.cuttingMs += dur;
          else if (seg.state === "dispatch") kpis.dispatchMs += dur;
          else if (seg.state === "poweroff") kpis.poweroffMs += dur;
          else if (seg.cause === "fault") {
            kpis.stoppedMs += dur;
            kpis.stoppedCount += 1;
            kpis.longestStoppedMs = Math.max(kpis.longestStoppedMs, dur);
          }
        }
        const powered = hi - lo - kpis.poweroffMs;
        kpis.cuttingRatePct = powered > 0 ? Number(((kpis.cuttingMs / powered) * 100).toFixed(1)) : 0;

        return { fromMs: lo, toMs: hi, kpis, segments };
      },
      () => super.getDowntime(),
    );
  }

  // ------------------------------------------------------- 三个分析页

  private faultLogs(db: DatabaseSync, likeAny: string[], sinceMs: number, limit = 10) {
    const conds = likeAny.map(() => "fr.name LIKE ?").join(" OR ");
    const rows = db
      .prepare(
        `SELECT fn.occur_ts, fr.name, fr.type FROM fault_normal fn
         JOIN fault_rule fr ON fr.fault_code = fn.fault_code
         WHERE fn.occur_ts >= ? AND (${conds})
         ORDER BY fn.occur_ts DESC LIMIT ?`,
      )
      .all(sinceMs, ...likeAny.map((k) => `%${k}%`), limit) as unknown as Array<{
      occur_ts: number;
      name: string;
      type: number;
    }>;
    return rows.map((r) => ({ time: fmtTs(r.occur_ts), text: r.name, type: r.type }));
  }

  private actionLogs(db: DatabaseSync, ops: string[], sinceMs: number, limit = 10) {
    const placeholders = ops.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT occur_ts, source_name, op_name, action FROM device_action
         WHERE occur_ts >= ? AND op_name IN (${placeholders}) AND source_type = '输入'
         ORDER BY occur_ts DESC LIMIT ?`,
      )
      .all(sinceMs, ...ops, limit) as unknown as Array<{
      occur_ts: number;
      source_name: string;
      op_name: string;
      action: string;
    }>;
    return rows.map((r) => ({
      time: fmtTs(r.occur_ts),
      text: `${r.source_name} ${r.op_name}(${r.action})`,
    }));
  }

  /** 部件统计行：平均负荷/平均温度/带载时长/过载时长/过温时长（按 24h 小时桶近似）。 */
  private partStats(
    db: DatabaseSync,
    part: string,
    loadTag: string,
    tempTag: string,
    fromMs: number,
    toMs: number,
  ) {
    const buckets = 24;
    const load = this.bucketSeries(db, loadTag, fromMs, toMs, buckets);
    const temp = this.bucketSeries(db, tempTag, fromMs, toMs, buckets);
    const loaded = load.filter((v) => v > 5).length;
    const overload = load.filter((v) => v >= 100).length;
    const overtemp = temp.filter((v) => v >= 80).length;
    const avg = (a: number[]) =>
      a.length ? Number((a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)) : 0;
    return {
      part,
      averageLoadPower: `${avg(load.filter((v) => v > 5))}%`,
      averageLoadTemperature: `${avg(temp.filter((v) => v > -39.9))}℃`,
      todayLoadedRuntime: `${loaded} h`,
      todayOverloadTime: `${overload} h`,
      todayOverTemperatureTime: `${overtemp} h`,
    };
  }

  async getPumpAnalysis(range: PumpAnalysisRange): Promise<PumpAnalysisResponse> {
    return this.withDb(
      (db) => {
        const now = Date.now();
        const from = now - DAY;
        const buckets = 24;
        const step = (now - from) / buckets;
        const series: Array<[string, string, string]> = [
          ["左泵电流", "left_pump_current_u", "#4f8cff"],
          ["右泵电流", "right_pump_current_u", "#48c7ff"],
          ["左泵温度", "left_pump_temp", "#ffb14a"],
          ["右泵温度", "right_pump_temp", "#f7d65c"],
          ["左水路压力", "left_water_pressure", "#5cd6d0"],
        ];
        const trendSeries = series.map(([name, tag, color]) => ({
          name,
          color,
          values: this.bucketSeries(db, tag, from, now, buckets),
        }));
        const statOf = (tag: string, unit: string) => {
          const r = db
            .prepare(
              `SELECT AVG(value) AS a, MAX(value) AS m FROM sensor_hyper
               WHERE std_tag = ? AND ts >= ?`,
            )
            .get(tag, from) as { a: number | null; m: number | null };
          return `均值 ${r.a === null ? "--" : r.a.toFixed(1)}${unit} / 峰值 ${r.m === null ? "--" : r.m.toFixed(1)}${unit}`;
        };
        const faults = this.faultLogs(db, ["泵", "水路"], from);
        return {
          range,
          labels: this.hourLabels(from, buckets, step),
          trendSeries,
          stats: [
            { label: "左泵电流(U)", value: statOf("left_pump_current_u", "A") },
            { label: "右泵电流(U)", value: statOf("right_pump_current_u", "A") },
            { label: "左泵温度", value: statOf("left_pump_temp", "℃") },
            { label: "右泵温度", value: statOf("right_pump_temp", "℃") },
            { label: "左水路压力", value: statOf("left_water_pressure", "MPa") },
            { label: "左水路流量", value: statOf("left_water_flow1", "L/Min") },
          ],
          logs: this.actionLogs(db, ["泵启", "泵停"], from),
          alerts: faults.map(({ time, text }) => ({ time, text })),
        };
      },
      () => super.getPumpAnalysis(range),
    );
  }

  async getCuttingAnalysis(range: CuttingAnalysisRange): Promise<CuttingAnalysisResponse> {
    return this.withDb(
      (db) => {
        const now = Date.now();
        const from = now - DAY;
        const buckets = 24;
        const step = (now - from) / buckets;
        const motor: Array<[string, string, string]> = [
          ["左截割负荷", "left_cutter_load_pct", "#4f8cff"],
          ["右截割负荷", "right_cutter_load_pct", "#48c7ff"],
          ["左截割温度", "left_cutter_temp", "#ffb14a"],
          ["右截割温度", "right_cutter_temp", "#f7d65c"],
        ];
        const arm: Array<[string, string, string]> = [
          ["左摇臂温度", "left_arm_temp", "#ff8a5c"],
          ["右摇臂温度", "right_arm_temp", "#ffad85"],
          ["左采高", "left_arm_height", "#38d889"],
          ["右采高", "right_arm_height", "#6fe3a8"],
        ];
        const mk = ([name, tag, color]: [string, string, string]) => ({
          name,
          color,
          values: this.bucketSeries(db, tag, from, now, buckets),
        });
        const faults = this.faultLogs(db, ["截割", "摇臂"], from);
        return {
          range,
          labels: this.hourLabels(from, buckets, step),
          motorSeries: motor.map(mk),
          armSeries: arm.map(mk),
          stats: [
            this.partStats(db, "左截割电机", "left_cutter_load_pct", "left_cutter_temp", from, now),
            this.partStats(db, "右截割电机", "right_cutter_load_pct", "right_cutter_temp", from, now),
          ],
          logs: this.actionLogs(db, ["左截启", "左截停", "右截启", "右截停"], from),
          alerts: faults.map(({ time, text }) => ({ time, text })),
        };
      },
      () => super.getCuttingAnalysis(range),
    );
  }

  async getTractionAnalysis(range: TractionAnalysisRange): Promise<TractionAnalysisResponse> {
    return this.withDb(
      (db) => {
        const now = Date.now();
        const from = now - DAY;
        const buckets = 24;
        const step = (now - from) / buckets;
        const mk = ([name, tag, color]: [string, string, string]) => ({
          name,
          color,
          values: this.bucketSeries(db, tag, from, now, buckets),
        });
        const motor: Array<[string, string, string]> = [
          ["左牵引负荷", "left_haul_load_pct", "#4f8cff"],
          ["右牵引负荷", "right_haul_load_pct", "#48c7ff"],
          ["左牵引温度", "left_haul_temp", "#ffb14a"],
          ["右牵引温度", "right_haul_temp", "#f7d65c"],
          ["实测速度", "left_speed_measured", "#38d889"],
        ];
        const inverter: Array<[string, string, string]> = [
          ["左变频器输出电流", "left_inv_output_current", "#9f86ff"],
          ["右变频器输出电流", "right_inv_output_current", "#c3a8ff"],
          ["左变频器IGBT温度", "left_inv_igbt_temp", "#ff8a5c"],
          ["右变频器IGBT温度", "right_inv_igbt_temp", "#ffad85"],
        ];
        const faults = this.faultLogs(db, ["牵引", "变频"], from);
        return {
          range,
          labels: this.hourLabels(from, buckets, step),
          motorSeries: motor.map(mk),
          inverterSeries: inverter.map(mk),
          stats: [
            this.partStats(db, "左牵引电机", "left_haul_load_pct", "left_haul_temp", from, now),
            this.partStats(db, "右牵引电机", "right_haul_load_pct", "right_haul_temp", from, now),
          ],
          logs: this.actionLogs(db, ["牵启", "牵停", "加速", "减速", "向左", "向右"], from),
          alerts: faults.map(({ time, text }) => ({ time, text })),
        };
      },
      () => super.getTractionAnalysis(range),
    );
  }

  subscribe(onEvent: (event: DataSourceEvent) => void) {
    const timer = setInterval(() => {
      this.withDb(
        (db) => {
          onEvent({ type: "connection_status", data: this.connectionFromDb(db) });
          return null;
        },
        () => null,
      );
    }, 5_000);
    return () => clearInterval(timer);
  }
}
