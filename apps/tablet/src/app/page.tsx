"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AppShell, formatDate, formatTime, useAppShellState } from "@/components/app-shell";

// 主页面 = 时钟 + 功能导航（Launchpad 风格：大图标、无说明文字、单屏不滚动）
const homeNavItems = [
  { label: "传感器", href: "/sensors", icon: "传", from: "#54a5ff", to: "#2e6be6" },
  { label: "故障代码查询", href: "/fault-codes", icon: "码", from: "#ffb03a", to: "#f07b22" },
  { label: "实时故障", href: "/live-faults", icon: "障", from: "#ff6b5c", to: "#e03e30" },
  { label: "停机分析", href: "/downtime", icon: "停", from: "#4cd97b", to: "#2aa857" },
  { label: "近期故障排名", href: "/rankings", icon: "排", from: "#a78bfa", to: "#7c4de0" },
  { label: "日常检修打卡", href: "/checkins", icon: "检", from: "#5ee0b8", to: "#2bb88c" },
  { label: "知识库", href: "/knowledge", icon: "知", from: "#7b9bff", to: "#4b63e6" },
  { label: "系统设置", href: "/settings", icon: "设", from: "#b3b9c6", to: "#7c8494" },
] as const;

export default function HomePage() {
  const shellState = useAppShellState();
  const { now } = shellState;

  // 主页面单屏固定，禁用页面滚动
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <AppShell disableHomeButton minimalHeader shellState={shellState} title="主页面">
      <section className="page active">
        <div className="home-launchpad">
          <div className="home-clock">
            <div className="home-clock-time">{formatTime(now)}</div>
            <div className="home-clock-date">{formatDate(now, true)}</div>
          </div>

          <div className="launchpad-grid">
            {homeNavItems.map((item) => (
              <Link className="launchpad-tile" href={item.href} key={item.label}>
                <span
                  className="launchpad-icon"
                  style={{ background: `linear-gradient(180deg, ${item.from}, ${item.to})` }}
                >
                  {item.icon}
                </span>
                <span className="launchpad-name">{item.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
