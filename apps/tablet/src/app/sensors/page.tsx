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
import Link from "next/link";
import { useEffect, useState } from "react";
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

const getSensorBadge = (sensor: Pick<SensorSummary, "valid" | "state">) => {
  if (!sensor.valid) {
    return { label: "失效", className: "error" };
  }

  if (
    sensor.state.includes("预警") ||
    sensor.state.includes("关注") ||
    sensor.state.includes("波动")
  ) {
    return { label: "预警", className: "warn" };
  }

  return { label: "有效", className: "success" };
};

const getSensorPill = (sensor: Pick<SensorDetail, "valid" | "state"> | null) => {
  if (!sensor) {
    return { text: "当前状态", className: "blue" };
  }

  if (!sensor.valid) {
    return { text: `当前状态：${sensor.state}`, className: "red" };
  }

  if (
    sensor.state.includes("预警") ||
    sensor.state.includes("关注") ||
    sensor.state.includes("波动")
  ) {
    return { text: `当前状态：${sensor.state}`, className: "orange" };
  }

  return { text: `当前状态：${sensor.state}`, className: "green" };
};

export default function SensorsPage() {
  const [sensorSummaries, setSensorSummaries] = useState<SensorSummary[]>([]);
  const [selectedSensorId, setSelectedSensorId] = useState<string>("");
  const [sensorDetail, setSensorDetail] = useState<SensorDetail | null>(null);
  const [sensorTrend, setSensorTrend] = useState<SensorTrendPoint[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadSensorSummaries = async () => {
      try {
        setListLoading(true);

        const response = await fetch(`${resolveHttpBase()}/api/sensors`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const json = await response.json();
        const parsed = SensorSummariesApiResponseSchema.parse(json);

        if (cancelled) {
          return;
        }

        setSensorSummaries(parsed.data);
        setSelectedSensorId((current) => {
          if (current) {
            return current;
          }

          const preferred = parsed.data.find((sensor) => sensor.id === "sensor-2");
          return preferred?.id ?? parsed.data[0]?.id ?? "";
        });
        setErrorMessage(null);
      } catch {
        if (!cancelled) {
          setErrorMessage("传感器列表加载失败，请先启动 IPC 服务。");
        }
      } finally {
        if (!cancelled) {
          setListLoading(false);
        }
      }
    };

    void loadSensorSummaries();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!selectedSensorId) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadSensorDetail = async () => {
      try {
        setDetailLoading(true);

        const [detailResponse, trendResponse] = await Promise.all([
          fetch(`${resolveHttpBase()}/api/sensors/${selectedSensorId}`, {
            signal: controller.signal,
            cache: "no-store",
          }),
          fetch(`${resolveHttpBase()}/api/sensors/${selectedSensorId}/trend?range=24h`, {
            signal: controller.signal,
            cache: "no-store",
          }),
        ]);

        const [detailJson, trendJson] = await Promise.all([
          detailResponse.json(),
          trendResponse.json(),
        ]);

        const parsedDetail = SensorDetailApiResponseSchema.parse(detailJson);
        const parsedTrend = SensorTrendApiResponseSchema.parse(trendJson);

        if (cancelled) {
          return;
        }

        setSensorDetail(parsedDetail.data);
        setSensorTrend(parsedTrend.data);
        setErrorMessage(null);
      } catch {
        if (!cancelled) {
          setErrorMessage("传感器详情或趋势数据加载失败。");
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    };

    void loadSensorDetail();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedSensorId]);

  const rankingData = [...sensorSummaries].sort((left, right) => right.failures30d - left.failures30d);
  const activeSummary =
    sensorSummaries.find((sensor) => sensor.id === selectedSensorId) ?? sensorSummaries[0] ?? null;
  const sensorPill = getSensorPill(sensorDetail);
  const detailSubtitle = sensorDetail
    ? `${sensorDetail.location} · ${sensorDetail.name}`
    : activeSummary
      ? `${activeSummary.location} · ${activeSummary.name}`
      : "点击左侧条目查看 24 小时数据曲线。";

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="toolbar">
          <div className="toolbar-left">
            <Link className="home-btn" href="/">
              主菜单
            </Link>
            <div className="page-heading">
              <h1 className="page-title">传感器</h1>
              <p className="page-subtitle">
                查看有效状态、失效排名与单个传感器 24 小时变化曲线
              </p>
            </div>
          </div>
          <div className="toolbar-right">
            <span className="pill blue">24h 时序</span>
          </div>
        </header>

        <div className="content">
          {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

          <section className="page active">
            <div className="split">
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <h3 className="panel-title">
                      <span className="accent-bar" />
                      传感器总览
                    </h3>
                    <p className="panel-subtitle">
                      展示有效状态、近 30 天失效次数、上次有数据时间。
                    </p>
                  </div>
                  <span className="pill green">支持点选详情</span>
                </div>
                <div className="panel-body">
                  <div className="list">
                    {listLoading ? (
                      <div className="empty">正在加载传感器列表...</div>
                    ) : sensorSummaries.length === 0 ? (
                      <div className="empty">当前没有可展示的传感器数据。</div>
                    ) : (
                      sensorSummaries.map((sensor) => {
                        const badge = getSensorBadge(sensor);

                        return (
                          <div
                            className={`sensor-item ${sensor.id === selectedSensorId ? "active" : ""}`}
                            key={sensor.id}
                          >
                            <button
                              className="sensor-btn"
                              onClick={() => setSelectedSensorId(sensor.id)}
                              type="button"
                            >
                              <div className="sensor-main">
                                <div className="meta-line">
                                  {sensor.location} · 上次数据 {sensor.lastSeen}
                                </div>
                                <div className="sensor-title">{sensor.name}</div>
                                <div className="meta-line">
                                  近 30 天失效 {sensor.failures30d} 次 · 当前状态 {sensor.state}
                                </div>
                              </div>
                              <span className={`badge ${badge.className}`}>{badge.label}</span>
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              <div className="detail-stack">
                <div className="panel">
                  <div className="panel-head">
                    <div>
                      <h3 className="panel-title">
                        <span className="accent-bar" />
                        传感器详情
                      </h3>
                      <p className="panel-subtitle">{detailSubtitle}</p>
                    </div>
                    <span className={`pill ${sensorPill.className}`}>{sensorPill.text}</span>
                  </div>
                  <div className="panel-body">
                    <div className="kpi-row">
                      <div className="kpi">
                        <div className="kpi-name">当前状态</div>
                        <div className="kpi-value">{sensorDetail?.state ?? "--"}</div>
                      </div>
                      <div className="kpi">
                        <div className="kpi-name">近 30 天失效</div>
                        <div className="kpi-value">
                          {sensorDetail ? `${sensorDetail.failures30d} 次` : "--"}
                        </div>
                      </div>
                      <div className="kpi">
                        <div className="kpi-name">平均值</div>
                        <div className="kpi-value">{sensorDetail?.averageDisplay ?? "--"}</div>
                      </div>
                      <div className="kpi">
                        <div className="kpi-name">峰值</div>
                        <div className="kpi-value">{sensorDetail?.peakDisplay ?? "--"}</div>
                      </div>
                    </div>
                    <div className="section-spacer" />
                    <div className="chart-card">
                      <div className="chart-head">
                        <div>
                          <h4 className="chart-title">
                            {sensorDetail?.name ?? activeSummary?.name ?? "传感器"} · 24 小时数据曲线
                          </h4>
                          <div className="chart-meta">采样间隔：1 小时 · 数据仅为交互示意</div>
                        </div>
                        <span className="badge info">
                          {sensorDetail?.type ?? activeSummary?.type ?? "传感器"}传感器
                        </span>
                      </div>
                      <SensorTrendChart
                        loading={detailLoading}
                        points={sensorTrend}
                        sensorName={sensorDetail?.name ?? activeSummary?.name ?? "传感器"}
                        unit={sensorDetail?.unit ?? activeSummary?.unit ?? ""}
                      />
                    </div>
                  </div>
                </div>

                <div className="panel">
                  <div className="panel-head">
                    <div>
                      <h3 className="panel-title">
                        <span className="accent-bar" />
                        近一个月失效次数排名
                      </h3>
                      <p className="panel-subtitle">便于快速发现高频失效点位。</p>
                    </div>
                  </div>
                  <div className="panel-body">
                    <div className="list">
                      {rankingData.length === 0 ? (
                        <div className="empty">当前没有可排序的传感器数据。</div>
                      ) : (
                        rankingData.map((sensor, index) => (
                          <div className="rank-item" key={sensor.id}>
                            <div className="rank-left">
                              <div className="rank-top">
                                <span className="rank-index">{index + 1}</span>
                                <div className="rank-name">{sensor.name}</div>
                              </div>
                              <div className="meta-line">
                                {sensor.location} · 最近一次 {sensor.lastSeen}
                              </div>
                            </div>
                            <div className="rank-count">{sensor.failures30d} 次</div>
                          </div>
                        ))
                      )}
                    </div>
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
