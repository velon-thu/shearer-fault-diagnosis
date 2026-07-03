"use client";

import { useEffect, useRef } from "react";

type MiniChartProps = {
  name: string;
  unit: string;
  points: Array<{ ts: number; value: number }>;
  markTs?: number; // 故障时刻竖线
  color?: string;
};

/** 冻结帧小图：轻量单线图，无缩放，故障时刻红色竖线。 */
export function MiniChart({ name, unit, points, markTs, color = "#48c7ff" }: MiniChartProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current || points.length === 0) {
      return;
    }
    let disposed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let chart: any = null;

    const render = async () => {
      const echarts = await import("echarts");
      if (disposed || !ref.current) {
        return;
      }
      chart = echarts.getInstanceByDom(ref.current) ?? echarts.init(ref.current);
      chart.setOption(
        {
          animation: false,
          grid: { top: 34, left: 46, right: 12, bottom: 22 },
          title: {
            text: `${name}${unit ? `（${unit}）` : ""}`,
            textStyle: { color: "rgba(245,247,251,.85)", fontSize: 16, fontWeight: 700 },
            left: 4,
            top: 2,
          },
          tooltip: {
            trigger: "axis",
            backgroundColor: "rgba(18,24,33,.96)",
            textStyle: { color: "#f5f7fb" },
          },
          xAxis: {
            type: "time",
            axisLabel: { color: "rgba(245,247,251,.45)", fontSize: 11, hideOverlap: true },
            axisLine: { lineStyle: { color: "rgba(255,255,255,.1)" } },
          },
          yAxis: {
            type: "value",
            scale: true,
            axisLabel: { color: "rgba(245,247,251,.45)", fontSize: 11 },
            splitLine: { lineStyle: { color: "rgba(255,255,255,.05)" } },
          },
          series: [
            {
              type: "line",
              showSymbol: false,
              data: points.map((p) => [p.ts, p.value]),
              lineStyle: { width: 2, color },
              markLine: markTs
                ? {
                    silent: true,
                    symbol: "none",
                    label: { show: false },
                    lineStyle: { color: "#ff5c5c", width: 2, type: "solid" },
                    data: [{ xAxis: markTs }],
                  }
                : undefined,
            },
          ],
        },
        { notMerge: true },
      );
    };
    void render();
    return () => {
      disposed = true;
      chart?.dispose();
    };
  }, [name, unit, points, markTs, color]);

  return <div className="mini-chart" ref={ref} />;
}
