"use client";

import {
  PumpAnalysisResponseSchema,
  createApiSuccessResponseSchema,
  type PumpAnalysisResponse,
} from "@shearer/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AnalysisTrendChart } from "@/components/analysis-trend-chart";

const PumpAnalysisApiResponseSchema = createApiSuccessResponseSchema(PumpAnalysisResponseSchema);

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

export default function PumpAnalysisPage() {
  const [analysis, setAnalysis] = useState<PumpAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadAnalysis = async () => {
      try {
        setLoading(true);

        const response = await fetch(`${resolveHttpBase()}/api/analysis/pump?range=24h`, {
          cache: "no-store",
        });
        const json = await response.json();
        const parsed = PumpAnalysisApiResponseSchema.parse(json);

        if (cancelled) {
          return;
        }

        setAnalysis(parsed.data);
        setErrorMessage(null);
      } catch {
        if (!cancelled) {
          setErrorMessage("泵分析数据加载失败，请先启动 IPC 服务。");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadAnalysis();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="toolbar">
          <div className="toolbar-left">
            <Link className="home-btn" href="/">
              主菜单
            </Link>
            <div className="page-heading">
              <h1 className="page-title">泵分析</h1>
              <p className="page-subtitle">泵电机运行趋势、运行统计及两分钟异常状态</p>
            </div>
          </div>
          <div className="toolbar-right">
            <span className="pill blue">24h 时序</span>
          </div>
        </header>

        <div className="content">
          {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

          <section className="page active">
            <div className="grid-12">
              <div className="span-8 panel">
                <div className="panel-head">
                  <div>
                    <h3 className="panel-title">
                      <span className="accent-bar" />
                      泵电机 24 小时趋势
                    </h3>
                    <p className="panel-subtitle">泵电机温度、电流及负载状态的综合展示。</p>
                  </div>
                </div>
                <div className="panel-body">
                  <div className="chart-card">
                    <div className="chart-head">
                      <div>
                        <h4 className="chart-title">泵电机 · 温度 / 电流 / 功率估算</h4>
                        <div className="chart-meta">趋势数据用于原型演示，可替换为实时采样源</div>
                      </div>
                    </div>
                    <AnalysisTrendChart
                      labels={analysis?.labels ?? []}
                      loading={loading}
                      series={analysis?.trendSeries ?? []}
                    />
                    {analysis?.trendSeries?.length ? (
                      <div className="chart-legend">
                        {analysis.trendSeries.map((item) => (
                          <div className="legend-item" key={item.name}>
                            <span className="legend-line" style={{ background: item.color }} />
                            <span>{item.name}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="span-4 panel">
                <div className="panel-head">
                  <div>
                    <h3 className="panel-title">
                      <span className="accent-bar" />
                      统计信息
                    </h3>
                    <p className="panel-subtitle">泵电机带载统计</p>
                  </div>
                </div>
                <div className="panel-body">
                  <div className="kpi-row">
                    {analysis?.stats?.length ? (
                      analysis.stats.map((item) => (
                        <div className="kpi" key={item.label}>
                          <div className="kpi-name">{item.label}</div>
                          <div className="kpi-value pump-kpi-value">{item.value}</div>
                        </div>
                      ))
                    ) : (
                      <div className="empty">暂无统计信息</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="span-6 panel">
                <div className="panel-head">
                  <div>
                    <h3 className="panel-title">
                      <span className="accent-bar" />
                      最近两分钟操作日志
                    </h3>
                    <p className="panel-subtitle">泵站动作与操作记录</p>
                  </div>
                </div>
                <div className="panel-body">
                  <div className="log-list">
                    {analysis?.logs?.length ? (
                      analysis.logs.map((item, index) => (
                        <div className="log-item" key={`${item.time}-${item.text}-${index}`}>
                          <div className="log-time">{item.time}</div>
                          <div className="log-text">{item.text}</div>
                        </div>
                      ))
                    ) : (
                      <div className="empty">暂无操作日志</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="span-6 panel">
                <div className="panel-head">
                  <div>
                    <h3 className="panel-title">
                      <span className="accent-bar" />
                      近两分钟异常状态
                    </h3>
                    <p className="panel-subtitle">集中显示 EDCR / RDCR 相关状态</p>
                  </div>
                </div>
                <div className="panel-body">
                  <div className="log-list">
                    {analysis?.alerts?.length ? (
                      analysis.alerts.map((item, index) => (
                        <div className="log-item alarm" key={`${item.time}-${item.text}-${index}`}>
                          <div className="log-time">{item.time}</div>
                          <div className="log-text">{item.text}</div>
                        </div>
                      ))
                    ) : (
                      <div className="empty">暂无异常状态</div>
                    )}
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
