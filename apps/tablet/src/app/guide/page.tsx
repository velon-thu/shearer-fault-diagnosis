"use client";

import {
  DataWindowSchema,
  DiagnosisTreesResponseSchema,
  FaultRulesResponseSchema,
  FreezeFrameSchema,
  InternalFaultRulesSchema,
  LiveFaultsResponseSchema,
  RankingsResponseSchema,
  createApiSuccessResponseSchema,
  type DiagnosisOption,
  type DiagnosisTree,
  type FaultRuleItem,
  type FreezeFrame,
  type FreezeFrameSignal,
  type LiveFault,
} from "@shearer/contracts";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";
import { splitHandle } from "@/lib/fault-text";
import { FreezeFrameBody, FreezeFrameSignalView } from "@/components/freeze-frame";
import {
  cardForNode,
  evidenceRequestFor,
  parseEvidence,
  profileFacts,
  recommendedModuleIds,
  type TreeEvidence,
} from "./evidence";
import { resolveHttpBase } from "@/lib/api-base";

const DiagnosisTreesApiResponseSchema = createApiSuccessResponseSchema(DiagnosisTreesResponseSchema);
const FaultRulesApiResponseSchema = createApiSuccessResponseSchema(FaultRulesResponseSchema);
const LiveFaultsApiResponseSchema = createApiSuccessResponseSchema(LiveFaultsResponseSchema);
const DataWindowApiResponseSchema = createApiSuccessResponseSchema(DataWindowSchema);
const RankingsApiResponseSchema = createApiSuccessResponseSchema(RankingsResponseSchema);
const FreezeFrameApiResponseSchema = createApiSuccessResponseSchema(FreezeFrameSchema);
const InternalFaultRulesApiResponseSchema =
  createApiSuccessResponseSchema(InternalFaultRulesSchema);

const TYPE_TEXT = ["提示", "警告", "停机"];

const toHex = (code: number) => `0x${code.toString(16).toUpperCase().padStart(4, "0")}`;

// 实时故障流里的内部故障名带 "[BOC/HPC · 停机] " 前缀，目录里没有，比对前先去掉
const normalizeName = (name: string) => name.replace(/^\[[^\]]*\]\s*/, "");

// 内部故障目录不在 fault_rule 表里，单独走 /api/internal-fault-rules
const INTERNAL_KIND = 6;

// 部位入口 = fault_rule.kind 分类（7 来源为内部故障的定位辅助，不单列）
const PARTS = [
  { kind: 1, label: "变频器" },
  { kind: 2, label: "电机" },
  { kind: 3, label: "模块" },
  { kind: 4, label: "传感器" },
  { kind: 5, label: "自动化" },
  { kind: INTERNAL_KIND, label: "内部" },
] as const;

// 状态类信息（非故障）不进排查列表：type=0 提示类，或名称明显是运行状态
const STATUS_NAME_RE = /运行中|输出转矩|连接OK|接通。|已就绪/;

// 该故障没配处理建议时的兜底路径：全部指向本机已有的诊断工具，不臆造维修结论
const GENERIC_STEPS = [
  "先做一键体检，确认模块通讯是否正常、相关传感器是否有效",
  "在事件时间线回看故障前后 10 分钟的操作与状态变化",
  "在信号对比中把该部位左右对称的测点叠加，看是否单侧异常",
  "查阅知识库对应机型的图纸与排查视频，按现场情况确认",
];

const pad = (n: number) => String(n).padStart(2, "0");

