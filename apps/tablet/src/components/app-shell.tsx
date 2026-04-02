"use client";

import {
  BootstrapResponseSchema,
  LiveMessageSchema,
  type AuthUser,
  createApiSuccessResponseSchema,
  type BootstrapResponse,
  type ConnectionStatus,
} from "@shearer/contracts";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  clearStoredAuthSession,
  fetchAuthMe,
  getSafeNextPath,
  getStoredAccessToken,
  logoutCurrentSession,
} from "@/lib/auth";

const BootstrapApiResponseSchema = createApiSuccessResponseSchema(BootstrapResponseSchema);

const fallbackConnection: ConnectionStatus = {
  tabletToIpc: "disconnected",
  hpc: "offline",
  moc: "offline",
  boc: "offline",
  syncAt: "",
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

export type AppShellState = {
  bootstrap: BootstrapResponse | null;
  connection: ConnectionStatus;
  now: Date | null;
};

export const formatStatusText = (status: string) => {
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

export const formatDate = (value: Date | string | null, withWeekday = false) => {
  if (!value) {
    return "--";
  }

  const date = typeof value === "string" ? new Date(value) : value;

  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: withWeekday ? "long" : undefined,
  });
};

export const formatTime = (value: Date | string | null) => {
  if (!value) {
    return "--:--:--";
  }

  const date = typeof value === "string" ? new Date(value) : value;

  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }

  return date.toLocaleTimeString("zh-CN", {
    hour12: false,
  });
};

export const useAppShellState = (): AppShellState => {
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>(fallbackConnection);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());

    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

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
      } catch {
        if (!cancelled) {
          setBootstrap(null);
          setConnection(fallbackConnection);
        }
      }
    };

    void loadBootstrap();

    const ws = new WebSocket(resolveWsUrl());

    ws.onmessage = (event) => {
      try {
        const parsed = LiveMessageSchema.parse(JSON.parse(event.data));
        setConnection(parsed.data);
      } catch {
        setConnection(fallbackConnection);
      }
    };

    ws.onerror = () => {
      setConnection((current) =>
        current.tabletToIpc === "connected" ? current : fallbackConnection,
      );
    };

    return () => {
      cancelled = true;
      controller.abort();
      ws.close();
    };
  }, []);

  return {
    bootstrap,
    connection,
    now,
  };
};

type AppShellProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  shellState: AppShellState;
  disableHomeButton?: boolean;
  tagText?: string;
  tagTone?: "blue" | "green" | "orange" | "red";
};

export function AppShell({
  title,
  subtitle,
  children,
  shellState,
  disableHomeButton = false,
  tagText,
  tagTone = "blue",
}: AppShellProps) {
  const { connection, now } = shellState;
  const pathname = usePathname();
  const router = useRouter();
  const [authStatus, setAuthStatus] = useState<"checking" | "authenticated" | "redirecting">(
    "checking",
  );
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const statusChips = useMemo(
    () => [
      {
        label: "平板↔工控机",
        value: formatStatusText(connection.tabletToIpc),
        tone: connection.tabletToIpc === "connected" ? "success" : "offline",
      },
      {
        label: "HPC",
        value: formatStatusText(connection.hpc),
        tone: connection.hpc === "ok" ? "success" : connection.hpc,
      },
      {
        label: "MOC",
        value: formatStatusText(connection.moc),
        tone: connection.moc === "ok" ? "success" : connection.moc,
      },
      {
        label: "BOC",
        value: formatStatusText(connection.boc),
        tone: connection.boc === "ok" ? "success" : connection.boc,
      },
    ],
    [connection],
  );

  useEffect(() => {
    let cancelled = false;
    const nextPath = getSafeNextPath(pathname);
    const accessToken = getStoredAccessToken();

    if (!accessToken) {
      clearStoredAuthSession();
      setAuthStatus("redirecting");
      router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
      return () => {
        cancelled = true;
      };
    }

    const verifySession = async () => {
      try {
        const session = await fetchAuthMe(accessToken);

        if (cancelled) {
          return;
        }

        setCurrentUser(session.user);
        setAuthStatus("authenticated");
      } catch {
        if (cancelled) {
          return;
        }

        clearStoredAuthSession();
        setCurrentUser(null);
        setAuthStatus("redirecting");
        router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
      }
    };

    void verifySession();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  const handleLogout = async () => {
    setLoggingOut(true);
    await logoutCurrentSession(getStoredAccessToken());
    setCurrentUser(null);
    setAuthStatus("redirecting");
    router.replace("/login");
  };

  if (authStatus !== "authenticated") {
    return (
      <main className="app-shell">
        <section className="workspace auth-check-shell">
          <div className="content">
            <div className="content-inner">
              <div className="empty">
                {loggingOut ? "正在退出登录..." : "正在验证登录状态并跳转..."}
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="toolbar">
          <div className="toolbar-inner">
            <div className="toolbar-left">
              {disableHomeButton ? (
                <span aria-current="page" className="home-btn is-current">
                  主页面
                </span>
              ) : (
                <Link className="home-btn" href="/">
                  返回主页面
                </Link>
              )}
              <div className="page-heading">
                <div className="page-title-row">
                  <h1 className="page-title">{title}</h1>
                  {tagText ? <span className={`pill ${tagTone}`}>{tagText}</span> : null}
                </div>
                <p className="page-subtitle">{subtitle}</p>
              </div>
            </div>
            <div className="toolbar-right">
              <div className="toolbar-session">
                {currentUser ? (
                  <div className="status-chip user">
                    <span className="status-dot" />
                    <span>{currentUser.employeeNo} · {currentUser.displayName}</span>
                  </div>
                ) : null}
                <button
                  className="toolbar-ghost"
                  disabled={loggingOut}
                  onClick={() => void handleLogout()}
                  type="button"
                >
                  {loggingOut ? "退出中..." : "退出登录"}
                </button>
              </div>
              <div className="status-cluster">
                {statusChips.map((chip) => (
                  <div className={`status-chip ${chip.tone}`} key={chip.label}>
                    <span className="status-dot" />
                    <span>
                      {chip.label} {chip.value}
                    </span>
                  </div>
                ))}
              </div>
              <div className="clock-box">
                <div className="clock-time">{formatTime(now)}</div>
                <div className="clock-date">{formatDate(now, true)}</div>
              </div>
            </div>
          </div>
        </header>

        <div className="content">
          <div className="content-inner">{children}</div>
        </div>
      </section>
    </main>
  );
}
