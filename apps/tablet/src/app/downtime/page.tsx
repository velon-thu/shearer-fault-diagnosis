"use client";

import { AppShell, useAppShellState } from "@/components/app-shell";

// 停机分析：分析方案确定后实现，此为入口占位页
export default function DowntimePage() {
  const shellState = useAppShellState();

  return (
    <AppShell shellState={shellState} title="停机分析">
      <section className="page active">
        <div className="empty" style={{ fontSize: 22, padding: "80px 0" }}>
          停机分析功能建设中
        </div>
      </section>
    </AppShell>
  );
}
