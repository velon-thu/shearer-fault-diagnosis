import type { Metadata } from "next";
import "./globals.css";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "采煤机故障诊断点检仪",
  description: "平板静态前端骨架",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    /* 主题脚本会在 hydrate 之前给 <html> 打上 data-theme，
       服务端产物里没有这个属性，属预期差异，不让 React 报 hydration 警告 */
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 首屏定主题：早于 body 执行，避免先闪一下暗色再跳成亮色 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
