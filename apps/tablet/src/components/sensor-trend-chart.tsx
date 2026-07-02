"use client";

import type { SensorTrendPoint } from "@shearer/contracts";
import { useEffect, useRef } from "react";

type SensorTrendChartProps = {
  sensorName: string;
  points: SensorTrendPoint[];
  unit: string;
  loading?: boolean;
  /**
   * 用户在图上框选/双指缩放出一个时间窗口时回调（毫秒时间戳）。
   * 父组件可按该窗口重新拉取更细粒度的数据。
   */
  onWindowSelect?: (fromMs: number, toMs: number) => void;
};

export function SensorTrendChart({
  sensorName,
  points,
  unit,
  loading = false,
  onWindowSelect,
}: SensorTrendChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onWindowSelectRef = useRef(onWindowSelect);
  onWindowSelectRef.current = onWindowSelect;

  useEffect(() => {
    if (!containerRef.current || loading || points.length === 0) {
      return;
    }

    let disposed = false;
    let cleanupResize = () => {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let chart: any = null;
    let zoomTimer = 0;

    // ts 齐全时用时间轴（支持任意缩放）；否则退回类目轴（mock 数据）
    const hasTs = points.every((p) => typeof p.ts === "number");
    const minTs = hasTs ? (points[0].ts as number) : 0;
    const maxTs = hasTs ? (points[points.length - 1].ts as number) : 0;

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

      chart.setOption(
        {
          animationDuration: 300,
          // 框选缩放：默认激活 dataZoomSelect，在图上直接拖出想看的时间段
          toolbox: hasTs
            ? {
                show: true,
                right: 12,
                top: 2,
                itemSize: 22,
                iconStyle: { borderColor: "rgba(245,247,251,.55)" },
                emphasis: { iconStyle: { borderColor: "#48c7ff" } },
                feature: {
                  dataZoom: {
                    yAxisIndex: "none",
                    title: { zoom: "框选时间段", back: "撤销框选" },
                  },
                },
              }
            : undefined,
          grid: {
            top: 40,
            left: 56,
            right: 20,
            bottom: hasTs ? 84 : 34,
          },
          tooltip: {
            trigger: "axis",
            backgroundColor: "rgba(18,24,33,.96)",
            borderColor: "rgba(79,140,255,.22)",
            textStyle: {
              color: "#f5f7fb",
            },
          },
          xAxis: hasTs
            ? {
                type: "time",
                axisLine: { lineStyle: { color: "rgba(255,255,255,.12)" } },
                axisLabel: {
                  color: "rgba(245,247,251,.52)",
                  fontSize: 12,
                  hideOverlap: true,
                },
                splitLine: { show: false },
              }
            : {
                type: "category",
                boundaryGap: false,
                data: points.map((point) => point.time),
                axisLine: { lineStyle: { color: "rgba(255,255,255,.12)" } },
                axisLabel: { color: "rgba(245,247,251,.52)", fontSize: 11 },
                splitLine: { show: false },
              },
          yAxis: {
            type: "value",
            name: unit,
            scale: true,
            nameTextStyle: {
              color: "rgba(245,247,251,.52)",
              padding: [0, 0, 0, 8],
            },
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { color: "rgba(245,247,251,.52)", fontSize: 12 },
            splitLine: { lineStyle: { color: "rgba(255,255,255,.06)" } },
          },
          dataZoom: hasTs
            ? [
                {
                  type: "inside",
                  throttle: 100,
                },
                {
                  type: "slider",
                  height: 44,
                  bottom: 10,
                  borderColor: "rgba(255,255,255,.1)",
                  backgroundColor: "rgba(255,255,255,.03)",
                  fillerColor: "rgba(79,140,255,.14)",
                  handleSize: "120%",
                  textStyle: { color: "rgba(245,247,251,.5)" },
                },
              ]
            : [],
          series: [
            {
              name: sensorName,
              type: "line",
              smooth: false,
              showSymbol: false,
              data: hasTs
                ? points.map((point) => [point.ts, point.value])
                : points.map((point) => point.value),
              lineStyle: {
                width: 2.5,
                color: "#48c7ff",
              },
              areaStyle: {
                color: {
                  type: "linear",
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: "rgba(72,199,255,.24)" },
                    { offset: 1, color: "rgba(72,199,255,.03)" },
                  ],
                },
              },
            },
          ],
        },
        { notMerge: true },
      );

      // 默认进入"框选时间段"光标模式：一指在图上拖出矩形即可选择观察窗口
      if (hasTs) {
        chart.dispatchAction({
          type: "takeGlobalCursor",
          key: "dataZoomSelect",
          dataZoomSelectActive: true,
        });
      }

      // 缩放停止 500ms 后，把选中的时间窗口回调给父组件做数据细化
      if (hasTs && onWindowSelectRef.current) {
        chart.off("datazoom");
        chart.on("datazoom", () => {
          window.clearTimeout(zoomTimer);
          zoomTimer = window.setTimeout(() => {
            if (disposed || !chart) {
              return;
            }
            const option = chart.getOption();
            const dz = option?.dataZoom?.[0];
            const start = typeof dz?.startValue === "number" ? dz.startValue : minTs;
            const end = typeof dz?.endValue === "number" ? dz.endValue : maxTs;
            // 缩到明显小于全量时才触发细化，避免全览状态误触发
            if (end - start > 0 && end - start < (maxTs - minTs) * 0.97) {
              onWindowSelectRef.current?.(Math.round(start), Math.round(end));
            }
          }, 500);
        });
      }

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
      window.clearTimeout(zoomTimer);
      cleanupResize();
      chart?.dispose();
    };
  }, [loading, points, sensorName, unit]);

  return (
    <div className="chart-wrap tall">
      <div className="chart-canvas" ref={containerRef} />
      {loading ? <div className="chart-overlay">正在加载趋势数据...</div> : null}
      {!loading && points.length === 0 ? <div className="chart-overlay">暂无趋势数据</div> : null}
    </div>
  );
}
