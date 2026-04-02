"use client";

import {
  BootstrapResponseSchema,
  createApiSuccessResponseSchema,
  type BootstrapResponse,
  type ConnectionStatus,
} from "@shearer/contracts";
import { useEffect, useMemo, useState } from "react";

const BootstrapApiResponseSchema = createApiSuccessResponseSchema(BootstrapResponseSchema);

const emptyStatus: ConnectionStatus = {
  tabletToIpc: "disconnected",
  hpc: "offline",
  moc: "offline",
  boc: "offline",
  syncAt: new Date(0).toISOString(),
};

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

const resolveWsUrl = () => {
  if (typeof window === "undefined") {
    return "";
  }

  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }

  const { hostname, port, protocol } = window.location;
  const wsProtocol = protocol === "https:" ? "wss:" : "ws:";

  if ((hostname === "localhost" || hostname === "127.0.0.1") && port === "3000") {
    return `${wsProtocol}//${hostname}:18080/ws/live`;
  }

  return `${wsProtocol}//${window.location.host}/ws/live`;
};

const formatConnectionText = (status: string) => {
  switch (status) {
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
      return "离线";
    default:
      return status;
  }
};

export default function HomePage() {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>(emptyStatus);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadBootstrap = async () => {
      try {
        const response = await fetch(`${resolveHttpBase()}/api/bootstrap`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const json = await response.json();
        const parsed = BootstrapApiResponseSchema.parse(json);

        if (cancelled) {
          return;
        }

        setBootstrap(parsed.data);
        setConnection(parsed.data.connection);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage("当前未获取到 IPC bootstrap mock 数据。");
        }
      }
    };

    void loadBootstrap();

    const ws = new WebSocket(resolveWsUrl());

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as { type?: string; data?: ConnectionStatus };

        if (parsed.type === "connection_status" && parsed.data) {
          setConnection(parsed.data);
        }
      } catch {
        setErrorMessage("实时状态消息解析失败。");
      }
    };

    ws.onerror = () => {
      setErrorMessage("当前未连接到 /ws/live mock 通道。");
    };

    return () => {
      cancelled = true;
      controller.abort();
      ws.close();
    };
  }, []);

  const machineMeta = useMemo(
    () => [
      { label: "机型", value: bootstrap?.machineModel ?? "MG500/1180-WD" },
      { label: "设备名称", value: bootstrap?.machineName ?? "西翼 2305 工作面采煤机" },
      { label: "前端形态", value: "Next.js App Router + static export" },
      { label: "后端形态", value: "Fastify + WebSocket mock 服务" },
    ],
    [bootstrap],
  );

  const connectionCards = useMemo(
    () => [
      { label: "平板↔工控机", value: connection.tabletToIpc, className: connection.tabletToIpc },
      { label: "HPC", value: connection.hpc, className: connection.hpc },
      { label: "MOC", value: connection.moc, className: connection.moc },
      { label: "BOC", value: connection.boc, className: connection.boc },
    ],
    [connection],
  );

  return (
    <main className="shell">
      <section className="panel">
        <div className="hero">
          <div className="hero-copy">
            <span className="eyebrow">MVP 工程骨架</span>
            <h1 className="title">采煤机故障诊断点检仪平板端</h1>
            <p className="subtitle">
              当前页面只承载第一版骨架验证：样式 token 已沿用设计稿，数据全部来自 IPC mock
              服务，未接入真实采集链路，也没有在 Next API Routes 中承载业务后端。
            </p>
            <div className="hint-list">
              <div className="hint">已预留 `packages/contracts` 作为前后端返回结构唯一来源。</div>
              <div className="hint">静态导出模式下，bootstrap 与实时状态都在客户端拉取。</div>
              <div className="hint">
                启动 IPC 服务后，可通过 <span className="code">/api/bootstrap</span> 和{" "}
                <span className="code">/ws/live</span> 验证联通性。
              </div>
            </div>
          </div>
          <div className="card">
            <h2>设备概览</h2>
            <div className="meta" style={{ marginTop: 16 }}>
              {machineMeta.map((item) => (
                <div className="meta-row" key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="grid">
          <section className="card">
            <h3>连接状态</h3>
            <div className="status-list" style={{ marginTop: 16 }}>
              {connectionCards.map((item) => (
                <div className="status-chip" key={item.label}>
                  <span className="status-label">{item.label}</span>
                  <span className={`status-value status-${item.className}`}>
                    {formatConnectionText(item.value)}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section className="card">
            <h3>当前阶段说明</h3>
            <div className="hint-list" style={{ marginTop: 16 }}>
              <div className="hint">已完成 monorepo、contracts、Next 平板端和 Fastify mock 服务骨架。</div>
              <div className="hint">下一步适合继续拆首页、传感器页和状态顶栏组件。</div>
              <div className="hint">
                最近同步时间：
                <span className="code" style={{ marginLeft: 8 }}>
                  {new Date(connection.syncAt).toLocaleString("zh-CN")}
                </span>
              </div>
              {errorMessage ? <div className="hint">{errorMessage}</div> : null}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
