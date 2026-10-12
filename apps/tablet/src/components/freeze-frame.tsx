"use client";

import type { FreezeFrame, FreezeFrameSignal } from "@shearer/contracts";
import { useState } from "react";
import { MiniChart, ZoomChart } from "@/components/mini-chart";

const pad = (n: number) => String(n).padStart(2, "0");

const fmtClock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** 相对故障时刻的偏移，负数在前。列表按这个对齐读起来最快 */
const fmtOffset = (offsetMs: number) => {
  const sec = Math.round(Math.abs(offsetMs) / 1000);
  const body = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${pad(sec % 60)}s`;
  return offsetMs < 0 ? `-${body}` : `+${body}`;
};

const CHANGE_COLOR: Record<FreezeFrameSignal["change"], string> = {
  "drop-zero": "#ff5c5c",
  drop: "#ffb03a",
  surge: "#ffb03a",
  none: "#48c7ff",
  invalid: "rgba(245,247,251,0.3)",
};

const TONE_CLASS: Record<string, string> = {
  stop: "lf-tag-stop",
  warn: "lf-tag-warn",
  ok: "lf-tag-ok",
  state: "lf-tag-internal",
};

type Tab = "signals" | "operations" | "events";

/** 结论卡：整个故障现场最先看的一块，排版按"先结论、再证据、最后免责"走。 */
function SummaryCard({ frame }: { frame: FreezeFrame }) {
  const { summary } = frame;
  return (
    <div className="ff-summary">
      <div className="ff-summary-head">
        <span className="ff-summary-badge">结论</span>
        <p className="ff-summary-headline">{summary.headline}</p>
      </div>

      {summary.findings.length > 0 || summary.context.length > 0 ? (
        <div className="ff-summary-cols">
          <div className="ff-summary-col">
            <div className="ff-summary-col-head">曲线上看到的</div>
            {summary.findings.length === 0 ? (
              <p className="ff-summary-none">各路信号在故障前后都没有明显突变</p>
            ) : (
              <ul className="ff-summary-list">
                {summary.findings.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            )}
          </div>
          <div className="ff-summary-col">
            <div className="ff-summary-col-head">前后的操作与异常</div>
            {summary.context.length === 0 ? (
              <p className="ff-summary-none">窗口内没有操作记录，也没有其他异常</p>
            ) : (
              <ul className="ff-summary-list">
                {summary.context.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {summary.caveats.length > 0 ? (
        <p className="ff-summary-caveat">{summary.caveats.join("；")}。</p>
      ) : null}
    </div>
  );
}

type FreezeFrameBodyProps = {
  frame: FreezeFrame;
  onPickSignal: (signal: FreezeFrameSignal) => void;
};

/** 故障现场主体：结论 + 曲线宫格 + 操作/异常记录。曲线点一下就放大。 */
export function FreezeFrameBody({ frame, onPickSignal }: FreezeFrameBodyProps) {
  const [tab, setTab] = useState<Tab>("signals");
  const changed = frame.signals.filter(
    (signal) => signal.change !== "none" && signal.change !== "invalid",
  ).length;

  return (
    <>
      <SummaryCard frame={frame} />

      <div className="hc-tabs ff-tabs">
        {(
          [
            ["signals", `曲线 ${frame.signals.length}${changed > 0 ? ` · ${changed} 路有变化` : ""}`],
            ["operations", `操作记录 ${frame.operations.length}`],
            ["events", `异常与状态 ${frame.events.length}`],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <button
            className={`hc-tab${tab === key ? " active" : ""}`}
            key={key}
            onClick={() => setTab(key)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "signals" ? (
        <div className="ff-grid">
          {frame.signals.map((signal) => (
            <button
              className={`ff-cell${signal.change === "invalid" ? " dim" : ""}`}
              key={signal.name}
              onClick={() => onPickSignal(signal)}
              type="button"
            >
              <MiniChart
                color={CHANGE_COLOR[signal.change]}
                markTs={frame.ts}
                name={signal.name}
                points={signal.points}
                unit={signal.unit}
              />
              <span className="ff-cell-foot" style={{ color: CHANGE_COLOR[signal.change] }}>
                {signal.changeText}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {tab === "operations" ? (
        frame.operations.length === 0 ? (
          <div className="empty">窗口内没有操作记录。</div>
        ) : (
          <div className="ff-timeline">
            {frame.operations.map((op, index) => (
              <div className={`ff-row${op.offsetMs <= 0 ? " before" : ""}`} key={index}>
                <span className="ff-row-offset">{fmtOffset(op.offsetMs)}</span>
                <span className="ff-row-clock">{fmtClock(op.ts)}</span>
                <span className={`lf-tag ${op.input ? "lf-tag-warn" : "lf-tag-internal"}`}>
                  {op.input ? "操作" : "输出"}
                </span>
                <span className="ff-row-text">
                  {op.source} 按下「{op.op}」
                </span>
              </div>
            ))}
          </div>
        )
      ) : null}

      {tab === "events" ? (
        frame.events.length === 0 ? (
          <div className="empty">窗口内没有其他异常或状态切换。</div>
        ) : (
          <div className="ff-timeline">
            {frame.events.map((event, index) => (
              <div className={`ff-row${event.offsetMs <= 0 ? " before" : ""}`} key={index}>
                <span className="ff-row-offset">{fmtOffset(event.offsetMs)}</span>
                <span className="ff-row-clock">{fmtClock(event.ts)}</span>
                <span className={`lf-tag ${TONE_CLASS[event.tone] ?? "lf-tag-internal"}`}>
                  {event.kind === "fault" ? "故障" : event.kind === "clear" ? "消除" : "状态"}
                </span>
                <span className="ff-row-text">{event.text}</span>
              </div>
            ))}
          </div>
        )
      ) : null}
    </>
  );
}

/** 单信号放大：可捏合/滚轮缩放，下方拖动条选区间。 */
export function FreezeFrameSignalView({
  signal,
  markTs,
}: {
  signal: FreezeFrameSignal;
  markTs: number;
}) {
  return (
    <div className="ff-zoom">
      <div className="ff-zoom-head">
        <h2 className="ff-zoom-title">
          {signal.name}
          {signal.unit ? <span className="ff-zoom-unit">{signal.unit}</span> : null}
        </h2>
        <span className="ff-zoom-change" style={{ color: CHANGE_COLOR[signal.change] }}>
          {signal.changeText}
        </span>
      </div>
      <ZoomChart
        color={CHANGE_COLOR[signal.change]}
        markTs={markTs}
        name={signal.name}
        points={signal.points}
        unit={signal.unit}
      />
      <p className="ff-zoom-hint">双指捏合或滚轮缩放，拖动下方滑块选时间段</p>
    </div>
  );
}
