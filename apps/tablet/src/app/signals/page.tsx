"use client";

import {
  SensorSummarySchema,
  SensorTrendPointSchema,
  createApiSuccessResponseSchema,
  type SensorSummary,
} from "@shearer/contracts";
import { useEffect, useMemo, useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";
import { MultiTrendChart, type OverlaySeries } from "@/components/multi-trend-chart";
import { resolveHttpBase } from "@/lib/api-base";

const SensorSummariesApiResponseSchema = createApiSuccessResponseSchema(SensorSummarySchema.array());
const SensorTrendApiResponseSchema = createApiSuccessResponseSchema(SensorTrendPointSchema.array());

const COLORS = ["#48c7ff", "#38d889", "#ffb03a", "#ff6b9d"];
const MAX_PICK = 4;

const TYPE_ORDER = [
  "温度", "电流", "负荷", "压力/流量/油位", "速度/位置", "角度", "其他",
] as const;

const typeGroup = (sensor: { type: string; name: string }) => {
  const t = sensor.type;
  if (t === "温度" || t === "电流" || t === "负荷" || t === "角度") {
    return t;
  }
  if (t === "压力" || t === "流量" || t === "油位") {
    return "压力/流量/油位";
  }
  if (t === "速度" || t === "位置" || sensor.name.includes("采高")) {
    return "速度/位置";
  }
  return "其他";
};

type ViewMode = "pick" | "chart";

export default function SignalsPage() {
  const shellState = useAppShellState();
  const [summaries, setSummaries] = useState<SensorSummary[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [view, setView] = useState<ViewMode>("pick");
  const [series, setSeries] = useState<OverlaySeries[]>([]);
  const [loading, setLoading] = useState(false);
  const [trendWindow, setTrendWindow] = useState<{ from: number; to: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`${resolveHttpBase()}/api/sensors`, { cache: "no-store" });
        const parsed = SensorSummariesApiResponseSchema.parse(await response.json());
        if (!cancelled) {
          // 只列有效测点，按类型分组展示
          setSummaries(parsed.data.filter((s) => s.valid));
        }
      } catch {
        if (!cancelled) {
          setErrorMessage("传感器列表加载失败，请确认服务已启动。");
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // 选中信号的曲线拉取（全量或缩放窗口）
  useEffect(() => {
    if (view !== "chart" || picked.length === 0) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    const query = trendWindow ? `from=${trendWindow.from}&to=${trendWindow.to}` : "range=all";
    const load = async () => {
      try {
        const results = await Promise.all(
          picked.map(async (id) => {
            const response = await fetch(
              `${resolveHttpBase()}/api/sensors/${id}/trend?${query}`,
              { cache: "no-store" },
            );
            return SensorTrendApiResponseSchema.parse(await response.json()).data;
          }),
        );
        if (cancelled) {
          return;
        }
        setSeries(
          picked.map((id, index) => {
            const info = summaries.find((s) => s.id === id);
            return {
              name: info?.name ?? id,
              unit: info?.unit ?? "",
              color: COLORS[index % COLORS.length],
              points: results[index],
            };
          }),
        );
        setLoading(false);
        setErrorMessage(null);
      } catch {
        if (!cancelled) {
          setLoading(false);
          setErrorMessage("信号数据加载失败。");
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, picked, trendWindow]);

  const groups = useMemo(() => {
    const byType = new Map<string, SensorSummary[]>();
    for (const s of summaries) {
      const key = typeGroup(s);
      const list = byType.get(key) ?? [];
      list.push(s);
      byType.set(key, list);
    }
    return TYPE_ORDER.map((t) => [t, byType.get(t) ?? []] as const).filter(
      ([, list]) => list.length > 0,
    );
  }, [summaries]);

  const togglePick = (id: string) => {
    setPicked((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : current.length < MAX_PICK
          ? [...current, id]
          : current,
    );
  };

  return (
    <AppShell
      back={
        view === "chart"
          ? {
              label: "选择信号",
              onClick: () => {
                setView("pick");
                setSeries([]);
              },
            }
          : undefined
      }
      shellState={shellState}
      title="信号对比"
      viewTitle={view === "chart" ? "趋势对比" : "选择信号"}
    >
      <section className="page active">
        {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

        {view === "pick" ? (
          <>
            <div className="sensor-topbar">
              <h1 className="sensor-detail-title">选择信号（最多 {MAX_PICK} 个）</h1>
              <div className="sg-picked">
                {picked.map((id, index) => {
                  const info = summaries.find((s) => s.id === id);
                  return (
                    <span
                      className="sg-picked-chip"
                      key={id}
                      style={{ borderColor: COLORS[index], color: COLORS[index] }}
                    >
                      {info?.name ?? id}
                    </span>
                  );
                })}
              </div>
              <button
                className="range-picker-confirm sg-go"
                disabled={picked.length === 0}
                onClick={() => {
                  setTrendWindow(null);
                  setView("chart");
                }}
                type="button"
              >
                查看曲线
              </button>
            </div>
            {groups.map(([type, list]) => (
              <div key={type}>
                <h2 className="sensor-group-title">{type}</h2>
                <div className="sg-grid">
                  {list.map((s) => {
                    const index = picked.indexOf(s.id);
                    const on = index >= 0;
                    return (
                      <button
                        className={`sensor-type-chip sg-chip${on ? " active" : ""}`}
                        key={s.id}
                        onClick={() => togglePick(s.id)}
                        style={on ? { borderColor: COLORS[index], color: COLORS[index] } : undefined}
                        type="button"
                      >
                        {s.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            {/* 返回由导航栏统一承担，这里只留页面自己的动作 */}
            {trendWindow ? (
              <div className="sensor-topbar">
                <button
                  className="sensor-back-btn"
                  onClick={() => setTrendWindow(null)}
                  type="button"
                >
                  恢复全览
                </button>
              </div>
            ) : null}
            <div className={`sensor-detail-chart${trendWindow ? "" : " chart-flush"}`}>
              <MultiTrendChart
                loading={loading}
                onWindowSelect={(fromMs, toMs) => setTrendWindow({ from: fromMs, to: toMs })}
                series={series}
              />
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}
