"use client";

import {
  MachineStatusSchema,
  createApiSuccessResponseSchema,
  type MachineStatus,
} from "@shearer/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell, formatDate, formatTime, useAppShellState } from "@/components/app-shell";

const MachineStatusApiResponseSchema = createApiSuccessResponseSchema(MachineStatusSchema);

const resolveHttpBase = () => {
  if (typeof window === "undefined") {
    return "";
  }
  if (process.env.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }
  const { protocol, hostname, port } = window.location;
  if ((hostname === "localhost" || hostname === "127.0.0.1") && port === "3000") {
    return `${protocol}//${hostname}:18080`;
  }
  return `${protocol}//${window.location.host}`;
};

// 机况胶囊样式：在不在割煤一眼可辨
const MACHINE_STYLE: Record<MachineStatus["state"], { label: string; color: string }> = {
  cutting: { label: "割煤中", color: "#38d889" },
  dispatch: { label: "牵引调度", color: "#48c7ff" },
  stopped: { label: "停 机", color: "#ffb03a" },
  offline: { label: "离 线", color: "#8fa3bf" },
};

// 主页面 = 时钟 + 功能导航（Launchpad 风格：大图标、无说明文字、单屏不滚动）
const homeNavItems = [
  { label: "传感器", href: "/sensors", icon: "传", from: "#54a5ff", to: "#2e6be6" },
  { label: "信号对比", href: "/signals", icon: "比", from: "#4ad4e0", to: "#1fa3c4" },
  { label: "实时故障", href: "/live-faults", icon: "障", from: "#ff6b5c", to: "#e03e30" },
  { label: "事件时间线", href: "/timeline", icon: "线", from: "#7b9bff", to: "#4b63e6" },
  { label: "一键体检", href: "/health", icon: "体", from: "#2dd4bf", to: "#0d9488" },
  { label: "停机分析", href: "/downtime", icon: "停", from: "#4cd97b", to: "#2aa857" },
  { label: "近期故障排名", href: "/rankings", icon: "排", from: "#a78bfa", to: "#7c4de0" },
  { label: "故障代码查询", href: "/fault-codes", icon: "码", from: "#ffb03a", to: "#f07b22" },
  { label: "日常检修打卡", href: "/checkins", icon: "检", from: "#5ee0b8", to: "#2bb88c" },
  { label: "知识库", href: "/knowledge", icon: "知", from: "#8b9bff", to: "#5b63d6" },
  { label: "系统设置", href: "/settings", icon: "设", from: "#b3b9c6", to: "#7c8494" },
] as const;

export default function HomePage() {
  const shellState = useAppShellState();
  const { now } = shellState;
  const [machine, setMachine] = useState<MachineStatus | null>(null);

  // 机况胶囊：3s 轮询
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`${resolveHttpBase()}/api/machine-status`, {
          cache: "no-store",
        });
        const parsed = MachineStatusApiResponseSchema.parse(await response.json());
        if (!cancelled) {
          setMachine(parsed.data);
        }
      } catch {
        if (!cancelled) {
          setMachine(null);
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), 3_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

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
          {machine ? (
            <div
              className="home-machine"
              style={{ borderColor: `${MACHINE_STYLE[machine.state].color}55` }}
            >
              <span
                className="home-machine-dot"
                style={{
                  background: MACHINE_STYLE[machine.state].color,
                  boxShadow: `0 0 0 0 ${MACHINE_STYLE[machine.state].color}88`,
                }}
              />
              <strong style={{ color: MACHINE_STYLE[machine.state].color }}>
                {MACHINE_STYLE[machine.state].label}
              </strong>
              <span className="home-machine-sep" />
              <strong className="home-machine-speed">{machine.speedMmin.toFixed(2)}</strong>
              <span className="home-machine-unit">m/min</span>
            </div>
          ) : null}
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
