"use client";

import { useEffect, useRef } from "react";
import { readChartTheme } from "@/lib/chart-theme";
import { THEME_CHANGE_EVENT } from "@/lib/theme";

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
      const theme = readChartTheme();
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
            textStyle: { color: theme.text, fontSize: 16, fontWeight: 700 },
            left: 4,
            top: 2,
          },
          tooltip: {
            trigger: "axis",
            backgroundColor: theme.tooltipBg,
            textStyle: { color: theme.tooltipFg },
          },
          xAxis: {
            type: "time",
            axisLabel: { color: theme.text3, fontSize: 11, hideOverlap: true },
            axisLine: { lineStyle: { color: theme.line } },
          },
          yAxis: {
            type: "value",
            scale: true,
            axisLabel: { color: theme.text3, fontSize: 11 },
            splitLine: { lineStyle: { color: theme.split } },
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
    // 切主题时坐标轴/网格线颜色要跟着翻，重画一次
    const onTheme = () => void render();
    window.addEventListener(THEME_CHANGE_EVENT, onTheme);
    return () => {
      disposed = true;
      window.removeEventListener(THEME_CHANGE_EVENT, onTheme);
      chart?.dispose();
    };
  }, [name, unit, points, markTs, color]);

  return <div className="mini-chart" ref={ref} />;
}

type ZoomChartProps = {
  name: string;
  unit: string;
  points: Array<{ ts: number; value: number }>;
  markTs?: number;
  color?: string;
};

/**
 * 放大图：带缩放的单信号大图。
 *
 * 井下戴手套操作，缩放要能"捏"也能"拖"：inside 支持双指捏合与滚轮，
 * slider 给一条足够粗的拖动条，两者联动。
 */
export function ZoomChart({ name, unit, points, markTs, color = "#48c7ff" }: ZoomChartProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current || points.length === 0) {
      return;
    }
    let disposed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let chart: any = null;

    const render = async () => {
      const theme = readChartTheme();
      const echarts = await import("echarts");
      if (disposed || !ref.current) {
        return;
      }
      chart = echarts.getInstanceByDom(ref.current) ?? echarts.init(ref.current);
      chart.setOption(
        {
          animation: false,
          grid: { top: 28, left: 68, right: 28, bottom: 96 },
          tooltip: {
            trigger: "axis",
            backgroundColor: theme.tooltipBg,
            borderWidth: 0,
            textStyle: { color: theme.tooltipFg, fontSize: 16 },
          },
          xAxis: {
            type: "time",
            axisLabel: { color: theme.axis, fontSize: 14, hideOverlap: true },
            axisLine: { lineStyle: { color: theme.line } },
          },
          yAxis: {
            type: "value",
            scale: true,
            name: unit,
            nameTextStyle: { color: theme.text3, fontSize: 14 },
            axisLabel: { color: theme.axis, fontSize: 14 },
            splitLine: { lineStyle: { color: theme.split } },
          },
          dataZoom: [
            { type: "inside", filterMode: "none", zoomOnMouseWheel: true, moveOnMouseMove: true },
            {
              type: "slider",
              height: 44,
              bottom: 24,
              borderColor: theme.line,
              backgroundColor: theme.split,
              fillerColor: "rgba(79,140,255,.18)",
              handleStyle: { color: "#4f8cff" },
              moveHandleSize: 10,
              textStyle: { color: theme.axis, fontSize: 13 },
            },
          ],
          series: [
            {
              name,
              type: "line",
              showSymbol: false,
              data: points.map((p) => [p.ts, p.value]),
              lineStyle: { width: 2.5, color },
              areaStyle: { color, opacity: 0.08 },
              markLine: markTs
                ? {
                    silent: true,
                    symbol: "none",
                    label: { show: true, formatter: "故障", color: "#ff8a8a", fontSize: 14 },
                    lineStyle: { color: "#ff5c5c", width: 2 },
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

    // 切主题时坐标轴/网格线颜色要跟着翻，重画一次
    const onTheme = () => void render();
    window.addEventListener(THEME_CHANGE_EVENT, onTheme);
    const onResize = () => chart?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      disposed = true;
      window.removeEventListener(THEME_CHANGE_EVENT, onTheme);
      window.removeEventListener("resize", onResize);
      chart?.dispose();
    };
  }, [name, unit, points, markTs, color]);

  return <div className="zoom-chart" ref={ref} />;
}
