"use client";

import { useEffect, useRef } from "react";
import { readChartTheme } from "@/lib/chart-theme";
import { THEME_CHANGE_EVENT } from "@/lib/theme";

type ChartSeriesLike = {
  name: string;
  color: string;
  values: number[];
};

type AnalysisTrendChartProps = {
  labels: string[];
  loading?: boolean;
  series: ChartSeriesLike[];
  tall?: boolean;
};

export function AnalysisTrendChart({
  labels,
  series,
  loading = false,
  tall = true,
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
      const theme = readChartTheme();
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
          backgroundColor: theme.tooltipBg,
          borderColor: "rgba(79,140,255,.22)",
          textStyle: {
            color: theme.tooltipFg,
          },
        },
        xAxis: {
          type: "category",
          boundaryGap: false,
          data: labels,
          axisLine: {
            lineStyle: {
              color: theme.line,
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
              color: theme.split,
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
    // 切主题时坐标轴/网格线颜色要跟着翻，重画一次
    const onTheme = () => void renderChart();
    window.addEventListener(THEME_CHANGE_EVENT, onTheme);

    return () => {
      disposed = true;
      window.removeEventListener(THEME_CHANGE_EVENT, onTheme);
      cleanupResize();
      chart?.dispose();
    };
  }, [labels, loading, series]);

  return (
    <div className={`chart-wrap ${tall ? "tall" : ""}`.trim()}>
      <div className="chart-canvas" ref={containerRef} />
      {loading ? <div className="chart-overlay">正在加载 24h 趋势数据...</div> : null}
      {!loading && (labels.length === 0 || series.length === 0) ? (
        <div className="chart-overlay">暂无 24h 趋势数据</div>
      ) : null}
    </div>
  );
}
