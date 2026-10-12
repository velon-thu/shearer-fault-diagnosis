/**
 * DataplaneDataSourceAdapter：真实数据适配器。
 *
 * 数据源为 dataplane 采集器落库的 shearer.db（sensor_hyper / state_hyper /
 * device_action / fault_normal / fault_internal + 定义与规则表）。
 * 继承 MockDataSourceAdapter：org 数据支撑不到的板块（打卡、知识库、
 * 设置静态字段、认证）沿用原实现；数据库不可用时逐方法回退 mock。
 */
import { existsSync, statSync } from "node:fs";
import { hostname, networkInterfaces, release, type } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readDiagnosisTrees } from "../diagnosis/trees";
import type {
  ArmEvidence,
  ArmEvidenceVerdict,
  ConnectionStatus,
  CuttingAnalysisRange,
  CuttingAnalysisResponse,
  DeviceStatus,
  FaultCategory,
  FaultCodeResult,
  DowntimeResponse,
  DowntimeSegment,
  FreezeFrame,
  HealthReport,
  HomeSummary,
  LiveFault,
  TimelineResponse,
  PumpAnalysisRange,
  PumpAnalysisResponse,
  RunCycleResponse,
  SensorDetail,
  SensorSummary,
  SensorTrendPoint,
  TractionAnalysisRange,
  TractionAnalysisResponse,
  MotorEvidence,
  TractionEvidence,
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

/** 时长口语化：给体检、设置这类"给人看"的文案用 */
const fmtDuration = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分`;
  return `${total} 秒`;
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

  /**
   * 系统设置。
   *
   * 连接状态、数据源、运行环境这三块都从工控机现读，不再用配置里写死的样例值——
   * 现场看到的必须是这台机器此刻的真实情况。工作面与机型参数仍来自 ipc.db 配置。
   */
  async getSettings() {
    const base = await super.getSettings();
    return this.withDb(
      (db) => {
        const connection = this.connectionFromDb(db);
        const now = Date.now();

        // ---- 数据源实况
        const win = db.prepare(`SELECT MIN(ts) AS lo, MAX(ts) AS hi FROM sensor_hyper`).get() as {
          lo: number | null;
          hi: number | null;
        };
        const lagMs = win.hi === null ? null : now - win.hi;
        const countOf = (table: string): number => {
          try {
            return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
          } catch {
            return 0;
          }
        };
        let dbSizeMb: number | null = null;
        try {
          dbSizeMb = Math.round((statSync(DATAPLANE_DB).size / (1024 * 1024)) * 10) / 10;
        } catch {
          dbSizeMb = null;
        }
        const trees = readDiagnosisTrees().trees.map((tree) => ({
          name: tree.shortName,
          modules: tree.modules.length,
          nodes: tree.modules.reduce((sum, module) => sum + module.nodes.length, 0),
        }));

        // ---- 运行环境：主机名、网卡地址、系统、Node、服务已跑多久
        const addresses: string[] = [];
        for (const [name, list] of Object.entries(networkInterfaces())) {
          for (const item of list ?? []) {
            if (item.family === "IPv4" && !item.internal) {
              addresses.push(`${item.address}（${name}）`);
            }
          }
        }
        const runtimeInfo = [
          { label: "工控机主机名", value: hostname() },
          { label: "工控机地址", value: addresses.length > 0 ? addresses.join("，") : "未取到网卡地址" },
          { label: "操作系统", value: `${type()} ${release()}` },
          { label: "Node 版本", value: process.version },
          { label: "服务端口", value: `HTTP ${process.env.PORT ?? 18080} · WebSocket /ws/live` },
          { label: "服务已运行", value: fmtDuration(process.uptime() * 1000) },
          { label: "本次读数时间", value: fmtTs(now) },
        ];

        return {
          ...base,
          connected: true,
          connection,
          runtimeInfo,
          dataSource: {
            dbPath: DATAPLANE_DB,
            dbSizeMb,
            fromMs: win.lo,
            toMs: win.hi,
            lagMs,
            // 两分钟内还有新数据，就认为采集/回放在跑
            collecting: lagMs !== null && lagMs < 2 * 60_000,
            tables: [
              { name: "传感器时序", rows: countOf("sensor_hyper") },
              { name: "状态时序", rows: countOf("state_hyper") },
              { name: "操作记录", rows: countOf("device_action") },
              { name: "故障事件", rows: countOf("fault_normal") },
            ],
            trees,
          },
        };
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

  /** 故障冻结帧：故障时刻前后 ±60s 的关键信号（秒级），复刻汽车诊断仪 Freeze Frame。 */
  /**
   * 故障现场：故障时刻 ±5 分钟的信号、操作、其他异常，外加一段结论。
   *
   * 结论是**规则推出来的，不是编的**。三件事各自独立判断，然后拼成一句话：
   *   1. 曲线：每一路比故障前 60s 与后 60s 的均值，掉零/骤降/骤升才报，没变化不报。
   *   2. 操作：故障前 60s 内人按过什么（停类操作是最常见的"假故障"来源）。
   *   3. 并发：同一窗口里其他故障的发生与消除、关键电机启停。
   *
   * 拿不准就写在 caveats 里明说，绝不把"可能"写成"就是"。
   */
  async getFreezeFrame(tsMs: number, pickedName?: string): Promise<FreezeFrame> {
    return this.withDb(
      (db) => {
        const SIGNALS: Array<[string, string, string]> = [
          ["牵引速度", "left_speed_measured", "m/min"],
          ["左截割负荷", "left_cutter_load_pct", "%"],
          ["右截割负荷", "right_cutter_load_pct", "%"],
          ["左截割电流", "left_cutter_current_u", "A"],
          ["右截割电流", "right_cutter_current_u", "A"],
          ["左牵引负荷", "left_haul_load_pct", "%"],
          ["右牵引负荷", "right_haul_load_pct", "%"],
          ["左截割温度", "left_cutter_temp", "℃"],
          ["右截割温度", "right_cutter_temp", "℃"],
          ["左泵电流", "left_pump_current_u", "A"],
          ["左变频器母线电压", "left_inv_bus_voltage", "V"],
          ["左水路压力", "left_water_pressure", "MPa"],
        ];
        const WINDOW_MS = 5 * 60_000;
        const COMPARE_MS = 60_000; // 前后各取 1 分钟算均值
        const lo = tsMs - WINDOW_MS;
        const hi = tsMs + WINDOW_MS;
        const buckets = 300; // 2 秒一格
        const step = (hi - lo) / buckets;

        const avgIn = (tag: string, from: number, to: number): number | null => {
          const row = db
            .prepare(`SELECT AVG(value) AS a FROM sensor_hyper WHERE std_tag=? AND ts>=? AND ts<?`)
            .get(tag, from, to) as { a: number | null };
          return row.a;
        };
        const distinctOf = (tag: string): number =>
          (
            db
              .prepare(`SELECT COUNT(DISTINCT value) AS c FROM sensor_hyper WHERE std_tag = ?`)
              .get(tag) as { c: number }
          ).c;

        const signals = SIGNALS.map(([name, tag, unit]) => {
          const seed = (
            db
              .prepare(
                `SELECT value AS v FROM sensor_hyper WHERE std_tag=? AND ts<? ORDER BY ts DESC LIMIT 1`,
              )
              .get(tag, lo) as { v: number } | undefined
          )?.v;
          const values = this.bucketSeries(db, tag, lo, hi, buckets, seed ?? 0);
          const points = values.map((v, i) => ({ ts: Math.round(lo + i * step), value: v }));

          // 沿变存储下"前后都没有记录"就是没变；均值取不到时回退到 seed
          const rawBefore = avgIn(tag, tsMs - COMPARE_MS, tsMs);
          const rawAfter = avgIn(tag, tsMs, tsMs + COMPARE_MS);
          const dead = distinctOf(tag) <= 1;
          const beforeAvg =
            rawBefore ?? (seed !== undefined ? seed : null);
          const afterAvg = rawAfter ?? beforeAvg;

          let change: "none" | "drop-zero" | "drop" | "surge" | "invalid" = "none";
          let changePct: number | null = null;
          let changeText = "无明显变化";
          if (dead || beforeAvg === null || afterAvg === null || isSentinel(unit, beforeAvg)) {
            change = "invalid";
            changeText = "测点无效";
          } else {
            const base = Math.abs(beforeAvg);
            changePct = base > 0.5 ? Math.round(((afterAvg - beforeAvg) / base) * 100) : null;
            const round1 = (v: number) => Math.round(v * 10) / 10;
            if (base > 0.5 && Math.abs(afterAvg) < base * 0.08) {
              change = "drop-zero";
              changeText = `由 ${round1(beforeAvg)}${unit} 掉到 ${round1(afterAvg)}${unit}`;
            } else if (changePct !== null && changePct <= -35) {
              change = "drop";
              changeText = `下降 ${Math.abs(changePct)}%（${round1(beforeAvg)} → ${round1(afterAvg)}${unit}）`;
            } else if (changePct !== null && changePct >= 50) {
              change = "surge";
              changeText = `上升 ${changePct}%（${round1(beforeAvg)} → ${round1(afterAvg)}${unit}）`;
            } else {
              changeText = `基本平稳（${round1(beforeAvg)} → ${round1(afterAvg)}${unit}）`;
            }
          }

          return {
            name,
            unit,
            points,
            beforeAvg: beforeAvg === null ? null : Math.round(beforeAvg * 100) / 100,
            afterAvg: afterAvg === null ? null : Math.round(afterAvg * 100) / 100,
            changePct,
            change,
            changeText,
          };
        });

        // ---- 窗口内的操作记录
        const operations = (
          db
            .prepare(
              `SELECT occur_ts, source_type, source_name, op_name FROM device_action
               WHERE action='按下' AND occur_ts BETWEEN ? AND ? ORDER BY occur_ts`,
            )
            .all(lo, hi) as unknown as Array<{
            occur_ts: number;
            source_type: string;
            source_name: string;
            op_name: string;
          }>
        ).map((row) => ({
          ts: row.occur_ts,
          offsetMs: row.occur_ts - tsMs,
          source: row.source_name,
          op: row.op_name,
          input: row.source_type === "输入",
        }));

        // ---- 窗口内的其他故障与关键状态切换
        const events: Array<{
          ts: number;
          offsetMs: number;
          kind: "fault" | "clear" | "state";
          text: string;
          tone: "stop" | "warn" | "ok" | "state";
        }> = [];
        const faultRows = db
          .prepare(
            `SELECT fn.occur_ts, fn.clear_ts, fr.name, fr.type FROM fault_normal fn
             JOIN fault_rule fr ON fr.fault_code = fn.fault_code
             WHERE fr.type IN (1,2) AND (
                   (fn.occur_ts BETWEEN ? AND ?) OR (fn.clear_ts BETWEEN ? AND ?))
             ORDER BY fn.occur_ts LIMIT 60`,
          )
          .all(lo, hi, lo, hi) as unknown as Array<{
          occur_ts: number;
          clear_ts: number | null;
          name: string;
          type: number;
        }>;
        for (const row of faultRows) {
          if (row.occur_ts >= lo && row.occur_ts <= hi) {
            events.push({
              ts: row.occur_ts,
              offsetMs: row.occur_ts - tsMs,
              kind: "fault",
              text: row.name,
              tone: row.type === 2 ? "stop" : "warn",
            });
          }
          if (row.clear_ts !== null && row.clear_ts >= lo && row.clear_ts <= hi) {
            events.push({
              ts: row.clear_ts,
              offsetMs: row.clear_ts - tsMs,
              kind: "clear",
              text: `${row.name}（消除）`,
              tone: "ok",
            });
          }
        }
        const STATE_TAGS: Array<[string, string]> = [
          ["left_cutter_running", "左截割电机"],
          ["right_cutter_running", "右截割电机"],
          ["pump_running", "泵电机"],
          ["haul_started", "牵引"],
        ];
        for (const [tag, label] of STATE_TAGS) {
          const seedState =
            (
              db
                .prepare(
                  `SELECT state_code AS v FROM state_hyper WHERE std_tag=? AND ts<? ORDER BY ts DESC LIMIT 1`,
                )
                .get(tag, lo) as { v: number } | undefined
            )?.v ?? 0;
          let prev = seedState;
          const rows = db
            .prepare(
              `SELECT ts, state_code AS v FROM state_hyper WHERE std_tag=? AND ts BETWEEN ? AND ? ORDER BY ts`,
            )
            .all(tag, lo, hi) as unknown as Array<{ ts: number; v: number }>;
          for (const row of rows) {
            if (row.v !== prev) {
              events.push({
                ts: row.ts,
                offsetMs: row.ts - tsMs,
                kind: "state",
                text: `${label}${row.v === 1 ? "启动" : "停止"}`,
                tone: "state",
              });
              prev = row.v;
            }
          }
        }
        events.sort((a, b) => a.ts - b.ts);

        // ---- 这次故障叫什么。
        // 同一秒里常有好几条一起报（比如各路"流量检测通道保护"会和"电流传感器测试
        // 继电器接通"同时置起），只按时间取最近的必然抓错，所以优先用调用方点中的那条。
        const nearby = faultRows.filter((row) => Math.abs(row.occur_ts - tsMs) <= 2000);
        const faultName =
          (pickedName && nearby.find((row) => row.name === pickedName)?.name) ??
          pickedName ??
          nearby[0]?.name ??
          null;
        // 同一时刻并发的其他故障单独拎出来，现场看得见"这一秒还一起报了什么"
        const concurrent = nearby
          .filter((row) => row.name !== faultName)
          .map((row) => row.name);

        // ---- 结论：三路证据各自成句，再合成一句 headline
        const fmtOffset = (offsetMs: number) => {
          const sec = Math.round(Math.abs(offsetMs) / 1000);
          const body = sec < 60 ? `${sec} 秒` : `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
          return offsetMs < 0 ? `故障前 ${body}` : `故障后 ${body}`;
        };

        const dropped = signals.filter((s) => s.change === "drop-zero");
        const moved = signals.filter((s) => s.change === "drop" || s.change === "surge");
        const findings: string[] = [
          ...dropped.map((s) => `${s.name} ${s.changeText}`),
          ...moved.map((s) => `${s.name} ${s.changeText}`),
        ];
        const invalidCount = signals.filter((s) => s.change === "invalid").length;

        // 故障前 1 分钟的人工操作，停类单独拎出来
        const STOP_OPS = /停/;
        const beforeOps = operations.filter(
          (op) => op.input && op.offsetMs < 0 && op.offsetMs >= -COMPARE_MS,
        );
        const stopOps = beforeOps.filter((op) => STOP_OPS.test(op.op));
        // "总停"会在同一秒展开成牵停/运停/破停/左右截停等好几条，逐条列会把版面占满
        const context: string[] = [];
        const opGroups = new Map<string, { offsetMs: number; source: string; ops: string[] }>();
        for (const op of beforeOps) {
          const key = `${Math.round(op.ts / 1000)}|${op.source}`;
          const prev = opGroups.get(key);
          if (prev) {
            prev.ops.push(op.op);
          } else {
            opGroups.set(key, { offsetMs: op.offsetMs, source: op.source, ops: [op.op] });
          }
        }
        for (const group of [...opGroups.values()].slice(-4)) {
          context.push(
            group.ops.length > 1
              ? `${fmtOffset(group.offsetMs)}，${group.source} 按下「${group.ops[group.ops.length - 1]}」等 ${group.ops.length} 条指令`
              : `${fmtOffset(group.offsetMs)}，${group.source} 按下「${group.ops[0]}」`,
          );
        }
        if (concurrent.length > 0) {
          context.push(
            `同一秒还一起报了 ${concurrent.length} 条：${concurrent.slice(0, 3).join("、")}${concurrent.length > 3 ? " 等" : ""}`,
          );
        }
        // 同名故障在窗口内反复出现是很强的线索，但逐条列出来会把别的证据淹掉，先归并
        const otherFaults = events.filter(
          (e) => e.kind === "fault" && Math.abs(e.ts - tsMs) > 2000,
        );
        const faultTally = new Map<string, { count: number; nearest: number }>();
        for (const event of otherFaults) {
          const prev = faultTally.get(event.text);
          if (prev === undefined || Math.abs(event.offsetMs) < Math.abs(prev.nearest)) {
            faultTally.set(event.text, {
              count: (prev?.count ?? 0) + 1,
              nearest: event.offsetMs,
            });
          } else {
            prev.count += 1;
          }
        }
        // 与本次同名、且在窗口内重复出现 = 间歇性故障
        const repeatCount = faultName ? (faultTally.get(faultName)?.count ?? 0) : 0;
        for (const [name, tally] of [...faultTally.entries()].slice(0, 4)) {
          context.push(
            tally.count > 1
              ? `${name}：窗口内共出现 ${tally.count} 次，最近一次在${fmtOffset(tally.nearest)}`
              : `${fmtOffset(tally.nearest)}，${name}`,
          );
        }
        // 结论卡只放最关键的几条，完整清单在下面的记录分页里
        const stateEvents = events.filter((e) => e.kind === "state");
        for (const event of stateEvents.slice(0, 3)) {
          context.push(`${fmtOffset(event.offsetMs)}，${event.text}`);
        }

        // 判"机器真停了"不能只看信号掉零：牵引速度会反向、负荷会降到低位但不为零。
        // 电机停止的状态位才是硬证据。
        const stoppedNear = events.filter(
          (e) =>
            e.kind === "state" &&
            /停止/.test(e.text) &&
            e.offsetMs >= -10_000 &&
            e.offsetMs <= COMPARE_MS,
        );

        let headline: string;
        if (stopOps.length > 0) {
          const op = stopOps[stopOps.length - 1];
          const followed =
            stoppedNear.length > 0 ||
            dropped.length > 0 ||
            signals.some((s) => s.change === "drop");
          const what =
            stoppedNear.length > 0
              ? `${stoppedNear.map((e) => e.text.replace("停止", "")).join("、")}相继停机`
              : dropped.length > 0
                ? `${dropped.length} 路信号掉到零`
                : `${signals.filter((s) => s.change === "drop").length} 路信号明显下降`;
          headline = followed
            ? `${fmtOffset(op.offsetMs)}${op.source}按了「${op.op}」，紧接着${what}——这更像是停机操作带出来的连锁报警，先确认是不是人为停的。`
            : `${fmtOffset(op.offsetMs)}${op.source}按了「${op.op}」，但设备没有跟着停、曲线也没变化，停机指令与这条故障未必是同一件事。`;
        } else if (repeatCount >= 2) {
          headline = `同一条故障在这 10 分钟里反复出现 ${repeatCount + 1} 次，属于间歇性故障——这类多是接插件松动、线路虚接或通讯受扰，比一次性故障更该盯住。`;
        } else if (dropped.length >= 3) {
          headline = `没有停机操作记录，却有 ${dropped.length} 路信号在故障时刻同时掉零，倾向供电中断或模块通讯丢失，先查电源与通讯。`;
        } else if (dropped.length > 0) {
          headline = `只有 ${dropped.map((s) => s.name).join("、")} 掉到零，其余信号正常，问题大概率局限在这一路对应的回路上。`;
        } else if (moved.length > 0) {
          headline = `没有信号掉零，但 ${moved.map((s) => s.name).join("、")} 在故障前后有明显变化，按这几路顺藤摸瓜。`;
        } else if (otherFaults.length > 0) {
          headline = `本机信号在故障前后没有明显突变，但同期还有 ${otherFaults.length} 条其他故障，先看是不是被别的故障带出来的。`;
        } else {
          headline = "故障前后信号平稳、也没有操作记录，数据这边看不出诱因，需要结合现场判断。";
        }

        const caveats: string[] = [];
        if (invalidCount > 0) {
          caveats.push(`${invalidCount} 路信号测点无效，本次未参与判断`);
        }
        if (operations.length === 0) {
          caveats.push("窗口内没有任何操作记录，无法判断是否人为操作导致");
        }
        caveats.push("曲线按 2 秒一格聚合，比这更短的瞬时波动看不出来");

        return {
          ts: tsMs,
          fromMs: lo,
          toMs: hi,
          faultName,
          concurrentFaults: concurrent,
          signals,
          operations,
          events,
          summary: { headline, findings, context, caveats },
        };
      },
      () => super.getFreezeFrame(tsMs),
    );
  }

  /**
   * 一键体检。
   *
   * 八个分项各自独立计分，扣分都要说得出理由（前端逐项展开）：
   *   模块通讯 18 · 停机故障 20 · 警告故障 14 · 数据链路 8
   *   传感器 12 · 牵引对称性 10 · 温度余量 10 · 运行稳定性 8
   *
   * 两条与现场实际对齐的口径，也是这次重做的关键：
   *
   * 1. **未配备测点引发的常驻报警不扣分**。本机水路流量、泵箱油位、背压这几路
   *    根本没接线，读数恒定，于是系统里长年挂着二十多条"流量检测通道保护""泵箱
   *    油位低"。这些是测点缺失的表现，不是机器有病；照单扣分会让一台好机器永远
   *    六十分。这里把它们识别出来单列成"存疑报警"，让人知道系统没瞎，但不扣分。
   *
   * 2. **只做牵引电机的左右对称性**。采煤机左右两侧真正对称、可直接比大小的只有
   *    牵引部；截割左右滚筒割的煤不一样、水路右侧压力测点已坏，硬比出来的"关注"
   *    全是噪声。
   */
  async getHealthReport(): Promise<HealthReport> {
    const summaries = await this.getSensorSummaries();
    return this.withDb(
      (db) => {
        const now = Date.now();
        const items: Array<{
          key: string;
          name: string;
          status: "ok" | "attention" | "bad" | "skipped";
          score: number;
          maxScore: number;
          summary: string;
          details: string[];
        }> = [];

        const latestValue = (tag: string): number | null => {
          const row = db
            .prepare(`SELECT value FROM sensor_hyper WHERE std_tag = ? ORDER BY ts DESC LIMIT 1`)
            .get(tag) as { value: number } | undefined;
          return row ? row.value : null;
        };
        const distinctOf = (tag: string): number => {
          const row = db
            .prepare(`SELECT COUNT(DISTINCT value) AS c FROM sensor_hyper WHERE std_tag = ?`)
            .get(tag) as { c: number };
          return row?.c ?? 0;
        };

        // ---------------------------------------------------------- 模块通讯 18
        const conn = this.connectionFromDb(db);
        const modules = [
          { name: "HPC", ok: conn.hpc === "ok" },
          { name: "MOC", ok: conn.moc === "ok" },
          { name: "BOC", ok: conn.boc === "ok" },
          { name: "AXI", ok: conn.axi === "ok" },
          { name: "WCR", ok: conn.wcr === "ok" },
          { name: "SGC", ok: conn.sgc === "ok" },
          { name: "BP1", ok: conn.bp1 === "ok" },
          { name: "BP2", ok: conn.bp2 === "ok" },
        ];
        const offline = modules.filter((m) => !m.ok);
        items.push({
          key: "modules",
          name: "模块通讯",
          status: offline.length === 0 ? "ok" : "bad",
          score: Math.max(0, 18 - offline.length * 9),
          maxScore: 18,
          summary:
            offline.length === 0
              ? `${modules.length} 个模块全部在线`
              : `${offline.length} 个模块离线：${offline.map((m) => m.name).join("、")}`,
          details: offline.map((m) => `${m.name} 通讯中断，先查该模块供电与通讯线`),
        });

        // ------------------------------------------------ 激活故障（停机 20 / 警告 14）
        const activeFaults = (
          db
            .prepare(
              `SELECT fr.name, fr.type, fn.occur_ts FROM fault_normal fn
               JOIN fault_rule fr ON fr.fault_code = fn.fault_code
               WHERE fn.status = 1 AND fr.type IN (1, 2)
               ORDER BY fr.type DESC, fn.occur_ts DESC LIMIT 60`,
            )
            .all() as unknown as Array<{ name: string; type: number; occur_ts: number }>
        ).map((f) => ({ name: f.name, type: f.type, occurTs: f.occur_ts }));

        // 报警名关键词 → 触发它的测点。测点无效/未配备时，这条报警按"存疑"处理。
        const SUSPECT_RULES: Array<{ test: RegExp; tags: string[]; what: string }> = [
          {
            test: /流量检测通道|水.*流量|冷却水/,
            tags: ["left_water_flow1", "left_water_flow2", "right_water_flow1", "right_water_flow2"],
            what: "水路流量测点",
          },
          {
            test: /泵箱油位/,
            tags: ["left_pumpbox_oil_level", "right_pumpbox_oil_level"],
            what: "泵箱油位测点",
          },
          {
            test: /背压/,
            tags: ["left_back_pressure", "right_back_pressure"],
            what: "背压压力测点",
          },
          {
            test: /水.*压力/,
            tags: ["left_water_pressure", "right_water_pressure"],
            what: "水路压力测点",
          },
        ];
        // 故障码表里混着一批"配置状态"条目：参数组校验、启动顺序配置之类。
        // 它们是机器在陈述自己怎么配的，不是坏了，照故障扣分会冤枉一台好机器。
        const CONFIG_NOTICE_RE = /参数组未通过验证|配置为|已就绪|连接OK/;

        const deadTag = (tag: string) => distinctOf(tag) <= 1;
        const suspectFaults: Array<{ name: string; reason: string }> = [];
        const realFaults: typeof activeFaults = [];
        for (const fault of activeFaults) {
          const rule = SUSPECT_RULES.find((r) => r.test.test(fault.name));
          const dead = rule ? rule.tags.filter(deadTag) : [];
          if (rule && dead.length > 0) {
            suspectFaults.push({
              name: fault.name,
              reason: `${rule.what}读数恒定（${dead.length}/${rule.tags.length} 路无效），大概率是测点未接导致的常驻报警`,
            });
          } else if (CONFIG_NOTICE_RE.test(fault.name)) {
            suspectFaults.push({ name: fault.name, reason: "配置状态提示，不是设备故障" });
          } else {
            realFaults.push(fault);
          }
        }
        const stopFaults = realFaults.filter((f) => f.type === 2);
        const warnFaults = realFaults.filter((f) => f.type === 1);

        items.push({
          key: "stop-faults",
          name: "停机故障",
          status: stopFaults.length === 0 ? "ok" : "bad",
          score: Math.max(0, 20 - stopFaults.length * 7),
          maxScore: 20,
          summary:
            stopFaults.length === 0 ? "当前没有停机级故障" : `${stopFaults.length} 条停机级故障进行中`,
          details: stopFaults.slice(0, 6).map((f) => `${f.name}（${fmtTs(f.occurTs)}）`),
        });
        // 警告是"提醒"级别，条数多不等于机器要停；用分档，别一条条线性扣到见底
        const warnScore =
          warnFaults.length === 0
            ? 14
            : warnFaults.length === 1
              ? 11
              : warnFaults.length <= 3
                ? 9
                : warnFaults.length <= 8
                  ? 6
                  : 3;
        items.push({
          key: "warn-faults",
          name: "警告故障",
          status: warnFaults.length === 0 ? "ok" : "attention",
          score: warnScore,
          maxScore: 14,
          summary:
            warnFaults.length === 0
              ? suspectFaults.length > 0
                ? `没有需要处理的警告（另有 ${suspectFaults.length} 条存疑报警已排除）`
                : "当前没有警告级故障"
              : `${warnFaults.length} 条警告需要关注`,
          details: [
            ...warnFaults.slice(0, 6).map((f) => `${f.name}（${fmtTs(f.occurTs)}）`),
            ...(suspectFaults.length > 0
              ? [`另有 ${suspectFaults.length} 条报警来自未接测点，已单列不计分`]
              : []),
          ],
        });

        // ---------------------------------------------------------- 数据链路 8
        const latestTs = (
          db.prepare(`SELECT MAX(ts) AS ts FROM sensor_hyper`).get() as { ts: number | null }
        ).ts;
        const dataLagMs = latestTs === null ? null : now - latestTs;
        // 井下采集有抖动，几分钟的滞后属正常；半小时不动才说明采集真的停了
        const STALE_MS = 30 * 60_000;
        const linkScore =
          dataLagMs === null ? 0 : dataLagMs > STALE_MS ? 0 : dataLagMs > 5 * 60_000 ? 5 : 8;
        items.push({
          key: "link",
          name: "数据链路",
          status: linkScore === 8 ? "ok" : linkScore === 0 ? "bad" : "attention",
          score: linkScore,
          maxScore: 8,
          summary:
            dataLagMs === null
              ? "库内没有数据"
              : dataLagMs > STALE_MS
                ? `采集已停 ${fmtDuration(dataLagMs)}，当前看到的是历史数据`
                : dataLagMs > 5 * 60_000
                  ? `最新数据 ${fmtDuration(dataLagMs)}前，采集有滞后`
                  : `采集正常，最新数据 ${Math.round(dataLagMs / 1000)} 秒前`,
          details:
            dataLagMs !== null && dataLagMs > STALE_MS
              ? ["采集器或回放器没在跑，体检结论只反映最后一次采集时的状态"]
              : [],
        });

        // ------------------------------------------------------ 传感器有效性 12
        // 温度类哨兵（-40 / 200）本质是没接线，归"未配备"，不按失效扣分
        const sentinelTemp = (name: string): boolean => {
          const def = summaries.find((s) => s.name === name);
          return def?.type === "温度";
        };
        const notInstalled = summaries.filter((x) => x.state.includes("恒为0")).length;
        const invalidAll = summaries
          .filter((x) => !x.valid && !x.state.includes("恒为0"))
          .map((x) => ({ name: x.name, state: x.state }));
        const invalid = invalidAll.filter((x) => !sentinelTemp(x.name));
        const unwired = invalidAll.length - invalid.length;
        const equipped = Math.max(1, summaries.length - notInstalled - unwired);
        const invalidRate = invalid.length / equipped;
        // 数据一停，所有测点都会被判"读数过期"。那是链路的问题，已经在数据链路项扣过了，
        // 这里不能再按"传感器全坏"扣第二遍——直接跳过并说明。
        const staleData = dataLagMs !== null && dataLagMs > 5 * 60_000;
        items.push({
          key: "sensors",
          name: "传感器",
          status: staleData ? "skipped" : invalid.length === 0 ? "ok" : invalidRate > 0.15 ? "bad" : "attention",
          score: staleData ? 12 : Math.max(0, Math.round(12 * (1 - Math.min(1, invalidRate * 3)))),
          maxScore: 12,
          summary: staleData
            ? "数据已滞后，测点有效性判不了，本项跳过"
            : invalid.length === 0
              ? `已配备 ${equipped} 个测点全部有效`
              : `${invalid.length}/${equipped} 个已配备测点读数异常`,
          details: staleData
            ? ["采集恢复后重新体检才能看到测点有效性"]
            : [
                ...invalid.slice(0, 6).map((x) => `${x.name}：${x.state}`),
                ...(unwired > 0
                  ? [`另有 ${unwired} 个温度测点读到 -40/200 哨兵值，按未接线处理`]
                  : []),
                ...(notInstalled > 0 ? [`${notInstalled} 个测点全程为 0，本机未配备，不计分`] : []),
              ],
        });

        // ------------------------------------------------------ 牵引对称性 10
        // 只比牵引部：左右两侧同规格、同工况，差异才有诊断意义
        const PAIRS: Array<[string, string, string, string, number, boolean]> = [
          // [名称, 左tag, 右tag, 单位, 阈值, 是否按相对差]
          ["牵引电机温度", "left_haul_temp", "right_haul_temp", "℃", 20, false],
          ["牵引电机负荷", "left_haul_load_pct", "right_haul_load_pct", "%", 0.4, true],
          ["牵引电机电流", "left_haul_current_u", "right_haul_current_u", "A", 0.35, true],
          ["牵引变频器转矩", "left_inv_output_torque", "right_inv_output_torque", "%Te", 0.5, true],
        ];
        const avgStmt = db.prepare(
          `SELECT AVG(value) AS a FROM sensor_hyper WHERE std_tag = ? AND ts >= ?`,
        );
        const since = (latestTs ?? now) - 10 * 60_000;
        const symmetry = PAIRS.map(([item, lTag, rTag, unit, thr, rel]) => {
          const l = (avgStmt.get(lTag, since) as { a: number | null }).a;
          const r = (avgStmt.get(rTag, since) as { a: number | null }).a;
          // 任一侧读数恒定 = 该路没接，比不了
          const dead = distinctOf(lTag) <= 1 || distinctOf(rTag) <= 1;
          if (l === null || r === null || dead || isSentinel(unit, l) || isSentinel(unit, r)) {
            return {
              item,
              left: l ?? 0,
              right: r ?? 0,
              unit,
              diffText: "--",
              judge: "invalid" as const,
            };
          }
          const left = Number(l.toFixed(1));
          const right = Number(r.toFixed(1));
          const diff = Math.abs(left - right);
          const base = Math.max(Math.abs(left), Math.abs(right));
          const attention = rel ? base > 5 && diff / base > thr : diff > thr;
          const diffText = rel
            ? base > 5
              ? `${((diff / base) * 100).toFixed(0)}%`
              : "—"
            : `${diff.toFixed(1)}${unit}`;
          return {
            item,
            left,
            right,
            unit,
            diffText,
            judge: attention ? ("attention" as const) : ("normal" as const),
          };
        });
        const symAttention = symmetry.filter((x) => x.judge === "attention");
        const symUsable = symmetry.filter((x) => x.judge !== "invalid");
        items.push({
          key: "symmetry",
          name: "牵引对称性",
          status:
            symUsable.length === 0 ? "skipped" : symAttention.length === 0 ? "ok" : "attention",
          score: symUsable.length === 0 ? 10 : Math.max(0, 10 - symAttention.length * 5),
          maxScore: 10,
          summary:
            symUsable.length === 0
              ? "牵引部对称测点都不可用，本项跳过"
              : symAttention.length === 0
                ? `${symUsable.length} 项牵引对比都在正常区间`
                : `${symAttention.length} 项左右偏差偏大`,
          details: symAttention.map(
            (x) => `${x.item}：左 ${x.left}${x.unit} / 右 ${x.right}${x.unit}（差 ${x.diffText}）`,
          ),
        });

        // -------------------------------------------------------- 温度余量 10
        const TEMP_TAGS: Array<[string, string]> = [
          ["左截割电机", "left_cutter_temp"],
          ["右截割电机", "right_cutter_temp"],
          ["左牵引电机", "left_haul_temp"],
          ["右牵引电机", "right_haul_temp"],
          ["左泵电机", "left_pump_temp"],
          ["牵引变压器", "haul_xfmr_temp"],
        ];
        const temps = TEMP_TAGS.map(([name, tag]) => ({ name, value: latestValue(tag) })).filter(
          (t): t is { name: string; value: number } =>
            t.value !== null && !isSentinel("℃", t.value),
        );
        const hot = temps.filter((t) => t.value >= 110);
        const warm = temps.filter((t) => t.value >= 90 && t.value < 110);
        items.push({
          key: "thermal",
          name: "温度余量",
          status: hot.length > 0 ? "bad" : warm.length > 0 ? "attention" : "ok",
          score: Math.max(0, 10 - hot.length * 6 - warm.length * 3),
          maxScore: 10,
          summary:
            temps.length === 0
              ? "没有可用的温度测点"
              : hot.length > 0
                ? `${hot.length} 台设备温度超 110℃`
                : warm.length > 0
                  ? `${warm.length} 台设备温度超 90℃`
                  : `最高 ${Math.max(...temps.map((t) => t.value)).toFixed(1)}℃，距降额阈值有余量`,
          details: [...hot, ...warm].map((t) => `${t.name} ${t.value.toFixed(1)}℃`),
        });

        // ------------------------------------------------------ 运行稳定性 8
        // 主要电机在最近 2 小时里"起来又掉"的次数：偏高说明控制回路虚接或吸持不良
        const dropCount = (tag: string): number => {
          const rows = db
            .prepare(
              `SELECT state_code AS v FROM state_hyper WHERE std_tag = ? AND ts >= ? ORDER BY ts`,
            )
            .all(tag, (latestTs ?? now) - 2 * HOUR) as unknown as Array<{ v: number }>;
          let drops = 0;
          let prev = rows[0]?.v ?? 0;
          for (const row of rows) {
            if (prev === 1 && row.v === 0) {
              drops += 1;
            }
            prev = row.v;
          }
          return drops;
        };
        const drops = [
          { name: "泵电机", n: dropCount("pump_running") },
          { name: "左截割电机", n: dropCount("left_cutter_running") },
          { name: "右截割电机", n: dropCount("right_cutter_running") },
        ];
        // 一个班里正常割煤本来就要反复启停截割，阈值按"明显偏多"来定
        const maxDrop = Math.max(...drops.map((d) => d.n));
        items.push({
          key: "stability",
          name: "运行稳定性",
          status: maxDrop >= 15 ? "bad" : maxDrop >= 8 ? "attention" : "ok",
          score: maxDrop >= 15 ? 2 : maxDrop >= 8 ? 5 : 8,
          maxScore: 8,
          summary:
            maxDrop === 0
              ? "近 2 小时主要电机没有中途掉停"
              : maxDrop < 8
                ? `近 2 小时最多掉停 ${maxDrop} 次，属正常作业启停`
                : `近 2 小时最多掉停 ${maxDrop} 次，偏多`,
          details: drops
            .filter((d) => d.n > 0)
            .map((d) => `${d.name} 掉停 ${d.n} 次（正常停机操作也会计入）`),
        });

        const score = Math.max(0, Math.min(100, items.reduce((sum, item) => sum + item.score, 0)));
        const grade =
          score >= 90
            ? ("优" as const)
            : score >= 78
              ? ("良" as const)
              : score >= 60
                ? ("注意" as const)
                : ("异常" as const);

        return {
          scannedAt: now,
          score,
          grade,
          items,
          modules,
          sensors: {
            total: summaries.length,
            valid: summaries.filter((x) => x.valid).length,
            notInstalled: notInstalled + unwired,
            invalid,
          },
          activeFaults: realFaults,
          suspectFaults,
          symmetry,
          dataLagMs,
        };
      },
      () => super.getHealthReport(),
    );
  }

  /** 事件关联时间线：故障发生/消除 + 操作按下 + 关键电机启停，按时间归并。 */
  async getEventTimeline(fromMs: number, toMs: number): Promise<TimelineResponse> {
    return this.withDb(
      (db) => {
        type Ev = { ts: number; kind: "fault" | "clear" | "op" | "state"; text: string; tone: "stop" | "warn" | "ok" | "op" | "state" };
        const events: Ev[] = [];

        const faults = db
          .prepare(
            `SELECT fn.occur_ts, fn.clear_ts, fr.name, fr.type FROM fault_normal fn
             JOIN fault_rule fr ON fr.fault_code = fn.fault_code
             WHERE fr.type IN (1,2) AND fn.occur_ts BETWEEN ? AND ?
             ORDER BY fn.occur_ts DESC LIMIT 300`,
          )
          .all(fromMs, toMs) as unknown as Array<{ occur_ts: number; clear_ts: number | null; name: string; type: number }>;
        for (const f of faults) {
          events.push({ ts: f.occur_ts, kind: "fault", text: f.name, tone: f.type === 2 ? "stop" : "warn" });
          if (f.clear_ts !== null && f.clear_ts <= toMs) {
            events.push({ ts: f.clear_ts, kind: "clear", text: `${f.name}（消除）`, tone: "ok" });
          }
        }

        const ops = db
          .prepare(
            `SELECT occur_ts, source_name, op_name FROM device_action
             WHERE action = '按下' AND source_type = '输入' AND occur_ts BETWEEN ? AND ?
             ORDER BY occur_ts DESC LIMIT 300`,
          )
          .all(fromMs, toMs) as unknown as Array<{ occur_ts: number; source_name: string; op_name: string }>;
        for (const o of ops) {
          events.push({ ts: o.occur_ts, kind: "op", text: `${o.source_name} 按下「${o.op_name}」`, tone: "op" });
        }

        const STATE_TAGS: Array<[string, string]> = [
          ["left_cutter_running", "左截割电机"],
          ["right_cutter_running", "右截割电机"],
          ["pump_running", "泵电机"],
          ["haul_started", "牵引"],
        ];
        const stStmt = db.prepare(
          `SELECT ts, state_code AS v FROM state_hyper WHERE std_tag = ? AND ts BETWEEN ? AND ? ORDER BY ts`,
        );
        const seedStmt = db.prepare(
          `SELECT state_code AS v FROM state_hyper WHERE std_tag = ? AND ts < ? ORDER BY ts DESC LIMIT 1`,
        );
        for (const [tag, label] of STATE_TAGS) {
          let prev = (seedStmt.get(tag, fromMs) as { v: number } | undefined)?.v ?? 0;
          for (const r of stStmt.all(tag, fromMs, toMs) as unknown as Array<{ ts: number; v: number }>) {
            if (r.v !== prev) {
              events.push({ ts: r.ts, kind: "state", text: `${label}${r.v === 1 ? "启动" : "停止"}`, tone: "state" });
              prev = r.v;
            }
          }
        }

        events.sort((a, b) => b.ts - a.ts);
        return { fromMs, toMs, events: events.slice(0, 400) };
      },
      () => super.getEventTimeline(fromMs, toMs),
    );
  }

  /** 当前机况：与停机分析同一套判定（割煤/移机/停机），供主页状态胶囊 3s 轮询。 */
  async getMachineStatus() {
    return this.withDb(
      (db) => {
        const stateOf = (tag: string): number => {
          const row = db
            .prepare(`SELECT state_code AS v FROM state_hyper WHERE std_tag = ? ORDER BY ts DESC LIMIT 1`)
            .get(tag) as { v: number } | undefined;
          return row?.v ?? 0;
        };
        const speedRow = db
          .prepare(
            `SELECT value AS v, ts FROM sensor_hyper WHERE std_tag = 'left_speed_measured' ORDER BY ts DESC LIMIT 1`,
          )
          .get() as { v: number; ts: number } | undefined;

        // 数据流断了（>2 分钟无速度记录）视为离线
        if (!speedRow || Date.now() - speedRow.ts > 2 * 60_000) {
          return { state: "offline" as const, speedMmin: 0 };
        }

        const speedValid = speedRow.v >= 0 && speedRow.v < 600;
        const speed = speedValid ? Number(speedRow.v.toFixed(2)) : 0;
        const cutting = stateOf("left_cutter_running") === 1 || stateOf("right_cutter_running") === 1;
        if (cutting) {
          return { state: "cutting" as const, speedMmin: speed };
        }
        const moving = stateOf("haul_started") === 1 || speed >= 0.1;
        return { state: moving ? ("dispatch" as const) : ("stopped" as const), speedMmin: speed };
      },
      () => super.getMachineStatus(),
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

  // ------------------------------------------------- 调高证据（引导性诊断树数据侧）

  /**
   * 摇臂调高的三段证据。
   *
   * 诊断树顶部那几问（单边还是双侧 / 遥控器操作没反应 / 端头站能不能动）本质上是在问
   * "指令走到哪一段断了"，而这条链库里全程有记录：
   *
   *   指令段 device_action(source_type=输入)  人按了遥控器、端头站
   *     → 输出段 device_action(source_type=输出) 主控继电器真的输出了
   *       → 效果段 sensor_hyper(*_arm_height)   摇臂采高变了
   *
   * 三段的真值组合直接对应诊断树的分支，所以这里只算事实、给判定，不替人做决定。
   *
   * 关键口径：sensor_hyper 是**沿变 + 60s 快照**存储，指令窗口内查不到采高记录
   * 等于"值没变"，也就是摇臂没动——不是缺数据。
   */
  async getArmEvidence(windowMs: number): Promise<ArmEvidence> {
    return this.withDb(
      (db) => {
        const CHAIN_MATCH_MS = 2_000; // 输入按下后多久内出现主控输出算走通
        const MOTION_LEAD_MS = 1_000; // 指令前留一点，避开采样对齐误差
        const MOTION_WINDOW_MS = 8_000; // 指令后多久内的采高变化算这条指令引起的
        const MOVE_THRESHOLD_M = 0.02; // 摆角传感器精度 0.01m，取两个最小刻度
        const MIN_SAMPLE = 3; // 少于这个条数不下结论，只报样本不足

        // 时间基准取库内最新数据，回放/离线时窗口才不会落空
        const latest = db.prepare(`SELECT MAX(ts) AS ts FROM sensor_hyper`).get() as {
          ts: number | null;
        };
        const toMs = latest.ts ?? Date.now();
        const fromMs = toMs - windowMs;

        type ActionRow = {
          occur_ts: number;
          source_type: string;
          source_name: string;
          op_name: string;
          action: string;
        };
        type Point = { ts: number; value: number };

        const actionStmt = db.prepare(
          `SELECT occur_ts, source_type, source_name, op_name, action FROM device_action
           WHERE op_name IN (?, ?) AND action = '按下' ORDER BY occur_ts`,
        );
        const heightStmt = db.prepare(
          `SELECT ts, value FROM sensor_hyper WHERE std_tag = ? ORDER BY ts`,
        );
        const distinctStmt = db.prepare(
          `SELECT COUNT(DISTINCT value) AS c, MIN(value) AS lo, MAX(value) AS hi
           FROM sensor_hyper WHERE std_tag = ?`,
        );

        // 采高序列内 [ts-lead, ts+window] 的波动幅度；无记录 = 没变 = 没动
        const deltaAt = (points: Point[], ts: number): number => {
          const lo = ts - MOTION_LEAD_MS;
          const hi = ts + MOTION_WINDOW_MS;
          let start = 0;
          let end = points.length;
          while (start < end) {
            const mid = (start + end) >> 1;
            if (points[mid].ts < lo) {
              start = mid + 1;
            } else {
              end = mid;
            }
          }
          let min = Number.POSITIVE_INFINITY;
          let max = Number.NEGATIVE_INFINITY;
          for (let i = start; i < points.length && points[i].ts <= hi; i += 1) {
            min = Math.min(min, points[i].value);
            max = Math.max(max, points[i].value);
          }
          return max === Number.NEGATIVE_INFINITY ? 0 : max - min;
        };

        const median = (values: number[]): number | null => {
          if (values.length === 0) {
            return null;
          }
          const sorted = [...values].sort((a, b) => a - b);
          return sorted[Math.floor(sorted.length / 2)];
        };
        const pct = (part: number, total: number): number | null =>
          total === 0 ? null : Math.round((part / total) * 1000) / 10;
        const round2 = (v: number | null): number | null =>
          v === null ? null : Math.round(v * 100) / 100;

        // 输出指令的"动作命中率 + 单次位移中位数"，窗口与全库基线共用一套算法
        const motionStats = (cmds: ActionRow[], points: Point[]) => {
          const deltas: number[] = [];
          let moved = 0;
          for (const cmd of cmds) {
            const delta = deltaAt(points, cmd.occur_ts);
            if (delta >= MOVE_THRESHOLD_M) {
              moved += 1;
              deltas.push(delta);
            }
          }
          return { moved, movedRatePct: pct(moved, cmds.length), medianDeltaM: median(deltas) };
        };

        const SIDES = [
          { side: "left" as const, label: "左摇臂", ops: ["左升", "左降"], tag: "left_arm_height" },
          {
            side: "right" as const,
            label: "右摇臂",
            ops: ["右升", "右降"],
            tag: "right_arm_height",
          },
        ];

        const sides = SIDES.map((cfg) => {
          const actions = actionStmt.all(cfg.ops[0], cfg.ops[1]) as unknown as ActionRow[];
          const points = heightStmt.all(cfg.tag) as unknown as Point[];
          const heightInfo = distinctStmt.get(cfg.tag) as { c: number; lo: number; hi: number };
          const heightValid = (heightInfo?.c ?? 0) > 2;

          const inWindow = (row: ActionRow) => row.occur_ts >= fromMs && row.occur_ts <= toMs;
          const inputsAll = actions.filter((row) => row.source_type === "输入");
          const outputsAll = actions.filter((row) => row.source_type === "输出");
          const inputs = inputsAll.filter(inWindow);
          const outputs = outputsAll.filter(inWindow);

          // 指令段 → 输出段：每条输入按下后 2s 内是否有主控输出
          const outputTs = outputsAll.map((row) => row.occur_ts);
          const hasOutputNear = (ts: number): boolean => {
            let start = 0;
            let end = outputTs.length;
            while (start < end) {
              const mid = (start + end) >> 1;
              if (outputTs[mid] < ts - 200) {
                start = mid + 1;
              } else {
                end = mid;
              }
            }
            return start < outputTs.length && outputTs[start] <= ts + CHAIN_MATCH_MS;
          };
          const matchedCount = inputs.filter((row) => hasOutputNear(row.occur_ts)).length;
          const matchedRatePct = pct(matchedCount, inputs.length);

          // 输出段 → 效果段
          const windowMotion = motionStats(outputs, points);
          const baseMotion = motionStats(outputsAll, points);

          // 按操作来源拆开：端头站、遥控器、自动截割各自能不能把摇臂带动
          const bySource = new Map<string, { count: number; movedCount: number; lastTs: number }>();
          for (const row of inputs) {
            const prev = bySource.get(row.source_name) ?? { count: 0, movedCount: 0, lastTs: 0 };
            prev.count += 1;
            prev.lastTs = Math.max(prev.lastTs, row.occur_ts);
            if (deltaAt(points, row.occur_ts) >= MOVE_THRESHOLD_M) {
              prev.movedCount += 1;
            }
            bySource.set(row.source_name, prev);
          }

          // 判定门槛跟着本机自己的基线走：正常机器也有大量点动指令不产生明显位移
          const motionFloor = Math.max(15, (baseMotion.movedRatePct ?? 40) * 0.4);
          let verdict: ArmEvidenceVerdict;
          let verdictText: string;
          if (!heightValid) {
            verdict = "sensor-invalid";
            verdictText = `${cfg.label}采高测点无效，效果段判不了，请现场实测。`;
          } else if (inputs.length < MIN_SAMPLE && outputs.length < MIN_SAMPLE) {
            verdict = "no-command";
            verdictText = `窗口内${cfg.label}升降指令不足 ${MIN_SAMPLE} 条，数据判不了，请现场实操后再看。`;
          } else if (
            inputs.length >= MIN_SAMPLE &&
            matchedRatePct !== null &&
            matchedRatePct < 50
          ) {
            verdict = "chain-broken";
            verdictText = `${cfg.label}：${inputs.length} 条操作只有 ${matchedCount} 条走到主控输出，指令链在遥控器/接收模块/主控这一段。`;
          } else if (
            outputs.length >= MIN_SAMPLE &&
            windowMotion.movedRatePct !== null &&
            windowMotion.movedRatePct < motionFloor
          ) {
            verdict = "no-motion";
            verdictText = `${cfg.label}：主控已输出 ${outputs.length} 次，采高只动了 ${windowMotion.moved} 次，问题在输出继电器之后（线路/电磁阀/阀组/液力锁/油缸）。`;
          } else {
            verdict = "ok";
            verdictText = `${cfg.label}：${outputs.length} 次输出带动 ${windowMotion.moved} 次采高变化，三段都通。`;
          }

          const efficiencyPct =
            windowMotion.medianDeltaM !== null &&
            baseMotion.medianDeltaM !== null &&
            baseMotion.medianDeltaM > 0
              ? Math.round((windowMotion.medianDeltaM / baseMotion.medianDeltaM) * 100)
              : null;

          return {
            side: cfg.side,
            label: cfg.label,
            inputCount: inputs.length,
            outputCount: outputs.length,
            matchedCount,
            matchedRatePct,
            movedCount: windowMotion.moved,
            movedRatePct: windowMotion.movedRatePct,
            medianDeltaM: round2(windowMotion.medianDeltaM),
            heightValid,
            verdict,
            verdictText,
            sources: [...bySource.entries()]
              .map(([source, v]) => ({
                source,
                count: v.count,
                movedCount: v.movedCount,
                lastTs: v.lastTs === 0 ? null : v.lastTs,
              }))
              .sort((a, b) => b.count - a.count),
            baselineMovedRatePct: baseMotion.movedRatePct,
            baselineMedianDeltaM: round2(baseMotion.medianDeltaM),
            efficiencyPct,
          };
        });

        // q01「单边还是双侧」的数据答案
        const broken = sides.filter(
          (s) => s.verdict === "no-motion" || s.verdict === "chain-broken",
        );
        const sideVerdict =
          broken.length === 2
            ? ("both" as const)
            : broken.length === 1
              ? broken[0].side
              : sides.length > 0 && sides.every((s) => s.verdict === "ok")
                ? ("none" as const)
                : ("unknown" as const);
        const sideVerdictText =
          sideVerdict === "both"
            ? "左右摇臂都没跟上指令，数据倾向「双侧」。"
            : sideVerdict === "left"
              ? "只有左摇臂没跟上指令，数据倾向「单边」（左）。"
              : sideVerdict === "right"
                ? "只有右摇臂没跟上指令，数据倾向「单边」（右）。"
                : sideVerdict === "none"
                  ? "窗口内左右摇臂都能跟上指令，数据没看到调高异常。"
                  : "窗口内升降指令太少，数据给不出单边/双侧，请按现场实操作答。";

        // 与调高链路相关的模块通讯（诊断树里点名的那几个）
        const conn = this.connectionFromDb(db);
        const stateOf = (tag: string): number | null => {
          const row = db
            .prepare(`SELECT state_code FROM state_hyper WHERE std_tag = ? ORDER BY id DESC LIMIT 1`)
            .get(tag) as { state_code: number } | undefined;
          return row ? row.state_code : null;
        };
        const eioOk = stateOf("eio_comm_ok") === 1;
        const modules = [
          { name: "BOC 主控", ok: conn.boc === "ok", note: "升降继电器输出" },
          { name: "SGC", ok: conn.sgc === "ok", note: "PVD 比例阀 485 中转" },
          { name: "EIO", ok: eioOk, note: "大煤机总阀扩展" },
          { name: "MOC", ok: conn.moc === "ok", note: "操作台" },
          { name: "HPC", ok: conn.hpc === "ok", note: "泵站" },
        ];

        // 泵电机（诊断树的前置条件"泵电机启动后"）
        const pumpRunning = stateOf("pump_running") === 1;
        const pumpContactor = stateOf("pump_contactor_on") === 1;
        const pumpChange = db
          .prepare(
            `SELECT ts FROM state_hyper WHERE std_tag = 'pump_running' ORDER BY id DESC LIMIT 1`,
          )
          .get() as { ts: number } | undefined;

        // 机型收敛：只用敢确定的两条（泵数、采高档次），阀型交给人对图纸
        const pumpCurrent = (tag: string): number =>
          (
            db.prepare(`SELECT COUNT(*) AS c FROM sensor_hyper WHERE std_tag = ? AND value > 1`).get(
              tag,
            ) as { c: number }
          ).c;
        const leftPumpLoaded = pumpCurrent("left_pump_current_u");
        const rightPumpLoaded = pumpCurrent("right_pump_current_u");
        const doublePump = leftPumpLoaded >= 100 && rightPumpLoaded >= 100;
        const heightRange = [
          distinctStmt.get("left_arm_height") as { c: number; lo: number; hi: number },
          distinctStmt.get("right_arm_height") as { c: number; lo: number; hi: number },
        ];
        const maxHeight = Math.max(heightRange[0]?.hi ?? 0, heightRange[1]?.hi ?? 0);
        const bigMachine = maxHeight >= 3.5;
        const pumpReason = doublePump
          ? `左右泵电机各有 ${leftPumpLoaded} / ${rightPumpLoaded} 条带载电流记录，判为双泵`
          : `只有一侧泵电机有带载电流记录（左 ${leftPumpLoaded} / 右 ${rightPumpLoaded}），判为单泵`;
        const heightReason = `库内最大采高 ${maxHeight.toFixed(2)} m`;
        const candidates = doublePump
          ? [
              { moduleId: "double_prop", name: "双泵比例阀煤机", reasons: [pumpReason] },
              { moduleId: "double_normal", name: "双泵普通阀煤机", reasons: [pumpReason] },
            ]
          : bigMachine
            ? [
                {
                  moduleId: "single_prop_large",
                  name: "单泵比例阀大煤机",
                  reasons: [pumpReason, heightReason],
                },
                {
                  moduleId: "single_normal_large",
                  name: "单泵普通阀大煤机",
                  reasons: [pumpReason, heightReason],
                },
              ]
            : [
                {
                  moduleId: "single_prop_small",
                  name: "单泵比例阀小煤机",
                  reasons: [pumpReason, heightReason],
                },
                {
                  moduleId: "single_normal_small",
                  name: "单泵普通阀小煤机",
                  reasons: [pumpReason, heightReason],
                },
              ];

        // 诊断树问到、本机确实没有测点的项：写明请现场实测，不拿别的数糊弄
        const constantOrMissing = (tag: string): { c: number; lo: number; hi: number } | null => {
          const row = distinctStmt.get(tag) as { c: number; lo: number; hi: number } | undefined;
          return row && row.c > 0 ? row : null;
        };
        const unavailable: Array<{ topic: string; reason: string }> = [
          {
            topic: "调高低压 2.5MPa",
            reason: "共享内存定义里没有调高系统低压测点，只能看现场压力表。",
          },
          {
            topic: "调高高压 18MPa",
            reason: "共享内存定义里没有调高系统高压测点，只能看现场压力表。",
          },
          {
            topic: "端子 DC24V / AC26V、继电器触点",
            reason: "端子级电压没有采集点，必须万用表实测。",
          },
          {
            topic: "手动比例阀 / 手动换向阀 / 总阀阀杆",
            reason: "手动阀与阀杆动作没有传感器，靠现场观察。",
          },
        ];
        const leftFlow = constantOrMissing("left_arm_flow");
        const rightFlow = constantOrMissing("right_arm_flow");
        if ((leftFlow?.c ?? 0) <= 1 || (rightFlow?.c ?? 0) <= 1) {
          unavailable.push({
            topic: "摇臂流量",
            reason: "左摇臂流量恒为 0、右摇臂流量与摇臂油位同源，判为无效，不作为证据。",
          });
        }
        const pumpBoxLevel = constantOrMissing("left_pumpbox_oil_level");
        if ((pumpBoxLevel?.c ?? 0) <= 1) {
          unavailable.push({
            topic: "泵箱油位",
            reason: `泵箱油位恒为 ${(pumpBoxLevel?.hi ?? 0).toFixed(1)} cm，反映不了实际油量，请开盖查看。`,
          });
        }

        return {
          fromMs,
          toMs,
          windowLabel: `${fmtTs(fromMs)} ~ ${fmtTs(toMs)}`,
          pump: {
            running: pumpRunning,
            contactorOn: pumpContactor,
            lastChangeTs: pumpChange?.ts ?? null,
            text: pumpRunning
              ? "泵电机运行中，满足诊断树「泵电机启动后」的前置条件。"
              : pumpContactor
                ? "泵接触器已吸合但泵未运行，先确认泵电机本身。"
                : "泵电机未运行，诊断树的前置条件不成立，先启泵。",
          },
          sides,
          sideVerdict,
          sideVerdictText,
          modules,
          profile: {
            candidates,
            facts: [
              { label: "左泵带载记录", value: `${leftPumpLoaded} 条` },
              { label: "右泵带载记录", value: `${rightPumpLoaded} 条` },
              { label: "最大采高", value: `${maxHeight.toFixed(2)} m` },
              { label: "SGC 通讯", value: conn.sgc === "ok" ? "在线" : "离线" },
              { label: "EIO 通讯", value: eioOk ? "在线" : "离线" },
            ],
          },
          unavailable,
        };
      },
      () => super.getArmEvidence(windowMs),
    );
  }

  // ------------------------------------------- 牵引证据（系统牵引故障诊断树数据侧）

  /**
   * 系统牵引的数据旁证。
   *
   * 牵引树问的东西比调高树更"电气"，但恰好大半在共享内存里有对应状态位：
   * HPC 通讯、牵电状态、牵启状态、向左/向右、松闸指令/确认/状态、各类锁定位。
   * 树里问"屏幕上 XX 是不是绿色"，这里直接把那一位的当前值摆出来。
   *
   * 另外两件树里明确要人去翻的事，库里也有：
   *   · r08「查看减速指令来源」、r09「查看牵停信号来源」→ device_action 按 source_name 分组
   *   · q09「变频器是否报故障」→ 实时故障流里的牵引/变频器条目
   *
   * 松闸确认位单独做了交叉校验：本机 brake_release_ack 长期为 0，但变频器在正常
   * 输出、实测速度也在变——这种情况判"该位无效"，绝不能反过来报制动回路故障。
   */
  async getTractionEvidence(windowMs: number): Promise<TractionEvidence> {
    return this.withDb(
      (db) => {
        const CHAIN_MATCH_MS = 2_000;
        const MOTION_LEAD_MS = 1_000;
        const MOTION_WINDOW_MS = 8_000;
        const MOVE_THRESHOLD_MMIN = 0.1; // 实测速度动起来的阈值
        const MIN_SAMPLE = 3;

        const latest = db.prepare(`SELECT MAX(ts) AS ts FROM sensor_hyper`).get() as {
          ts: number | null;
        };
        const toMs = latest.ts ?? Date.now();
        const fromMs = toMs - windowMs;

        const stateOf = (tag: string): number | null => {
          const row = db
            .prepare(`SELECT state_code FROM state_hyper WHERE std_tag = ? ORDER BY id DESC LIMIT 1`)
            .get(tag) as { state_code: number } | undefined;
          return row ? row.state_code : null;
        };
        const latestValue = (tag: string): number | null => {
          const row = db
            .prepare(`SELECT value FROM sensor_hyper WHERE std_tag = ? ORDER BY ts DESC LIMIT 1`)
            .get(tag) as { value: number } | undefined;
          return row ? row.value : null;
        };
        // 全程一个值的测点当没有：本机不少通道没接线，读数恒定
        const isConstant = (tag: string): boolean => {
          const row = db
            .prepare(`SELECT COUNT(DISTINCT value) AS c FROM sensor_hyper WHERE std_tag = ?`)
            .get(tag) as { c: number };
          return (row?.c ?? 0) <= 1;
        };
        const round1 = (v: number | null): number | null =>
          v === null ? null : Math.round(v * 10) / 10;

        // ---- 系统状态板：树里"屏幕上 XX 是不是绿色"那一类问题的直接答案
        const conn = this.connectionFromDb(db);
        const haulPowered = stateOf("haul_powered");
        const haulStarted = stateOf("haul_started");
        const pumpRunning = stateOf("pump_running");
        const pumpBlocked = stateOf("haul_not_ready_pump_blocked");
        const movingLeft = stateOf("moving_left");
        const movingRight = stateOf("moving_right");
        const haulStopLocked = stateOf("haul_stop_locked_reset");
        const estopLocked = stateOf("estop_locked_reset");
        const errorLocked = stateOf("error_locked_reset");
        const resetKey = stateOf("haul_reset_key_pressed");
        const bit = (v: number | null): boolean | null => (v === null ? null : v === 1);
        const yesNo = (v: number | null, yes: string, no: string) =>
          v === null ? "读不到" : v === 1 ? yes : no;

        const states = [
          {
            label: "HPC 通讯",
            value: conn.hpc === "ok" ? "绿色（正常）" : "红色（中断）",
            ok: conn.hpc === "ok",
          },
          {
            label: "牵电状态",
            value: yesNo(haulPowered, "绿色（已送电）", "红色（未送电）"),
            ok: bit(haulPowered),
          },
          { label: "牵启状态", value: yesNo(haulStarted, "已牵启", "未牵启"), ok: bit(haulStarted) },
          { label: "泵电机", value: yesNo(pumpRunning, "运行中", "未运行"), ok: bit(pumpRunning) },
          {
            label: "泵闭锁牵引",
            value: yesNo(pumpBlocked, "牵引被泵电机闭锁", "无闭锁"),
            ok: pumpBlocked === null ? null : pumpBlocked === 0,
          },
          {
            label: "牵引方向",
            value:
              movingLeft === 1 ? "向左" : movingRight === 1 ? "向右" : "未设定方向",
            ok: movingLeft === 1 || movingRight === 1,
          },
          {
            label: "牵停锁定",
            value: yesNo(haulStopLocked, "已锁定，需复位", "无"),
            ok: haulStopLocked === null ? null : haulStopLocked === 0,
          },
          {
            label: "急停锁定",
            value: yesNo(estopLocked, "已锁定，需复位", "无"),
            ok: estopLocked === null ? null : estopLocked === 0,
          },
          {
            label: "错误锁定",
            value: yesNo(errorLocked, "已锁定，需复位", "无"),
            ok: errorLocked === null ? null : errorLocked === 0,
          },
          {
            label: "牵引复位按键",
            value: yesNo(resetKey, "按下中（卡死会导致接触器不吸合）", "松开"),
            ok: resetKey === null ? null : resetKey === 0,
          },
        ];

        // ---- 三段链：牵引指令 → 主控输出 → 实测速度
        type ActionRow = {
          occur_ts: number;
          source_type: string;
          source_name: string;
          op_name: string;
        };
        const HAUL_OPS = ["牵启", "加速", "减速", "向左", "向右"];
        const placeholders = HAUL_OPS.map(() => "?").join(",");
        const actions = db
          .prepare(
            `SELECT occur_ts, source_type, source_name, op_name FROM device_action
             WHERE action = '按下' AND op_name IN (${placeholders}) ORDER BY occur_ts`,
          )
          .all(...HAUL_OPS) as unknown as ActionRow[];

        const speedTag = isConstant("left_speed_measured")
          ? "right_speed_measured"
          : "left_speed_measured";
        const speedValid = !isConstant(speedTag);
        const speedRows = db
          .prepare(`SELECT ts, value FROM sensor_hyper WHERE std_tag = ? ORDER BY ts`)
          .all(speedTag) as unknown as Array<{ ts: number; value: number }>;

        // 指令后 8s 内速度绝对值的最大值（沿变存储：窗口内无记录 = 速度没变）
        const speedSwingAt = (ts: number): number => {
          const lo = ts - MOTION_LEAD_MS;
          const hi = ts + MOTION_WINDOW_MS;
          let start = 0;
          let end = speedRows.length;
          while (start < end) {
            const mid = (start + end) >> 1;
            if (speedRows[mid].ts < lo) {
              start = mid + 1;
            } else {
              end = mid;
            }
          }
          let min = Number.POSITIVE_INFINITY;
          let max = Number.NEGATIVE_INFINITY;
          for (let i = start; i < speedRows.length && speedRows[i].ts <= hi; i += 1) {
            min = Math.min(min, speedRows[i].value);
            max = Math.max(max, speedRows[i].value);
          }
          return max === Number.NEGATIVE_INFINITY ? 0 : max - min;
        };

        const inWindow = (row: ActionRow) => row.occur_ts >= fromMs && row.occur_ts <= toMs;
        const inputs = actions.filter((row) => row.source_type === "输入" && inWindow(row));
        const outputsAll = actions.filter((row) => row.source_type === "输出");
        const outputs = outputsAll.filter(inWindow);
        const outputTs = outputsAll.map((row) => row.occur_ts);
        const hasOutputNear = (ts: number): boolean => {
          let start = 0;
          let end = outputTs.length;
          while (start < end) {
            const mid = (start + end) >> 1;
            if (outputTs[mid] < ts - 200) {
              start = mid + 1;
            } else {
              end = mid;
            }
          }
          return start < outputTs.length && outputTs[start] <= ts + CHAIN_MATCH_MS;
        };
        const matchedCount = inputs.filter((row) => hasOutputNear(row.occur_ts)).length;
        const movedCount = outputs.filter(
          (row) => speedSwingAt(row.occur_ts) >= MOVE_THRESHOLD_MMIN,
        ).length;
        const pct = (part: number, total: number): number | null =>
          total === 0 ? null : Math.round((part / total) * 1000) / 10;
        const matchedRatePct = pct(matchedCount, inputs.length);
        const movedRatePct = pct(movedCount, outputs.length);
        const windowSpeeds = speedRows.filter((row) => row.ts >= fromMs && row.ts <= toMs);
        const maxSpeedMmin =
          windowSpeeds.length === 0
            ? null
            : round1(Math.max(...windowSpeeds.map((row) => Math.abs(row.value))));

        let verdict: ArmEvidenceVerdict;
        let verdictText: string;
        if (!speedValid) {
          verdict = "sensor-invalid";
          verdictText = "实测速度测点无效，效果段判不了，请看屏幕与现场。";
        } else if (inputs.length < MIN_SAMPLE && outputs.length < MIN_SAMPLE) {
          verdict = "no-command";
          verdictText = `窗口内牵引类操作不足 ${MIN_SAMPLE} 条，数据判不了，请现场实操后再看。`;
        } else if (inputs.length >= MIN_SAMPLE && matchedRatePct !== null && matchedRatePct < 50) {
          verdict = "chain-broken";
          verdictText = `${inputs.length} 条牵引操作只有 ${matchedCount} 条走到主控输出，指令链断在按钮/遥控器到 BOC 这一段。`;
        } else if (outputs.length >= MIN_SAMPLE && movedRatePct !== null && movedRatePct < 15) {
          verdict = "no-motion";
          verdictText = `主控已输出 ${outputs.length} 次牵引指令，实测速度基本没动，问题在变频器或牵引传动侧。`;
        } else {
          verdict = "ok";
          verdictText = `${outputs.length} 次牵引输出带动 ${movedCount} 次速度变化，窗口内最高 ${maxSpeedMmin ?? 0} m/min，三段都通。`;
        }

        // ---- 指令来源分布：树里 r08/r09 明确要人去"按键功能测试"里查的东西
        const SOURCE_OPS = ["牵停", "减速", "牵启", "加速"];
        const sourceRows = db
          .prepare(
            `SELECT occur_ts, source_name, op_name FROM device_action
             WHERE action = '按下' AND source_type = '输入'
               AND op_name IN (?, ?, ?, ?) AND occur_ts BETWEEN ? AND ?
             ORDER BY occur_ts`,
          )
          .all(SOURCE_OPS[0], SOURCE_OPS[1], SOURCE_OPS[2], SOURCE_OPS[3], fromMs, toMs) as unknown as Array<{
          occur_ts: number;
          source_name: string;
          op_name: string;
        }>;
        const commandSources = SOURCE_OPS.map((op) => {
          const rows = sourceRows.filter((row) => row.op_name === op);
          const grouped = new Map<string, { count: number; lastTs: number }>();
          for (const row of rows) {
            const prev = grouped.get(row.source_name) ?? { count: 0, lastTs: 0 };
            prev.count += 1;
            prev.lastTs = Math.max(prev.lastTs, row.occur_ts);
            grouped.set(row.source_name, prev);
          }
          return {
            op,
            totalCount: rows.length,
            sources: [...grouped.entries()]
              .map(([source, v]) => ({ source, count: v.count, lastTs: v.lastTs || null }))
              .sort((a, b) => b.count - a.count),
          };
        });

        // ---- 变频器现状
        const inverterOf = (
          name: string,
          prefix: string,
          runTags: { fwd: string; rev: string; fault: string } | null,
        ) => {
          const tags = {
            bus: `${prefix}_inv_bus_voltage`,
            freq: `${prefix}_inv_output_freq`,
            torque: `${prefix}_inv_output_torque`,
            igbt: `${prefix}_inv_igbt_temp`,
          };
          const invalidTags: string[] = [];
          const read = (tag: string, label: string): number | null => {
            if (isConstant(tag)) {
              invalidTags.push(label);
              return null;
            }
            return round1(latestValue(tag));
          };
          return {
            name,
            busVoltageV: read(tags.bus, "母线电压"),
            outputFreqHz: read(tags.freq, "输出频率"),
            outputTorquePct: read(tags.torque, "输出转矩"),
            igbtTemp: read(tags.igbt, "IGBT 温度"),
            running:
              runTags === null
                ? null
                : stateOf(runTags.fwd) === 1 || stateOf(runTags.rev) === 1,
            extFault: runTags === null ? null : bit(stateOf(runTags.fault)),
            invalidTags,
          };
        };
        const inverters = [
          inverterOf("左变频器（主）", "left", {
            fwd: "left_inv_fwd_run",
            rev: "left_inv_rev_run",
            fault: "left_inv_ext_fault",
          }),
          inverterOf("右变频器（从）", "right", null),
        ];

        // ---- 松闸链 + 交叉校验
        const brakeCmd = stateOf("brake_release_cmd");
        const brakeAck = stateOf("brake_release_ack");
        const brakeReleased = stateOf("brake_released");
        const inverterRunning = inverters[0].running === true;
        const machineMoving = (maxSpeedMmin ?? 0) >= MOVE_THRESHOLD_MMIN;
        // 位说"没松闸"，机器却在正常牵引 —— 那是位没接，不是制动器坏
        const brakeContradiction = brakeAck !== 1 && (inverterRunning || machineMoving);
        const brakeTrustworthy = !brakeContradiction;
        const brake = {
          cmd: bit(brakeCmd),
          ack: bit(brakeAck),
          released: bit(brakeReleased),
          trustworthy: brakeTrustworthy,
          text: brakeContradiction
            ? `松闸确认位读到 ${brakeAck ?? "空"}，但同期变频器在输出、实测速度最高 ${maxSpeedMmin ?? 0} m/min——本机这一位判为未接/无效，不作为制动回路的证据。`
            : brakeAck === 1
              ? "松闸指令与松闸确认都到位，制动器已打开。"
              : brakeCmd === 1
                ? "有松闸指令但没收到松闸确认，检查制动电磁阀、压力继电器 1/3 触点到 HPCJX3.4 的回路（超 2 秒会报 ACS880 71A3 / ACS800 FF74）。"
                : "当前没有松闸指令，牵引未启动时属正常。",
        };

        // ---- 牵引相关的激活故障（对应 q09/q15/q16）
        const activeFaults = (
          db
            .prepare(
              `SELECT fr.name, fr.type, fn.occur_ts FROM fault_normal fn
               JOIN fault_rule fr ON fr.fault_code = fn.fault_code
               WHERE fn.status = 1 AND fr.type IN (1, 2)
                 AND (fr.name LIKE '%牵引%' OR fr.name LIKE '%牵变%' OR fr.name LIKE '%变频器%'
                      OR fr.name LIKE '%漏电%' OR fr.name LIKE '%电压%' OR fr.name LIKE '%松闸%')
               ORDER BY fr.type DESC, fn.occur_ts DESC LIMIT 20`,
            )
            .all() as unknown as Array<{ name: string; type: number; occur_ts: number }>
        ).map((row) => ({ name: row.name, type: row.type, occurTs: row.occur_ts }));

        // ---- 左右负荷对称（主从同步是否跑偏）
        const loadBalance: Array<{
          label: string;
          left: number;
          right: number;
          unit: string;
        }> = [];
        const pushBalance = (label: string, leftTag: string, rightTag: string, unit: string) => {
          if (isConstant(leftTag) || isConstant(rightTag)) {
            return;
          }
          const left = round1(latestValue(leftTag));
          const right = round1(latestValue(rightTag));
          // 哨兵值（温度 -40/200 = 未接）不能拿来比对称，否则一侧永远"异常"
          if (
            left === null ||
            right === null ||
            isSentinel(unit, left) ||
            isSentinel(unit, right)
          ) {
            return;
          }
          loadBalance.push({ label, left, right, unit });
        };
        pushBalance("牵引电机负荷", "left_haul_load_pct", "right_haul_load_pct", "%");
        pushBalance("变频器输出转矩", "left_inv_output_torque", "right_inv_output_torque", "%Te");
        pushBalance("牵引箱温度", "left_haulbox_temp", "right_haulbox_temp", "℃");

        // ---- 树里问到、本机没有测点的项
        const unavailable = [
          {
            topic: "牵引接触器吸合",
            reason:
              "本机只有截割/泵/破碎三路接触器状态位，牵引接触器没有独立反馈位；可用变频器母线电压是否建立当旁证。",
          },
          {
            topic: "端子 24V / 控制变压器 220V·380V",
            reason: "端子级电压没有采集点，必须万用表实测。",
          },
          { topic: "牵引电机与电缆绝缘", reason: "摇表数据不进系统，必须现场摇测（摇前断开变频器）。" },
          {
            topic: "变频器 LOC/REM、操作键盘显示",
            reason: "变频器面板状态不回传，只能到变频器观察窗口看。",
          },
          { topic: "HPC 前端指示灯", reason: "模块指示灯不进数据，需要打开电控腔看。" },
        ];
        if (isConstant("left_haul_current_u")) {
          unavailable.push({
            topic: "牵引电机三相电流",
            reason: "左右牵引电流通道读数恒为 0，判为未接，改看牵引负荷百分比。",
          });
        }

        return {
          fromMs,
          toMs,
          windowLabel: `${fmtTs(fromMs)} ~ ${fmtTs(toMs)}`,
          states,
          chain: {
            inputCount: inputs.length,
            outputCount: outputs.length,
            matchedCount,
            matchedRatePct,
            movedCount,
            movedRatePct,
            maxSpeedMmin,
            speedValid,
            verdict,
            verdictText,
          },
          commandSources,
          inverters,
          brake,
          activeFaults,
          loadBalance,
          unavailable,
        };
      },
      () => super.getTractionEvidence(windowMs),
    );
  }

  // ------------------------------------------- 电机启停证据（电机启停树数据侧）

  /**
   * 泵 / 左右截割 / 破碎四台电机的启动链。
   *
   * 这棵树和数据的对应关系是四棵里最直的：诊断树一路问"有没有启动提示 → 电机起没起
   * → 能不能持续运转 → 是不是漏电 → 接触器吸没吸合"，而共享内存里每台电机恰好就是
   * 这五个状态位：
   *
   *   启动预警 → 启动过程中 → 接触器吸合 → 运行中，外加漏电闭锁
   *
   * 所以这里给的是"链断在第几环"，外加树里另一处要人去翻的东西：停止信号来自哪个
   * 操作台（`device_action` 输入侧按 source_name 分组）。
   *
   * 五位全程为 0 的电机（本机的破碎机）判为未配备，明说数据帮不上忙，不硬给结论。
   */
  async getMotorEvidence(windowMs: number): Promise<MotorEvidence> {
    return this.withDb(
      (db) => {
        const latest = db.prepare(`SELECT MAX(ts) AS ts FROM sensor_hyper`).get() as {
          ts: number | null;
        };
        const toMs = latest.ts ?? Date.now();
        const fromMs = toMs - windowMs;

        type StateRow = { ts: number; v: number };
        const stateSeries = (tag: string): StateRow[] =>
          db
            .prepare(
              `SELECT ts, state_code AS v FROM state_hyper WHERE std_tag = ?
               AND ts BETWEEN ? AND ? ORDER BY ts`,
            )
            .all(tag, fromMs, toMs) as unknown as StateRow[];
        const stateLatest = (tag: string): number | null => {
          const row = db
            .prepare(`SELECT state_code AS v FROM state_hyper WHERE std_tag = ? ORDER BY id DESC LIMIT 1`)
            .get(tag) as { v: number } | undefined;
          return row ? row.v : null;
        };
        // 全库有没有置起过：窗口内没动作不代表这台电机不存在
        const everOn = (tag: string): boolean => {
          const row = db
            .prepare(`SELECT COUNT(*) AS c FROM state_hyper WHERE std_tag = ? AND state_code = 1`)
            .get(tag) as { c: number };
          return (row?.c ?? 0) > 0;
        };
        const latestValue = (tag: string): number | null => {
          const row = db
            .prepare(`SELECT value FROM sensor_hyper WHERE std_tag = ? ORDER BY ts DESC LIMIT 1`)
            .get(tag) as { value: number } | undefined;
          return row ? row.value : null;
        };
        const isConstant = (tag: string): boolean => {
          const row = db
            .prepare(`SELECT COUNT(DISTINCT value) AS c FROM sensor_hyper WHERE std_tag = ?`)
            .get(tag) as { c: number };
          return (row?.c ?? 0) <= 1;
        };
        const readValue = (tag: string, unit: string): number | null => {
          if (isConstant(tag)) {
            return null;
          }
          const value = latestValue(tag);
          return value === null || isSentinel(unit, value) ? null : Math.round(value * 10) / 10;
        };

        const STAGE_LABELS = ["启动预警", "启动过程中", "接触器吸合", "运行中", "漏电闭锁"];
        const UNITS = [
          {
            id: "pump",
            name: "油泵电机",
            prefix: ["pump_start_warn", "pump_starting", "pump_contactor_on", "pump_running", "pump_leak_lock"],
            currentTag: "left_pump_current_u",
            loadTag: "left_pump_load_pct",
            tempTag: "left_pump_temp",
          },
          {
            id: "left-cutter",
            name: "左截割电机",
            prefix: [
              "left_cutter_start_warn",
              "left_cutter_starting",
              "left_cutter_contactor_on",
              "left_cutter_running",
              "left_cutter_leak_lock",
            ],
            currentTag: "left_cutter_current_u",
            loadTag: "left_cutter_load_pct",
            tempTag: "left_cutter_temp",
          },
          {
            id: "right-cutter",
            name: "右截割电机",
            prefix: [
              "right_cutter_start_warn",
              "right_cutter_starting",
              "right_cutter_contactor_on",
              "right_cutter_running",
              "right_cutter_leak_lock",
            ],
            currentTag: "right_cutter_current_u",
            loadTag: "right_cutter_load_pct",
            tempTag: "right_cutter_temp",
          },
          {
            id: "crusher",
            name: "破碎电机",
            prefix: [
              "crusher_start_warn",
              "crusher_starting",
              "crusher_contactor_on",
              "crusher_running",
              "crusher_leak_lock",
            ],
            currentTag: "crusher_current_u",
            loadTag: "crusher_load_pct",
            tempTag: "crusher_temp",
          },
        ];

        const motors = UNITS.map((unit) => {
          const stages = unit.prefix.map((tag, index) => {
            const series = stateSeries(tag);
            let onCount = 0;
            let lastOnTs: number | null = null;
            let prev = 0;
            for (const row of series) {
              if (row.v === 1 && prev !== 1) {
                onCount += 1;
                lastOnTs = row.ts;
              }
              prev = row.v;
            }
            return {
              label: STAGE_LABELS[index],
              on: stateLatest(tag) === null ? null : stateLatest(tag) === 1,
              lastOnTs,
              onCount,
            };
          });

          // 全库五位都没置起过 = 本机没这台电机（或未接线）
          const installed = unit.prefix.some((tag) => everOn(tag));

          // 运行时长与"起来又掉"的次数：树里"能否持续平稳运转"就是问这个
          const runSeries = stateSeries(unit.prefix[3]);
          let runSeconds = 0;
          let restartCount = 0;
          let prevValue =
            (
              db
                .prepare(
                  `SELECT state_code AS v FROM state_hyper WHERE std_tag = ? AND ts < ?
                   ORDER BY ts DESC LIMIT 1`,
                )
                .get(unit.prefix[3], fromMs) as { v: number } | undefined
            )?.v ?? 0;
          let prevTs = fromMs;
          for (const row of runSeries) {
            if (prevValue === 1) {
              runSeconds += (row.ts - prevTs) / 1000;
            }
            if (prevValue === 1 && row.v === 0) {
              restartCount += 1;
            }
            prevValue = row.v;
            prevTs = row.ts;
          }
          if (prevValue === 1) {
            runSeconds += (toMs - prevTs) / 1000;
          }

          const [warn, starting, contactor, running, leak] = stages;
          let verdict: string;
          let verdictText: string;
          if (!installed) {
            verdict = "not-installed";
            verdictText = `${unit.name}的五个状态位全程为 0，本机判为未配备或未接线，数据帮不上忙。`;
          } else if (leak.on === true) {
            verdict = "leak-locked";
            verdictText = `${unit.name}漏电闭锁位已置起，先按漏电分支查电机与电缆绝缘。`;
          } else if (running.on === true) {
            verdict = "ok";
            verdictText = `${unit.name}当前运行中，窗口内累计运行 ${Math.round(runSeconds / 60)} 分钟${
              restartCount > 0 ? `，中途停过 ${restartCount} 次` : "，没有中途掉停"
            }。`;
          } else if (contactor.on === true) {
            verdict = "not-holding";
            verdictText = `${unit.name}接触器吸合但运行位没起来，问题在接触器之后。`;
          } else if (starting.onCount > 0 || warn.onCount > 0) {
            verdict = "start-failed";
            verdictText = `${unit.name}窗口内有 ${Math.max(warn.onCount, starting.onCount)} 次启动提示，但接触器没吸合，断在启动提示到接触器这一段。`;
          } else if (runSeconds > 0 || restartCount > 0) {
            verdict = "not-holding";
            verdictText = `${unit.name}窗口内运行过 ${Math.round(runSeconds / 60)} 分钟后停下，掉停 ${restartCount} 次。`;
          } else {
            verdict = "never-started";
            verdictText = `${unit.name}窗口内没有启动提示也没有运行记录，数据判不了，请现场实操。`;
          }

          return {
            id: unit.id,
            name: unit.name,
            installed,
            stages,
            verdict,
            verdictText,
            runSeconds: Math.round(runSeconds),
            restartCount,
            currentA: readValue(unit.currentTag, "A"),
            loadPct: readValue(unit.loadTag, "%"),
            tempC: readValue(unit.tempTag, "℃"),
          };
        });

        // 停止/启动指令来源：树里"停止信号可能来自启动按钮、停止按钮、顺槽远程、
        // 端头站或遥控器"这一问，库里按 source_name 记得清清楚楚
        const groupOps = (ops: string[]) => {
          const placeholders = ops.map(() => "?").join(",");
          const rows = db
            .prepare(
              `SELECT occur_ts, source_name, op_name FROM device_action
               WHERE action = '按下' AND source_type = '输入'
                 AND op_name IN (${placeholders}) AND occur_ts BETWEEN ? AND ?
               ORDER BY occur_ts`,
            )
            .all(...ops, fromMs, toMs) as unknown as Array<{
            occur_ts: number;
            source_name: string;
            op_name: string;
          }>;
          return ops.map((op) => {
            const matched = rows.filter((row) => row.op_name === op);
            const grouped = new Map<string, { count: number; lastTs: number }>();
            for (const row of matched) {
              const prev = grouped.get(row.source_name) ?? { count: 0, lastTs: 0 };
              prev.count += 1;
              prev.lastTs = Math.max(prev.lastTs, row.occur_ts);
              grouped.set(row.source_name, prev);
            }
            return {
              op,
              totalCount: matched.length,
              sources: [...grouped.entries()]
                .map(([source, v]) => ({ source, count: v.count, lastTs: v.lastTs || null }))
                .sort((a, b) => b.count - a.count),
            };
          });
        };
        const stopSources = groupOps(["总停", "急停", "泵停", "左截停", "右截停", "破停"]);
        const startSources = groupOps(["总启", "泵启", "左截启", "右截启", "破启"]);

        const activeFaults = (
          db
            .prepare(
              `SELECT fr.name, fr.type, fn.occur_ts FROM fault_normal fn
               JOIN fault_rule fr ON fr.fault_code = fn.fault_code
               WHERE fn.status = 1 AND fr.type IN (1, 2)
                 AND (fr.name LIKE '%电机%' OR fr.name LIKE '%泵%' OR fr.name LIKE '%截割%'
                      OR fr.name LIKE '%破碎%' OR fr.name LIKE '%漏电%' OR fr.name LIKE '%接触器%')
               ORDER BY fr.type DESC, fn.occur_ts DESC LIMIT 20`,
            )
            .all() as unknown as Array<{ name: string; type: number; occur_ts: number }>
        ).map((row) => ({ name: row.name, type: row.type, occurTs: row.occur_ts }));

        const conn = this.connectionFromDb(db);
        const moduleOk = [
          { name: "MOC", ok: conn.moc === "ok" },
          { name: "BOC 主控", ok: conn.boc === "ok" },
          { name: "HPC", ok: conn.hpc === "ok" },
        ];

        const unavailable = [
          {
            topic: "MOC 端子 F+24V（JX3.x / JX4.x）",
            reason: "端子级电压没有采集点，必须万用表实测。",
          },
          {
            topic: "短接 MOC-JX2.x 试吸合",
            reason: "短接属高风险带电操作，数据无法替代，须按矿方规程由有资质人员执行。",
          },
          { topic: "控制变压器 132V / 220V", reason: "控制电源电压没有采集点，必须实测。" },
          {
            topic: "电机与电缆绝缘、220V 对地绝缘",
            reason: "绝缘数据不进系统。系统只有漏电闭锁位，说明「系统认为漏电」，不等于真漏电。",
          },
          { topic: "按钮是否卡死", reason: "按钮机械状态不回传，但可以看下面的指令来源分布做旁证。" },
        ];
        if (startSources.every((entry) => entry.totalCount === 0)) {
          unavailable.push({
            topic: "启动类指令记录",
            reason:
              "库内窗口时段没有泵启/截启/破启的按下记录（启动多在断电检修后完成，采集时段没覆盖到），启动侧只能看状态位。",
          });
        }

        const flagOf = (tag: string): boolean | null => {
          const value = stateLatest(tag);
          return value === null ? null : value === 1;
        };
        const flags = [
          { label: "牵引被泵电机闭锁", on: flagOf("haul_not_ready_pump_blocked") },
          { label: "左截割电机闭锁", on: flagOf("left_cutter_locked") },
          { label: "右截割电机闭锁", on: flagOf("right_cutter_locked") },
        ];

        return {
          fromMs,
          toMs,
          windowLabel: `${fmtTs(fromMs)} ~ ${fmtTs(toMs)}`,
          motors,
          stopSources,
          startSources,
          activeFaults,
          moduleOk,
          flags,
          unavailable,
        };
      },
      () => super.getMotorEvidence(windowMs),
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
