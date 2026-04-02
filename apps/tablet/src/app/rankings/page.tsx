"use client";

import {
  RankingsResponseSchema,
  createApiSuccessResponseSchema,
  type RankingItem,
  type RankingsResponse,
  type RankingSystemFilter,
} from "@shearer/contracts";
import { useEffect, useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";

const RankingsApiResponseSchema = createApiSuccessResponseSchema(RankingsResponseSchema);

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

const systemOptions: Array<{ label: string; value: RankingSystemFilter }> = [
  { label: "全部系统", value: "all" },
  { label: "液压系统", value: "hydraulic" },
  { label: "截割系统", value: "cutting" },
  { label: "牵引系统", value: "traction" },
];

type RankingPanelProps = {
  items: RankingItem[];
  loading: boolean;
  title: string;
  subtitle: string;
};

function RankingPanel({ items, loading, title, subtitle }: RankingPanelProps) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3 className="panel-title">
            <span className="accent-bar" />
            {title}
          </h3>
          <p className="panel-subtitle">{subtitle}</p>
        </div>
      </div>
      <div className="panel-body">
        <div className="list">
          {loading ? (
            <div className="empty">正在加载排名数据...</div>
          ) : items.length === 0 ? (
            <div className="empty">当前筛选条件下暂无排名数据。</div>
          ) : (
            items.map((item, index) => (
              <div className="rank-item" key={`${item.name}-${item.lastOccurredAt}`}>
                <div className="rank-left">
                  <div className="rank-top">
                    <span className="rank-index">{index + 1}</span>
                    <div className="rank-name">{item.name}</div>
                  </div>
                  <div className="meta-line">最近一次 {item.lastOccurredAt}</div>
                </div>
                <div className="rank-count">{item.count} 次</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function RankingsPage() {
  const shellState = useAppShellState();
  const [startDate, setStartDate] = useState("2026-03-01");
  const [endDate, setEndDate] = useState("2026-03-31");
  const [system, setSystem] = useState<RankingSystemFilter>("all");
  const [rankings, setRankings] = useState<RankingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadRankings = async ({
    end,
    start,
    system: nextSystem,
  }: {
    start: string;
    end: string;
    system: RankingSystemFilter;
  }) => {
    try {
      setLoading(true);

      const response = await fetch(
        `${resolveHttpBase()}/api/rankings?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&system=${nextSystem}`,
        {
          cache: "no-store",
        },
      );
      const json = await response.json();
      const parsed = RankingsApiResponseSchema.parse(json);

      setRankings(parsed.data);
      setErrorMessage(null);
    } catch {
      setErrorMessage("近期故障排名加载失败，请先启动 IPC 服务。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRankings({
      start: startDate,
      end: endDate,
      system,
    });
  }, []);

  return (
    <AppShell
      shellState={shellState}
      subtitle="支持日期范围与系统选择，便于查看指定时间段故障排名"
      tagText="排行筛选"
      title="近期故障排名"
    >
      {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

      <section className="page active">
        <div className="stack">
          <div className="panel">
            <div className="panel-head">
              <div>
                <h3 className="panel-title">
                  <span className="accent-bar" />
                  顶部筛选区
                </h3>
                <p className="panel-subtitle">支持日期范围与系统选择，便于查看指定时间段故障排名。</p>
              </div>
            </div>
            <div className="panel-body">
              <form
                className="filter-bar"
                onSubmit={(event) => {
                  event.preventDefault();
                  void loadRankings({
                    start: startDate,
                    end: endDate,
                    system,
                  });
                }}
              >
                <input
                  className="date-input"
                  onChange={(event) => setStartDate(event.target.value)}
                  type="date"
                  value={startDate}
                />
                <input
                  className="date-input"
                  onChange={(event) => setEndDate(event.target.value)}
                  type="date"
                  value={endDate}
                />
                <select
                  className="control"
                  onChange={(event) => setSystem(event.target.value as RankingSystemFilter)}
                  value={system}
                >
                  {systemOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button className="button primary" type="submit">
                  应用筛选
                </button>
              </form>
            </div>
          </div>

          <div className="grid-3">
            <RankingPanel
              items={rankings?.systemFaultRankings ?? []}
              loading={loading}
              subtitle="近一个月系统故障 Top 排名"
              title="系统故障"
            />
            <RankingPanel
              items={rankings?.inverterFaultRankings ?? []}
              loading={loading}
              subtitle="变频器类代码统计"
              title="变频器故障"
            />
            <RankingPanel
              items={rankings?.sensorFaultRankings ?? []}
              loading={loading}
              subtitle="按失效次数排序"
              title="传感器失效"
            />
          </div>
        </div>
      </section>
    </AppShell>
  );
}
