"use client";

import {
  HomeSummarySchema,
  WeeklyEventSchema,
  createApiSuccessResponseSchema,
  type ConnectionStatus,
  type HomeSummary,
  type WeeklyEvent,
} from "@shearer/contracts";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AppShell,
  formatDate,
  formatStatusText,
  formatTime,
  useAppShellState,
} from "@/components/app-shell";

const HomeSummaryApiResponseSchema = createApiSuccessResponseSchema(HomeSummarySchema);
const WeeklyEventsApiResponseSchema = createApiSuccessResponseSchema(WeeklyEventSchema.array());

const homeNavItems = [
  { label: "传感器", href: "/sensors", icon: "传" },
  { label: "故障代码查询", href: "/fault-codes", icon: "码" },
  { label: "截割部分析", href: "/analysis/cutting", icon: "截" },
  { label: "牵引部分析", href: "/analysis/traction", icon: "牵" },
  { label: "泵分析", href: "/analysis/pump", icon: "泵" },
  { label: "近期故障排名", href: null, icon: "排" },
  { label: "日常检修打卡", href: null, icon: "检" },
  { label: "知识库", href: null, icon: "知" },
  { label: "运行循环图", href: null, icon: "循" },
  { label: "系统设置", href: "/settings", icon: "设" },
] as const;

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

const getShiftLabel = (now: Date | null) => {
  if (!now) {
    return "--";
  }

  const hour = now.getHours();

  if (hour >= 8 && hour < 16) {
    return "早班";
  }

  if (hour >= 16 && hour < 24) {
    return "中班";
  }

  return "夜班";
};

const getHealthScore = (connection: ConnectionStatus) => {
  if (connection.tabletToIpc !== "connected") {
    return 0;
  }

  const scores = {
    ok: 100,
    warn: 88,
    error: 60,
    offline: 0,
  } as const;

  return Math.round((scores[connection.hpc] + scores[connection.moc] + scores[connection.boc]) / 3);
};

const getHealthTone = (score: number) => {
  if (score >= 95) {
    return "green";
  }

  if (score >= 80) {
    return "orange";
  }

  return "red";
};

