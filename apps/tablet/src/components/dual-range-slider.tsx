"use client";

import { useRef } from "react";

const pad = (n: number) => String(n).padStart(2, "0");

export const fmtSliderDateTime = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

type DualRangeSliderProps = {
  minMs: number;
  maxMs: number;
  fromMs: number;
  toMs: number;
  onChange: (fromMs: number, toMs: number) => void;
};

/** 双把手时间范围滑块（范围限制在数据存在的窗口内，平板大把手）。 */
export function DualRangeSlider({ minMs, maxMs, fromMs, toMs, onChange }: DualRangeSliderProps) {
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
        <span>{fmtSliderDateTime(minMs)}</span>
        <span>{fmtSliderDateTime(maxMs)}</span>
      </div>
    </div>
  );
}
