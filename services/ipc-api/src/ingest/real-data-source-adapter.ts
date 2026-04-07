import type {
  SensorDetail,
  SensorSummary,
  SensorTrendPoint,
} from "@shearer/contracts";
import { type DatabaseSync } from "node:sqlite";
import { sensors } from "../mock";
import { initializeSqlite } from "../db/sqlite";
import { MockDataSourceAdapter } from "./mock-data-source-adapter";

type RealSensorMapping = {
  id: string;
  name: string;
  type: string;
  location: string;
  unit: string;
  samplePeriod: string;
  rawSensorId: string;
  aggregateSensorId: string;
  sourceTable: "sensor_samples_raw";
  aggregateTable: "sensor_samples_1m";
};

type LatestSampleRow = {
  sampled_at: string;
  value: number;
  quality: string | null;
};

type SensorStatsRow = {
  average_value: number | null;
  peak_value: number | null;
  failures_30d: number | null;
};

type TrendRow = {
  time: string;
  value: number | null;
};

const REAL_SENSOR_MAPPINGS: RealSensorMapping[] = sensors.map((sensor) => ({
  id: sensor.id,
  name: sensor.name,
  type: sensor.type,
  location: sensor.location,
  unit: sensor.unit,
  samplePeriod: "待确认，当前优先按 1 分钟聚合读取",
  rawSensorId: sensor.id,
  aggregateSensorId: sensor.id,
  sourceTable: "sensor_samples_raw",
  aggregateTable: "sensor_samples_1m",
}));

const realSensorMap = new Map(REAL_SENSOR_MAPPINGS.map((item) => [item.id, item]));

const formatMetric = (value: number, unit: string) => `${Number(value.toFixed(1))}${unit}`;

const isQualityValid = (quality: string | null | undefined) => {
  if (!quality) {
    return true;
  }

  const normalized = quality.toLowerCase();

  return normalized === "good" || normalized === "ok" || normalized === "valid";
};

const toSqliteDateTime = (value: Date) => value.toISOString();

