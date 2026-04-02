"use client";

import {
  SettingsSnapshotSchema,
  createApiSuccessResponseSchema,
  type ConnectionStatus,
  type SettingsSnapshot,
} from "@shearer/contracts";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const SettingsSnapshotApiResponseSchema = createApiSuccessResponseSchema(SettingsSnapshotSchema);

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

const formatConnectionValue = (
  value: ConnectionStatus["tabletToIpc"] | ConnectionStatus["hpc"],
  fallbackDisconnected = "断开",
) => {
  switch (value) {
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
      return fallbackDisconnected;
    default:
      return String(value);
  }
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadSettings = async () => {
    try {
      setLoading(true);

      const response = await fetch(`${resolveHttpBase()}/api/settings`, {
        cache: "no-store",
      });
      const json = await response.json();
      const parsed = SettingsSnapshotApiResponseSchema.parse(json);

      setSettings(parsed.data);
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

  const connectionCards = useMemo(() => {
    if (!settings) {
      return [];
    }

    return [
      ["平板与工控机", settings.connected ? "已连接" : "未连接"],
      [
        "HPC 通讯",
        settings.connected ? formatConnectionValue(settings.connection.hpc) : "断开",
      ],
      [
        "MOC 通讯",
        settings.connected ? formatConnectionValue(settings.connection.moc) : "断开",
      ],
      [
        "BOC 通讯",
        settings.connected ? formatConnectionValue(settings.connection.boc) : "断开",
      ],
    ];
  }, [settings]);

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="toolbar">
          <div className="toolbar-left">
            <Link className="home-btn" href="/">
              主菜单
            </Link>
            <div className="page-heading">
              <h1 className="page-title">系统设置</h1>
              <p className="page-subtitle">连接、机型、网络、版本与工作面信息统一查看</p>
            </div>
          </div>
          <div className="toolbar-right">
            <span className="pill blue">设置概览</span>
          </div>
        </header>

        <div className="content">
          {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

          <section className="page active">
            <div className="setting-grid">
              <div className="stack">
                <div className="panel">
                  <div className="panel-head">
                    <div>
                      <h3 className="panel-title">
                        <span className="accent-bar" />
                        连接状态
                      </h3>
                      <p className="panel-subtitle">
                        建立联系时显示“已连接采煤机”，否则显示“未连接”。
                      </p>
                    </div>
                    <span className={`pill ${settings?.connected ? "green" : "red"}`}>
                      {settings?.connected ? "已连接采煤机" : "未连接采煤机"}
                    </span>
                  </div>
                  <div className="panel-body">
                    {loading && !settings ? (
                      <div className="empty">正在加载连接状态...</div>
                    ) : (
                      <>
                        <div className="kpi-row">
                          {connectionCards.map(([label, value]) => (
                            <div className="kpi" key={label}>
                              <div className="kpi-name">{label}</div>
                              <div className="kpi-value settings-kpi-value">{value}</div>
                            </div>
                          ))}
                        </div>
                        <div className="action-row">
                          <button className="button primary" onClick={() => void loadSettings()} type="button">
                            刷新连接状态
                          </button>
                          <button className="button ghost" onClick={() => void loadSettings()} type="button">
                            刷新网络信息
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="panel">
                  <div className="panel-head">
                    <div>
                      <h3 className="panel-title">
                        <span className="accent-bar" />
                        工作面信息
                      </h3>
                      <p className="panel-subtitle">用于绑定现场工况与机型配置。</p>
                    </div>
                  </div>
                  <div className="panel-body">
                    <div className="field-grid">
                      {settings?.workFaceFields.map((field) => (
                        <div className="field" key={field.label}>
                          <label>{field.label}</label>
                          <input className="text-input" readOnly value={field.value} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="panel">
                  <div className="panel-head">
                    <div>
                      <h3 className="panel-title">
                        <span className="accent-bar" />
                        采煤机机型信息
                      </h3>
                      <p className="panel-subtitle">机型参数可作为分析页标题和知识库索引。</p>
                    </div>
                  </div>
                  <div className="panel-body">
                    <div className="field-grid">
                      {settings?.machineFields.map((field) => (
                        <div className="field" key={field.label}>
                          <label>{field.label}</label>
                          <input className="text-input" readOnly value={field.value} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="stack">
                <div className="panel">
                  <div className="panel-head">
                    <div>
                      <h3 className="panel-title">
                        <span className="accent-bar" />
                        软件版本与更新记录
                      </h3>
                      <p className="panel-subtitle">支持展示当前版本与更新说明。</p>
                    </div>
                  </div>
                  <div className="panel-body">
                    <div className="history-list">
                      {settings?.versionHistoryData.map((item) => (
                        <div className="history-item" key={`${item.date}-${item.desc}`}>
                          <div>
                            <div className="asset-title">{item.date}</div>
                            <div className="asset-meta">{item.desc}</div>
                          </div>
                          <span className="badge info">记录</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="panel">
                  <div className="panel-head">
                    <div>
                      <h3 className="panel-title">
                        <span className="accent-bar" />
                        网络与工控机信息
                      </h3>
                      <p className="panel-subtitle">工控机主机名、IP、链路、系统版本等。</p>
                    </div>
                  </div>
                  <div className="panel-body">
                    <div className="network-grid">
                      {settings?.networkInfoData.map((item) => (
                        <div className="network-item" key={item.label}>
                          <strong>{item.label}</strong>
                          <span>{item.value}</span>
                        </div>
                      ))}
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
