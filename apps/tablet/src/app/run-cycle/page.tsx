"use client";

import {
  RunCycleResponseSchema,
  createApiSuccessResponseSchema,
  type RunCycleChartConfig,
  type RunCycleResponse,
} from "@shearer/contracts";
import { useEffect, useMemo, useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";
import { AnalysisTrendChart } from "@/components/analysis-trend-chart";

const RunCycleApiResponseSchema = createApiSuccessResponseSchema(RunCycleResponseSchema);

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

type ChartKey = "A" | "B";

type CycleChartCardProps = {
  chartKey: ChartKey;
  config: RunCycleChartConfig;
  data: RunCycleResponse | null;
  loading: boolean;
  onChangeXAxis: (chartKey: ChartKey, xAxis: string) => void;
  onToggleYAxis: (chartKey: ChartKey, yAxis: string) => void;
};

function CycleChartCard({
  chartKey,
  config,
  data,
  loading,
  onChangeXAxis,
  onToggleYAxis,
}: CycleChartCardProps) {
  const labels = data?.labelSets[config.xAxis] ?? [];
  const series = useMemo(
    () =>
      config.yAxes
        .map((item) => data?.seriesCatalog[item])
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    [config.yAxes, data],
  );

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <h4 className="chart-title">{`运行循环图 ${chartKey}`}</h4>
          <div className="chart-meta">
            {chartKey === "A"
              ? "横坐标可选：时间 / 工作面 / 温度"
              : "纵坐标支持多选：速度 / 电机温度 / 电机电流"}
          </div>
        </div>
      </div>

      <div className="stack">
        <div className="filter-bar">
          <select
            className="control"
            onChange={(event) => onChangeXAxis(chartKey, event.target.value)}
            value={config.xAxis}
          >
            {(data?.xAxisOptions ?? []).map((item) => (
              <option key={item} value={item}>
                {`横坐标：${item}`}
              </option>
            ))}
          </select>
          <div className="chip-row">
            {(data?.yAxisOptions ?? []).map((item) => (
              <button
                className={`selectable-chip ${config.yAxes.includes(item) ? "active" : ""}`.trim()}
                key={`${chartKey}-${item}`}
                onClick={() => onToggleYAxis(chartKey, item)}
                type="button"
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <AnalysisTrendChart labels={labels} loading={loading} series={series} />

        {series.length ? (
          <div className="chart-legend">
            {series.map((item) => (
              <div className="legend-item" key={`${chartKey}-${item.name}`}>
                <span className="legend-line" style={{ background: item.color }} />
                <span>{item.name}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function RunCyclePage() {
  const shellState = useAppShellState();
  const [runCycle, setRunCycle] = useState<RunCycleResponse | null>(null);
  const [chartConfigs, setChartConfigs] = useState<RunCycleResponse["defaultCharts"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadRunCycle = async () => {
      try {
        setLoading(true);

        const response = await fetch(`${resolveHttpBase()}/api/run-cycle`, {
          cache: "no-store",
        });
        const json = await response.json();
        const parsed = RunCycleApiResponseSchema.parse(json);

        if (cancelled) {
          return;
        }

        setRunCycle(parsed.data);
        setChartConfigs(parsed.data.defaultCharts);
        setErrorMessage(null);
      } catch {
        if (!cancelled) {
          setErrorMessage("运行循环图数据加载失败，请先启动 IPC 服务。");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadRunCycle();

    return () => {
      cancelled = true;
    };
  }, []);

  const updateXAxis = (chartKey: ChartKey, xAxis: string) => {
    setChartConfigs((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        [chartKey]: {
          ...current[chartKey],
          xAxis,
        },
      };
    });
  };

  const toggleYAxis = (chartKey: ChartKey, yAxis: string) => {
    setChartConfigs((current) => {
      if (!current) {
        return current;
      }

      const currentAxes = current[chartKey].yAxes;
      const alreadySelected = currentAxes.includes(yAxis);

      if (alreadySelected && currentAxes.length === 1) {
        return current;
      }

      return {
        ...current,
        [chartKey]: {
          ...current[chartKey],
          yAxes: alreadySelected
            ? currentAxes.filter((item) => item !== yAxis)
            : [...currentAxes, yAxis],
        },
      };
    });
  };

  return (
    <AppShell
      shellState={shellState}
      subtitle="每张图都支持选择横坐标与多个纵坐标"
      tagText="双图联动"
      title="运行循环图"
    >
      {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

      <section className="page active">
        <div className="stack">
          <div className="panel">
            <div className="panel-head">
              <div>
                <h3 className="panel-title">
                  <span className="accent-bar" />
                  运行循环图
                </h3>
                <p className="panel-subtitle">每张图都支持选择横坐标与多个纵坐标。</p>
              </div>
              <span className="pill blue">双图联动</span>
            </div>
            <div className="panel-body">
              <div className="grid-2">
                <CycleChartCard
                  chartKey="A"
                  config={chartConfigs?.A ?? { xAxis: "时间", yAxes: ["采煤机速度"] }}
                  data={runCycle}
                  loading={loading}
                  onChangeXAxis={updateXAxis}
                  onToggleYAxis={toggleYAxis}
                />
                <CycleChartCard
                  chartKey="B"
                  config={chartConfigs?.B ?? { xAxis: "工作面", yAxes: ["左截割电机电流"] }}
                  data={runCycle}
                  loading={loading}
                  onChangeXAxis={updateXAxis}
                  onToggleYAxis={toggleYAxis}
                />
              </div>
              <div className="footer-note">
                说明：该原型使用静态演示数据模拟“横坐标 / 纵坐标可配置”的交互方式，接入实时源后可直接替换数据生成逻辑。
              </div>
            </div>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
