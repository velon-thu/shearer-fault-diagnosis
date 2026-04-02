"use client";

import {
  CheckinsResponseSchema,
  CheckinsSubmitRequestSchema,
  createApiSuccessResponseSchema,
  type CheckinCalendarRecord,
  type CheckinHistoryEntry,
  type CheckinStatus,
  type CheckinsResponse,
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

const weekdays = ["日", "一", "二", "三", "四", "五", "六"] as const;

const getCheckinStatusConfig = (status?: CheckinStatus) => {
  if (status === "done") {
    return { text: "已打卡", badge: "done", tag: "已完成", badgeClass: "success" };
  }

  if (status === "partial") {
    return { text: "部分完成", badge: "partial", tag: "部分完成", badgeClass: "warn" };
  }

  if (status === "missed") {
    return { text: "未打卡", badge: "missed", tag: "未完成", badgeClass: "error" };
  }

  return { text: "无记录", badge: "empty", tag: "暂无记录", badgeClass: "info" };
};

const getHistoryBadgeClass = (item: CheckinHistoryEntry) => {
  if (item.result.includes("未")) {
    return "error";
  }

  if (item.result.includes("部分") || item.result.includes("补检")) {
    return "warn";
  }

  return "success";
};

export default function CheckinsPage() {
  const shellState = useAppShellState();
  const [checkins, setCheckins] = useState<CheckinsResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState("2026-03-16");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadCheckins = async () => {
    try {
      setLoading(true);

      const response = await fetch(`${resolveHttpBase()}/api/checkins`, {
        cache: "no-store",
      });
      const json = await response.json();
      const parsed = CheckinsApiResponseSchema.parse(json);

      setCheckins(parsed.data);
      setSelectedDate(parsed.data.todayDate);
      setErrorMessage(null);
    } catch {
      setErrorMessage("日常检修打卡数据加载失败，请先启动 IPC 服务。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCheckins();
  }, []);

  const toggleItem = (id: string) => {
    setCheckins((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        todayItems: current.todayItems.map((item) =>
          item.id === id ? { ...item, checked: !item.checked } : item,
        ),
      };
    });
  };

  const submitTodayCheckins = async () => {
    if (!checkins) {
      return;
    }

    try {
      setSubmitting(true);

      const payload = CheckinsSubmitRequestSchema.parse({
        checkedItemIds: checkins.todayItems.filter((item) => item.checked).map((item) => item.id),
      });

      const response = await fetch(`${resolveHttpBase()}/api/checkins`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const json = await response.json();
      const parsed = CheckinsApiResponseSchema.parse(json);

      setCheckins(parsed.data);
      setSelectedDate(parsed.data.todayDate);
      setErrorMessage(null);
    } catch {
      setErrorMessage("提交今日打卡失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  };

  const calendarCells = useMemo(() => {
    const year = 2026;
    const month = 3;
    const firstDay = new Date(year, month - 1, 1).getDay();
    const dayCount = new Date(year, month, 0).getDate();
    const cells: Array<
      | {
          type: "empty";
          key: string;
        }
      | {
          type: "day";
          key: string;
          date: string;
          day: number;
          record?: CheckinCalendarRecord;
        }
    > = [];

    for (let index = 0; index < firstDay; index += 1) {
      cells.push({
        type: "empty",
        key: `empty-${index}`,
      });
    }

    for (let day = 1; day <= dayCount; day += 1) {
      const date = `2026-03-${String(day).padStart(2, "0")}`;
      cells.push({
        type: "day",
        key: date,
        date,
        day,
        record: checkins?.calendarRecords[date],
      });
    }

    return cells;
  }, [checkins?.calendarRecords]);

  const selectedRecord = checkins?.calendarRecords[selectedDate];
  const selectedStatus = getCheckinStatusConfig(selectedRecord?.status);

  return (
    <AppShell
      shellState={shellState}
      subtitle="简洁打卡与历史记录"
      tagText="简洁模式"
      title="采煤机日常检修打卡"
    >
      {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

      <section className="page active">
        <div className="checkin-layout">
          <div className="stack">
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h3 className="panel-title">
                    <span className="accent-bar" />
                    今日打卡项列表
                  </h3>
                  <p className="panel-subtitle">打卡界面保持简洁，适合现场快速勾选并提交。</p>
                </div>
                <span className="pill green">简洁模式</span>
              </div>
              <div className="panel-body">
                <div className="list">
                  {loading ? (
                    <div className="empty">正在加载今日打卡项...</div>
                  ) : (
                    checkins?.todayItems.map((item) => (
                      <button
                        className={`check-item ${item.checked ? "done" : ""}`}
                        key={item.id}
                        onClick={() => toggleItem(item.id)}
                        type="button"
                      >
                        <div className="check-box">{item.checked ? "✓" : ""}</div>
                        <div className="check-title">{item.label}</div>
                      </button>
                    ))
                  )}
                </div>

                <div className="action-row">
                  <button
                    className="button success"
                    disabled={!checkins || submitting}
                    onClick={() => void submitTodayCheckins()}
                    type="button"
                  >
                    {submitting ? "提交中..." : "提交今日打卡"}
                  </button>
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
                    历史打卡记录区
                  </h3>
                  <p className="panel-subtitle">展示最近几次提交的班次、责任人与摘要。</p>
                </div>
              </div>
              <div className="panel-body">
                <div className="history-list">
                  {loading ? (
                    <div className="empty">正在加载历史打卡记录...</div>
                  ) : (
                    checkins?.historyData.map((item) => (
                      <div className="history-item" key={`${item.date}-${item.shift}-${item.person}`}>
                        <div>
                          <div className="asset-title">{item.date}</div>
                          <div className="asset-meta">
                            {item.shift} · {item.person} · {item.note}
                          </div>
                        </div>
                        <span className={`badge ${getHistoryBadgeClass(item)}`}>{item.result}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <div>
                  <h3 className="panel-title">
                    <span className="accent-bar" />
                    月历视图
                  </h3>
                  <p className="panel-subtitle">点击某一天后显示详细信息。</p>
                </div>
                <span className="pill blue">日历视图</span>
              </div>
              <div className="panel-body">
                <div className="calendar-wrap">
                  <div className="calendar-toolbar">
                    <div className="calendar-month">2026 年 03 月</div>
                    <div className="calendar-legend">
                      <span className="calendar-legend-item">
                        <span className="legend-dot done" />
                        已完成
                      </span>
                      <span className="calendar-legend-item">
                        <span className="legend-dot partial" />
                        部分完成
                      </span>
                      <span className="calendar-legend-item">
                        <span className="legend-dot missed" />
                        未打卡
                      </span>
                      <span className="calendar-legend-item">
                        <span className="legend-dot empty" />
                        暂无记录
                      </span>
                    </div>
                  </div>

                  <div className="calendar-grid">
                    {weekdays.map((weekday) => (
                      <div className="calendar-weekday" key={weekday}>
                        {weekday}
                      </div>
                    ))}
                    {calendarCells.map((cell) => {
                      if (cell.type === "empty") {
                        return <div className="calendar-cell empty" key={cell.key} />;
                      }

                      const status = getCheckinStatusConfig(cell.record?.status);

                      return (
                        <button
                          className={`calendar-cell ${cell.record?.status ?? ""} ${selectedDate === cell.date ? "selected" : ""}`.trim()}
                          key={cell.key}
                          onClick={() => setSelectedDate(cell.date)}
                          type="button"
                        >
                          <div className="calendar-date">{cell.day}</div>
                          <div>
                            <div className={`calendar-badge ${status.badge}`}>{status.text}</div>
                            <div className="calendar-note">
                              {cell.record ? cell.record.note : "暂无打卡记录"}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="calendar-detail">
                  {selectedRecord ? (
                    <>
                      <div className="calendar-detail-head">
                        <div>
                          <h4 className="calendar-detail-title">{selectedDate}</h4>
                          <div className="calendar-detail-meta">
                            {selectedRecord.shift} · {selectedRecord.person} · {selectedRecord.result}
                          </div>
                        </div>
                        <span className={`badge ${selectedStatus.badgeClass}`}>{selectedStatus.tag}</span>
                      </div>
                      <div className="calendar-detail-note">{selectedRecord.detail}</div>
                      <div className="calendar-detail-list">
                        <div className="calendar-detail-row">
                          <strong>记录摘要</strong>
                          <span>{selectedRecord.note}</span>
                        </div>
                        <div className="calendar-detail-row">
                          <strong>点检内容</strong>
                          <span>
                            主电缆、压力接点引出电缆、刻度记录、控制箱按钮及紧固螺钉检查。
                          </span>
                        </div>
                        <div className="calendar-detail-row">
                          <strong>适用说明</strong>
                          <span>该区域用于展示当天打卡结论、责任人和值班班次。</span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="calendar-detail-head">
                        <div>
                          <h4 className="calendar-detail-title">{selectedDate}</h4>
                          <div className="calendar-detail-meta">当日暂无历史打卡记录</div>
                        </div>
                        <span className="badge info">无记录</span>
                      </div>
                      <div className="calendar-detail-note">
                        该日期尚未录入打卡信息，可在实际系统中继续补录。
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