const toDisplayTime = (value: string) => {
  const date = new Date(value.replace(" ", "T"));

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

export class RealDataSourceAdapter extends MockDataSourceAdapter {
  private readonly db: DatabaseSync;

  constructor(options?: { db?: DatabaseSync }) {
    super();
    this.db = options?.db ?? initializeSqlite();
  }

  private getMapping(sensorId: string) {
    return realSensorMap.get(sensorId) ?? null;
  }

  private readLatestSample(sensorId: string): LatestSampleRow | null {
    const row = this.db
      .prepare(
        `
          SELECT sampled_at, value, quality
          FROM sensor_samples_raw
          WHERE sensor_id = ?
          ORDER BY datetime(sampled_at) DESC, id DESC
          LIMIT 1
        `,
      )
      .get(sensorId) as LatestSampleRow | undefined;

    return row ?? null;
  }

  private readSensorStats(sensorId: string, from: Date, to: Date): SensorStatsRow | null {
    const row = this.db
      .prepare(
        `
          SELECT
            AVG(value) AS average_value,
            MAX(value) AS peak_value,
            SUM(
              CASE
                WHEN quality IS NOT NULL AND lower(quality) NOT IN ('good', 'ok', 'valid')
                THEN 1
                ELSE 0
              END
            ) AS failures_30d
          FROM sensor_samples_raw
          WHERE sensor_id = ?
            AND datetime(sampled_at) BETWEEN datetime(?) AND datetime(?)
        `,
      )
      .get(sensorId, toSqliteDateTime(from), toSqliteDateTime(to)) as SensorStatsRow | undefined;

    if (!row || row.average_value === null || row.peak_value === null) {
      return null;
    }

    return row;
  }

  private async buildSensorDetailFromRealData(sensorId: string): Promise<SensorDetail | null> {
    const mapping = this.getMapping(sensorId);

    if (!mapping) {
      return null;
    }

    const latest = this.readLatestSample(mapping.rawSensorId);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const stats = this.readSensorStats(mapping.rawSensorId, thirtyDaysAgo, new Date());

    if (!latest && !stats) {
      return null;
    }

    const fallback = await super.getSensorDetail(sensorId);
    const averageValue = stats?.average_value ?? latest?.value ?? fallback?.averageValue ?? 0;
    const peakValue = stats?.peak_value ?? latest?.value ?? fallback?.peakValue ?? averageValue;
    const valid = isQualityValid(latest?.quality);
    const failures30d = Number(stats?.failures_30d ?? fallback?.failures30d ?? 0);
    const state = !valid
      ? "数据异常"
      : failures30d > 0
        ? "波动关注"
        : "正常";

    return {
      id: mapping.id,
      name: mapping.name,
      type: mapping.type,
      location: mapping.location,
      unit: mapping.unit,
      state,
      valid,
      failures30d,
      lastSeen: latest?.sampled_at ?? fallback?.lastSeen ?? new Date().toISOString(),
      averageValue,
      peakValue,
      averageDisplay: formatMetric(averageValue, mapping.unit),
      peakDisplay: formatMetric(peakValue, mapping.unit),
    };
  }

  async getSensorSummaries(): Promise<SensorSummary[]> {
    const details = await Promise.all(
      REAL_SENSOR_MAPPINGS.map(async (item) => {
        const realDetail = await this.buildSensorDetailFromRealData(item.id);

        return realDetail ?? (await super.getSensorDetail(item.id));
      }),
    );

    return details
      .filter((item): item is SensorDetail => Boolean(item))
      .map(
        ({
          averageDisplay: _averageDisplay,
          averageValue: _averageValue,
          peakDisplay: _peakDisplay,
          peakValue: _peakValue,
          ...summary
        }) => summary,
      );
  }

  async getSensorDetail(sensorId: string): Promise<SensorDetail | null> {
    const realDetail = await this.buildSensorDetailFromRealData(sensorId);

    if (realDetail) {
      return realDetail;
    }

    return super.getSensorDetail(sensorId);
  }

  async getSensorTrend(sensorId: string, from: Date, to: Date): Promise<SensorTrendPoint[]> {
    const mapping = this.getMapping(sensorId);

    if (!mapping) {
      return super.getSensorTrend(sensorId, from, to);
    }

    const aggregateRows = this.db
      .prepare(
        `
          SELECT bucket_at AS time, COALESCE(avg_value, max_value, min_value) AS value
          FROM sensor_samples_1m
          WHERE sensor_id = ?
            AND datetime(bucket_at) BETWEEN datetime(?) AND datetime(?)
          ORDER BY datetime(bucket_at) ASC, id ASC
        `,
      )
      .all(
        mapping.aggregateSensorId,
        toSqliteDateTime(from),
        toSqliteDateTime(to),
      ) as TrendRow[];

    if (aggregateRows.length > 0) {
      return aggregateRows
        .filter((row) => row.value !== null)
        .map((row) => ({
          time: toDisplayTime(row.time),
          value: row.value ?? 0,
          unit: mapping.unit,
        }));
    }

    const rawRows = this.db
      .prepare(
        `
          SELECT sampled_at AS time, value
          FROM sensor_samples_raw
          WHERE sensor_id = ?
            AND datetime(sampled_at) BETWEEN datetime(?) AND datetime(?)
          ORDER BY datetime(sampled_at) ASC, id ASC
          LIMIT 720
        `,
      )
      .all(mapping.rawSensorId, toSqliteDateTime(from), toSqliteDateTime(to)) as TrendRow[];

    if (rawRows.length > 0) {
      return rawRows
        .filter((row) => row.value !== null)
        .map((row) => ({
          time: toDisplayTime(row.time),
          value: row.value ?? 0,
          unit: mapping.unit,
        }));
    }

    return super.getSensorTrend(sensorId, from, to);
  }
}
