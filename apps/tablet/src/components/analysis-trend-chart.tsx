"use client";

import type { PumpAnalysisSeries } from "@shearer/contracts";
import { useEffect, useRef } from "react";

type AnalysisTrendChartProps = {
  labels: string[];
  loading?: boolean;
  series: PumpAnalysisSeries[];
};

export function AnalysisTrendChart({
  labels,
  series,
  loading = false,
}: AnalysisTrendChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current || loading || labels.length === 0 || series.length === 0) {
      return;
    }

    let disposed = false;
    let cleanupResize = () => {};
    let chart: {
      dispose: () => void;
      resize: () => void;
      setOption: (option: object) => void;
    } | null = null;

    const renderChart = async () => {
      const echarts = await import("echarts");

      if (disposed || !containerRef.current) {
        return;
      }

      chart =
        echarts.getInstanceByDom(containerRef.current) ??
        echarts.init(containerRef.current, undefined, {
          renderer: "canvas",
        });

      chart.setOption({
        animationDuration: 300,
        grid: {
          top: 28,
          left: 54,
          right: 18,
          bottom: 34,
        },
        tooltip: {
          trigger: "axis",
          backgroundColor: "rgba(18,24,33,.96)",
          borderColor: "rgba(79,140,255,.22)",
          textStyle: {
            color: "#f5f7fb",
          },
        },
        xAxis: {
          type: "category",
          boundaryGap: false,
          data: labels,
          axisLine: {
            lineStyle: {
              color: "rgba(255,255,255,.12)",
            },
          },
          axisLabel: {
            color: "rgba(245,247,251,.52)",
            fontSize: 11,
          },
          splitLine: {
            show: false,
          },
        },
        yAxis: {
          type: "value",
          axisLine: {
            show: false,
          },
          axisTick: {
            show: false,
          },
          axisLabel: {
            color: "rgba(245,247,251,.52)",
            fontSize: 11,
          },
          splitLine: {
            lineStyle: {
              color: "rgba(255,255,255,.06)",
            },
          },
        },
        series: series.map((item) => ({
          name: item.name,
          type: "line",
          smooth: true,
          showSymbol: false,
          data: item.values,
          lineStyle: {
            width: 3,
            color: item.color,
          },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${item.color}33` },
                { offset: 1, color: `${item.color}05` },
              ],
            },
          },
        })),
      });

      const resize = () => {
        chart?.resize();
      };

      const resizeObserver =
        typeof ResizeObserver === "undefined" || !containerRef.current
          ? null
          : new ResizeObserver(() => {
              resize();
            });

      if (resizeObserver && containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }

      window.addEventListener("resize", resize);
      cleanupResize = () => {
        resizeObserver?.disconnect();
        window.removeEventListener("resize", resize);
      };
    };

    void renderChart();

    return () => {
      disposed = true;
      cleanupResize();
      chart?.dispose();
    };
  }, [labels, loading, series]);

  return (
    <div className="chart-wrap tall">
      <div className="chart-canvas" ref={containerRef} />
      {loading ? <div className="chart-overlay">正在加载 24h 趋势数据...</div> : null}
      {!loading && (labels.length === 0 || series.length === 0) ? (
        <div className="chart-overlay">暂无 24h 趋势数据</div>
      ) : null}
    </div>
  );
}
