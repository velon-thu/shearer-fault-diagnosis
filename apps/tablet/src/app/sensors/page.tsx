"use client";

import {
  SensorDetailSchema,
  SensorSummarySchema,
  SensorTrendPointSchema,
  createApiSuccessResponseSchema,
  type SensorDetail,
  type SensorSummary,
  type SensorTrendPoint,
} from "@shearer/contracts";
import { useEffect, useMemo, useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";
import { SensorTrendChart } from "@/components/sensor-trend-chart";

const SensorSummariesApiResponseSchema = createApiSuccessResponseSchema(SensorSummarySchema.array());
const SensorDetailApiResponseSchema = createApiSuccessResponseSchema(SensorDetailSchema);
const SensorTrendApiResponseSchema = createApiSuccessResponseSchema(SensorTrendPointSchema.array());

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

// 类型页顺序（type 来自后端按单位推导；"数值"归入"其他"）
const TYPE_ORDER = [
  "温度", "电流", "负荷", "压力", "流量", "油位",
  "速度", "位置", "角度", "距离", "电压", "频率", "其他",
] as const;

const typeGroup = (type: string) =>
  (TYPE_ORDER as readonly string[]).includes(type) ? type : "其他";

// 详情页时间段选项（all=数据库内该测点全部数据）
const TREND_RANGES: Array<[string, string]> = [
  ["all", "全部"],
  ["24h", "24小时"],
  ["6h", "6小时"],
  ["1h", "1小时"],
  ["10m", "10分钟"],
];

const HIDDEN_KEY = "shearer.sensors.hidden";

const loadHidden = (): Set<string> => {
  try {
    const raw = window.localStorage.getItem(HIDDEN_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
};

const saveHidden = (hidden: Set<string>) => {
  try {
    window.localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
  } catch {
    // 存储不可用时本次会话内仍生效
  }
};

type ViewMode = "overview" | "detail" | "settings";

export default function SensorsPage() {
  const shellState = useAppShellState();
  const [summaries, setSummaries] = useState<SensorSummary[]>([]);
  const [view, setView] = useState<ViewMode>("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SensorDetail | null>(null);
  const [trend, setTrend] = useState<SensorTrendPoint[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [trendRange, setTrendRange] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [activeType, setActiveType] = useState<string>("温度");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setHidden(loadHidden());
  }, []);

  // 总览列表：进页面拉一次，30s 刷新（数据在直播）
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`${resolveHttpBase()}/api/sensors`, { cache: "no-store" });
        const parsed = SensorSummariesApiResponseSchema.parse(await response.json());
        if (!cancelled) {
          setSummaries(parsed.data);
          setErrorMessage(null);
        }
      } catch {
        if (!cancelled) {
          setErrorMessage("传感器列表加载失败，请确认服务已启动。");
        }
      }
    };

    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // 详情 + 趋势：选中后拉取，10s 刷新
  useEffect(() => {
    if (view !== "detail" || !selectedId) {
      setDetail(null);
      setTrend([]);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);

    const load = async () => {
      try {
        const [detailRes, trendRes] = await Promise.all([
          fetch(`${resolveHttpBase()}/api/sensors/${selectedId}`, { cache: "no-store" }),
          fetch(`${resolveHttpBase()}/api/sensors/${selectedId}/trend?range=${trendRange}`, {
            cache: "no-store",
          }),
        ]);
        const parsedDetail = SensorDetailApiResponseSchema.parse(await detailRes.json());
        const parsedTrend = SensorTrendApiResponseSchema.parse(await trendRes.json());
        if (!cancelled) {
          setDetail(parsedDetail.data);
          setTrend(parsedTrend.data);
          setDetailLoading(false);
        }
      } catch {
        if (!cancelled) {
          setDetailLoading(false);
          setErrorMessage("传感器详情加载失败。");
        }
      }
    };

    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [view, selectedId, trendRange]);

  // 可见传感器（设置里隐藏的不出现在总览）
  const visible = useMemo(
    () => summaries.filter((s) => !hidden.has(s.id)),
    [summaries, hidden],
  );

  // 存在数据的类型页列表
  const availableTypes = useMemo(() => {
    const present = new Set(visible.map((s) => typeGroup(s.type)));
    return TYPE_ORDER.filter((t) => present.has(t));
  }, [visible]);

  // 当前类型页失效时自动落到第一页
  useEffect(() => {
    if (availableTypes.length > 0 && !availableTypes.includes(activeType as never)) {
      setActiveType(availableTypes[0]);
    }
  }, [availableTypes, activeType]);

  const searching = searchText.trim().length > 0;

  const shownSensors = useMemo(() => {
    if (searching) {
      const text = searchText.trim().toLowerCase();
      return visible.filter(
        (s) =>
          s.name.toLowerCase().includes(text) ||
          s.location.toLowerCase().includes(text) ||
          s.type.toLowerCase().includes(text),
      );
    }
    return visible.filter((s) => typeGroup(s.type) === activeType);
  }, [visible, searching, searchText, activeType]);

  const typeIndex = availableTypes.indexOf(activeType as never);

  const gotoPage = (delta: number) => {
    if (availableTypes.length === 0) {
      return;
    }
    const next = (typeIndex + delta + availableTypes.length) % availableTypes.length;
    setActiveType(availableTypes[next]);
  };

  const toggleHidden = (id: string) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      saveHidden(next);
      return next;
    });
  };

  const selectedSummary = useMemo(
    () => summaries.find((s) => s.id === selectedId) ?? null,
    [summaries, selectedId],
  );
  const activeInfo = detail ?? selectedSummary;

  // 设置视图按类型分组（含已隐藏的全部传感器）
  const settingsGroups = useMemo(() => {
    const byType = new Map<string, SensorSummary[]>();
    for (const s of summaries) {
      const key = typeGroup(s.type);
      const list = byType.get(key) ?? [];
      list.push(s);
      byType.set(key, list);
    }
    return TYPE_ORDER.map((t) => [t, byType.get(t) ?? []] as const).filter(
      ([, list]) => list.length > 0,
    );
  }, [summaries]);

  return (
    <AppShell hideFloatingHome={view === "detail"} shellState={shellState} title="传感器">
      <section className="page active">
        {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

        {view === "overview" ? (
          /* ===== 总览：搜索 + 类型翻页 ===== */
          <>
            <div className="sensor-topbar">
              <input
                className="sensor-search"
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="搜索传感器名称 / 部件 / 类型"
                type="search"
                value={searchText}
              />
            </div>

            {!searching ? (
              <div className="sensor-type-bar">
                {availableTypes.map((t) => (
                  <button
                    className={`sensor-type-chip${t === activeType ? " active" : ""}`}
                    key={t}
                    onClick={() => setActiveType(t)}
                    type="button"
                  >
                    {t}
                  </button>
                ))}
              </div>
            ) : null}

            {summaries.length === 0 ? (
              <div className="empty">正在加载传感器列表...</div>
            ) : shownSensors.length === 0 ? (
              <div className="empty">
                {searching ? "没有匹配的传感器。" : "该类型下没有可显示的传感器。"}
              </div>
            ) : (
              <div className="sensor-grid">
                {shownSensors.map((sensor) => (
                  <button
                    className="sensor-cell"
                    key={sensor.id}
                    onClick={() => {
                      setSelectedId(sensor.id);
                      setView("detail");
                    }}
                    type="button"
                  >
                    <div>
                      <div className="sensor-cell-name">{sensor.name}</div>
                      <div className="sensor-cell-meta">
                        {sensor.location} · {sensor.state}
                      </div>
                    </div>
                    <span className={`badge ${sensor.valid ? "success" : "error"}`}>
                      {sensor.valid ? "有效" : "失效"}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {!searching ? (
              <div className="sensor-pager">
                <button onClick={() => gotoPage(-1)} type="button">
                  ‹ 上一页
                </button>
                <button
                  className="sensor-settings-btn"
                  onClick={() => setView("settings")}
                  type="button"
                >
                  传感器设置
                </button>
                <button onClick={() => gotoPage(1)} type="button">
                  下一页 ›
                </button>
              </div>
            ) : null}
          </>
        ) : view === "settings" ? (
          /* ===== 传感器设置：选择显示/隐藏 ===== */
          <>
            <div className="sensor-detail-head">
              <button
                className="sensor-back-btn"
                onClick={() => setView("overview")}
                type="button"
              >
                ‹ 返回总览
              </button>
              <div>
                <h1 className="sensor-detail-title">传感器设置</h1>
                <div className="sensor-detail-sub">
                  未配备的传感器可在此隐藏，隐藏后不在总览中显示（本机记忆）。
                </div>
              </div>
            </div>
            {settingsGroups.map(([type, list]) => (
              <div key={type}>
                <h2 className="sensor-group-title">{type}</h2>
                {list.map((sensor) => {
                  const isShown = !hidden.has(sensor.id);
                  return (
                    <div className="sensor-toggle-row" key={sensor.id}>
                      <div>
                        <div className="sensor-toggle-name">{sensor.name}</div>
                        <div className="sensor-toggle-meta">{sensor.location}</div>
                      </div>
                      <button
                        className={`sensor-switch${isShown ? " on" : ""}`}
                        onClick={() => toggleHidden(sensor.id)}
                        type="button"
                      >
                        {isShown ? "显示中" : "已隐藏"}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </>
        ) : (
          /* ===== 全屏详情 ===== */
          <>
            <div className="sensor-detail-head">
              <button
                className="sensor-back-btn"
                onClick={() => {
                  setView("overview");
                  setSelectedId(null);
                }}
                type="button"
              >
                ‹ 返回总览
              </button>
              <div>
                <h1 className="sensor-detail-title">{activeInfo?.name ?? "传感器"}</h1>
                <div className="sensor-detail-sub">
                  {activeInfo?.location ?? ""} · {activeInfo?.type ?? ""}传感器 · 上次数据{" "}
                  {activeInfo?.lastSeen ?? "--"}
                </div>
              </div>
              <span
                className={`pill ${activeInfo?.valid ? "green" : "red"}`}
                style={{ marginLeft: "auto" }}
              >
                {activeInfo?.state ?? "--"}
              </span>
            </div>

            <div className="kpi-row">
              <div className="kpi">
                <div className="kpi-name">当前状态</div>
                <div className="kpi-value">{activeInfo?.state ?? "--"}</div>
              </div>
              <div className="kpi">
                <div className="kpi-name">24h 平均</div>
                <div className="kpi-value">{detail?.averageDisplay ?? "--"}</div>
              </div>
              <div className="kpi">
                <div className="kpi-name">24h 峰值</div>
                <div className="kpi-value">{detail?.peakDisplay ?? "--"}</div>
              </div>
              <div className="kpi">
                <div className="kpi-name">近 30 天失效</div>
                <div className="kpi-value">
                  {activeInfo ? `${activeInfo.failures30d} 次` : "--"}
                </div>
              </div>
            </div>
            <div className="section-spacer" />
            <div className="sensor-type-bar">
              {TREND_RANGES.map(([key, label]) => (
                <button
                  className={`sensor-type-chip${trendRange === key ? " active" : ""}`}
                  key={key}
                  onClick={() => setTrendRange(key)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="sensor-detail-chart">
              <SensorTrendChart
                loading={detailLoading}
                points={trend}
                sensorName={activeInfo?.name ?? "传感器"}
                unit={activeInfo?.unit ?? ""}
              />
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}
