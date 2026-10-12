"use client";

import {
  MachineStatusSchema,
  createApiSuccessResponseSchema,
  type MachineStatus,
} from "@shearer/contracts";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { AppShell, formatDate, formatTime, useAppShellState } from "@/components/app-shell";
import { resolveHttpBase } from "@/lib/api-base";

const MachineStatusApiResponseSchema = createApiSuccessResponseSchema(MachineStatusSchema);

// 机况胶囊样式：在不在割煤一眼可辨
const MACHINE_STYLE: Record<MachineStatus["state"], { label: string; color: string }> = {
  cutting: { label: "割煤中", color: "#38d889" },
  dispatch: { label: "牵引调度", color: "#48c7ff" },
  stopped: { label: "停 机", color: "#ffb03a" },
  offline: { label: "离 线", color: "#8fa3bf" },
};

// 线性图标（24×24 描边，随卡片主色着色）
const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const ICONS: Record<string, ReactNode> = {
  // 实时故障：警示三角
  alert: (
    <>
      <path d="M12 3.8 2.9 19.6h18.2L12 3.8Z" {...stroke} />
      <path d="M12 9.6v4.3" {...stroke} />
      <path d="M12 16.9h.01" {...stroke} />
    </>
  ),
  // 故障代码查询：放大镜里的代码括号
  codeSearch: (
    <>
      <circle cx="10.8" cy="10.8" r="6.6" {...stroke} />
      <path d="m15.7 15.7 4.4 4.4" {...stroke} />
      <path d="M9.4 8.8 7.6 10.8l1.8 2" {...stroke} />
      <path d="m12.6 8.8 1.8 2-1.8 2" {...stroke} />
    </>
  ),
  // 引导性故障排查：罗盘指向
  compass: (
    <>
      <circle cx="12" cy="12" r="8.6" {...stroke} />
      <path d="m15.6 8.4-2.2 5.2-5.2 2.2 2.2-5.2 5.2-2.2Z" {...stroke} />
    </>
  ),
  // 近期故障排名：排名柱
  ranking: (
    <>
      <path d="M5.4 20.4v-6.6" {...stroke} strokeWidth={2.6} />
      <path d="M12 20.4V5.6" {...stroke} strokeWidth={2.6} />
      <path d="M18.6 20.4v-9.8" {...stroke} strokeWidth={2.6} />
    </>
  ),
  // 传感器：仪表盘
  gauge: (
    <>
      <path d="M3.8 17.4a8.6 8.6 0 1 1 16.4 0" {...stroke} />
      <path d="m12 17.4 4-4.6" {...stroke} />
      <circle cx="12" cy="17.4" r="1.5" {...stroke} />
    </>
  ),
  // 信号对比：两条叠加波形
  waves: (
    <>
      <path d="M3 9.6h3.4l1.9-3.8 2.1 7.6 1.8-3.8h8.8" {...stroke} />
      <path d="M3 17.6h5.6l2 3.2 2-6.4 1.7 3.2H21" {...stroke} opacity={0.62} />
    </>
  ),
  // 一键体检：盾牌打勾
  shieldCheck: (
    <>
      <path d="M12 3.2 19 6v5.6c0 4.4-3 7.6-7 9.2-4-1.6-7-4.8-7-9.2V6l7-2.8Z" {...stroke} />
      <path d="m8.8 12.1 2.3 2.3 4.2-4.6" {...stroke} />
    </>
  ),
  // 停机分析：时钟暂停
  pauseClock: (
    <>
      <circle cx="12" cy="12" r="8.6" {...stroke} />
      <path d="M10.2 9.2v5.6" {...stroke} />
      <path d="M13.8 9.2v5.6" {...stroke} />
    </>
  ),
  // 知识库：翻开的书
  book: (
    <>
      <path d="M12 6.6S9.8 5.1 6.5 5.1H3.6v13.2h2.9c3.3 0 5.5 1.6 5.5 1.6s2.2-1.6 5.5-1.6h2.9V5.1h-2.9C14.2 5.1 12 6.6 12 6.6Z" {...stroke} />
      <path d="M12 6.6v13.3" {...stroke} />
    </>
  ),
  // 事件时间线：时间轴节点
  timeline: (
    <>
      <path d="M6.4 3.8v16.4" {...stroke} />
      <circle cx="6.4" cy="8.4" r="2" {...stroke} />
      <circle cx="6.4" cy="16" r="2" {...stroke} />
      <path d="M10.6 8.4h9" {...stroke} />
      <path d="M10.6 16h6.6" {...stroke} />
    </>
  ),
  // 日常检修打卡：日历打勾
  calendarCheck: (
    <>
      <rect height="15.4" rx="3" width="17" x="3.5" y="5" {...stroke} />
      <path d="M8.2 3v4" {...stroke} />
      <path d="M15.8 3v4" {...stroke} />
      <path d="M3.5 10h17" {...stroke} />
      <path d="m9.3 14.9 2.1 2.1 3.9-4.3" {...stroke} />
    </>
  ),
  // 系统设置：齿轮
  gear: (
    <>
      <circle cx="12" cy="12" r="3.1" {...stroke} />
      <path
        d="M12 2.6a1.6 1.6 0 0 1 1.6 1.6v.5c0 .5.3 1 .8 1.2.5.2 1 .1 1.4-.2l.4-.4a1.6 1.6 0 1 1 2.3 2.3l-.4.4c-.3.4-.4.9-.2 1.4.2.5.7.8 1.2.8h.5a1.6 1.6 0 1 1 0 3.2h-.5c-.5 0-1 .3-1.2.8-.2.5-.1 1 .2 1.4l.4.4a1.6 1.6 0 1 1-2.3 2.3l-.4-.4c-.4-.3-.9-.4-1.4-.2-.5.2-.8.7-.8 1.2v.5a1.6 1.6 0 1 1-3.2 0v-.5c0-.5-.3-1-.8-1.2-.5-.2-1-.1-1.4.2l-.4.4a1.6 1.6 0 1 1-2.3-2.3l.4-.4c.3-.4.4-.9.2-1.4-.2-.5-.7-.8-1.2-.8h-.5a1.6 1.6 0 1 1 0-3.2h.5c.5 0 1-.3 1.2-.8.2-.5.1-1-.2-1.4l-.4-.4a1.6 1.6 0 1 1 2.3-2.3l.4.4c.4.3.9.4 1.4.2.5-.2.8-.7.8-1.2v-.5A1.6 1.6 0 0 1 12 2.6Z"
        {...stroke}
      />
    </>
  ),
};

