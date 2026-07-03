"use client";

import {
  DataWindowSchema,
  TimelineResponseSchema,
  createApiSuccessResponseSchema,
  type TimelineEvent,
} from "@shearer/contracts";
import { useEffect, useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";
import { DualRangeSlider, fmtSliderDateTime } from "@/components/dual-range-slider";

const DataWindowApiResponseSchema = createApiSuccessResponseSchema(DataWindowSchema);
const TimelineApiResponseSchema = createApiSuccessResponseSchema(TimelineResponseSchema);

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

const TONE_COLOR: Record<TimelineEvent["tone"], string> = {
  stop: "#ff5c5c",
  warn: "#ffb03a",
  ok: "#38d889",
  op: "#48c7ff",
  state: "#a78bfa",
};

const KIND_LABEL: Record<TimelineEvent["kind"], string> = {
  fault: "故障",
  clear: "消除",
  op: "操作",
  state: "状态",
};

type ViewMode = "range" | "list";

export default function TimelinePage() {
  const shellState = useAppShellState();
  const [view, setView] = useState<ViewMode>("range");
  const [dataWindow, setDataWindow] = useState<{ min: number; max: number } | null>(null);
  const [fromMs, setFromMs] = useState(0);
  const [toMs, setToMs] = useState(0);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | TimelineEvent["kind"]>("all");
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
          // 默认最近 1 小时
          setFromMs(Math.max(lo, hi - 3_600_000));
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

  const load = async (lo: number, hi: number) => {
    try {
      setLoading(true);
      const response = await fetch(`${resolveHttpBase()}/api/event-timeline?from=${lo}&to=${hi}`, {
        cache: "no-store",
      });
      const parsed = TimelineApiResponseSchema.parse(await response.json());
      setEvents(parsed.data.events);
      setErrorMessage(null);
    } catch {
      setErrorMessage("时间线加载失败。");
    } finally {
      setLoading(false);
    }
  };

  const shown = filter === "all" ? events : events.filter((e) => e.kind === filter);

  return (
    <AppShell shellState={shellState} title="事件时间线">
      <section className="page active">
        {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

        {view === "range" ? (
          <div className="range-picker">
            <h1 className="range-picker-title">选择时间范围</h1>
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
                    setView("list");
                    void load(fromMs, toMs);
                  }}
                  type="button"
                >
                  查看时间线
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
              <div className="sensor-type-bar" style={{ margin: 0, marginLeft: "auto" }}>
                {(
                  [
                    ["all", "全部"],
                    ["fault", "故障"],
                    ["op", "操作"],
                    ["state", "状态"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    className={`sensor-type-chip${filter === key ? " active" : ""}`}
                    key={key}
                    onClick={() => setFilter(key)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="empty">正在加载事件...</div>
            ) : shown.length === 0 ? (
              <div className="empty">该时间段内没有事件。</div>
            ) : (
              <div className="tl-list">
                {shown.map((e, index) => (
                  <div className="tl-row" key={`${e.ts}-${index}`}>
                    <span className="tl-time">{fmtClock(e.ts)}</span>
                    <span className="tl-node" style={{ background: TONE_COLOR[e.tone] }} />
                    <span className="tl-kind" style={{ color: TONE_COLOR[e.tone] }}>
                      {KIND_LABEL[e.kind]}
                    </span>
                    <span className="tl-text">{e.text}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </AppShell>
  );
}
