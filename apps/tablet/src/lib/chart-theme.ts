"use client";

/**
 * 图表配色：直接读 CSS 变量，不在图表里再写一份颜色。
 *
 * 这样切主题时图表跟着 globals.css 的 token 走，不会出现"页面白了但坐标轴还是
 * 白字"的情况。ECharts 不认 CSS 变量，所以要在 setOption 之前把值取出来。
 */
export type ChartTheme = {
  axis: string;
  split: string;
  line: string;
  tooltipBg: string;
  tooltipFg: string;
  text: string;
  text3: string;
  accent: string[];
};

const readVar = (styles: CSSStyleDeclaration, name: string, fallback: string) =>
  styles.getPropertyValue(name).trim() || fallback;

export const readChartTheme = (): ChartTheme => {
  if (typeof document === "undefined") {
    return {
      axis: "rgba(245,247,251,.5)",
      split: "rgba(255,255,255,.06)",
      line: "rgba(255,255,255,.12)",
      tooltipBg: "rgba(18,24,33,.96)",
      tooltipFg: "#f5f7fb",
      text: "#f5f7fb",
      text3: "rgba(245,247,251,.45)",
      accent: ["#4f8cff", "#38d889", "#ffb14a", "#ff5f57", "#9f86ff", "#48c7ff"],
    };
  }
  const styles = getComputedStyle(document.documentElement);
  return {
    axis: readVar(styles, "--chart-axis", "rgba(245,247,251,.5)"),
    split: readVar(styles, "--chart-split", "rgba(255,255,255,.06)"),
    line: readVar(styles, "--line", "rgba(255,255,255,.12)"),
    tooltipBg: readVar(styles, "--chart-tooltip-bg", "rgba(18,24,33,.96)"),
    tooltipFg: readVar(styles, "--chart-tooltip-fg", "#f5f7fb"),
    text: readVar(styles, "--text", "#f5f7fb"),
    text3: readVar(styles, "--text-3", "rgba(245,247,251,.45)"),
    accent: [
      readVar(styles, "--blue", "#4f8cff"),
      readVar(styles, "--green", "#38d889"),
      readVar(styles, "--orange", "#ffb14a"),
      readVar(styles, "--red", "#ff5f57"),
      readVar(styles, "--purple", "#9f86ff"),
      readVar(styles, "--cyan", "#48c7ff"),
    ],
  };
};
