"use client";

import {
  SettingsSnapshotSchema,
  createApiSuccessResponseSchema,
  type DeviceStatus,
  type SettingsSnapshot,
} from "@shearer/contracts";
import { useEffect, useMemo, useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";
import { useTheme, type ThemeName } from "@/lib/theme";
import { resolveHttpBase } from "@/lib/api-base";

const SettingsSnapshotApiResponseSchema = createApiSuccessResponseSchema(SettingsSnapshotSchema);

// 模块通讯位：现场只关心"在线/掉线"，不需要中间态
const MODULE_LABEL: Record<DeviceStatus, string> = {
  ok: "在线",
  warn: "预警",
  error: "掉线",
  offline: "无数据",
};

const pad = (n: number) => String(n).padStart(2, "0");
const fmtClock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtDuration = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分`;
  return `${total} 秒`;
};
const fmtRows = (n: number) =>
  n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : n.toLocaleString("zh-CN");

// 井下看屏幕靠暗色省眼；地面汇报、打印截图更适合白底
const THEMES: Array<{ key: ThemeName; label: string; desc: string }> = [
  { key: "dark", label: "暗色", desc: "井下作业" },
  { key: "light", label: "亮色", desc: "地面汇报" },
];

export default function SettingsPage() {
  const shellState = useAppShellState();
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<SettingsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${resolveHttpBase()}/api/settings`, { cache: "no-store" });
      const parsed = SettingsSnapshotApiResponseSchema.parse(await response.json());
      setSettings(parsed.data);
      setRefreshedAt(Date.now());
      setErrorMessage(null);
    } catch {
      setErrorMessage("系统设置加载失败，请先启动 IPC 服务。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const modules = useMemo(() => {
    if (!settings) {
      return [];
    }
    const c = settings.connection;
    return [
      { name: "HPC", status: c.hpc },
      { name: "MOC", status: c.moc },
      { name: "BOC", status: c.boc },
      { name: "AXI", status: c.axi },
      { name: "WCR", status: c.wcr },
      { name: "SGC", status: c.sgc },
      { name: "BP1", status: c.bp1 },
      { name: "BP2", status: c.bp2 },
    ];
  }, [settings]);

  const dataSource = settings?.dataSource;
  const onlineCount = modules.filter((m) => m.status === "ok").length;

  return (
    <AppShell shellState={shellState} title="系统设置">
      <section className="page active">
        {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

        {loading && !settings ? (
          <div className="empty">正在读取工控机状态…</div>
        ) : (
          <>
            {/* ===== 顶部：连接总览 ===== */}
            <div className="st-header">
              <div className={`st-link${settings?.connected ? " on" : ""}`}>
                <span className="st-link-dot" />
                <span className="st-link-text">
                  {settings?.connected ? "已连接采煤机" : "未连接采煤机"}
                </span>
              </div>
              <div className="st-modules">
                {modules.map((module) => (
                  <span
                    className={`st-module${module.status === "ok" ? " ok" : ""}`}
                    key={module.name}
                  >
                    <b>{module.name}</b>
                    {MODULE_LABEL[module.status]}
                  </span>
                ))}
              </div>
              <div className="st-header-side">
                <span className="st-refreshed">
                  {refreshedAt === null ? "—" : fmtClock(refreshedAt)}
                </span>
                <button
                  className="st-refresh"
                  disabled={loading}
                  onClick={() => void loadSettings()}
                  type="button"
                >
                  {loading ? "读取中…" : "刷新"}
                </button>
              </div>
            </div>

            <div className="st-grid">
              {/* ===== 界面风格 ===== */}
              <div className="st-card st-card-wide">
                <div className="st-card-head">
                  <h3>界面风格</h3>
                  <span className="st-chip">{theme === "light" ? "亮色" : "暗色"}</span>
                </div>
                <div className="st-themes">
                  {THEMES.map((item) => (
                    <button
                      className={`st-theme${theme === item.key ? " active" : ""}`}
                      key={item.key}
                      onClick={() => setTheme(item.key)}
                      type="button"
                    >
                      <span className={`st-theme-preview ${item.key}`}>
                        <span className="st-theme-bar" />
                        <span className="st-theme-block" />
                        <span className="st-theme-block short" />
                      </span>
                      <span className="st-theme-name">{item.label}</span>
                      <span className="st-theme-desc">{item.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* ===== 数据源 ===== */}
              <div className="st-card st-card-wide">
                <div className="st-card-head">
                  <h3>数据源</h3>
                  <span className={`st-chip${dataSource?.collecting ? " ok" : " warn"}`}>
                    {dataSource?.collecting ? "采集进行中" : "采集已停"}
                  </span>
                </div>

                {dataSource ? (
                  <>
                    <div className="st-stats">
                      <div className="st-stat">
                        <b>{dataSource.dbSizeMb ?? "—"}</b>
                        <span>数据库 MB</span>
                      </div>
                      <div className="st-stat">
                        <b>
                          {dataSource.fromMs !== null && dataSource.toMs !== null
                            ? fmtDuration(dataSource.toMs - dataSource.fromMs)
                            : "—"}
                        </b>
                        <span>覆盖时长</span>
                      </div>
                      <div className="st-stat">
                        <b>{dataSource.lagMs === null ? "—" : fmtDuration(dataSource.lagMs)}</b>
                        <span>数据滞后</span>
                      </div>
                      {dataSource.tables.map((table) => (
                        <div className="st-stat" key={table.name}>
                          <b>{fmtRows(table.rows)}</b>
                          <span>{table.name}</span>
                        </div>
                      ))}
                    </div>

                    <div className="st-rows">
                      <div className="st-row">
                        <span>数据时间窗</span>
                        <b>
                          {dataSource.fromMs !== null && dataSource.toMs !== null
                            ? `${fmtClock(dataSource.fromMs)} ~ ${fmtClock(dataSource.toMs)}`
                            : "库内暂无数据"}
                        </b>
                      </div>
                      <div className="st-row">
                        <span>数据库位置</span>
                        <b className="st-path">{dataSource.dbPath}</b>
                      </div>
                      <div className="st-row">
                        <span>诊断树</span>
                        <b>
                          {dataSource.trees.length === 0
                            ? "未安装"
                            : dataSource.trees
                                .map((tree) => `${tree.name} ${tree.nodes} 节点`)
                                .join(" · ")}
                        </b>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="empty">数据面未接入，当前使用兜底数据。</div>
                )}
              </div>

              {/* ===== 机型 ===== */}
              <div className="st-card">
                <div className="st-card-head">
                  <h3>采煤机机型</h3>
                </div>
                <div className="st-rows">
                  {settings?.machineFields.map((field) => (
                    <div className="st-row" key={field.label}>
                      <span>{field.label}</span>
                      <b>{field.value}</b>
                    </div>
                  ))}
                </div>
              </div>

              {/* ===== 工作面 ===== */}
              <div className="st-card">
                <div className="st-card-head">
                  <h3>工作面</h3>
                </div>
                <div className="st-rows">
                  {settings?.workFaceFields.map((field) => (
                    <div className="st-row" key={field.label}>
                      <span>{field.label}</span>
                      <b>{field.value}</b>
                    </div>
                  ))}
                </div>
              </div>

              {/* ===== 工控机运行环境 ===== */}
              <div className="st-card st-card-wide">
                <div className="st-card-head">
                  <h3>工控机</h3>
                  <span className="st-chip">
                    {onlineCount}/{modules.length} 模块在线
                  </span>
                </div>
                <div className="st-rows st-rows-2col">
                  {(settings?.runtimeInfo ?? settings?.networkInfoData ?? []).map((field) => (
                    <div className="st-row" key={field.label}>
                      <span>{field.label}</span>
                      <b className={field.label.includes("地址") ? "st-path" : undefined}>
                        {field.value}
                      </b>
                    </div>
                  ))}
                </div>
              </div>

              {/* ===== 版本记录 ===== */}
              <div className="st-card st-card-wide">
                <div className="st-card-head">
                  <h3>版本记录</h3>
                </div>
                <div className="st-versions">
                  {settings?.versionHistoryData.map((item) => (
                    <div className="st-version" key={`${item.date}-${item.desc}`}>
                      <span className="st-version-tag">{item.date}</span>
                      <span className="st-version-desc">{item.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}
