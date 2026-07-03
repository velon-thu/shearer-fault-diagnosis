"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  clearStoredAuthSession,
  fetchAuthMe,
  getSafeNextPath,
  getStoredAccessToken,
  loginWithPassword,
} from "@/lib/auth";

/* 平板为 Ubuntu 系统，不易唤起系统键盘：点账号/密码时在页面底部弹出屏幕软键盘 */
const KEY_ROWS: string[][] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
];

type OskField = "account" | "password";

export default function LoginPage() {
  const router = useRouter();
  const [nextPath, setNextPath] = useState("/");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [checkingSession, setCheckingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [activeField, setActiveField] = useState<OskField | null>(null);
  const [upperCase, setUpperCase] = useState(false);
  const accountRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const oskRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!activeField) {
      return;
    }

    const field = activeField === "account" ? accountRef.current : passwordRef.current;
    const osk = oskRef.current;

    if (!field || !osk) {
      return;
    }

    /* 键盘固定在底部，若输入框被盖住则把它滚到键盘上方 */
    const visibleBottom = window.innerHeight - osk.offsetHeight - 24;
    const fieldBottom = field.getBoundingClientRect().bottom;

    if (fieldBottom > visibleBottom) {
      window.scrollBy({ top: fieldBottom - visibleBottom, behavior: "smooth" });
    }
  }, [activeField]);

  const appendChar = (char: string) => {
    if (!activeField) {
      return;
    }

    const setValue = activeField === "account" ? setAccount : setPassword;
    setValue((value) => (value.length < 32 ? value + char : value));
  };

  const deleteChar = () => {
    if (!activeField) {
      return;
    }

    const setValue = activeField === "account" ? setAccount : setPassword;
    setValue((value) => value.slice(0, -1));
  };

  const hideKeyboard = () => {
    setActiveField(null);

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  const submitLogin = async () => {
    const trimmedAccount = account.trim();

    if (!trimmedAccount || !password) {
      return;
    }

    hideKeyboard();
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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitLogin();
  };

  /* 确认键：账号输完 → 自动跳到密码；密码输完 → 直接登录 */
  const confirmField = () => {
    if (activeField === "account") {
      setActiveField("password");
      passwordRef.current?.focus();
      return;
    }
    void submitLogin();
  };

  /* 点击键盘和输入框之外的任意位置 → 收起键盘 */
  const handleShellPointerDown = (event: React.PointerEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest(".login-osk") || target.closest(".login-input")) {
      return;
    }
    if (activeField) {
      hideKeyboard();
    }
  };

  const submitDisabled = checkingSession || submitting || !account.trim() || !password;

  return (
    <main
      className={`login-shell${activeField ? " login-shell--kb" : ""}`}
      onPointerDown={handleShellPointerDown}
    >
      <form
        autoComplete="on"
        className="login-card login-simple"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="login-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="中煤科工集团 CCTEG" className="login-brand-logo" src="/ccteg-logo.png" />
          <h1 className="login-brand-title">
            上海天地
            <br />
            采煤机故障诊断点检仪
          </h1>
        </div>

        <label className="login-field">
          <span>账号</span>
          <input
            autoComplete="username"
            className="login-input"
            inputMode="none"
            onChange={(event) => setAccount(event.target.value)}
            onClick={() => setActiveField("account")}
            onFocus={() => setActiveField("account")}
            placeholder="请输入账号"
            ref={accountRef}
            type="text"
            value={account}
          />
        </label>

        <label className="login-field">
          <span>密码</span>
          <input
            autoComplete="current-password"
            className="login-input"
            inputMode="none"
            onChange={(event) => setPassword(event.target.value)}
            onClick={() => setActiveField("password")}
            onFocus={() => setActiveField("password")}
            placeholder="请输入密码"
            ref={passwordRef}
            type="password"
            value={password}
          />
        </label>

        {errorMessage ? <div className="login-error">{errorMessage}</div> : null}

        <button className="login-submit" disabled={submitDisabled} type="submit">
          {checkingSession ? "正在验证登录状态..." : submitting ? "登录中..." : "登 录"}
        </button>
      </form>

      {activeField ? (
        /* onPointerDown preventDefault：点按键不夺走输入框焦点 */
        <div className="login-osk" onPointerDown={(event) => event.preventDefault()} ref={oskRef}>
          <div className="fc-keyboard">
            {KEY_ROWS.map((row, rowIndex) => (
              <div className="fc-key-row" key={rowIndex}>
                {row.map((key) => {
                  const label = upperCase ? key.toUpperCase() : key;

                  return (
                    <button
                      className="fc-key"
                      key={key}
                      onClick={() => appendChar(label)}
                      type="button"
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="fc-key-row">
              <button
                className={`fc-key fc-key-wide${upperCase ? " login-osk-shift-on" : ""}`}
                onClick={() => setUpperCase((value) => !value)}
                type="button"
              >
                ⇧ 大小写
              </button>
              <button className="fc-key fc-key-wide" onClick={deleteChar} type="button">
                ⌫ 删除
              </button>
              <button className="fc-key fc-key-wide" onClick={hideKeyboard} type="button">
                收起键盘
              </button>
              <button
                className="fc-key fc-key-confirm"
                disabled={activeField === "password" && (!account.trim() || !password)}
                onClick={confirmField}
                type="button"
              >
                {activeField === "account" ? "确认 · 下一步" : "确认登录"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
