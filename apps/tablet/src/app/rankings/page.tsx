"use client";

import {
  DataWindowSchema,
  FaultRulesResponseSchema,
  RankingsResponseSchema,
  createApiSuccessResponseSchema,
  type FaultRuleItem,
  type RankingsResponse,
} from "@shearer/contracts";
import { useEffect, useMemo, useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";
import { DualRangeSlider } from "@/components/dual-range-slider";

const RankingsApiResponseSchema = createApiSuccessResponseSchema(RankingsResponseSchema);
const DataWindowApiResponseSchema = createApiSuccessResponseSchema(DataWindowSchema);
const FaultRulesApiResponseSchema = createApiSuccessResponseSchema(FaultRulesResponseSchema);

const resolveHttpBase = () => {
  if (typeof window === "undefined") {
    return "";
  }

  if (process.env.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }

  const { protocol, hostname, port } = window.location;

  if ((hostname === "localhost" || hostname === "127.0.0.1") && port === "3000") {
    return `${protocol}//${hostname}:18080`;
  }

  return `${protocol}//${window.location.host}`;
};

const FAULT_PREFS_KEY = "shearer.faults.prefs";

// 状态类信息（非故障）默认隐藏：type=0 提示类，或名称明显是运行状态
const STATUS_NAME_RE = /运行中|输出转矩|连接OK|接通。|已就绪/;

type FaultPrefs = { hidden: Set<number>; shown: Set<number> };

const loadFaultPrefs = (): FaultPrefs => {
  try {
    const raw = window.localStorage.getItem(FAULT_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { hidden?: number[]; shown?: number[] };
      return { hidden: new Set(parsed.hidden ?? []), shown: new Set(parsed.shown ?? []) };
    }
    // 兼容旧格式（纯隐藏数组）
    const legacy = window.localStorage.getItem("shearer.faults.hidden");
    if (legacy) {
      return { hidden: new Set(JSON.parse(legacy) as number[]), shown: new Set() };
    }
  } catch {
    // 解析失败当作无配置
  }
  return { hidden: new Set(), shown: new Set() };
};

const saveFaultPrefs = (prefs: FaultPrefs) => {
  try {
    window.localStorage.setItem(
      FAULT_PREFS_KEY,
      JSON.stringify({ hidden: [...prefs.hidden], shown: [...prefs.shown] }),
    );
  } catch {
    // 存储不可用时本次会话内仍生效
  }
};

const TYPE_TEXT = ["提示", "警告", "停机"];
const KIND_TEXT: Record<number, string> = {
  1: "变频器", 2: "电机", 3: "模块", 4: "传感器", 5: "自动化", 6: "内部", 7: "来源",
};

// handle 形如 "1.xxx。2.xxx。3.xxx。" → 拆成建议条目
const splitHandle = (handle?: string): string[] =>
  (handle ?? "")
    .split(/\d+[.、]/)
    .map((part) => part.trim())
    .filter(Boolean);

const pad = (n: number) => String(n).padStart(2, "0");

const fmtDateTime = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fmtDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

type ViewMode = "range" | "list" | "settings";

export default function RankingsPage() {
  const shellState = useAppShellState();
  const [view, setView] = useState<ViewMode>("range");
  const [dataWindow, setDataWindow] = useState<{ min: number; max: number } | null>(null);
  const [fromMs, setFromMs] = useState(0);
  const [toMs, setToMs] = useState(0);
  const [rankings, setRankings] = useState<RankingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [faultRules, setFaultRules] = useState<FaultRuleItem[]>([]);
  const [faultPrefs, setFaultPrefs] = useState<FaultPrefs>({ hidden: new Set(), shown: new Set() });
  const [faultSearch, setFaultSearch] = useState("");
  const [page, setPage] = useState(0);
  const [detailRule, setDetailRule] = useState<FaultRuleItem | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 数据窗口 + 故障目录 + 本机隐藏配置
  useEffect(() => {
    setFaultPrefs(loadFaultPrefs());

    let cancelled = false;
    const init = async () => {
      try {
        const [windowRes, rulesRes] = await Promise.all([
          fetch(`${resolveHttpBase()}/api/data-window`, { cache: "no-store" }),
          fetch(`${resolveHttpBase()}/api/fault-rules`, { cache: "no-store" }),
        ]);
        const parsedWindow = DataWindowApiResponseSchema.parse(await windowRes.json());
        const parsedRules = FaultRulesApiResponseSchema.parse(await rulesRes.json());
        if (cancelled) {
          return;
        }
        setFaultRules(parsedRules.data);
        const { fromMs: lo, toMs: hi } = parsedWindow.data;
        if (lo !== null && hi !== null && hi > lo) {
          setDataWindow({ min: lo, max: hi });
          setFromMs(lo);
          setToMs(hi);
        }
        setErrorMessage(null);
      } catch {
        if (!cancelled) {
          setErrorMessage("加载失败，请确认服务已启动。");
        }
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadRankings = async (nextFrom: number, nextTo: number) => {
    try {
      setLoading(true);
      const query = `start=${fmtDate(nextFrom)}&end=${fmtDate(nextTo)}&system=all&from=${nextFrom}&to=${nextTo}`;
      const response = await fetch(`${resolveHttpBase()}/api/rankings?${query}`, {
        cache: "no-store",
      });
      const parsed = RankingsApiResponseSchema.parse(await response.json());
      setRankings(parsed.data);
      setErrorMessage(null);
    } catch {
      setErrorMessage("故障排名加载失败。");
    } finally {
      setLoading(false);
    }
  };

  // 生效的隐藏集合：状态类默认隐藏 + 手动隐藏 − 手动重新打开
  const effectiveHidden = useMemo(() => {
    const result = new Set<number>();
    for (const rule of faultRules) {
      if (rule.type === 0 || STATUS_NAME_RE.test(rule.name)) {
        result.add(rule.code);
      }
    }
    for (const code of faultPrefs.hidden) {
      result.add(code);
    }
    for (const code of faultPrefs.shown) {
      result.delete(code);
    }
    return result;
  }, [faultRules, faultPrefs]);

  const rulesByName = useMemo(() => {
    const map = new Map<string, FaultRuleItem>();
    for (const rule of faultRules) {
      map.set(rule.name, rule);
    }
    return map;
  }, [faultRules]);

  const hiddenNames = useMemo(() => {
    const names = new Set<string>();
    for (const rule of faultRules) {
      if (effectiveHidden.has(rule.code)) {
        names.add(rule.name);
      }
    }
    return names;
  }, [faultRules, effectiveHidden]);

  // 过滤隐藏故障后计算占比（分母 = 剩余故障的发生总次数）
  const shownRankings = useMemo(() => {
    const items = (rankings?.systemFaultRankings ?? []).filter((i) => !hiddenNames.has(i.name));
    const total = items.reduce((sum, i) => sum + i.count, 0);
    return items.map((i) => ({
      name: i.name,
      sharePct: total > 0 ? Number(((i.count / total) * 100).toFixed(1)) : 0,
    }));
  }, [rankings, hiddenNames]);

  const PAGE_SIZE = 5;
  const totalPages = Math.max(1, Math.ceil(shownRankings.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedRankings = shownRankings.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const toggleFault = (code: number) => {
    setFaultPrefs((current) => {
      const next: FaultPrefs = { hidden: new Set(current.hidden), shown: new Set(current.shown) };
      if (effectiveHidden.has(code)) {
        next.shown.add(code);
        next.hidden.delete(code);
      } else {
        next.hidden.add(code);
        next.shown.delete(code);
      }
      saveFaultPrefs(next);
      return next;
    });
  };

  const shownRules = useMemo(() => {
    const text = faultSearch.trim().toLowerCase();
    if (!text) {
      return faultRules;
    }
    return faultRules.filter(
      (r) => r.name.toLowerCase().includes(text) || String(r.code).includes(text),
    );
  }, [faultRules, faultSearch]);

  return (
    <AppShell hideFloatingHome={view === "settings"} shellState={shellState} title="近期故障排名">
      <section className="page active">
        {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

        {view === "range" ? (
          /* ===== 第一步：大号时间范围选择 ===== */
          <div className="range-picker">
            <h1 className="range-picker-title">选择时间范围</h1>
            {dataWindow ? (
              <>
                <div className="range-picker-values">
                  <div className="range-picker-value">
                    <span>开始</span>
                    <strong>{fmtDateTime(fromMs)}</strong>
                  </div>
                  <div className="range-picker-arrow">→</div>
                  <div className="range-picker-value">
                    <span>结束</span>
                    <strong>{fmtDateTime(toMs)}</strong>
                  </div>
                </div>
                <DualRangeSlider
                  fromMs={fromMs}
                  maxMs={dataWindow.max}
                  minMs={dataWindow.min}
                  onChange={(f, t) => {
                    setFromMs(f);
                    setToMs(t);
                  }}
                  toMs={toMs}
                />
                <button
                  className="range-picker-confirm"
                  onClick={() => {
                    setView("list");
                    void loadRankings(fromMs, toMs);
                  }}
                  type="button"
                >
                  查看排名
                </button>
              </>
            ) : (
              <div className="empty">正在读取数据时间范围...</div>
            )}
          </div>
        ) : view === "settings" ? (
          /* ===== 故障设置：搜索 + 显示/隐藏 ===== */
          <>
            <div className="sensor-detail-head">
              <button className="sensor-back-btn" onClick={() => setView("list")} type="button">
                ‹ 返回排名
              </button>
              <h1 className="sensor-detail-title">故障设置</h1>
            </div>
            <input
              className="sensor-search"
              onChange={(event) => setFaultSearch(event.target.value)}
              placeholder="搜索故障名称 / 故障码"
              type="search"
              value={faultSearch}
            />
            {shownRules.length === 0 ? (
              <div className="empty">没有匹配的故障条目。</div>
            ) : (
              shownRules.map((rule) => {
                const isShown = !effectiveHidden.has(rule.code);
                return (
                  <div className="sensor-toggle-row" key={rule.code}>
                    <div>
                      <div className="sensor-toggle-name">{rule.name}</div>
                      <div className="sensor-toggle-meta">故障码 {rule.code}</div>
                    </div>
                    <button
                      className={`sensor-switch${isShown ? " on" : ""}`}
                      onClick={() => toggleFault(rule.code)}
                      type="button"
                    >
                      {isShown ? "显示中" : "已隐藏"}
                    </button>
                  </div>
                );
              })
            )}
          </>
        ) : (
          /* ===== 排名列表：普通故障总排名（按占比） ===== */
          <>
            <div className="sensor-topbar">
              <button className="sensor-back-btn" onClick={() => setView("range")} type="button">
                重新选择时间
              </button>
              <span className="range-picker-current">
                {fmtDateTime(fromMs)} → {fmtDateTime(toMs)}
              </span>
            </div>

            <div className="panel rank-total-panel">
              <div className="panel-head">
                <div>
                  <h3 className="panel-title">
                    <span className="accent-bar" />
                    故障总排名
                  </h3>
                </div>
                <span className="rank-page-info">
                  {safePage + 1} / {totalPages}
                </span>
              </div>
              <div className="panel-body">
                <div className="list">
                  {loading ? (
                    <div className="empty">正在加载排名数据...</div>
                  ) : pagedRankings.length === 0 ? (
                    <div className="empty">该时间段内暂无故障记录。</div>
                  ) : (
                    pagedRankings.map((item, index) => (
                      <button
                        className="rank-item rank-item-btn"
                        key={item.name}
                        onClick={() => setDetailRule(rulesByName.get(item.name) ?? null)}
                        type="button"
                      >
                        <div className="rank-left">
                          <div className="rank-top">
                            <span className="rank-index">{safePage * PAGE_SIZE + index + 1}</span>
                            <div className="rank-name">{item.name}</div>
                          </div>
                        </div>
                        <div
                          className={`rank-count rank-count-type${rulesByName.get(item.name)?.type ?? 1}`}
                        >
                          {item.sharePct}%
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="sensor-pager">
              <button
                onClick={() => setPage(Math.max(0, safePage - 1))}
                type="button"
              >
                ‹ 上一页
              </button>
              <button
                className="sensor-settings-btn"
                onClick={() => setView("settings")}
                type="button"
              >
                故障设置
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
                type="button"
              >
                下一页 ›
              </button>
            </div>
          </>
        )}

        {/* 故障详情弹窗：处理建议 + 类型/类别 */}
        {detailRule ? (
          <div className="fc-modal-backdrop" onClick={() => setDetailRule(null)}>
            <div className="fc-modal" onClick={(event) => event.stopPropagation()}>
              <div className="fc-modal-head">
                <span className="fc-modal-code">{detailRule.code}</span>
                <h2 className="fc-modal-title">{detailRule.name}</h2>
              </div>
              <p className="fc-modal-desc">
                类型：{TYPE_TEXT[detailRule.type] ?? detailRule.type} · 类别：
                {KIND_TEXT[detailRule.kind] ?? detailRule.kind}
              </p>
              {splitHandle(detailRule.handle).length > 0 ? (
                <>
                  <div className="fc-modal-sub">处理建议</div>
                  <ol className="fc-modal-suggestions">
                    {splitHandle(detailRule.handle).map((tip, index) => (
                      <li key={index}>{tip}</li>
                    ))}
                  </ol>
                </>
              ) : null}
              <button className="fc-modal-close" onClick={() => setDetailRule(null)} type="button">
                关 闭
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
