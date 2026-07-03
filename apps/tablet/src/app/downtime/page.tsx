"use client";

import {
  DataWindowSchema,
  DowntimeResponseSchema,
  createApiSuccessResponseSchema,
  type DowntimeResponse,
  type DowntimeSegment,
} from "@shearer/contracts";
import { useEffect, useMemo, useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";
import { DualRangeSlider, fmtSliderDateTime } from "@/components/dual-range-slider";

const DataWindowApiResponseSchema = createApiSuccessResponseSchema(DataWindowSchema);
const DowntimeApiResponseSchema = createApiSuccessResponseSchema(DowntimeResponseSchema);

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

const pad = (n: number) => String(n).padStart(2, "0");

const fmtClock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const fmtDuration = (ms: number) => {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) {
    return `${sec} 秒`;
  }
  if (sec < 3600) {
    return `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
  }
  return `${Math.floor(sec / 3600)} 小时 ${Math.floor((sec % 3600) / 60)} 分`;
};

const fmtHours = (ms: number) => `${(ms / 3_600_000).toFixed(1)} 小时`;

// 状态段展示配置
const SEG_STYLE: Record<string, { label: string; color: string }> = {
  cutting: { label: "割煤", color: "#38d889" },
  dispatch: { label: "调度移机", color: "#48c7ff" },
  "stopped-fault": { label: "故障停机", color: "#ff5c5c" },
  "stopped-manual": { label: "人工停机", color: "#ffb03a" },
  "stopped-idle": { label: "待机", color: "#8fa3bf" },
  poweroff: { label: "断电检修", color: "#3a4353" },
};

const segKey = (seg: DowntimeSegment) =>
  seg.state === "stopped" ? `stopped-${seg.cause ?? "idle"}` : seg.state;

// handle 形如 "1.xxx。2.xxx。" → 拆条
const splitHandle = (handle: string): string[] =>
  handle
    .split(/\d+[.、](?=[^\d])/)
    .map((part) => part.trim())
    .filter(Boolean);

type ViewMode = "range" | "result";

export default function DowntimePage() {
  const shellState = useAppShellState();
  const [view, setView] = useState<ViewMode>("range");
  const [dataWindow, setDataWindow] = useState<{ min: number; max: number } | null>(null);
  const [fromMs, setFromMs] = useState(0);
  const [toMs, setToMs] = useState(0);
  const [data, setData] = useState<DowntimeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<DowntimeSegment | null>(null);
  const [page, setPage] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const response = await fetch(`${resolveHttpBase()}/api/data-window`, { cache: "no-store" });
        const parsed = DataWindowApiResponseSchema.parse(await response.json());
        if (cancelled) {
          return;
        }
        const { fromMs: lo, toMs: hi } = parsed.data;
        if (lo !== null && hi !== null && hi > lo) {
          setDataWindow({ min: lo, max: hi });
          setFromMs(lo);
          setToMs(hi);
        }
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

  const analyze = async (lo: number, hi: number) => {
    try {
      setLoading(true);
      const response = await fetch(`${resolveHttpBase()}/api/downtime?from=${lo}&to=${hi}`, {
        cache: "no-store",
      });
      const parsed = DowntimeApiResponseSchema.parse(await response.json());
      setData(parsed.data);
      setPage(0);
      setErrorMessage(null);
    } catch {
      setErrorMessage("停机分析加载失败。");
    } finally {
      setLoading(false);
    }
  };

  const stoppedSegs = useMemo(
    () => (data ? data.segments.filter((s) => s.state === "stopped") : []),
    [data],
  );

  const PAGE_SIZE = 5;
  const totalPages = Math.max(1, Math.ceil(stoppedSegs.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedStops = stoppedSegs.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const span = data ? data.toMs - data.fromMs : 1;

  return (
    <AppShell hideFloatingHome={detail !== null} shellState={shellState} title="停机分析">
      <section className="page active">
        {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

        {view === "range" ? (
          <div className="range-picker">
            <h1 className="range-picker-title">选择分析时间范围</h1>
            {dataWindow ? (
              <>
                <div className="range-picker-values">
                  <div className="range-picker-value">
                    <span>开始</span>
                    <strong>{fmtSliderDateTime(fromMs)}</strong>
                  </div>
                  <div className="range-picker-arrow">→</div>
                  <div className="range-picker-value">
                    <span>结束</span>
                    <strong>{fmtSliderDateTime(toMs)}</strong>
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
                    setView("result");
                    void analyze(fromMs, toMs);
                  }}
                  type="button"
                >
                  开始分析
                </button>
              </>
            ) : (
              <div className="empty">正在读取数据时间范围...</div>
            )}
          </div>
        ) : (
          <>
            <div className="sensor-topbar">
              <button className="sensor-back-btn" onClick={() => setView("range")} type="button">
                重新选择时间
              </button>
              <span className="range-picker-current">
                {fmtSliderDateTime(fromMs)} → {fmtSliderDateTime(toMs)}
              </span>
            </div>

            {loading || !data ? (
              <div className="empty">正在分析停机数据...</div>
            ) : (
              <>
                <div className="dt-kpis">
                  <div className="dt-kpi">
                    <span>割煤时长</span>
                    <strong style={{ color: "#38d889" }}>{fmtHours(data.kpis.cuttingMs)}</strong>
                  </div>
                  <div className="dt-kpi">
                    <span>割煤率（通电口径）</span>
                    <strong style={{ color: "#38d889" }}>{data.kpis.cuttingRatePct}%</strong>
                  </div>
                  <div className="dt-kpi">
                    <span>停机次数</span>
                    <strong style={{ color: "#ff5c5c" }}>{data.kpis.stoppedCount}</strong>
                  </div>
                  <div className="dt-kpi">
                    <span>停机总时长</span>
                    <strong style={{ color: "#ff5c5c" }}>{fmtHours(data.kpis.stoppedMs)}</strong>
                  </div>
                  <div className="dt-kpi">
                    <span>最长单次停机</span>
                    <strong style={{ color: "#ffb03a" }}>
                      {fmtDuration(data.kpis.longestStoppedMs)}
                    </strong>
                  </div>
                  <div className="dt-kpi">
                    <span>断电检修</span>
                    <strong style={{ color: "#8fa3bf" }}>{fmtHours(data.kpis.poweroffMs)}</strong>
                  </div>
                </div>

                <div className="dt-band">
                  {data.segments.map((seg, index) => {
                    const style = SEG_STYLE[segKey(seg)];
                    return (
                      <button
                        className="dt-band-seg"
                        key={index}
                        onClick={() => setDetail(seg)}
                        style={{
                          left: `${((seg.fromMs - data.fromMs) / span) * 100}%`,
                          width: `${Math.max(0.15, ((seg.toMs - seg.fromMs) / span) * 100)}%`,
                          background: style.color,
                        }}
                        title={style.label}
                        type="button"
                      />
                    );
                  })}
                </div>
                <div className="dt-legend">
                  {Object.values(SEG_STYLE).map((s) => (
                    <span className="dt-legend-item" key={s.label}>
                      <span className="dt-legend-dot" style={{ background: s.color }} />
                      {s.label}
                    </span>
                  ))}
                </div>

                <div className="panel rank-total-panel">
                  <div className="panel-head">
                    <div>
                      <h3 className="panel-title">
                        <span className="accent-bar" />
                        停机事件（{stoppedSegs.length} 次）
                      </h3>
                    </div>
                    <span className="rank-page-info">
                      {safePage + 1} / {totalPages}
                    </span>
                  </div>
                  <div className="panel-body">
                    <div className="list">
                      {pagedStops.length === 0 ? (
                        <div className="empty">该时间段内没有停机事件。</div>
                      ) : (
                        pagedStops.map((seg, index) => {
                          const style = SEG_STYLE[segKey(seg)];
                          return (
                            <button
                              className="rank-item rank-item-btn"
                              key={`${seg.fromMs}-${index}`}
                              onClick={() => setDetail(seg)}
                              type="button"
                            >
                              <div className="rank-left">
                                <div className="rank-top">
                                  <span
                                    className="lf-tag"
                                    style={{
                                      background: `${style.color}26`,
                                      color: style.color,
                                    }}
                                  >
                                    {style.label}
                                  </span>
                                  <div className="rank-name">{seg.causeText ?? style.label}</div>
                                </div>
                                <div className="meta-line" style={{ marginTop: 6 }}>
                                  {fmtClock(seg.fromMs)} → {fmtClock(seg.toMs)}
                                </div>
                              </div>
                              <div className="rank-count" style={{ color: style.color }}>
                                {fmtDuration(seg.toMs - seg.fromMs)}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                {stoppedSegs.length > PAGE_SIZE ? (
                  <div className="sensor-pager">
                    <button onClick={() => setPage(Math.max(0, safePage - 1))} type="button">
                      ‹ 上一页
                    </button>
                    <span className="rank-page-info">
                      第 {safePage + 1} / {totalPages} 页
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
            )}
          </>
        )}

        {detail ? (
          <div className="fc-modal-backdrop" onClick={() => setDetail(null)}>
            <div className="fc-modal" onClick={(event) => event.stopPropagation()}>
              <div className="fc-modal-head">
                <span
                  className="fc-modal-code"
                  style={{
                    color: SEG_STYLE[segKey(detail)].color,
                    borderColor: `${SEG_STYLE[segKey(detail)].color}66`,
                    background: `${SEG_STYLE[segKey(detail)].color}1f`,
                  }}
                >
                  {SEG_STYLE[segKey(detail)].label}
                </span>
                <h2 className="fc-modal-title">
                  {detail.state === "stopped"
                    ? detail.causeText ?? "停机"
                    : SEG_STYLE[segKey(detail)].label}
                </h2>
              </div>
              <p className="fc-modal-desc">
                {fmtClock(detail.fromMs)} → {fmtClock(detail.toMs)} · 持续{" "}
                {fmtDuration(detail.toMs - detail.fromMs)}
              </p>
              {detail.faults && detail.faults.length > 0 ? (
                <>
                  <div className="fc-modal-sub">期间停机级故障</div>
                  <ol className="fc-modal-suggestions">
                    {detail.faults.map((f, i) => (
                      <li key={i}>
                        {f.name}（{fmtClock(f.occurTs)}）
                        {f.handle ? (
                          <div style={{ fontSize: 18, color: "var(--text-2)", marginTop: 4 }}>
                            {splitHandle(f.handle).join("；")}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </>
              ) : null}
              {detail.actions && detail.actions.length > 0 ? (
                <>
                  <div className="fc-modal-sub">停机前后的操作记录</div>
                  <ol className="fc-modal-suggestions">
                    {detail.actions.map((a, i) => (
                      <li key={i}>
                        {fmtClock(a.ts)} · {a.source} {a.op}（{a.action}）
                      </li>
                    ))}
                  </ol>
                </>
              ) : null}
              {detail.state === "poweroff" ? (
                <p className="fc-modal-desc">
                  该时段无任何数据记录——设备断电，属于检修班或计划性停电。
                </p>
              ) : null}
              <button className="fc-modal-close" onClick={() => setDetail(null)} type="button">
                关 闭
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
