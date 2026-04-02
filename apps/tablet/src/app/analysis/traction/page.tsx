"use client";

import {
  TractionAnalysisResponseSchema,
  createApiSuccessResponseSchema,
  type TractionAnalysisResponse,
} from "@shearer/contracts";
import { useEffect, useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";
import { AnalysisTrendChart } from "@/components/analysis-trend-chart";

const TractionAnalysisApiResponseSchema = createApiSuccessResponseSchema(TractionAnalysisResponseSchema);

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

export default function TractionAnalysisPage() {
  const shellState = useAppShellState();
  const [analysis, setAnalysis] = useState<TractionAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadAnalysis = async () => {
      try {
        setLoading(true);

        const response = await fetch(`${resolveHttpBase()}/api/analysis/traction?range=24h`, {
          cache: "no-store",
        });
        const json = await response.json();
        const parsed = TractionAnalysisApiResponseSchema.parse(json);

        if (cancelled) {
          return;
        }

        setAnalysis(parsed.data);
        setErrorMessage(null);
      } catch {
        if (!cancelled) {
          setErrorMessage("牵引部分析数据加载失败，请先启动 IPC 服务。");
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
    <AppShell
      shellState={shellState}
      subtitle="牵引电机与变频器关键变量统一分析"
      tagText="变频器联动"
      title="牵引部分析"
    >
      {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

      <section className="page active">
        <div className="grid-12">
          <div className="span-12 panel">
            <div className="panel-head">
              <div>
                <h3 className="panel-title">
                  <span className="accent-bar" />
                  牵引部 24 小时趋势
                </h3>
                <p className="panel-subtitle">牵引电机温度 / 电流与变频器关键变量同屏对比。</p>
              </div>
              <span className="pill blue">变频器联动</span>
            </div>
            <div className="panel-body">
              <div className="grid-2">
                <div className="chart-card">
                  <div className="chart-head">
                    <div>
                      <h4 className="chart-title">左右牵引电机 · 温度 / 电流</h4>
                      <div className="chart-meta">左右电机负载差异对比</div>
                    </div>
                  </div>
                  <AnalysisTrendChart
                    labels={analysis?.labels ?? []}
                    loading={loading}
                    series={analysis?.motorSeries ?? []}
                    tall={false}
                  />
                  {analysis?.motorSeries?.length ? (
                    <div className="chart-legend">
                      {analysis.motorSeries.map((item) => (
                        <div className="legend-item" key={item.name}>
                          <span className="legend-line" style={{ background: item.color }} />
                          <span>{item.name}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="chart-card">
                  <div className="chart-head">
                    <div>
                      <h4 className="chart-title">变频器关键变量</h4>
                      <div className="chart-meta">输入电压 / 直流电压 / 输出转矩 / IGBT 温度</div>
                    </div>
                  </div>
                  <AnalysisTrendChart
                    labels={analysis?.labels ?? []}
                    loading={loading}
                    series={analysis?.inverterSeries ?? []}
                    tall={false}
                  />
                  {analysis?.inverterSeries?.length ? (
                    <div className="chart-legend">
                      {analysis.inverterSeries.map((item) => (
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
          </div>

          <div className="span-7 panel">
            <div className="panel-head">
              <div>
                <h3 className="panel-title">
                  <span className="accent-bar" />
                  统计信息
                </h3>
                <p className="panel-subtitle">牵引部今日运行画像与超限时长。</p>
              </div>
            </div>
            <div className="panel-body">
              {analysis?.stats?.length ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>部件</th>
                      <th>平均带载功率</th>
                      <th>平均带载温度</th>
                      <th>今日带载运行时间</th>
                      <th>今日过载时间</th>
                      <th>今日过温时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.stats.map((item) => (
                      <tr key={item.part}>
                        <td>{item.part}</td>
                        <td>{item.averageLoadPower}</td>
                        <td>{item.averageLoadTemperature}</td>
                        <td>{item.todayLoadedRuntime}</td>
                        <td>{item.todayOverloadTime}</td>
                        <td>{item.todayOverTemperatureTime}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty">暂无统计信息</div>
              )}
            </div>
          </div>

          <div className="span-5 panel">
            <div className="panel-head">
              <div>
                <h3 className="panel-title">
                  <span className="accent-bar" />
                  最近两分钟操作日志
                </h3>
                <p className="panel-subtitle">保留与截割部一致的统一日志结构。</p>
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

          <div className="span-12 panel">
            <div className="panel-head">
              <div>
                <h3 className="panel-title">
                  <span className="accent-bar" />
                  近两分钟异常状态
                </h3>
                <p className="panel-subtitle">用于跟踪变频器与牵引链路的保护动作。</p>
              </div>
            </div>
            <div className="panel-body">
              <div className="grid-2">
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
    </AppShell>
  );
}
