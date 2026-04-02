import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
