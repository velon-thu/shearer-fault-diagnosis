"use client";

import {
  CuttingAnalysisResponseSchema,
  createApiSuccessResponseSchema,
  type CuttingAnalysisResponse,
} from "@shearer/contracts";
import { useEffect, useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";
import { AnalysisTrendChart } from "@/components/analysis-trend-chart";

const CuttingAnalysisApiResponseSchema = createApiSuccessResponseSchema(CuttingAnalysisResponseSchema);

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

export default function CuttingAnalysisPage() {
  const shellState = useAppShellState();
  const [analysis, setAnalysis] = useState<CuttingAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadAnalysis = async () => {
      try {
        setLoading(true);

        const response = await fetch(`${resolveHttpBase()}/api/analysis/cutting?range=24h`, {
          cache: "no-store",
        });
        const json = await response.json();
        const parsed = CuttingAnalysisApiResponseSchema.parse(json);

        if (cancelled) {
          return;
        }

        setAnalysis(parsed.data);
        setErrorMessage(null);
      } catch {
        if (!cancelled) {
          setErrorMessage("截割部分析数据加载失败，请先启动 IPC 服务。");
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
      subtitle="左右截割电机、左右摇臂的温度与电流统一展示"
      tagText="24h 时序"
      title="截割部分析"
    >
      {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

      <section className="page active">
        <div className="grid-12">
          <div className="span-12 panel">
            <div className="panel-head">
              <div>
                <h3 className="panel-title">
                  <span className="accent-bar" />
                  截割部 24 小时趋势总览
                </h3>
                <p className="panel-subtitle">左右截割电机、左右摇臂的温度与电流同屏对比。</p>
              </div>
              <span className="pill blue">24h 时序</span>
            </div>
            <div className="panel-body">
              <div className="grid-2">
                <div className="chart-card">
                  <div className="chart-head">
                    <div>
                      <h4 className="chart-title">左右截割电机 · 温度 / 电流</h4>
                      <div className="chart-meta">左 / 右温度与电流四曲线叠加</div>
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
                      <h4 className="chart-title">左右摇臂 · 温度 / 电流</h4>
                      <div className="chart-meta">摇臂状态与负载变化</div>
                    </div>
                  </div>
                  <AnalysisTrendChart
                    labels={analysis?.labels ?? []}
                    loading={loading}
                    series={analysis?.armSeries ?? []}
                    tall={false}
                  />
                  {analysis?.armSeries?.length ? (
                    <div className="chart-legend">
                      {analysis.armSeries.map((item) => (
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
                  统计信息表
                </h3>
                <p className="panel-subtitle">平均带载功率、平均带载温度、运行与超限时间。</p>
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
                <p className="panel-subtitle">动作链与系统执行结果。</p>
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
                <p className="panel-subtitle">高亮显示报警与保护事件，便于班中快速研判。</p>
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
