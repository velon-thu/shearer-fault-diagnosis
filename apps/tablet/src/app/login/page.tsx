"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  clearStoredAuthSession,
  fetchAuthMe,
  getSafeNextPath,
  getStoredAccessToken,
  loginWithPassword,
} from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [nextPath, setNextPath] = useState("/");
  const [account, setAccount] = useState("");
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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedAccount = account.trim();

    if (!trimmedAccount || !password) {
      return;
    }

    setSubmitting(true);
    setErrorMessage("");

    try {
      await loginWithPassword({
        employeeNo: trimmedAccount,
        password,
      });
      router.replace(nextPath);
    } catch (error) {
      const message =
        error instanceof Error && error.message === "AUTH_INVALID_CREDENTIALS"
          ? "账号或密码错误，请重试。"
          : "登录服务暂不可用，请确认服务已启动。";

      setErrorMessage(message);
      setSubmitting(false);
    }
  };

  const submitDisabled = checkingSession || submitting || !account.trim() || !password;

  return (
    <main className="login-shell">
      <form
        autoComplete="on"
        className="login-card login-simple"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="login-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="中煤科工集团" className="login-brand-logo" src="/ccteg-logo.svg" />
          <h1 className="login-brand-title">中煤科工上海故障诊断点检仪</h1>
        </div>

        <label className="login-field">
          <span>账号</span>
          <input
            autoComplete="username"
            className="login-input"
            onChange={(event) => setAccount(event.target.value)}
            placeholder="请输入账号"
            type="text"
            value={account}
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

        {errorMessage ? <div className="login-error">{errorMessage}</div> : null}

        <button className="login-submit" disabled={submitDisabled} type="submit">
          {checkingSession ? "正在验证登录状态..." : submitting ? "登录中..." : "登 录"}
        </button>
      </form>
    </main>
  );
}
