"use client";

import {
  CheckinsResponseSchema,
  CheckinsSubmitRequestSchema,
  createApiSuccessResponseSchema,
  type CheckinItem,
} from "@shearer/contracts";
import { useEffect, useMemo, useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";

const CheckinsApiResponseSchema = createApiSuccessResponseSchema(CheckinsResponseSchema);

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

const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 某天的打卡记录 */
type DayRecord = {
  date: string;
  shift: string;
  person: string;
  result: string;
  items: Array<{ label: string; checked: boolean }>;
};

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

export default function CheckinsPage() {
  const shellState = useAppShellState();
  const [items, setItems] = useState<CheckinItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submittedToday, setSubmittedToday] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [dayDetail, setDayDetail] = useState<DayRecord | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 今日打卡项（四项）来自接口；勾选状态本地维护
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`${resolveHttpBase()}/api/checkins`, { cache: "no-store" });
        const parsed = CheckinsApiResponseSchema.parse(await response.json());
        if (!cancelled) {
          setItems(parsed.data.todayItems.map((i) => ({ ...i, checked: false })));
          setErrorMessage(null);
        }
      } catch {
        if (!cancelled) {
          setErrorMessage("打卡项加载失败，请确认服务已启动。");
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleItem = (id: string) => {
    if (submittedToday) {
      return;
    }
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item)),
    );
  };

  const submit = async () => {
    try {
      setSubmitting(true);
      const payload = CheckinsSubmitRequestSchema.parse({
        checkedItemIds: items.filter((i) => i.checked).map((i) => i.id),
      });
      await fetch(`${resolveHttpBase()}/api/checkins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      setSubmittedToday(true);
      setErrorMessage(null);
    } catch {
      setErrorMessage("提交失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * 历史打卡记录（按约定 mock）：项目启动前四天均已完成打卡；
   * 今天提交后当天也计入。待真实打卡数据源接入后替换。
   */
  const records = useMemo(() => {
    const map = new Map<string, DayRecord>();
    const today = new Date();
    for (let back = 1; back <= 4; back += 1) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
      map.set(dateKey(d), {
        date: dateKey(d),
        shift: "检修班",
        person: "tiandi · 点检员",
        result: "已完成 4/4 项",
        items: items.map((i) => ({ label: i.label, checked: true })),
      });
    }
    if (submittedToday) {
      const done = items.filter((i) => i.checked).length;
      map.set(dateKey(today), {
        date: dateKey(today),
        shift: "检修班",
        person: "tiandi · 点检员",
        result: `已完成 ${done}/${items.length} 项`,
        items: items.map((i) => ({ label: i.label, checked: i.checked })),
      });
    }
    return map;
  }, [items, submittedToday]);

  // 当前展示月份的日历格（周一开头）
  const calCells = useMemo(() => {
    const year = calMonth.getFullYear();
    const month = calMonth.getMonth();
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ day: number; key: string } | null> = [];
    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push(null);
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push({ day, key: dateKey(new Date(year, month, day)) });
    }
    return cells;
  }, [calMonth]);

  const checkedCount = items.filter((i) => i.checked).length;
  const todayText = dateKey(new Date());

  return (
    <AppShell hideFloatingHome={showCalendar} shellState={shellState} title="日常检修打卡">
      <section className="page active">
        {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

        {/* ===== 今日打卡项 ===== */}
        <div className="ck-head">
          <h1 className="sensor-detail-title">今日检修打卡</h1>
          <span className="range-picker-current">{todayText}</span>
          <span
            className={`pill ${submittedToday ? "green" : "blue"}`}
            style={{ marginLeft: "auto" }}
          >
            {submittedToday ? `已打卡 · ${checkedCount}/${items.length} 项` : `已勾选 ${checkedCount}/${items.length} 项`}
          </span>
        </div>

        <div className="ck-items">
          {items.length === 0 ? (
            <div className="empty">正在加载打卡项...</div>
          ) : (
            items.map((item, index) => (
              <button
                className={`ck-item${item.checked ? " on" : ""}`}
                key={item.id}
                onClick={() => toggleItem(item.id)}
                type="button"
              >
                <span className={`ck-item-box${item.checked ? " on" : ""}`}>
                  {item.checked ? "✓" : index + 1}
                </span>
                <span className="ck-item-label">{item.label}</span>
              </button>
            ))
          )}
        </div>

        {items.length > 0 && !submittedToday ? (
          <button
            className="range-picker-confirm ck-submit"
            disabled={submitting || checkedCount === 0}
            onClick={() => void submit()}
            type="button"
          >
            {submitting ? "提交中…" : "提交打卡"}
          </button>
        ) : null}

        <div className="sensor-pager" style={{ justifyContent: "center" }}>
          <button
            className="sensor-settings-btn"
            onClick={() => {
              setDayDetail(null);
              setShowCalendar(true);
            }}
            type="button"
          >
            历史打卡记录
          </button>
        </div>

        {/* ===== 日历弹窗 ===== */}
        {showCalendar ? (
          <div className="fc-modal-backdrop" onClick={() => setShowCalendar(false)}>
            <div className="fc-modal" onClick={(event) => event.stopPropagation()}>
              {dayDetail === null ? (
                <>
                  <div className="ck-cal-head">
                    <button
                      className="sensor-back-btn"
                      onClick={() =>
                        setCalMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))
                      }
                      type="button"
                    >
                      ‹
                    </button>
                    <h2 className="fc-modal-title">
                      {calMonth.getFullYear()} 年 {calMonth.getMonth() + 1} 月
                    </h2>
                    <button
                      className="sensor-back-btn"
                      onClick={() =>
                        setCalMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))
                      }
                      type="button"
                    >
                      ›
                    </button>
                  </div>
                  <div className="ck-cal-grid">
                    {WEEKDAYS.map((w) => (
                      <div className="ck-cal-weekday" key={w}>
                        {w}
                      </div>
                    ))}
                    {calCells.map((cell, index) =>
                      cell === null ? (
                        <div key={`empty-${index}`} />
                      ) : (
                        <button
                          className={`ck-cal-day${records.has(cell.key) ? " has-record" : ""}${cell.key === todayText ? " today" : ""}`}
                          key={cell.key}
                          onClick={() => {
                            const rec = records.get(cell.key);
                            setDayDetail(
                              rec ?? {
                                date: cell.key,
                                shift: "--",
                                person: "--",
                                result: "当天无打卡记录",
                                items: [],
                              },
                            );
                          }}
                          type="button"
                        >
                          {cell.day}
                          {records.has(cell.key) ? <span className="ck-cal-dot" /> : null}
                        </button>
                      ),
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="fc-modal-head">
                    <span className="fc-modal-code">{dayDetail.date}</span>
                    <h2 className="fc-modal-title">{dayDetail.result}</h2>
                  </div>
                  {dayDetail.items.length > 0 ? (
                    <>
                      <p className="fc-modal-desc">
                        班次：{dayDetail.shift} · 点检人：{dayDetail.person}
                      </p>
                      <ol className="fc-modal-suggestions">
                        {dayDetail.items.map((item, index) => (
                          <li key={index}>
                            {item.checked ? "✓ " : "✗ "}
                            {item.label}
                          </li>
                        ))}
                      </ol>
                    </>
                  ) : (
                    <p className="fc-modal-desc">该日期没有打卡记录。</p>
                  )}
                  <button
                    className="fc-modal-close"
                    onClick={() => setDayDetail(null)}
                    type="button"
                  >
                    返回日历
                  </button>
                </>
              )}
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
