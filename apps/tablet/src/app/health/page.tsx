"use client";

import {
  HealthReportSchema,
  createApiSuccessResponseSchema,
  type HealthReport,
} from "@shearer/contracts";
import { useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";

const HealthApiResponseSchema = createApiSuccessResponseSchema(HealthReportSchema);

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

const GRADE_COLOR: Record<HealthReport["grade"], string> = {
  优: "#38d889",
  良: "#48c7ff",
  注意: "#ffb03a",
  异常: "#ff5c5c",
};

const pad = (n: number) => String(n).padStart(2, "0");
const fmtClock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export default function HealthPage() {
  const shellState = useAppShellState();
  const [report, setReport] = useState<HealthReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const scan = async () => {
    try {
      setScanning(true);
      const response = await fetch(`${resolveHttpBase()}/api/health-check`, { cache: "no-store" });
      const parsed = HealthApiResponseSchema.parse(await response.json());
      setReport(parsed.data);
      setErrorMessage(null);
    } catch {
      setErrorMessage("体检失败，请确认服务已启动。");
    } finally {
      setScanning(false);
    }
  };

  return (
    <AppShell shellState={shellState} title="一键体检">
      <section className="page active">
        {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

        {report === null ? (
          <div className="hc-start">
            <button
              className="hc-scan-btn"
              disabled={scanning}
              onClick={() => void scan()}
              type="button"
            >
              {scanning ? "扫描中…" : "开始体检"}
            </button>
          </div>
        ) : (
          <>
            <div className="hc-top">
              <div className="hc-score" style={{ borderColor: `${GRADE_COLOR[report.grade]}66` }}>
                <strong style={{ color: GRADE_COLOR[report.grade] }}>{report.score}</strong>
                <span className="hc-grade" style={{ color: GRADE_COLOR[report.grade] }}>
                  {report.grade}
                </span>
                <span className="hc-scanned">{fmtClock(report.scannedAt)}</span>
              </div>
              <div className="hc-top-cards">
                <div className="dt-kpi">
                  <span>模块通讯</span>
                  <strong style={{ color: report.modules.every((m) => m.ok) ? "#38d889" : "#ff5c5c" }}>
                    {report.modules.filter((m) => m.ok).length}/{report.modules.length}
                  </strong>
                </div>
                <div className="dt-kpi">
                  <span>传感器有效</span>
                  <strong style={{ color: "#48c7ff" }}>
                    {report.sensors.valid}/{report.sensors.total - report.sensors.notInstalled}
                  </strong>
                </div>
                <div className="dt-kpi">
                  <span>激活故障</span>
                  <strong style={{ color: report.activeFaults.length ? "#ff5c5c" : "#38d889" }}>
                    {report.activeFaults.length}
                  </strong>
                </div>
                <div className="dt-kpi">
                  <span>对称性关注</span>
                  <strong
                    style={{
                      color: report.symmetry.some((x) => x.judge === "attention")
                        ? "#ffb03a"
                        : "#38d889",
                    }}
                  >
                    {report.symmetry.filter((x) => x.judge === "attention").length}
                  </strong>
                </div>
                <button className="sensor-settings-btn" onClick={() => void scan()} type="button">
                  重新体检
                </button>
              </div>
            </div>

            <div className="hc-grid">
              <div className="panel">
                <div className="panel-head">
                  <h3 className="panel-title">
                    <span className="accent-bar" />
                    模块通讯
                  </h3>
                </div>
                <div className="panel-body">
                  <div className="hc-modules">
                    {report.modules.map((m) => (
                      <span className={`hc-module${m.ok ? " ok" : ""}`} key={m.name}>
                        <span className="status-dot" />
                        {m.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-head">
                  <h3 className="panel-title">
                    <span className="accent-bar" />
                    左右对称性
                  </h3>
                </div>
                <div className="panel-body">
                  <table className="data-table hc-table">
                    <thead>
                      <tr>
                        <th>项目</th>
                        <th>左</th>
                        <th>右</th>
                        <th>差值</th>
                        <th>判定</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.symmetry.map((x) => (
                        <tr key={x.item}>
                          <td>{x.item}</td>
                          <td>{x.judge === "invalid" ? "--" : `${x.left}${x.unit}`}</td>
                          <td>{x.judge === "invalid" ? "--" : `${x.right}${x.unit}`}</td>
                          <td>{x.diffText}</td>
                          <td>
                            {x.judge === "invalid" ? (
                              <span className="badge info">无效</span>
                            ) : x.judge === "attention" ? (
                              <span className="badge warn">关注</span>
                            ) : (
                              <span className="badge success">正常</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="panel">
                <div className="panel-head">
                  <h3 className="panel-title">
                    <span className="accent-bar" />
                    激活故障（{report.activeFaults.length}）
                  </h3>
                </div>
                <div className="panel-body">
                  <div className="list">
                    {report.activeFaults.length === 0 ? (
                      <div className="empty">当前没有激活的警告/停机故障。</div>
                    ) : (
                      report.activeFaults.map((f, i) => (
                        <div className="rank-item" key={i}>
                          <div className="rank-left">
                            <div className="rank-top">
                              <span className={`lf-tag ${f.type === 2 ? "lf-tag-stop" : "lf-tag-warn"}`}>
                                {f.type === 2 ? "停机" : "警告"}
                              </span>
                              <div className="rank-name">{f.name}</div>
                            </div>
                          </div>
                          <div className="meta-line">{fmtClock(f.occurTs)}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="panel">
                <div className="panel-head">
                  <h3 className="panel-title">
                    <span className="accent-bar" />
                    传感器（无效 {report.sensors.invalid.length} · 未配备 {report.sensors.notInstalled}）
                  </h3>
                </div>
                <div className="panel-body">
                  <div className="list">
                    {report.sensors.invalid.length === 0 ? (
                      <div className="empty">已配备传感器全部有效。</div>
                    ) : (
                      report.sensors.invalid.map((x, i) => (
                        <div className="rank-item" key={i}>
                          <div className="rank-left">
                            <div className="rank-top">
                              <span className="lf-tag lf-tag-stop">失效</span>
                              <div className="rank-name">{x.name}</div>
                            </div>
                          </div>
                          <div className="meta-line">{x.state}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}