export default function HomePage() {
  const shellState = useAppShellState();
  const { bootstrap, connection, now } = shellState;
  const [homeSummary, setHomeSummary] = useState<HomeSummary | null>(null);
  const [weeklyEvents, setWeeklyEvents] = useState<WeeklyEvent[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadData = async () => {
      try {
        const [homeSummaryResponse, weeklyEventsResponse] = await Promise.all([
          fetch(`${resolveHttpBase()}/api/home/summary`, {
            signal: controller.signal,
            cache: "no-store",
          }),
          fetch(`${resolveHttpBase()}/api/events/weekly`, {
            signal: controller.signal,
            cache: "no-store",
          }),
        ]);

        const [homeSummaryJson, weeklyEventsJson] = await Promise.all([
          homeSummaryResponse.json(),
          weeklyEventsResponse.json(),
        ]);

        const parsedHomeSummary = HomeSummaryApiResponseSchema.parse(homeSummaryJson);
        const parsedWeeklyEvents = WeeklyEventsApiResponseSchema.parse(weeklyEventsJson);

        if (cancelled) {
          return;
        }

        setHomeSummary(parsedHomeSummary.data);
        setWeeklyEvents(parsedWeeklyEvents.data);
        setErrorMessage(null);
      } catch {
        if (!cancelled) {
          setErrorMessage("首页 mock 数据暂时不可用，请先启动 IPC 服务。");
        }
      }
    };

    void loadData();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const latestWeeklyEvent = useMemo(
    () => weeklyEvents[weeklyEvents.length - 1] ?? homeSummary?.latestWeeklyEvent ?? null,
    [homeSummary?.latestWeeklyEvent, weeklyEvents],
  );

  const weeklyEventCount = weeklyEvents.length || homeSummary?.weeklyEventCount || 0;
  const healthScore = getHealthScore(connection);
  const healthTone = getHealthTone(healthScore);
  const syncDate = connection.syncAt ? formatDate(connection.syncAt) : "--";
  const syncTime = connection.syncAt ? formatTime(connection.syncAt) : "--:--:--";

  const heroCards = useMemo(
    () => [
      {
        label: "上一次数据同步",
        value: syncDate,
        meta: `${syncTime} · 来自 IPC 实时链路`,
        toneClass: "",
      },
      {
        label: "当前日期",
        value: formatDate(now),
        meta: `班次：${getShiftLabel(now)} · ${bootstrap?.machineName ?? "采煤机主控台"}`,
        toneClass: "",
      },
      {
        label: "本周异常事件",
        value: String(weeklyEventCount),
        meta: latestWeeklyEvent ? `最新事件：${latestWeeklyEvent.text}` : "等待事件流更新",
        toneClass: "hero-value-orange",
      },
      {
        label: "通信健康度",
        value: `${healthScore}%`,
        meta: `HPC ${formatStatusText(connection.hpc)} · MOC ${formatStatusText(connection.moc)} · BOC ${formatStatusText(connection.boc)}`,
        toneClass: healthTone === "green" ? "hero-value-green" : healthTone === "orange" ? "hero-value-orange" : "hero-value-red",
      },
    ],
    [bootstrap?.machineName, connection.boc, connection.hpc, connection.moc, healthScore, healthTone, latestWeeklyEvent, now, syncDate, syncTime, weeklyEventCount],
  );

  const previewCards = useMemo(
    () => [
      {
        tone: "orange",
        label: "异常事件总览",
        time: latestWeeklyEvent?.time ?? "--",
        count: weeklyEventCount,
        title: latestWeeklyEvent?.text ?? "等待本周异常事件",
        description: "主页只保留 1 条预览，正式版会联动到对应分析页。",
        footLeft: `本周记录 ${weeklyEventCount} 条`,
      },
      {
        tone: "red",
        label: "本月故障排名",
        time: homeSummary?.topFault ? `最近一次 ${homeSummary.topFault.lastOccurredAt}` : "--",
        count: homeSummary?.topFault.count ?? 0,
        title: homeSummary?.topFault.name ?? "等待故障排行数据",
        description: "首页先展示第 1 名，后续再补完整 Top 排名页。",
        footLeft: "按次数排序",
      },
      {
        tone: "green",
        label: "本月传感器失效排名",
        time: homeSummary?.topSensor ? `最近一次 ${homeSummary.topSensor.lastOccurredAt}` : "--",
        count: homeSummary?.topSensor.count ?? 0,
        title: homeSummary?.topSensor.name ?? "等待传感器排行数据",
        description: "首页先展示第 1 名，后续再接入传感器详情与联动跳转。",
        footLeft: "按失效次数排序",
      },
    ],
    [homeSummary, latestWeeklyEvent, weeklyEventCount],
  );

  return (
    <AppShell
      disableHomeButton
      shellState={shellState}
      subtitle="面向 10.1 英寸平板的采煤机故障诊断与点检主控台"
      title="主页面"
    >
      {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

      <section className="page active">
        <div className="grid-12">
          <div className="span-12 panel">
            <div className="panel-body">
              <div className="hero-grid">
                {heroCards.map((card) => (
                  <article className="hero-card" key={card.label}>
                    <div className="hero-label">{card.label}</div>
                    <p className={`hero-value ${card.toneClass}`.trim()}>{card.value}</p>
                    <div className="hero-meta">{card.meta}</div>
                  </article>
                ))}
              </div>
            </div>
          </div>

          <div className="span-12">
            <div className="summary-grid">
              {previewCards.map((card) => (
                <article className={`summary-card ${card.tone}`} key={card.label}>
                  <div className="summary-top">
                    <div>
                      <div className="summary-label">{card.label}</div>
                      <div className="summary-time">{card.time}</div>
                    </div>
                    <div className="summary-count">{card.count}</div>
                  </div>
                  <div className="summary-main">
                    <h2 className="summary-title">{card.title}</h2>
                    <div className="summary-sub">{card.description}</div>
                  </div>
                  <div className="summary-foot">
                    <span>{card.footLeft}</span>
                    <span className="summary-link">首页预览</span>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="span-12 panel">
            <div className="panel-head">
              <div>
                <h3 className="panel-title">
                  <span className="accent-bar" />
                  功能导航
                </h3>
                <p className="panel-subtitle">
                  已完成页面接成真实路由，未完成模块继续保留原型入口占位。
                </p>
              </div>
              <span className="pill blue">主菜单</span>
            </div>
            <div className="panel-body">
              <div className="big-nav">
                {homeNavItems.map((item) =>
                  item.href ? (
                    <Link className="nav-tile nav-tile-link" href={item.href} key={item.label}>
                      <div className="nav-tile-icon">{item.icon}</div>
                      <div className="nav-tile-name">{item.label}</div>
                      <div className="nav-tile-meta ready">已接通</div>
                    </Link>
                  ) : (
                    <div
                      aria-disabled="true"
                      className="nav-tile nav-tile-disabled"
                      key={item.label}
                    >
                      <div className="nav-tile-icon">{item.icon}</div>
                      <div className="nav-tile-name">{item.label}</div>
                      <div className="nav-tile-meta">开发中</div>
                    </div>
                  ),
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