type NavItem = {
  label: string;
  href: string;
  icon: keyof typeof ICONS;
  from: string;
  to: string;
  tint: string;
};

// 主页面 = 时钟 + 功能导航
// 三行分组：故障处置 / 数据诊断 / 日常与配置（单屏不滚动）
const homeNavItems: readonly NavItem[] = [
  {
    label: "实时故障",
    href: "/live-faults",
    icon: "alert",
    from: "#ff8578",
    to: "#e03e30",
    tint: "rgba(255, 107, 92, 0.16)",
  },
  {
    label: "故障代码查询",
    href: "/fault-codes",
    icon: "codeSearch",
    from: "#ffc266",
    to: "#f07b22",
    tint: "rgba(255, 176, 58, 0.16)",
  },
  {
    label: "引导性故障排查",
    href: "/guide",
    icon: "compass",
    from: "#ff92b3",
    to: "#e0417a",
    tint: "rgba(255, 122, 156, 0.16)",
  },
  {
    label: "近期故障排名",
    href: "/rankings",
    icon: "ranking",
    from: "#bfa6ff",
    to: "#7c4de0",
    tint: "rgba(167, 139, 250, 0.16)",
  },
  {
    label: "传感器",
    href: "/sensors",
    icon: "gauge",
    from: "#7bbcff",
    to: "#2e6be6",
    tint: "rgba(84, 165, 255, 0.16)",
  },
  {
    label: "信号对比",
    href: "/signals",
    icon: "waves",
    from: "#6ee2ec",
    to: "#1fa3c4",
    tint: "rgba(74, 212, 224, 0.15)",
  },
  {
    label: "一键体检",
    href: "/health",
    icon: "shieldCheck",
    from: "#5fe3d2",
    to: "#0d9488",
    tint: "rgba(45, 212, 191, 0.15)",
  },
  {
    label: "停机分析",
    href: "/downtime",
    icon: "pauseClock",
    from: "#79e59c",
    to: "#2aa857",
    tint: "rgba(76, 217, 123, 0.15)",
  },
  {
    label: "知识库",
    href: "/knowledge",
    icon: "book",
    from: "#f7cf85",
    to: "#d99a2b",
    tint: "rgba(244, 191, 95, 0.15)",
  },
  {
    label: "事件时间线",
    href: "/timeline",
    icon: "timeline",
    from: "#9db4ff",
    to: "#4b63e6",
    tint: "rgba(123, 155, 255, 0.16)",
  },
  {
    label: "日常检修打卡",
    href: "/checkins",
    icon: "calendarCheck",
    from: "#8aeacb",
    to: "#2bb88c",
    tint: "rgba(94, 224, 184, 0.15)",
  },
  {
    label: "系统设置",
    href: "/settings",
    icon: "gear",
    from: "#c9cfd9",
    to: "#7c8494",
    tint: "rgba(179, 185, 198, 0.14)",
  },
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
    <AppShell minimalHeader shellState={shellState} title="主页面">
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
              <Link
                className="lp-card"
                href={item.href}
                key={item.label}
                style={
                  {
                    "--lp-from": item.from,
                    "--lp-to": item.to,
                    "--lp-tint": item.tint,
                  } as React.CSSProperties
                }
              >
                <span className="lp-card-icon">
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    {ICONS[item.icon]}
                  </svg>
                </span>
                <span className="lp-card-title">{item.label}</span>
                <svg className="lp-card-chev" viewBox="0 0 24 24">
                  <path d="m9.5 5.5 7 6.5-7 6.5" {...stroke} strokeWidth={2} />
                </svg>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
