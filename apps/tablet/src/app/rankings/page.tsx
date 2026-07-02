"use client";

import {
  DataWindowSchema,
  FaultRulesResponseSchema,
  RankingsResponseSchema,
  createApiSuccessResponseSchema,
  type FaultRuleItem,
  type RankingItem,
  type RankingsResponse,
  type RankingSystemFilter,
} from "@shearer/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";

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

const systemOptions: Array<{ label: string; value: RankingSystemFilter }> = [
  { label: "全部", value: "all" },
  { label: "液压", value: "hydraulic" },
  { label: "截割", value: "cutting" },
  { label: "牵引", value: "traction" },
];

const HIDDEN_FAULTS_KEY = "shearer.faults.hidden";

const loadHiddenFaults = (): Set<number> => {
  try {
    const raw = window.localStorage.getItem(HIDDEN_FAULTS_KEY);
    return raw ? new Set(JSON.parse(raw) as number[]) : new Set();
  } catch {
    return new Set();
  }
};

const saveHiddenFaults = (hidden: Set<number>) => {
  try {
    window.localStorage.setItem(HIDDEN_FAULTS_KEY, JSON.stringify([...hidden]));
  } catch {
    // 存储不可用时本次会话内仍生效
  }
};

const pad = (n: number) => String(n).padStart(2, "0");

const fmtDateTime = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fmtDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/* ===== 双滑块时间范围选择（限制在数据存在的窗口内） ===== */
type DualRangeSliderProps = {
  minMs: number;
  maxMs: number;
  fromMs: number;
  toMs: number;
  onChange: (fromMs: number, toMs: number) => void;
};

function DualRangeSlider({ minMs, maxMs, fromMs, toMs, onChange }: DualRangeSliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<"from" | "to" | null>(null);
  const span = Math.max(1, maxMs - minMs);
  const minGapMs = Math.max(60_000, span * 0.01); // 最小选择跨度

  const ratioOf = (ms: number) => ((ms - minMs) / span) * 100;

  const msFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      return minMs;
    }
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(minMs + ratio * span);
  };

  const handleMove = (clientX: number) => {
    const which = draggingRef.current;
    if (!which) {
      return;
    }
    const ms = msFromClientX(clientX);
    if (which === "from") {
      onChange(Math.max(minMs, Math.min(ms, toMs - minGapMs)), toMs);
    } else {
      onChange(fromMs, Math.min(maxMs, Math.max(ms, fromMs + minGapMs)));
    }
  };

  const startDrag = (which: "from" | "to") => (event: React.PointerEvent) => {
    draggingRef.current = which;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  return (
    <div className="range-slider">
      <div
        className="range-slider-track"
        onPointerDown={(event) => {
          // 点击轨道：移动较近的一端
          const ms = msFromClientX(event.clientX);
          if (Math.abs(ms - fromMs) <= Math.abs(ms - toMs)) {
            onChange(Math.max(minMs, Math.min(ms, toMs - minGapMs)), toMs);
          } else {
            onChange(fromMs, Math.min(maxMs, Math.max(ms, fromMs + minGapMs)));
          }
        }}
        ref={trackRef}
      >
        <div
          className="range-slider-fill"
          style={{ left: `${ratioOf(fromMs)}%`, width: `${ratioOf(toMs) - ratioOf(fromMs)}%` }}
        />
        {(["from", "to"] as const).map((which) => (
          <div
            className="range-slider-thumb"
            key={which}
            onPointerDown={startDrag(which)}
            onPointerMove={(event) => handleMove(event.clientX)}
            onPointerUp={() => {
              draggingRef.current = null;
            }}
            style={{ left: `${ratioOf(which === "from" ? fromMs : toMs)}%` }}
          />
        ))}
      </div>
      <div className="range-slider-scale">
        <span>{fmtDateTime(minMs)}</span>
        <span>{fmtDateTime(maxMs)}</span>
      </div>
    </div>
  );
}

type RankingPanelProps = {
  items: RankingItem[];
  loading: boolean;
  title: string;
};

