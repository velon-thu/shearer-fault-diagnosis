/**
 * 共享内存实时读取（/api/shm/live 的数据源）。
 *
 * - 共享内存：Linux/WSL 下为 /dev/shm/td3sharemem 文件（回放器创建），
 *   每次请求整块读入做快照解析；Windows 部署时需改由采集器侧转发（见 docs）。
 * - 变量定义：读 dataplane 的 shearer.db（collector 启动时灌种子），
 *   只读打开，10s 缓存。
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ShmFault,
  ShmFifo,
  ShmLiveResponse,
  ShmOpsGroup,
  ShmVariable,
} from "@shearer/contracts";

const SHM_NAME = process.env.SHEARER_SHM_NAME ?? "td3sharemem";
const SHM_PATH = `/dev/shm/${SHM_NAME}`;
const SHM_WORDS = 4096;

// 回放器元数据字（与 services/dataplane/internal/shm/shm.go 保持一致）
const META_HEARTBEAT = 4090;
const META_RECORD_LO = 4091;
const META_RECORD_HI = 4092;
const META_FILE_INDEX = 4093;
const META_FILE_TOTAL = 4094;
const META_INTERVAL_MS = 4095;

const FIFO_BASE = 3400;
const FIFO_MODULES = ["BOC", "HPC", "MOC"] as const;

const packageRoot = resolve(__dirname, "..", "..");
const DATAPLANE_DB =
  process.env.SHEARER_DATAPLANE_DB ??
  resolve(packageRoot, "..", "dataplane", "data", "shearer.db");

// 32 位操作码各 bit 的指令名（与 dataplane defs.OpNames 一致）
const OP_NAMES: Record<number, string> = {
  16: "向左", 17: "泵停", 18: "右顺", 19: "左顺",
  20: "顶升", 21: "破升", 22: "右升", 23: "左升",
  24: "减速", 25: "牵停", 26: "运停", 27: "破停",
  28: "右截停", 29: "左截停", 30: "总停", 31: "急停",
  0: "向右", 1: "泵启", 2: "右逆", 3: "左逆",
  4: "顶降", 5: "破降", 6: "右降", 7: "左降",
  8: "加速", 9: "牵启", 10: "显示", 11: "破启",
  12: "右截启", 13: "左截启", 14: "总启", 15: "F2",
};

type SensorDefRow = {
  add: number;
  category: string;
  name: string;
  std_tag: string;
  accuracy: number;
  unit: string;
  org: string;
  signed: number;
  sheet: string;
};
type StatusDefRow = {
  add: number;
  category: string;
  status: string;
  std_tag: string;
  org: string;
  sheet: string;
};
type FaultMapRow = { fault_code: number; org: string; name: string; trigger: string };
type OpsMapRow = {
  group_no: number;
  source_name: string;
  source_type: string;
  addr_hi: number;
  addr_lo: number;
};

type DefiCache = {
  sensors: SensorDefRow[];
  statuses: StatusDefRow[];
  faults: FaultMapRow[];
  ops: OpsMapRow[];
  loadedAt: number;
};

let defiCache: DefiCache | null = null;

const loadDefi = (): DefiCache | null => {
  if (defiCache && Date.now() - defiCache.loadedAt < 10_000) {
    return defiCache;
  }

  if (!existsSync(DATAPLANE_DB)) {
    return null;
  }

  let db: DatabaseSync | null = null;

  try {
    db = new DatabaseSync(DATAPLANE_DB, { readOnly: true });
    defiCache = {
      sensors: db
        .prepare(
          `SELECT "add" AS "add", category, name, std_tag, accuracy, unit, org, signed, sheet
           FROM sensor_data_defi ORDER BY "add"`,
        )
        .all() as SensorDefRow[],
      statuses: db
        .prepare(
          `SELECT "add" AS "add", category, status, std_tag, org, sheet
           FROM status_data_defi ORDER BY "add"`,
        )
        .all() as StatusDefRow[],
      faults: db
        .prepare(
          `SELECT fault_code, org, name, trigger FROM fault_map
           WHERE trigger != 'fifo' ORDER BY fault_code`,
        )
        .all() as FaultMapRow[],
      ops: db
        .prepare(
          `SELECT group_no, source_name, source_type, addr_hi, addr_lo
           FROM ops_map ORDER BY group_no`,
        )
        .all() as OpsMapRow[],
      loadedAt: Date.now(),
    };
    return defiCache;
  } catch {
    return defiCache; // 数据库暂不可读时沿用旧缓存
  } finally {
    db?.close();
  }
};

const toInt16 = (v: number) => (v >= 0x8000 ? v - 0x10000 : v);

const faultActive = (trigger: string, v: number): boolean => {
  if (trigger === "bit") return v === 1;
  if (trigger === "bit_inv") return v === 0;
  if (trigger.startsWith("eq:")) return v === Number(trigger.slice(3));
  if (trigger.startsWith("neq:")) return v !== Number(trigger.slice(4));
  return false;
};

// 心跳活性判定：模块级记忆上次心跳值与变化时刻
let lastHeartbeat = -1;
let lastHeartbeatChange = 0;

export const readShmLive = (): ShmLiveResponse => {
  const empty: ShmLiveResponse = {
    available: false,
    shmName: SHM_NAME,
    meta: null,
    variables: [],
    ops: [],
    faults: [],
    fifos: [],
  };

  if (!existsSync(SHM_PATH)) {
    return empty;
  }

  let buf: Buffer;

  try {
    buf = readFileSync(SHM_PATH);
  } catch {
    return empty;
  }

  if (buf.length < SHM_WORDS * 2) {
    return empty;
  }

  const word = (addr: number) => buf.readUInt16LE(addr * 2);

  const heartbeat = word(META_HEARTBEAT);
  const now = Date.now();

  if (heartbeat !== lastHeartbeat) {
    lastHeartbeat = heartbeat;
    lastHeartbeatChange = now;
  }

  const meta = {
    heartbeat,
    records: word(META_RECORD_HI) * 65536 + word(META_RECORD_LO),
    fileIndex: word(META_FILE_INDEX),
    fileTotal: word(META_FILE_TOTAL),
    intervalMs: word(META_INTERVAL_MS),
    replayerAlive: now - lastHeartbeatChange < 3_000,
  };

  const defi = loadDefi();

  if (!defi) {
    return { ...empty, available: true, meta };
  }

  const variables: ShmVariable[] = [];

  for (const s of defi.sensors) {
    const raw = word(s.add);
    const base = s.signed ? toInt16(raw) : raw;
    variables.push({
      add: s.add,
      kind: "sensor",
      category: s.category,
      name: s.name,
      stdTag: s.std_tag,
      org: s.org,
      raw,
      value: Number((base * s.accuracy).toFixed(4)),
      unit: s.unit,
      sheet: s.sheet,
    });
  }

  for (const s of defi.statuses) {
    const raw = word(s.add);
    variables.push({
      add: s.add,
      kind: "status",
      category: s.category,
      name: s.status,
      stdTag: s.std_tag,
      org: s.org,
      raw,
      value: raw === 0 ? 0 : 1,
      unit: "",
      sheet: s.sheet,
    });
  }

  const ops: ShmOpsGroup[] = defi.ops.map((g) => {
    const code = word(g.addr_hi) * 65536 + word(g.addr_lo);
    const activeOps: string[] = [];

    for (let bit = 0; bit < 32; bit += 1) {
      if ((code & (2 ** bit)) !== 0 && OP_NAMES[bit]) {
        activeOps.push(OP_NAMES[bit]);
      }
    }

    return {
      groupNo: g.group_no,
      sourceName: g.source_name,
      sourceType: g.source_type,
      hex: `0x${code.toString(16).toUpperCase().padStart(8, "0")}`,
      activeOps,
    };
  });

  const faults: ShmFault[] = defi.faults.map((f) => {
    const raw = word(f.fault_code);

    return {
      code: f.fault_code,
      name: f.name,
      trigger: f.trigger,
      raw,
      active: faultActive(f.trigger, raw),
    };
  });

  const fifos: ShmFifo[] = FIFO_MODULES.map((module, gi) => ({
    module,
    words: [0, 1, 2, 3].map((i) => word(FIFO_BASE + gi * 4 + i)),
  }));

  return {
    available: true,
    shmName: SHM_NAME,
    meta,
    variables,
    ops,
    faults,
    fifos,
  };
};
