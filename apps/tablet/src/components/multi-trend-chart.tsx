"use client";

import type { SensorTrendPoint } from "@shearer/contracts";
import { useEffect, useRef } from "react";
import { readChartTheme } from "@/lib/chart-theme";
import { THEME_CHANGE_EVENT } from "@/lib/theme";

export type OverlaySeries = {
  name: string;
  unit: string;
  color: string;
  points: SensorTrendPoint[];
};

type MultiTrendChartProps = {
  series: OverlaySeries[];
  loading?: boolean;
  onWindowSelect?: (fromMs: number, toMs: number) => void;
};

/** 多信号叠加图：时间轴 + 多 Y 轴（每单位一轴）+ 框选/捏合缩放，与单信号图同款细化回调。 */
export function MultiTrendChart({ series, loading = false, onWindowSelect }: MultiTrendChartProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cbRef = useRef(onWindowSelect);
  cbRef.current = onWindowSelect;

  useEffect(() => {
    if (!ref.current || loading || series.length === 0) {
      return;
    }
    let disposed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let chart: any = null;
    let zoomTimer = 0;

    const allTs = series.flatMap((s) => s.points.map((p) => p.ts ?? 0));
    const minTs = Math.min(...allTs);
    const maxTs = Math.max(...allTs);

    // 每个不同单位一条 Y 轴（最多 3 条，多余的共用第一条）
    const units = [...new Set(series.map((s) => s.unit))].slice(0, 3);

    const render = async () => {
      const theme = readChartTheme();
      const echarts = await import("echarts");
      if (disposed || !ref.current) {
        return;
      }
      chart = echarts.getInstanceByDom(ref.current) ?? echarts.init(ref.current);
      chart.setOption(
        {
          animationDuration: 300,
          legend: {
            top: 4,
            textStyle: { color: "rgba(245,247,251,.8)", fontSize: 15 },
            itemWidth: 22,
          },
          toolbox: {
            show: true,
            right: 12,
            top: 2,
            itemSize: 22,
            iconStyle: { borderColor: theme.axis },
            feature: {
              dataZoom: { yAxisIndex: "none", title: { zoom: "框选时间段", back: "撤销框选" } },
            },
          },
          grid: { top: 48, left: 62, right: units.length > 1 ? 62 : 20, bottom: 84 },
          tooltip: {
            trigger: "axis",
            backgroundColor: theme.tooltipBg,
            textStyle: { color: theme.tooltipFg },
          },
          xAxis: {
            type: "time",
            axisLabel: { color: theme.axis, fontSize: 12, hideOverlap: true },
            axisLine: { lineStyle: { color: theme.line } },
          },
          yAxis: units.map((unit, index) => ({
            type: "value",
            name: unit,
            scale: true,
            position: index === 0 ? "left" : "right",
            offset: index > 1 ? 52 : 0,
            nameTextStyle: { color: theme.axis },
            axisLabel: { color: theme.axis, fontSize: 12 },
            splitLine: { show: index === 0, lineStyle: { color: theme.split } },
          })),
          dataZoom: [
            { type: "inside", throttle: 100 },
            {
              type: "slider",
              height: 44,
              bottom: 10,
              borderColor: theme.line,
              backgroundColor: theme.split,
              fillerColor: "rgba(79,140,255,.14)",
              handleSize: "120%",
              textStyle: { color: theme.axis },
            },
          ],
          series: series.map((s) => ({
            name: s.name,
            type: "line",
            showSymbol: false,
            yAxisIndex: Math.max(0, units.indexOf(s.unit)),
            data: s.points.map((p) => [p.ts, p.value]),
            lineStyle: { width: 2.5, color: s.color },
            itemStyle: { color: s.color },
          })),
        },
        { notMerge: true },
      );

      chart.dispatchAction({
        type: "takeGlobalCursor",
        key: "dataZoomSelect",
        dataZoomSelectActive: true,
      });

      if (cbRef.current) {
        chart.off("datazoom");
        chart.on("datazoom", () => {
          window.clearTimeout(zoomTimer);
          zoomTimer = window.setTimeout(() => {
            if (disposed || !chart) {
              return;
            }
            const dz = chart.getOption()?.dataZoom?.[0];
            const start = typeof dz?.startValue === "number" ? dz.startValue : minTs;
            const end = typeof dz?.endValue === "number" ? dz.endValue : maxTs;
            if (end - start > 0 && end - start < (maxTs - minTs) * 0.97) {
              cbRef.current?.(Math.round(start), Math.round(end));
            }
          }, 500);
        });
      }

      const resize = () => chart?.resize();
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    };
    void render();
    // 切主题时坐标轴/网格线颜色要跟着翻，重画一次
    const onTheme = () => void render();
    window.addEventListener(THEME_CHANGE_EVENT, onTheme);
    return () => {
      disposed = true;
      window.removeEventListener(THEME_CHANGE_EVENT, onTheme);
      window.clearTimeout(zoomTimer);
      chart?.dispose();
    };
  }, [loading, series]);

  return (
    <div className="chart-wrap tall">
      <div className="chart-canvas" ref={ref} />
      {loading ? <div className="chart-overlay">正在加载信号数据...</div> : null}
      {!loading && series.length === 0 ? <div className="chart-overlay">请选择要对比的信号</div> : null}
    </div>
  );
}
