"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemeName = "dark" | "light";

export const THEME_STORAGE_KEY = "cmTablet.theme";
const DEFAULT_THEME: ThemeName = "dark";

/**
 * 主题在 <html data-theme> 上，整套配色靠 globals.css 里的两组 token 翻面。
 *
 * 首屏必须在渲染前就定好，否则会先闪一下暗色再跳成亮色——这段脚本由 layout
 * 内联进 <head>，早于 body 执行。localStorage 不可用时静默用默认值。
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}else{document.documentElement.dataset.theme=${JSON.stringify(
  DEFAULT_THEME,
)}}}catch(e){document.documentElement.dataset.theme=${JSON.stringify(DEFAULT_THEME)}}})();`;

/** 主题变更事件：图表这类需要重绘的组件靠它感知 */
export const THEME_CHANGE_EVENT = "cmTablet:themechange";

const readTheme = (): ThemeName => {
  if (typeof document === "undefined") {
    return DEFAULT_THEME;
  }
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
};

export const applyTheme = (theme: ThemeName) => {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 隐私模式下写不进去，只影响下次进入时的记忆
  }
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }));
};

/** 读当前主题并跟随切换重渲染 */
export const useTheme = () => {
  const [theme, setTheme] = useState<ThemeName>(DEFAULT_THEME);

  useEffect(() => {
    setTheme(readTheme());
    const onChange = () => setTheme(readTheme());
    window.addEventListener(THEME_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  }, []);

  const toggle = useCallback((next: ThemeName) => {
    applyTheme(next);
    setTheme(next);
  }, []);

  return { theme, setTheme: toggle };
};
