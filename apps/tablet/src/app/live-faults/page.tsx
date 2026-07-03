"use client";

import {
  LiveFaultsResponseSchema,
  createApiSuccessResponseSchema,
  type LiveFault,
} from "@shearer/contracts";
import { useEffect, useMemo, useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";

const LiveFaultsApiResponseSchema = createApiSuccessResponseSchema(LiveFaultsResponseSchema);

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

const TYPE_TEXT = ["提示", "警告", "停机"];
const KIND_TEXT: Record<number, string> = {
  1: "变频器", 2: "电机", 3: "模块", 4: "传感器", 5: "自动化", 6: "内部", 7: "来源",
};

const pad = (n: number) => String(n).padStart(2, "0");

const fmtClock = (ms: number) => {
  const d = new Date(ms);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const hms = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return sameDay ? hms : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hms}`;
};

const fmtDuration = (ms: number) => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) {
    return `${sec} 秒`;
  }
  if (sec < 3600) {
    return `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
  }
  return `${Math.floor(sec / 3600)} 小时 ${Math.floor((sec % 3600) / 60)} 分`;
};

// handle 形如 "1.xxx。2.xxx。" → 拆条；无编号的整段返回
const splitHandle = (handle: string): string[] =>
  handle
    .split(/\d+[.、](?=[^\d])/)
    .map((part) => part.trim())
    .filter(Boolean);

// 严重度样式：内部紫 / 停机红 / 警告黄
const severityOf = (item: LiveFault) =>
  item.source === "internal" ? "internal" : item.type === 2 ? "stop" : "warn";

const SEVERITY_LABEL: Record<string, string> = {
  internal: "内部",
  stop: "停机",
  warn: "警告",
};

export default function LiveFaultsPage() {
  const shellState = useAppShellState();
  const [items, setItems] = useState<LiveFault[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [detail, setDetail] = useState<LiveFault | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 3s 拉取故障流，1s 心跳驱动"已持续"时长跳动
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`${resolveHttpBase()}/api/live-faults`, { cache: "no-store" });
        const parsed = LiveFaultsApiResponseSchema.parse(await response.json());
        if (!cancelled) {
          setItems(parsed.data);
          setLoaded(true);
          setErrorMessage(null);
        }
      } catch {
        if (!cancelled) {
          setErrorMessage("实时故障加载失败，请确认服务已启动。");
        }
      }
    };

    void load();
    const pollTimer = setInterval(() => void load(), 3_000);
    const tickTimer = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      clearInterval(tickTimer);
    };
  }, []);

  const active = useMemo(() => items.filter((i) => i.clearTs === null), [items]);
  const history = useMemo(() => items.filter((i) => i.clearTs !== null), [items]);

  const counts = useMemo(() => {
    let stop = 0;
    let warn = 0;
    let internal = 0;
    for (const i of items) {
      const sev = severityOf(i);
      if (sev === "internal") internal += 1;
      else if (sev === "stop") stop += 1;
      else warn += 1;
    }
    return { stop, warn, internal };
  }, [items]);

  return (
    <AppShell shellState={shellState} title="实时故障">
      <section className="page active">
        {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

        {/* ===== 状态条：LIVE + 计数 ===== */}
        <div className="lf-statusbar">
          <span className="lf-live">
            <span className="lf-live-dot" />
            实时监控中
          </span>
          <span className={`lf-count lf-count-active${active.length > 0 ? " hot" : ""}`}>
            进行中 {active.length}
          </span>
          <span className="lf-count lf-count-stop">停机 {counts.stop}</span>
          <span className="lf-count lf-count-warn">警告 {counts.warn}</span>
          <span className="lf-count lf-count-internal">内部 {counts.internal}</span>
        </div>

        {/* ===== 进行中故障：置顶重点告警 ===== */}
        {active.length > 0 ? (
          <div className="lf-active-zone">
            {active.map((item) => (
              <button
                className="lf-active-card"
                key={item.id}
                onClick={() => setDetail(item)}
                type="button"
              >
                <span className="lf-active-dot" />
                <div className="lf-active-main">
                  <div className="lf-active-name">{item.name}</div>
                  <div className="lf-active-meta">
                    {fmtClock(item.occurTs)} 发生 · 已持续 {fmtDuration(now - item.occurTs)}
                  </div>
                </div>
                <span className="lf-active-badge">进行中</span>
              </button>
            ))}
          </div>
        ) : loaded ? (
          <div className="lf-all-clear">当前没有进行中的故障</div>
        ) : null}

        {/* ===== 故障流：最新在前 ===== */}
        <div className="lf-feed">
          {!loaded ? (
            <div className="empty">正在加载实时故障...</div>
          ) : history.length === 0 && active.length === 0 ? (
            <div className="empty">暂无故障记录。</div>
          ) : (
            history.map((item) => {
              const sev = severityOf(item);
              return (
                <button
                  className={`lf-row lf-${sev}`}
                  key={item.id}
                  onClick={() => setDetail(item)}
                  type="button"
                >
                  <span className={`lf-tag lf-tag-${sev}`}>
                    {item.module || SEVERITY_LABEL[sev]}
                  </span>
                  <span className="lf-row-name">{item.name}</span>
                  <span className="lf-row-time">
                    {fmtClock(item.occurTs)}
                    {item.source === "internal" ? null : (
                      <>
                        <span className="lf-row-arrow">→</span>
                        {fmtClock(item.clearTs as number)}
                      </>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* ===== 详情弹窗：处理建议 ===== */}
        {detail ? (
          <div className="fc-modal-backdrop" onClick={() => setDetail(null)}>
            <div className="fc-modal" onClick={(event) => event.stopPropagation()}>
              <div className="fc-modal-head">
                <span className="fc-modal-code">{detail.code}</span>
                <h2 className="fc-modal-title">{detail.name}</h2>
              </div>
              <p className="fc-modal-desc">
                {detail.source === "internal"
                  ? `内部故障 · 模块：${detail.module}`
                  : `类型：${TYPE_TEXT[detail.type] ?? detail.type} · 类别：${KIND_TEXT[detail.kind] ?? detail.kind}`}
              </p>
              <p className="fc-modal-desc">
                发生：{fmtClock(detail.occurTs)}
                {detail.source === "internal" ? null : detail.clearTs === null ? (
                  <>
                    {" · "}
                    <strong style={{ color: "#ff5c5c" }}>
                      进行中，已持续 {fmtDuration(now - detail.occurTs)}
                    </strong>
                  </>
                ) : (
                  ` · 结束：${fmtClock(detail.clearTs)} · 持续 ${fmtDuration(detail.clearTs - detail.occurTs)}`
                )}
              </p>
              {detail.handle ? (
                splitHandle(detail.handle).length > 1 ? (
                  <>
                    <div className="fc-modal-sub">处理建议</div>
                    <ol className="fc-modal-suggestions">
                      {splitHandle(detail.handle).map((tip, index) => (
                        <li key={index}>{tip}</li>
                      ))}
                    </ol>
                  </>
                ) : (
                  <>
                    <div className="fc-modal-sub">处理建议</div>
                    <p className="fc-modal-desc">{detail.handle}</p>
                  </>
                )
              ) : null}
              <button className="fc-modal-close" onClick={() => setDetail(null)} type="button">
                关 闭
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
