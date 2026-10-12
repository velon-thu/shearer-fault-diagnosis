"use client";

import {
  HealthReportSchema,
  createApiSuccessResponseSchema,
  type HealthCheckItem,
  type HealthReport,
} from "@shearer/contracts";
import { useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";
import { resolveHttpBase } from "@/lib/api-base";

const HealthApiResponseSchema = createApiSuccessResponseSchema(HealthReportSchema);

const GRADE_COLOR: Record<HealthReport["grade"], string> = {
  优: "#38d889",
  良: "#48c7ff",
  注意: "#ffb03a",
  异常: "#ff5c5c",
};

const STATUS_COLOR: Record<HealthCheckItem["status"], string> = {
  ok: "#38d889",
  attention: "#ffb03a",
  bad: "#ff5c5c",
  skipped: "rgba(245,247,251,0.35)",
};

const pad = (n: number) => String(n).padStart(2, "0");
const fmtClock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

type DetailTab = "faults" | "suspect" | "symmetry" | "sensors";

export default function HealthPage() {
  const shellState = useAppShellState();
  const [report, setReport] = useState<HealthReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>("faults");

  const scan = async () => {
    try {
      setScanning(true);
      const response = await fetch(`${resolveHttpBase()}/api/health-check`, { cache: "no-store" });
      const parsed = HealthApiResponseSchema.parse(await response.json());
      setReport(parsed.data);
      setOpenItem(null);
      setTab(parsed.data.activeFaults.length > 0 ? "faults" : "suspect");
      setErrorMessage(null);
    } catch {
      setErrorMessage("体检失败，请确认服务已启动。");
    } finally {
      setScanning(false);
    }
  };

  const equipped = report ? report.sensors.total - report.sensors.notInstalled : 0;
  // 数据滞后时后端会跳过传感器项，覆盖面数字这时没有意义，别摆出来误导人
  const sensorsSkipped =
    report?.items.find((item) => item.key === "sensors")?.status === "skipped";

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
            {/* ===== 分数 + 覆盖面 ===== */}
            <div className="hc-header">
              <div
                className="hc-ring"
                style={{
                  background: `conic-gradient(${GRADE_COLOR[report.grade]} ${report.score * 3.6}deg, rgba(255,255,255,0.07) 0deg)`,
                }}
              >
                <div className="hc-ring-inner">
                  <strong style={{ color: GRADE_COLOR[report.grade] }}>{report.score}</strong>
                  <span style={{ color: GRADE_COLOR[report.grade] }}>{report.grade}</span>
                </div>
              </div>

              <div className="hc-header-main">
                <div className="hc-header-line">
                  <span className="hc-clock">{fmtClock(report.scannedAt)}</span>
                  <button
                    className="hc-rescan"
                    disabled={scanning}
                    onClick={() => void scan()}
                    type="button"
                  >
                    {scanning ? "扫描中…" : "重新体检"}
                  </button>
                </div>
                <div className="hc-coverage">
                  {sensorsSkipped ? (
                    <>数据已滞后，本次没统计测点覆盖面</>
                  ) : (
                    <>
                      本次覆盖 <b>{report.sensors.valid}</b> / {equipped} 个已配备测点
                      {report.sensors.notInstalled > 0 ? (
                        <>
                          ，另有 <b>{report.sensors.notInstalled}</b> 个未配备或未接线
                        </>
                      ) : null}
                    </>
                  )}
                  {report.suspectFaults.length > 0 ? (
                    <>
                      ；<b>{report.suspectFaults.length}</b> 条常驻报警来自未接测点与配置提示，已单列不计分
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            {/* ===== 分项得分：点开看扣分理由 ===== */}
            <div className="hc-items">
              {report.items.map((item) => {
                const open = openItem === item.key;
                const full = item.score >= item.maxScore;
                return (
                  <button
                    className={`hc-item${open ? " open" : ""}${full ? "" : " lost"}`}
                    key={item.key}
                    onClick={() => setOpenItem(open ? null : item.key)}
                    type="button"
                  >
                    <span className="hc-item-top">
                      <span className="hc-item-name">{item.name}</span>
                      <span className="hc-item-score" style={{ color: STATUS_COLOR[item.status] }}>
                        {item.status === "skipped" ? "跳过" : item.score}
                        {item.status === "skipped" ? null : <i>/{item.maxScore}</i>}
                      </span>
                    </span>
                    <span className="hc-item-summary">{item.summary}</span>
                    <span className="hc-item-bar">
                      <span
                        className="hc-item-bar-fill"
                        style={{
                          width: `${(item.score / item.maxScore) * 100}%`,
                          background: STATUS_COLOR[item.status],
                        }}
                      />
                    </span>
                    {open && item.details.length > 0 ? (
                      <span className="hc-item-details">
                        {item.details.map((line, index) => (
                          <span className="hc-item-detail" key={index}>
                            {line}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {/* ===== 明细分页 ===== */}
            <div className="hc-tabs">
              {(
                [
                  ["faults", `需要处理 ${report.activeFaults.length}`],
                  ["suspect", `常驻报警 ${report.suspectFaults.length}`],
                  ["symmetry", "牵引对称性"],
                  ["sensors", "模块与测点"],
                ] as Array<[DetailTab, string]>
              ).map(([key, label]) => (
                <button
                  className={`hc-tab${tab === key ? " active" : ""}`}
                  key={key}
                  onClick={() => setTab(key)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="hc-detail-panel">
              {tab === "faults" ? (
                report.activeFaults.length === 0 ? (
                  <div className="empty">没有需要处理的故障。</div>
                ) : (
                  <div className="list">
                    {report.activeFaults.map((fault, index) => (
                      <div className="rank-item" key={index}>
                        <div className="rank-left">
                          <div className="rank-top">
                            <span
                              className={`lf-tag ${fault.type === 2 ? "lf-tag-stop" : "lf-tag-warn"}`}
                            >
                              {fault.type === 2 ? "停机" : "警告"}
                            </span>
                            <div className="rank-name">{fault.name}</div>
                          </div>
                        </div>
                        <div className="meta-line">{fmtClock(fault.occurTs)}</div>
                      </div>
                    ))}
                  </div>
                )
              ) : null}

              {tab === "suspect" ? (
                report.suspectFaults.length === 0 ? (
                  <div className="empty">没有存疑报警。</div>
                ) : (
                  <div className="list">
                    {report.suspectFaults.map((fault, index) => (
                      <div className="rank-item" key={index}>
                        <div className="rank-left">
                          <div className="rank-top">
                            <span className="lf-tag lf-tag-internal">不计分</span>
                            <div className="rank-name">{fault.name}</div>
                          </div>
                          <div className="meta-line">{fault.reason}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : null}

              {tab === "symmetry" ? (
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
                    {report.symmetry.map((row) => (
                      <tr key={row.item}>
                        <td>{row.item}</td>
                        <td>{row.judge === "invalid" ? "--" : `${row.left}${row.unit}`}</td>
                        <td>{row.judge === "invalid" ? "--" : `${row.right}${row.unit}`}</td>
                        <td>{row.diffText}</td>
                        <td>
                          {row.judge === "invalid" ? (
                            <span className="badge info">测点未接</span>
                          ) : row.judge === "attention" ? (
                            <span className="badge warn">关注</span>
                          ) : (
                            <span className="badge success">正常</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}

              {tab === "sensors" ? (
                <>
                  <div className="hc-modules">
                    {report.modules.map((module) => (
                      <span className={`hc-module${module.ok ? " ok" : ""}`} key={module.name}>
                        <span className="status-dot" />
                        {module.name}
                      </span>
                    ))}
                  </div>
                  <div className="list hc-sensor-list">
                    {report.sensors.invalid.length === 0 ? (
                      <div className="empty">已配备测点读数全部有效。</div>
                    ) : (
                      report.sensors.invalid.map((sensor, index) => (
                        <div className="rank-item" key={index}>
                          <div className="rank-left">
                            <div className="rank-top">
                              <span className="lf-tag lf-tag-stop">读数异常</span>
                              <div className="rank-name">{sensor.name}</div>
                            </div>
                          </div>
                          <div className="meta-line">{sensor.state}</div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}
