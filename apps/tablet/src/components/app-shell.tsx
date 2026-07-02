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
  axi: "offline",
  wcr: "offline",
  sgc: "offline",
  bp1: "offline",
  bp2: "offline",
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
  subtitle?: string;
  children: ReactNode;
  shellState: AppShellState;
  disableHomeButton?: boolean;
  tagText?: string;
  tagTone?: "blue" | "green" | "orange" | "red";
  /** 精简顶栏（主页面用）：只保留退出登录 + HPC/MOC/BOC 状态灯 */
  minimalHeader?: boolean;
};

export function AppShell({
  children,
  shellState,
  minimalHeader = false,
}: AppShellProps) {
  const { connection } = shellState;
  const pathname = usePathname();
  const router = useRouter();
  const [authStatus, setAuthStatus] = useState<"checking" | "authenticated" | "redirecting">(
    "checking",
  );
  const [, setCurrentUser] = useState<AuthUser | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const statusChips = useMemo(() => {
    const device = (label: string, value: ConnectionStatus["hpc"]) => ({
      label,
      value: formatStatusText(value),
      tone: value === "ok" ? "success" : value,
    });
    const link = {
      label: "平板↔工控机",
      value: formatStatusText(connection.tabletToIpc),
      tone: connection.tabletToIpc === "connected" ? "success" : "offline",
    };
    // 精简顶栏（主页面）：8 个模块通讯状态；普通页面：链路 + 三大主控
    if (minimalHeader) {
      return [
        device("HPC", connection.hpc),
        device("MOC", connection.moc),
        device("BOC", connection.boc),
        device("AXI", connection.axi),
        device("WCR", connection.wcr),
        device("SGC", connection.sgc),
        device("BP1", connection.bp1),
        device("BP2", connection.bp2),
      ];
    }
    return [link, device("HPC", connection.hpc), device("MOC", connection.moc), device("BOC", connection.boc)];
  }, [connection, minimalHeader]);

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

    // 乐观放行：本地有 token 先直接渲染页面，后台异步校验，
    // 失败才跳登录——避免每次导航都被"正在验证登录状态"卡一拍。
    setAuthStatus("authenticated");
    try {
      const cachedUser = window.sessionStorage.getItem("shearer.auth.user");
      if (cachedUser) {
        setCurrentUser(JSON.parse(cachedUser) as AuthUser);
      }
    } catch {
      // sessionStorage 不可用时忽略，仅影响用户名展示
    }

    const verifySession = async () => {
      try {
        const session = await fetchAuthMe(accessToken);

        if (cancelled) {
          return;
        }

        setCurrentUser(session.user);
        try {
          window.sessionStorage.setItem("shearer.auth.user", JSON.stringify(session.user));
        } catch {
          // 忽略存储失败
        }
      } catch {
        if (cancelled) {
          return;
        }

        clearStoredAuthSession();
        try {
          window.sessionStorage.removeItem("shearer.auth.user");
        } catch {
          // 忽略
        }
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
        {minimalHeader ? (
          <header className="toolbar">
            <div className="toolbar-inner">
              <div className="toolbar-left">
                <span className="toolbar-brand">上海天地</span>
              </div>
              <div className="toolbar-right">
                <div className="toolbar-session">
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
                      <span>{chip.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </header>
        ) : (
          // 子页面：顶栏不放任何东西，只有一个自动隐身的悬浮返回按钮
          <FloatingHomeLink />
        )}

        <div className="content">
          <div className="content-inner">{children}</div>
        </div>
      </section>
    </main>
  );
}

/**
 * 悬浮「返回主页面」按钮：3 秒无操作自动淡出成幽灵态（仍可点击），
 * 任何触摸/滚动/按键立即恢复完全可见。
 */
function FloatingHomeLink() {
  const [dimmed, setDimmed] = useState(false);

  useEffect(() => {
    let timer = 0;

    const wake = () => {
      setDimmed(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setDimmed(true), 3000);
    };

    wake();
    const events = ["pointerdown", "touchstart", "scroll", "keydown", "wheel"] as const;
    events.forEach((name) =>
      window.addEventListener(name, wake, { passive: true, capture: true }),
    );

    return () => {
      window.clearTimeout(timer);
      events.forEach((name) =>
        window.removeEventListener(name, wake, { capture: true }),
      );
    };
  }, []);

  return (
    <Link className={`float-home${dimmed ? " dimmed" : ""}`} href="/">
      ‹ 主页面
    </Link>
  );
}