function RankingPanel({ items, loading, title }: RankingPanelProps) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3 className="panel-title">
            <span className="accent-bar" />
            {title}
          </h3>
        </div>
      </div>
      <div className="panel-body">
        <div className="list">
          {loading ? (
            <div className="empty">正在加载排名数据...</div>
          ) : items.length === 0 ? (
            <div className="empty">该时间段内暂无记录。</div>
          ) : (
            items.map((item, index) => (
              <div className="rank-item" key={`${item.name}-${item.lastOccurredAt}`}>
                <div className="rank-left">
                  <div className="rank-top">
                    <span className="rank-index">{index + 1}</span>
                    <div className="rank-name">{item.name}</div>
                  </div>
                  <div className="meta-line">最近一次 {item.lastOccurredAt}</div>
                </div>
                <div className="rank-count">{item.count} 次</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

type ViewMode = "range" | "list" | "settings";

export default function RankingsPage() {
  const shellState = useAppShellState();
  const [view, setView] = useState<ViewMode>("range");
  const [dataWindow, setDataWindow] = useState<{ min: number; max: number } | null>(null);
  const [fromMs, setFromMs] = useState(0);
  const [toMs, setToMs] = useState(0);
  const [system, setSystem] = useState<RankingSystemFilter>("all");
  const [rankings, setRankings] = useState<RankingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [faultRules, setFaultRules] = useState<FaultRuleItem[]>([]);
  const [hiddenFaults, setHiddenFaults] = useState<Set<number>>(new Set());
  const [faultSearch, setFaultSearch] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 数据窗口 + 故障目录 + 本机隐藏配置
  useEffect(() => {
    setHiddenFaults(loadHiddenFaults());

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

  const loadRankings = async (
    nextFrom: number,
    nextTo: number,
    nextSystem: RankingSystemFilter,
  ) => {
    try {
      setLoading(true);
      const query = `start=${fmtDate(nextFrom)}&end=${fmtDate(nextTo)}&system=${nextSystem}&from=${nextFrom}&to=${nextTo}`;
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

  // 隐藏配置：按故障名过滤排名条目
  const hiddenNames = useMemo(() => {
    const names = new Set<string>();
    for (const rule of faultRules) {
      if (hiddenFaults.has(rule.code)) {
        names.add(rule.name);
      }
    }
    return names;
  }, [faultRules, hiddenFaults]);

  const filterItems = (items: RankingItem[]) => items.filter((i) => !hiddenNames.has(i.name));

  const toggleFault = (code: number) => {
    setHiddenFaults((current) => {
      const next = new Set(current);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      saveHiddenFaults(next);
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
            <p className="range-picker-sub">
              拖动两端滑块选择统计时间段（仅限数据库中有数据的范围）
            </p>
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
                    void loadRankings(fromMs, toMs, system);
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
                const isShown = !hiddenFaults.has(rule.code);
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
          /* ===== 排名列表 ===== */
          <>
            <div className="sensor-topbar">
              <button className="sensor-back-btn" onClick={() => setView("range")} type="button">
                重新选择时间
              </button>
              <span className="range-picker-current">
                {fmtDateTime(fromMs)} → {fmtDateTime(toMs)}
              </span>
              <div className="sensor-type-bar" style={{ margin: 0, marginLeft: "auto" }}>
                {systemOptions.map((option) => (
                  <button
                    className={`sensor-type-chip${system === option.value ? " active" : ""}`}
                    key={option.value}
                    onClick={() => {
                      setSystem(option.value);
                      void loadRankings(fromMs, toMs, option.value);
                    }}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid-3">
              <RankingPanel
                items={filterItems(rankings?.systemFaultRankings ?? [])}
                loading={loading}
                title="系统故障排名"
              />
              <RankingPanel
                items={filterItems(rankings?.inverterFaultRankings ?? [])}
                loading={loading}
                title="变频器故障排名"
              />
              <RankingPanel
                items={filterItems(rankings?.sensorFaultRankings ?? [])}
                loading={loading}
                title="传感器故障排名"
              />
            </div>

            <div className="sensor-pager" style={{ justifyContent: "center" }}>
              <button
                className="sensor-settings-btn"
                onClick={() => setView("settings")}
                type="button"
              >
                故障设置
              </button>
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}
