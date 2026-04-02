"use client";

import {
  BootstrapResponseSchema,
  HomeSummarySchema,
  LiveMessageSchema,
  WeeklyEventSchema,
  createApiSuccessResponseSchema,
  type BootstrapResponse,
  type ConnectionStatus,
  type HomeSummary,
  type WeeklyEvent,
} from "@shearer/contracts";
import { useEffect, useMemo, useState } from "react";

const BootstrapApiResponseSchema = createApiSuccessResponseSchema(BootstrapResponseSchema);
const HomeSummaryApiResponseSchema = createApiSuccessResponseSchema(HomeSummarySchema);
const WeeklyEventsApiResponseSchema = createApiSuccessResponseSchema(WeeklyEventSchema.array());

const fallbackConnection: ConnectionStatus = {
  tabletToIpc: "disconnected",
  hpc: "offline",
  moc: "offline",
  boc: "offline",
  syncAt: "",
};

const homeNavItems = [
  { label: "传感器", page: "sensors", icon: "传" },
  { label: "故障代码查询", page: "fault-codes", icon: "码" },
  { label: "截割部分析", page: "cutting-analysis", icon: "截" },
  { label: "牵引部分析", page: "traction-analysis", icon: "牵" },
  { label: "泵分析", page: "pump-analysis", icon: "泵" },
  { label: "近期故障排名", page: "recent-ranking", icon: "排" },
  { label: "日常检修打卡", page: "checkin", icon: "检" },
  { label: "知识库", page: "knowledge", icon: "知" },
  { label: "运行循环图", page: "run-cycle", icon: "循" },
  { label: "系统设置", page: "settings", icon: "设" },
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

const resolveWsUrl = () => {
  if (typeof window === "undefined") {
    return "";
  }

  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }

  const { hostname, port, protocol } = window.location;
  const wsProtocol = protocol === "https:" ? "wss:" : "ws:";

  if ((hostname === "localhost" || hostname === "127.0.0.1") && port === "3000") {
    return `${wsProtocol}//${hostname}:18080/ws/live`;
  }

  return `${wsProtocol}//${window.location.host}/ws/live`;
};

const formatStatusText = (status: string) => {
  switch (status) {
    case "connected":
      return "已连接";
    case "disconnected":
      return "未连接";
    case "ok":
      return "正常";
    case "warn":
      return "预警";
    case "error":
      return "异常";
    case "offline":
      return "离线";
    default:
      return status;
  }
};

const formatDate = (value: Date | string | null, withWeekday = false) => {
  if (!value) {
    return "--";
  }

  const date = typeof value === "string" ? new Date(value) : value;

  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: withWeekday ? "long" : undefined,
  });
};

const formatTime = (value: Date | string | null) => {
  if (!value) {
    return "--:--:--";
  }

  const date = typeof value === "string" ? new Date(value) : value;

  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }

  return date.toLocaleTimeString("zh-CN", {
    hour12: false,
  });
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
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [homeSummary, setHomeSummary] = useState<HomeSummary | null>(null);
  const [weeklyEvents, setWeeklyEvents] = useState<WeeklyEvent[]>([]);
  const [connection, setConnection] = useState<ConnectionStatus>(fallbackConnection);
  const [now, setNow] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setNow(new Date());

    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadData = async () => {
      try {
        const [bootstrapResponse, homeSummaryResponse, weeklyEventsResponse] = await Promise.all([
          fetch(`${resolveHttpBase()}/api/bootstrap`, {
            signal: controller.signal,
            cache: "no-store",
          }),
          fetch(`${resolveHttpBase()}/api/home/summary`, {
            signal: controller.signal,
            cache: "no-store",
          }),
          fetch(`${resolveHttpBase()}/api/events/weekly`, {
            signal: controller.signal,
            cache: "no-store",
          }),
        ]);

        const [bootstrapJson, homeSummaryJson, weeklyEventsJson] = await Promise.all([
          bootstrapResponse.json(),
          homeSummaryResponse.json(),
          weeklyEventsResponse.json(),
        ]);

        const parsedBootstrap = BootstrapApiResponseSchema.parse(bootstrapJson);
        const parsedHomeSummary = HomeSummaryApiResponseSchema.parse(homeSummaryJson);
        const parsedWeeklyEvents = WeeklyEventsApiResponseSchema.parse(weeklyEventsJson);

        if (cancelled) {
          return;
        }

        setBootstrap(parsedBootstrap.data);
        setConnection(parsedBootstrap.data.connection);
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

    const ws = new WebSocket(resolveWsUrl());

    ws.onmessage = (event) => {
      try {
        const parsed = LiveMessageSchema.parse(JSON.parse(event.data));
        setConnection(parsed.data);
      } catch {
        setErrorMessage("实时状态消息解析失败。");
      }
    };

    ws.onerror = () => {
      setErrorMessage((current) => current ?? "当前未连接到 /ws/live mock 通道。");
    };

    return () => {
      cancelled = true;
      controller.abort();
      ws.close();
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

  const statusChips = useMemo(
    () => [
      {
        label: "平板↔工控机",
        value: formatStatusText(connection.tabletToIpc),
        tone: connection.tabletToIpc === "connected" ? "success" : "offline",
      },
      { label: "HPC", value: formatStatusText(connection.hpc), tone: connection.hpc === "ok" ? "success" : connection.hpc },
      { label: "MOC", value: formatStatusText(connection.moc), tone: connection.moc === "ok" ? "success" : connection.moc },
      { label: "BOC", value: formatStatusText(connection.boc), tone: connection.boc === "ok" ? "success" : connection.boc },
    ],
    [connection],
  );

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
    <main className="app-shell">
      <section className="workspace">
        <header className="toolbar">
          <div className="toolbar-left">
            <div className="home-btn" aria-hidden="true">
              主菜单
            </div>
            <div className="page-heading">
              <h1 className="page-title">主页面</h1>
              <p className="page-subtitle">
                面向 10.1 英寸平板的采煤机故障诊断与点检主控台
              </p>
            </div>
          </div>
          <div className="toolbar-right">
            <div className="status-cluster">
              {statusChips.map((chip) => (
                <div className={`status-chip ${chip.tone}`} key={chip.label}>
                  <span className="status-dot" />
                  <span>{chip.label} {chip.value}</span>
                </div>
              ))}
            </div>
            <div className="clock-box">
              <div className="clock-time">{formatTime(now)}</div>
              <div className="clock-date">{formatDate(now, true)}</div>
            </div>
          </div>
        </header>

        <div className="content">
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
                      沿用设计稿的大图标主菜单布局，这一版先完成首页迁移，其他页面按钮仅作入口占位。
                    </p>
                  </div>
                  <span className="pill blue">主菜单</span>
                </div>
                <div className="panel-body">
                  <div className="big-nav">
                    {homeNavItems.map((item) => (
                      <article className="nav-tile" key={item.page}>
                        <div className="nav-tile-icon">{item.icon}</div>
                        <div className="nav-tile-name">{item.label}</div>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