const fmtClock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const fmtDuration = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}小时${pad(m)}分` : m > 0 ? `${m}分${pad(s)}秒` : `${s}秒`;
};

type Candidate = {
  key: string;
  code: string;
  name: string;
  type: number;
  kind: number;
  handle: string;
  active: boolean;
  internal: boolean;
  occurTs: number | null;
  recentCount: number;
};

type Entry = { mode: "active" } | { mode: "part"; kind: number };
type ViewMode = "start" | "list" | "steps" | "tree-pick" | "tree-node";

// 走过的问答，既是"上一步"的依据，也是排查结束时的过程记录
type PathStep = { nodeId: string; question: string; answer: string };

const PAGE_SIZE = 5;

// 数据证据的时间窗：太短没样本，太长会把上个班的操作混进来
const EVIDENCE_WINDOW_MS = 2 * 60 * 60 * 1000;

// 选项 status 不是 observed 时给个来源标记，让人知道这一跳的可信度
const STATUS_TAG: Record<string, string> = {
  inferred_from_backtracking: "回溯推断",
  inferred_from_recorded_backtracking: "回溯推断",
  inferred_from_technical_logic: "技术逻辑补齐",
  unresolved_not_recorded: "待补录",
};

export default function GuidePage() {
  const shellState = useAppShellState();
  const [view, setView] = useState<ViewMode>("start");
  const [entry, setEntry] = useState<Entry>({ mode: "active" });
  const [rules, setRules] = useState<FaultRuleItem[]>([]);
  const [internalRules, setInternalRules] = useState<FaultRuleItem[]>([]);
  const [live, setLive] = useState<LiveFault[]>([]);
  const [recent, setRecent] = useState<Map<string, { count: number; lastAt: string }>>(new Map());
  const [onlySeen, setOnlySeen] = useState(true);
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [unresolved, setUnresolved] = useState(false);
  const [page, setPage] = useState(0);
  const [frame, setFrame] = useState<FreezeFrame | null>(null);
  const [frameLoading, setFrameLoading] = useState(false);
  // 故障现场在排查流程里以弹窗出现，放大图在弹窗内再切一层
  const [frameSignal, setFrameSignal] = useState<FreezeFrameSignal | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [loaded, setLoaded] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ===== 诊断树 =====
  const [trees, setTrees] = useState<DiagnosisTree[]>([]);
  const [evidence, setEvidence] = useState<TreeEvidence | null>(null);
  const [treeId, setTreeId] = useState<string | null>(null);
  const [moduleId, setModuleId] = useState<string | null>(null);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [path, setPath] = useState<PathStep[]>([]);
  const [todoNote, setTodoNote] = useState<string | null>(null);
  const [treeDone, setTreeDone] = useState<"ok" | "no" | null>(null);

  // 故障目录 + 近期发生统计（全库时间窗）
  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const [rulesRes, internalRes, windowRes] = await Promise.all([
          fetch(`${resolveHttpBase()}/api/fault-rules`, { cache: "no-store" }),
          fetch(`${resolveHttpBase()}/api/internal-fault-rules`, { cache: "no-store" }),
          fetch(`${resolveHttpBase()}/api/data-window`, { cache: "no-store" }),
        ]);
        const parsedRules = FaultRulesApiResponseSchema.parse(await rulesRes.json());
        const parsedInternal = InternalFaultRulesApiResponseSchema.parse(await internalRes.json());
        const parsedWindow = DataWindowApiResponseSchema.parse(await windowRes.json());
        if (cancelled) {
          return;
        }
        setRules(parsedRules.data);
        // 内部故障目录（BOC/HPC 解析条目 + MOC 来源代码）不在 fault_rule 里
        setInternalRules([...parsedInternal.data.bocHpc, ...parsedInternal.data.moc]);

        const { fromMs, toMs } = parsedWindow.data;
        if (fromMs !== null && toMs !== null && toMs > fromMs) {
          const rankingsRes = await fetch(
            `${resolveHttpBase()}/api/rankings?from=${fromMs}&to=${toMs}`,
            { cache: "no-store" },
          );
          const parsedRankings = RankingsApiResponseSchema.parse(await rankingsRes.json());
          if (cancelled) {
            return;
          }
          const stats = new Map<string, { count: number; lastAt: string }>();
          const { systemFaultRankings, inverterFaultRankings, sensorFaultRankings } =
            parsedRankings.data;
          for (const item of [
            ...systemFaultRankings,
            ...inverterFaultRankings,
            ...sensorFaultRankings,
          ]) {
            const prev = stats.get(item.name);
            stats.set(item.name, {
              count: (prev?.count ?? 0) + item.count,
              lastAt: item.lastOccurredAt,
            });
          }
          setRecent(stats);
        }
        setErrorMessage(null);
      } catch {
        if (!cancelled) {
          setErrorMessage("故障目录加载失败，请确认服务已启动。");
        }
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  // 诊断树目录：一次性拉全（树本身是静态的，跟着后端种子文件走）
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`${resolveHttpBase()}/api/diagnosis-trees`, {
          cache: "no-store",
        });
        const parsed = DiagnosisTreesApiResponseSchema.parse(await response.json());
        if (!cancelled) {
          setTrees(parsed.data.trees);
        }
      } catch {
        // 诊断树读不到不影响故障目录排查，start 页自然不出这个入口
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // 数据证据：进树后才拉，按树种走各自的接口，30s 刷新一次（窗口 2 小时，不必更密）
  useEffect(() => {
    if ((view !== "tree-pick" && view !== "tree-node") || treeId === null) {
      return;
    }
    const request = evidenceRequestFor(treeId);
    if (request === null) {
      setEvidence(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(
          `${resolveHttpBase()}${request.path}?window=${EVIDENCE_WINDOW_MS}`,
          { cache: "no-store" },
        );
        const parsed = parseEvidence(request.kind, await response.json());
        if (!cancelled) {
          setEvidence(parsed);
        }
      } catch {
        if (!cancelled) {
          setEvidence(null);
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [treeId, view]);

  // 实时故障：5s 轮询（进行中条数驱动第一步入口），1s 心跳刷新持续时长
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`${resolveHttpBase()}/api/live-faults`, { cache: "no-store" });
        const parsed = LiveFaultsApiResponseSchema.parse(await response.json());
        if (!cancelled) {
          setLive(parsed.data);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setLoaded(true);
        }
      }
    };
    void load();
    const pollTimer = setInterval(() => void load(), 5_000);
    const tickTimer = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      clearInterval(tickTimer);
    };
  }, []);

  const activeFaults = useMemo(() => live.filter((item) => item.clearTs === null), [live]);

  // 目录条目 → 最近一次实际发生时刻（用于调故障现场）
  const lastOccurByName = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of live) {
      const key = normalizeName(item.name);
      const prev = map.get(key);
      if (prev === undefined || item.occurTs > prev) {
        map.set(key, item.occurTs);
      }
    }
    return map;
  }, [live]);

  const partCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const rule of rules) {
      if (rule.type === 0 || STATUS_NAME_RE.test(rule.name)) {
        continue;
      }
      counts.set(rule.kind, (counts.get(rule.kind) ?? 0) + 1);
    }
    counts.set(INTERNAL_KIND, internalRules.length);
    return counts;
  }, [internalRules, rules]);

  const candidates = useMemo<Candidate[]>(() => {
    if (entry.mode === "active") {
      return activeFaults.map((item) => ({
        key: item.id,
        code: item.code,
        name: item.name,
        type: item.type,
        kind: item.kind,
        handle: item.handle,
        active: true,
        internal: item.source === "internal",
        occurTs: item.occurTs,
        recentCount: recent.get(item.name)?.count ?? 0,
      }));
    }

    const activeNames = new Set(activeFaults.map((item) => normalizeName(item.name)));
    const source =
      entry.kind === INTERNAL_KIND
        ? internalRules
        : rules.filter(
            (rule) => rule.kind === entry.kind && rule.type > 0 && !STATUS_NAME_RE.test(rule.name),
          );

    return source
      .map((rule, index) => ({
        key: `${entry.kind}-${rule.code}-${index}`,
        code: toHex(rule.code),
        name: rule.name,
        type: rule.type,
        kind: entry.kind,
        handle: rule.handle ?? "",
        active: activeNames.has(rule.name),
        internal: entry.kind === INTERNAL_KIND,
        occurTs: lastOccurByName.get(rule.name) ?? null,
        recentCount: recent.get(rule.name)?.count ?? 0,
      }))
      .sort((a, b) => {
        if (a.active !== b.active) {
          return a.active ? -1 : 1;
        }
        // 真正发生过的排前面：目录动辄上百条，没发生过的往后放
        const aSeen = a.occurTs !== null || a.recentCount > 0;
        const bSeen = b.occurTs !== null || b.recentCount > 0;
        if (aSeen !== bSeen) {
          return aSeen ? -1 : 1;
        }
        if (a.recentCount !== b.recentCount) {
          return b.recentCount - a.recentCount;
        }
        if (a.occurTs !== null && b.occurTs !== null && a.occurTs !== b.occurTs) {
          return b.occurTs - a.occurTs;
        }
        return b.type - a.type;
      });
  }, [activeFaults, entry, internalRules, lastOccurByName, recent, rules]);

  // 发生过的条目（进行中 / 库内有记录），"只看发生过的"就是筛这些
  const seenCount = useMemo(
    () => candidates.filter((item) => item.active || item.occurTs !== null || item.recentCount > 0)
      .length,
    [candidates],
  );

  const shown = useMemo(
    () =>
      onlySeen && seenCount > 0
        ? candidates.filter((item) => item.active || item.occurTs !== null || item.recentCount > 0)
        : candidates,
    [candidates, onlySeen, seenCount],
  );

  const totalPages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = shown.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const steps = useMemo(() => {
    if (!picked) {
      return { list: [] as string[], generic: false };
    }
    const list = splitHandle(picked.handle);
    return list.length > 0 ? { list, generic: false } : { list: GENERIC_STEPS, generic: true };
  }, [picked]);

  // ===== 诊断树导航：currentNodeId + path 栈，"上一步"走导航不写进业务选项 =====
  const tree = useMemo(() => trees.find((item) => item.id === treeId) ?? null, [treeId, trees]);
  const treeModule = useMemo(
    () => tree?.modules.find((item) => item.id === moduleId) ?? null,
    [moduleId, tree],
  );
  const nodeMap = useMemo(
    () => new Map((treeModule?.nodes ?? []).map((item) => [item.id, item])),
    [treeModule],
  );
  const node = nodeId === null ? null : (nodeMap.get(nodeId) ?? null);

  // 机型收敛：数据能定的先排上去，剩下的照旧全列，人可以随时选别的
  const recommendedIds = useMemo(() => new Set(recommendedModuleIds(evidence)), [evidence]);
  const orderedModules = useMemo(() => {
    const list = [...(tree?.modules ?? [])];
    return list.sort((a, b) => {
      const aRec = recommendedIds.has(a.id);
      const bRec = recommendedIds.has(b.id);
      if (aRec !== bRec) {
        return aRec ? -1 : 1;
      }
      return a.index - b.index;
    });
  }, [recommendedIds, tree]);

  const profile = useMemo(() => profileFacts(evidence), [evidence]);

  const evidenceCard = useMemo(
    () => (node === null ? null : cardForNode(node, moduleId, evidence)),
    [evidence, moduleId, node],
  );

  // 数据倾向只能落在**一个**选项上。先找完全相同的标签，找不到再退回包含匹配——
  // 否则「吸合 / 不吸合」这种选项会因为"不吸合"含有"吸合"而双双高亮。
  const recommendedIndex = useMemo(() => {
    const words = evidenceCard?.recommend?.match;
    if (!node || !words) {
      return -1;
    }
    const exact = node.options.findIndex((option) =>
      words.some((word) => option.label === word),
    );
    return exact >= 0
      ? exact
      : node.options.findIndex((option) => words.some((word) => option.label.includes(word)));
  }, [evidenceCard, node]);

  const startModule = (target: { id: string; startNode: string }) => {
    setModuleId(target.id);
    setNodeId(target.startNode);
    setPath([]);
    setTodoNote(null);
    setTreeDone(null);
    setView("tree-node");
  };

  const openTree = (id: string) => {
    setTreeId(id);
    setModuleId(null);
    setNodeId(null);
    setPath([]);
    setTodoNote(null);
    setTreeDone(null);
    // 单模块树（如系统牵引）没有机型可选，直接进第一问
    const target = trees.find((item) => item.id === id);
    if (target && target.modules.length === 1) {
      startModule(target.modules[0]);
      return;
    }
    setView("tree-pick");
  };

  const openTreeModule = (id: string) => {
    const target = tree?.modules.find((item) => item.id === id);
    if (target) {
      startModule(target);
    }
  };

  const chooseOption = (option: DiagnosisOption) => {
    if (!node) {
      return;
    }
    // 资料里没有后续步骤的分支：如实说明，不让系统编一个结论出来
    // （选项的原始 note 是维护用的标注，不往井下人员面前摆）
    if (option.next === null) {
      setTodoNote(
        "这一支诊断树还没补录到下一步，系统不会自行推断结论。请按现场经验继续排查，或回上一步改选其他答案。",
      );
      return;
    }
    setTodoNote(null);
    setPath((prev) => [...prev, { nodeId: node.id, question: node.text, answer: option.label }]);
    setNodeId(option.next);
  };

  const singleModuleTree = (tree?.modules.length ?? 0) <= 1;

  const stepBack = () => {
    setTodoNote(null);
    setTreeDone(null);
    if (path.length === 0) {
      // 单模块树没有选机型那一层，直接退回选起点
      setView(singleModuleTree ? "start" : "tree-pick");
      return;
    }
    const last = path[path.length - 1];
    setPath((prev) => prev.slice(0, -1));
    setNodeId(last.nodeId);
  };

  const openEntry = (next: Entry) => {
    setEntry(next);
    setPage(0);
    setView("list");
  };

  const openSteps = (candidate: Candidate) => {
    setPicked(candidate);
    setDone(new Set());
    setUnresolved(false);
    setView("steps");
  };

  const toggleStep = (index: number) => {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // 同一秒常有多条故障并发，必须把点中的那条名字带上，否则后端只能靠时间猜
  const openFreezeFrame = async (ts: number, name: string) => {
    try {
      setFrameLoading(true);
      const response = await fetch(
        `${resolveHttpBase()}/api/freeze-frame?ts=${ts}&name=${encodeURIComponent(name)}`,
        { cache: "no-store" },
      );
      const parsed = FreezeFrameApiResponseSchema.parse(await response.json());
      setFrame(parsed.data);
    } catch {
      setErrorMessage("故障现场加载失败。");
    } finally {
      setFrameLoading(false);
    }
  };

  const entryTitle =
    entry.mode === "active"
      ? "进行中故障"
      : `${PARTS.find((part) => part.kind === entry.kind)?.label ?? "部位"}相关故障`;

  const backConfig =
    view === "steps"
      ? { label: "定位故障", onClick: () => setView("list") }
      : view === "list"
        ? { label: "选起点", onClick: () => setView("start") }
        : view === "tree-pick"
          ? { label: "选起点", onClick: () => setView("start") }
          : view === "tree-node"
            ? {
                label:
                  path.length > 0 ? "上一步" : singleModuleTree ? "选起点" : "选机型",
                onClick: stepBack,
              }
            : undefined;

  const viewTitle =
    view === "steps"
      ? "按步排查"
      : view === "list"
        ? "定位故障"
        : view === "tree-pick"
          ? `${tree?.shortName ?? "诊断树"} · 选机型`
          : view === "tree-node"
            ? `${(singleModuleTree ? tree?.shortName : treeModule?.name) ?? "诊断树"} · 第 ${path.length + 1} 步`
            : "选起点";

  return (
    <AppShell
      back={backConfig}
      shellState={shellState}
      title="引导性故障排查"
      viewTitle={viewTitle}
    >
      <section className="page active">
        {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

        {/* ===== 第 1 步：选起点 ===== */}
        {view === "start" ? (
          <>
            <div className="gd-steps">
              <span className="gd-step on">1 选起点</span>
              <span className="gd-step-line" />
              <span className="gd-step">2 定位故障</span>
              <span className="gd-step-line" />
              <span className="gd-step">3 按步排查</span>
            </div>

            <button
              className={`gd-entry-main${activeFaults.length > 0 ? " hot" : ""}`}
              disabled={activeFaults.length === 0}
              onClick={() => openEntry({ mode: "active" })}
              type="button"
            >
              <span className="gd-entry-badge">{activeFaults.length}</span>
              <span className="gd-entry-text">
                <span className="gd-entry-title">
                  {activeFaults.length > 0 ? "排查当前进行中的故障" : "当前没有进行中的故障"}
                </span>
                <span className="gd-entry-desc">
                  {activeFaults.length > 0
                    ? activeFaults
                        .slice(0, 3)
                        .map((item) => item.name)
                        .join(" · ")
                    : loaded
                      ? "机器当前无激活故障，可按部位做例行排查"
                      : "正在读取实时故障…"}
                </span>
              </span>
              {activeFaults.length > 0 ? <span className="gd-entry-go">开始 ›</span> : null}
            </button>

            {trees.length > 0 ? (
              <>
                <div className="gd-sub-title">按诊断树排查</div>
                <div className="dt-tree-grid">
                  {trees.map((item) => (
                    <button
                      className="dt-tree-entry"
                      key={item.id}
                      onClick={() => openTree(item.id)}
                      type="button"
                    >
                      {item.shortName}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            <div className="gd-sub-title">按部位排查</div>
            <div className="gd-part-grid">
              {PARTS.map((part) => (
                <button
                  className="gd-part"
                  key={part.kind}
                  onClick={() => openEntry({ mode: "part", kind: part.kind })}
                  type="button"
                >
                  <span className="gd-part-name">{part.label}</span>
                  <span className="gd-part-count">{partCounts.get(part.kind) ?? 0} 项</span>
                </button>
              ))}
            </div>

            <div className="gd-hint">
              不确定从哪儿查起？先做一次
              <Link className="gd-hint-link" href="/health">
                一键体检
              </Link>
              ，用评分和对称性结果缩小范围。
            </div>
          </>
        ) : null}

        {/* ===== 第 2 步：定位故障 ===== */}
        {view === "list" ? (
          <>
            <div className="gd-steps">
              <span className="gd-step done">1 选起点</span>
              <span className="gd-step-line" />
              <span className="gd-step on">2 定位故障</span>
              <span className="gd-step-line" />
              <span className="gd-step">3 按步排查</span>
            </div>

            <div className="gd-bar">
              <span className="gd-bar-title">{entryTitle}</span>
              {entry.mode === "part" && seenCount > 0 && seenCount < candidates.length ? (
                <button
                  className={`sensor-type-chip${onlySeen ? " active" : ""}`}
                  onClick={() => {
                    setOnlySeen((prev) => !prev);
                    setPage(0);
                  }}
                  type="button"
                >
                  只看发生过的
                </button>
              ) : null}
              <span className="sensor-pager-info">共 {shown.length} 项</span>
            </div>

            <div className="list gd-list">
              {shown.length === 0 ? (
                <div className="empty">该入口下暂无可排查的故障条目。</div>
              ) : (
                pageItems.map((item) => (
                  <button
                    className="rank-item rank-item-btn"
                    key={item.key}
                    onClick={() => openSteps(item)}
                    type="button"
                  >
                    <div className="rank-left">
                      <div className="rank-top">
                        {item.active ? (
                          <span className="lf-tag lf-tag-stop">进行中</span>
                        ) : item.internal ? (
                          <span className="lf-tag lf-tag-internal">内部</span>
                        ) : (
                          <span className={`lf-tag lf-tag-${item.type === 2 ? "stop" : "warn"}`}>
                            {TYPE_TEXT[item.type] ?? item.type}
                          </span>
                        )}
                        <div className="rank-name">{item.name}</div>
                      </div>
                      <div className="meta-line">
                        {item.code}
                        {item.recentCount > 0 ? ` · 库内共发生 ${item.recentCount} 次` : ""}
                        {item.occurTs !== null
                          ? ` · 最近 ${fmtClock(item.occurTs)}`
                          : item.recentCount > 0
                            ? ""
                            : " · 库内未发生"}
                      </div>
                    </div>
                    <div className="gd-item-go">排查 ›</div>
                  </button>
                ))
              )}
            </div>

            {shown.length > PAGE_SIZE ? (
              <div className="sensor-pager">
                <button onClick={() => setPage(Math.max(0, safePage - 1))} type="button">
                  ‹ 上一页
                </button>
                <span className="sensor-pager-info">
                  {safePage + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
                  type="button"
                >
                  下一页 ›
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        {/* ===== 第 3 步：按步排查 ===== */}
        {view === "steps" && picked ? (
          <>
            <div className="gd-steps">
              <span className="gd-step done">1 选起点</span>
              <span className="gd-step-line" />
              <span className="gd-step done">2 定位故障</span>
              <span className="gd-step-line" />
              <span className="gd-step on">3 按步排查</span>
            </div>

            <div className="gd-bar">
              <span className="gd-bar-title">
                {picked.code} · {picked.name}
              </span>
              <span className="sensor-pager-info">
                {done.size} / {steps.list.length}
              </span>
            </div>

            <div className="gd-head-card">
              <div className="gd-head-tags">
                {picked.active ? (
                  <span className="lf-tag lf-tag-stop">进行中</span>
                ) : picked.internal ? (
                  <span className="lf-tag lf-tag-internal">内部</span>
                ) : (
                  <span className={`lf-tag lf-tag-${picked.type === 2 ? "stop" : "warn"}`}>
                    {TYPE_TEXT[picked.type] ?? picked.type}
                  </span>
                )}
                {picked.internal ? null : (
                  <span className="badge info">
                    {PARTS.find((part) => part.kind === picked.kind)?.label ?? `类别${picked.kind}`}
                  </span>
                )}
                {picked.active && picked.occurTs !== null ? (
                  <span className="gd-head-live">
                    已持续 {fmtDuration(now - picked.occurTs)}
                  </span>
                ) : picked.occurTs !== null ? (
                  <span className="gd-head-meta">最近发生 {fmtClock(picked.occurTs)}</span>
                ) : (
                  <span className="gd-head-meta">库内暂无该故障记录</span>
                )}
              </div>
              <div className="gd-progress">
                <div
                  className="gd-progress-fill"
                  style={{
                    width: `${steps.list.length > 0 ? (done.size / steps.list.length) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>

            {steps.generic ? (
              <div className="system-note">
                该故障在规则库里没有配处理建议，下面是通用排查路径（按本机诊断工具展开）。
              </div>
            ) : null}

            <div className="gd-step-list">
              {steps.list.map((text, index) => (
                <button
                  className={`gd-step-item${done.has(index) ? " done" : ""}`}
                  key={index}
                  onClick={() => toggleStep(index)}
                  type="button"
                >
                  <span className="gd-step-no">{done.has(index) ? "✓" : index + 1}</span>
                  <span className="gd-step-text">{text}</span>
                </button>
              ))}
            </div>

            <div className="gd-tools">
              {picked.occurTs !== null ? (
                <button
                  className="sensor-settings-btn"
                  disabled={frameLoading}
                  onClick={() => void openFreezeFrame(picked.occurTs as number, picked.name)}
                  type="button"
                >
                  {frameLoading ? "加载中…" : "故障现场"}
                </button>
              ) : null}
              <Link className="sensor-settings-btn gd-tool-link" href="/timeline">
                事件时间线
              </Link>
              <Link className="sensor-settings-btn gd-tool-link" href="/signals">
                信号对比
              </Link>
              <Link className="sensor-settings-btn gd-tool-link" href="/health">
                一键体检
              </Link>
            </div>

            <div className="gd-verdict">
              <button
                className="gd-verdict-btn ok"
                onClick={() => {
                  setUnresolved(false);
                  setView("start");
                }}
                type="button"
              >
                故障已排除
              </button>
              <button
                className="gd-verdict-btn no"
                onClick={() => setUnresolved(true)}
                type="button"
              >
                仍未解决
              </button>
            </div>

            {unresolved ? (
              <div className="gd-next">
                <div className="gd-next-title">还没解决，接着做这三件事</div>
                <ol className="gd-next-list">
                  <li>
                    到
                    <Link className="gd-hint-link" href="/knowledge">
                      知识库
                    </Link>
                    调对应机型的图纸与排查视频，核对接线与元件位置。
                  </li>
                  <li>
                    在
                    <Link className="gd-hint-link" href="/rankings">
                      近期故障排名
                    </Link>
                    里看这条故障是否高频复发，高频往往指向固定的薄弱点。
                  </li>
                  <li>把故障现场截图与本次已排除的步骤一并交给上一级，避免重复排查。</li>
                </ol>
              </div>
            ) : null}
          </>
        ) : null}

        {/* ===== 诊断树：选机型 ===== */}
        {view === "tree-pick" && tree ? (
          <>
            <div className="gd-bar">
              <span className="gd-bar-title">{tree.title}</span>
              <span className="sensor-pager-info">{tree.modules.length} 个机型</span>
            </div>

            {profile ? (
              <div className="dt-profile">
                <div className="dt-profile-facts">
                  {profile.facts.map((fact) => (
                    <span className="dt-fact" key={fact.label}>
                      {fact.label}
                      <b>{fact.value}</b>
                    </span>
                  ))}
                </div>
                <div className="dt-profile-note">{profile.note}</div>
              </div>
            ) : null}

            <div className="dt-module-list">
              {orderedModules.map((item) => (
                <button
                  className={`dt-module${recommendedIds.has(item.id) ? " rec" : ""}`}
                  key={item.id}
                  onClick={() => openTreeModule(item.id)}
                  type="button"
                >
                  <span className="dt-module-name">{item.name}</span>
                  {recommendedIds.has(item.id) ? (
                    <span className="dt-tag rec">数据收敛</span>
                  ) : null}
                  <span className="dt-module-go">开始 ›</span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {/* ===== 诊断树：按节点走 ===== */}
        {view === "tree-node" && treeModule && node ? (
          <>
            <div className="gd-bar">
              <span className="gd-bar-title">
                {singleModuleTree ? (tree?.title ?? treeModule.name) : treeModule.name}
              </span>
              <span className="sensor-pager-info">
                {node.type === "result" ? "已到结论" : `已走 ${path.length} 步`}
              </span>
            </div>

            {/* 安全须知与原理说明只在第一问露一次，别每步都挡着 */}
            {path.length === 0 && tree?.safetyNotice?.length ? (
              <div className="dt-safety">
                <span className="dt-safety-badge">安全须知</span>
                <div className="dt-safety-text">
                  {tree.safetyNotice.map((line, index) => (
                    <p className="dt-safety-line" key={index}>
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}

            {path.length === 0 && tree?.introduction ? (
              <details className="dt-intro">
                <summary className="dt-intro-head">原理说明</summary>
                <div className="dt-intro-body">{tree.introduction}</div>
              </details>
            ) : null}

            <div className={`dt-node${node.type === "result" ? " result" : ""}`}>
              <div className="dt-node-kind">
                {node.type === "result" ? "结论" : `第 ${path.length + 1} 问`}
              </div>
              <div className="dt-node-text">{node.text}</div>
              {node.note ? <div className="dt-node-note">{node.note}</div> : null}
            </div>

            {evidenceCard ? (
              <div className={`dt-evi ${evidenceCard.tone}`}>
                <div className="dt-evi-head">
                  <span className="dt-evi-badge">
                    {evidenceCard.tone === "data" ? "机器数据" : "无测点"}
                  </span>
                  <span className="dt-evi-title">{evidenceCard.title}</span>
                </div>
                {evidenceCard.lines.length > 0 ? (
                  <div className="dt-evi-lines">
                    {evidenceCard.lines.map((line, index) => (
                      <div className="dt-evi-line" key={`${line.label}-${index}`}>
                        <span className="dt-evi-label">{line.label}</span>
                        <span className="dt-evi-value">{line.value}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {evidenceCard.note ? (
                  <div className="dt-evi-note">{evidenceCard.note}</div>
                ) : null}
              </div>
            ) : null}

            {node.type === "question" ? (
              <>
                <div className="dt-options">
                  {node.options.map((option, index) => {
                    const recommended = index === recommendedIndex;
                    return (
                      <button
                        className={`dt-option${recommended ? " rec" : ""}${
                          option.next === null ? " todo" : ""
                        }`}
                        key={`${option.label}-${index}`}
                        onClick={() => chooseOption(option)}
                        type="button"
                      >
                        <span className="dt-option-label">{option.label}</span>
                        {recommended ? <span className="dt-tag rec">数据倾向</span> : null}
                        {STATUS_TAG[option.status] ? (
                          <span className="dt-tag">{STATUS_TAG[option.status]}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                {/* 没有选项被命中时不摆理由，免得出现"有说明却没高亮"的怪状态 */}
                {evidenceCard?.recommend && recommendedIndex >= 0 ? (
                  <div className="dt-why">
                    {evidenceCard.recommend.why}数据只做提示，最终以现场实测为准。
                  </div>
                ) : null}
              </>
            ) : null}

            {todoNote ? <div className="system-note">{todoNote}</div> : null}

            {node.type === "result" ? (
              <>
                <div className="gd-tools">
                  <Link className="sensor-settings-btn gd-tool-link" href="/timeline">
                    事件时间线
                  </Link>
                  <Link className="sensor-settings-btn gd-tool-link" href="/signals">
                    信号对比
                  </Link>
                  <Link className="sensor-settings-btn gd-tool-link" href="/health">
                    一键体检
                  </Link>
                  <Link className="sensor-settings-btn gd-tool-link" href="/knowledge">
                    知识库
                  </Link>
                </div>

                <div className="gd-verdict">
                  <button
                    className="gd-verdict-btn ok"
                    onClick={() => {
                      setTreeDone("ok");
                      setView("start");
                    }}
                    type="button"
                  >
                    故障已排除
                  </button>
                  <button
                    className="gd-verdict-btn no"
                    onClick={() => setTreeDone("no")}
                    type="button"
                  >
                    仍未解决
                  </button>
                </div>

                {treeDone === "no" ? (
                  <div className="gd-next">
                    <div className="gd-next-title">按这条路径没解决，接着做这三件事</div>
                    <ol className="gd-next-list">
                      <li>点上方「上一步」回到最近一个拿不准的问题，换一个答案再走一遍。</li>
                      <li>
                        到
                        <Link className="gd-hint-link" href="/knowledge">
                          知识库
                        </Link>
                        调本机型图纸，核对结论里点到的模块、接线腔与元件位置。
                      </li>
                      <li>把下面的「已走路径」连同现场实测值一并交给上一级，避免重复排查。</li>
                    </ol>
                  </div>
                ) : null}
              </>
            ) : null}

            {path.length > 0 ? (
              <div className="dt-path">
                <div className="dt-path-head">已走路径</div>
                {path.map((step, index) => (
                  <div className="dt-path-item" key={`${step.nodeId}-${index}`}>
                    <span className="dt-path-no">{index + 1}</span>
                    <span className="dt-path-q">{step.question}</span>
                    <span className="dt-path-a">{step.answer}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {/* ===== 故障现场：结论 + 曲线 + 前后 5 分钟操作与异常 ===== */}
        {frame ? (
          <div
            className="fc-modal-backdrop"
            onClick={() => {
              setFrame(null);
              setFrameSignal(null);
            }}
          >
            <div className="fc-modal ff-modal" onClick={(event) => event.stopPropagation()}>
              <div className="fc-modal-head">
                <span className="fc-modal-code">{fmtClock(frame.ts)}</span>
                <h2 className="fc-modal-title">
                  {frameSignal ? frameSignal.name : (frame.faultName ?? "故障现场")}
                </h2>
              </div>
              {frameSignal ? (
                <FreezeFrameSignalView markTs={frame.ts} signal={frameSignal} />
              ) : (
                <FreezeFrameBody frame={frame} onPickSignal={setFrameSignal} />
              )}
              <button
                className="fc-modal-close"
                onClick={() => {
                  if (frameSignal) {
                    setFrameSignal(null);
                    return;
                  }
                  setFrame(null);
                }}
                type="button"
              >
                {frameSignal ? "‹ 返回故障现场" : "关 闭"}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
