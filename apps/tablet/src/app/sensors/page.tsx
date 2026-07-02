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

// 总览分组顺序（type 来自后端按单位推导；"数值"归入"其他"）
const TYPE_ORDER = [
  "温度", "电流", "负荷", "压力", "流量", "油位",
  "速度", "位置", "角度", "距离", "电压", "频率", "其他",
] as const;

const typeGroup = (type: string) =>
  (TYPE_ORDER as readonly string[]).includes(type) ? type : "其他";

const badgeOf = (sensor: SensorSummary) => {
  if (!sensor.valid) {
    return { label: "失效", className: "error" };
  }
  return { label: "有效", className: "success" };
};

export default function SensorsPage() {
  const shellState = useAppShellState();
  const [summaries, setSummaries] = useState<SensorSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SensorDetail | null>(null);
  const [trend, setTrend] = useState<SensorTrendPoint[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
    if (!selectedId) {
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
          fetch(`${resolveHttpBase()}/api/sensors/${selectedId}/trend?range=24h`, { cache: "no-store" }),
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
  }, [selectedId]);

  const groups = useMemo(() => {
    const text = searchText.trim().toLowerCase();
    const filtered = text
      ? summaries.filter(
          (s) =>
            s.name.toLowerCase().includes(text) ||
            s.location.toLowerCase().includes(text) ||
            s.type.toLowerCase().includes(text),
        )
      : summaries;

    const byType = new Map<string, SensorSummary[]>();
    for (const s of filtered) {
      const key = typeGroup(s.type);
      const list = byType.get(key) ?? [];
      list.push(s);
      byType.set(key, list);
    }
    return TYPE_ORDER.map((t) => [t, byType.get(t) ?? []] as const).filter(
      ([, list]) => list.length > 0,
    );
  }, [summaries, searchText]);

  const selectedSummary = useMemo(
    () => summaries.find((s) => s.id === selectedId) ?? null,
    [summaries, selectedId],
  );

  const activeInfo = detail ?? selectedSummary;

  return (
    <AppShell shellState={shellState} title="传感器">
      <section className="page active">
        {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

        {selectedId === null ? (
          /* ===== 总览：搜索 + 按类型分组 ===== */
          <>
            <input
              className="sensor-search"
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="搜索传感器名称 / 部件 / 类型"
              type="search"
              value={searchText}
            />
            {summaries.length === 0 ? (
              <div className="empty">正在加载传感器列表...</div>
            ) : (
              groups.map(([type, list]) => (
                <div key={type}>
                  <h2 className="sensor-group-title">
                    {type}
                    <small>{list.length} 个</small>
                  </h2>
                  <div className="sensor-grid">
                    {list.map((sensor) => {
                      const badge = badgeOf(sensor);
                      return (
                        <button
                          className="sensor-cell"
                          key={sensor.id}
                          onClick={() => setSelectedId(sensor.id)}
                          type="button"
                        >
                          <div>
                            <div className="sensor-cell-name">{sensor.name}</div>
                            <div className="sensor-cell-meta">
                              {sensor.location} · {sensor.state}
                            </div>
                          </div>
                          <span className={`badge ${badge.className}`}>{badge.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </>
        ) : (
          /* ===== 全屏详情 ===== */
          <>
            <div className="sensor-detail-head">
              <button className="sensor-back-btn" onClick={() => setSelectedId(null)} type="button">
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
                <div className="kpi-name">24h 平均值</div>
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
