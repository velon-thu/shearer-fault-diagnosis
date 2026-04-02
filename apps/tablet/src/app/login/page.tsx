"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  clearStoredAuthSession,
  fetchAuthMe,
  getSafeNextPath,
  getStoredAccessToken,
  loginWithPassword,
  mockLoginHint,
} from "@/lib/auth";

const loginMetrics = [
  {
    label: "认证方式",
    value: "工控机统一认证",
  },
  {
    label: "会话策略",
    value: "短期 token 会话",
  },
  {
    label: "应用范围",
    value: "诊断 · 点检 · 查询",
  },
  {
    label: "终端形态",
    value: "局域网全屏浏览器",
  },
] as const;

export default function LoginPage() {
  const router = useRouter();
  const [nextPath, setNextPath] = useState("/");
  const [employeeNo, setEmployeeNo] = useState("");
  const [password, setPassword] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const queryNext = getSafeNextPath(new URLSearchParams(window.location.search).get("next"));
    setNextPath(queryNext);

    let cancelled = false;
    const accessToken = getStoredAccessToken();

    if (!accessToken) {
      setCheckingSession(false);
      return () => {
        cancelled = true;
      };
    }

    const verifySession = async () => {
      try {
        await fetchAuthMe(accessToken);

        if (!cancelled) {
          router.replace(queryNext);
        }
      } catch {
        clearStoredAuthSession();

        if (!cancelled) {
          setCheckingSession(false);
        }
      }
    };

    void verifySession();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleFillDemo = () => {
    setEmployeeNo(mockLoginHint.employeeNo);
    setPassword(mockLoginHint.password);
    setErrorMessage("");
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedEmployeeNo = employeeNo.trim();

    if (!trimmedEmployeeNo || !password) {
      return;
    }

    setSubmitting(true);
    setErrorMessage("");

    try {
      await loginWithPassword({
        employeeNo: trimmedEmployeeNo,
        password,
      });
      router.replace(nextPath);
    } catch (error) {
      const message =
        error instanceof Error && error.message === "AUTH_INVALID_CREDENTIALS"
          ? "工号或密码错误，请核对 mock 账号后重试。"
          : "登录服务暂不可用，请确认 IPC 服务已经启动。";

      setErrorMessage(message);
      setSubmitting(false);
    }
  };

  const loginStateText = checkingSession ? "正在校验" : submitting ? "登录中" : "待登录";
  const submitDisabled = checkingSession || submitting || !employeeNo.trim() || !password;

  return (
    <main className="login-shell">
      <div className="login-stage">
        <section className="login-visual">
          <div>
            <div className="login-logo">CM</div>
            <div className="login-kicker">Industrial Browser HMI</div>
            <h1>采煤机故障诊断点检仪</h1>
            <p className="login-visual-text">
              平板端通过工控机后端统一认证进入主控界面，用于故障诊断、传感器点检、故障代码查询、检修打卡与知识资料访问。
            </p>
            <div className="login-chip-row">
              <span className="pill blue">工控机统一认证</span>
              <span className="pill">平板仅保存短期 token</span>
              <span className="pill">不保存明文密码</span>
            </div>
          </div>

          <div className="login-metric-grid">
            {loginMetrics.map((item) => (
              <div className="login-metric" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </section>

        <form autoComplete="on" className="login-card" onSubmit={(event) => void handleSubmit(event)}>
          <div className="login-head">
            <div>
              <div className="login-label">账号登录</div>
              <h2>进入主页面</h2>
              <p>输入工号和密码，通过工控机 mock auth 登录。登录成功后仅在当前会话内保存短期 token。</p>
            </div>
            <div className="login-state-pill">
              <span className="status-dot" />
              <span>{loginStateText}</span>
            </div>
          </div>

          <label className="login-field">
            <span>工号</span>
            <input
              autoComplete="username"
              className="login-input"
              onChange={(event) => setEmployeeNo(event.target.value)}
              placeholder="请输入工号"
              type="text"
              value={employeeNo}
            />
          </label>

          <label className="login-field">
            <span>密码</span>
            <input
              autoComplete="current-password"
              className="login-input"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
              type="password"
              value={password}
            />
          </label>

          <div className="login-options">
            <div className="pill blue">未登录访问功能页会先跳转到这里</div>
            <button className="fill-demo-btn" onClick={handleFillDemo} type="button">
              填入演示账号
            </button>
          </div>

          <div className="login-hint">
            演示账号：<strong>{mockLoginHint.employeeNo}</strong>，密码：
            <strong>{mockLoginHint.password}</strong>。这是后端 mock 用户，前端不会写入本地明文账号密码。
          </div>

          {errorMessage ? <div className="login-error">{errorMessage}</div> : null}

          <button className="login-submit" disabled={submitDisabled} type="submit">
            {checkingSession
              ? "正在验证登录状态..."
              : submitting
                ? "登录中..."
                : "登录进入主界面"}
          </button>
        </form>
      </div>
    </main>
  );
}
