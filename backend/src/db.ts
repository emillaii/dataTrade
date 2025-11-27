import { Pool } from "pg";
import type { PoolClient } from "pg";
import dotenv from "dotenv";
import type { BarEvent, Dataset } from "./types";

dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

export const pool = new Pool({
  connectionString
});

export async function ensureSchema(client?: PoolClient) {
  const c = client ?? (await pool.connect());
  try {
    await c.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
    await c.query(`
      CREATE TABLE IF NOT EXISTS datasets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        timezone TEXT,
        source_file TEXT,
        rows BIGINT NOT NULL DEFAULT 0,
        start_time TIMESTAMPTZ NOT NULL,
        end_time TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // For legacy tables created before timezone column existed
    await c.query(`ALTER TABLE datasets ADD COLUMN IF NOT EXISTS timezone TEXT;`);

    await c.query(`
      CREATE TABLE IF NOT EXISTS candles (
        id BIGSERIAL PRIMARY KEY,
        dataset_id UUID REFERENCES datasets(id) ON DELETE CASCADE,
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL,
        open DOUBLE PRECISION NOT NULL,
        high DOUBLE PRECISION NOT NULL,
        low DOUBLE PRECISION NOT NULL,
        close DOUBLE PRECISION NOT NULL,
        volume DOUBLE PRECISION NOT NULL,
        spread DOUBLE PRECISION,
        tick_count INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await c.query(`CREATE INDEX IF NOT EXISTS idx_candles_symbol_tf_ts ON candles(symbol, timeframe, timestamp);`);
  } finally {
    if (!client) c.release();
  }
}

export async function insertDataset(meta: Omit<Dataset, "id" | "createdAt">, client?: PoolClient) {
  const c = client ?? (await pool.connect());
  try {
    const res = await c.query(
      `
        INSERT INTO datasets(symbol, timeframe, timezone, source_file, rows, start_time, end_time)
        VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0))
        RETURNING id, symbol, timeframe, timezone, source_file as "sourceFile", rows, EXTRACT(EPOCH FROM start_time) * 1000 AS "startTime", EXTRACT(EPOCH FROM end_time) * 1000 AS "endTime", EXTRACT(EPOCH FROM created_at) * 1000 AS "createdAt";
      `,
      [meta.symbol, meta.timeframe, meta.timezone ?? null, meta.sourceFile, meta.rows, meta.startTime, meta.endTime]
    );
    return res.rows[0] as Dataset;
  } finally {
    if (!client) c.release();
  }
}

export async function insertCandles(datasetId: string, candles: BarEvent[], client?: PoolClient) {
  if (candles.length === 0) return;
  const c = client ?? (await pool.connect());
  try {
    const values: any[] = [];
    const valueStrings = candles.map((bar, idx) => {
      const base = idx * 9;
      values.push(
        datasetId,
        bar.symbol,
        bar.timeframe,
        bar.timestamp,
        bar.open,
        bar.high,
        bar.low,
        bar.close,
        bar.volume
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, to_timestamp($${base + 4} / 1000.0), $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
    });

    const sql = `
      INSERT INTO candles (dataset_id, symbol, timeframe, timestamp, open, high, low, close, volume)
      VALUES ${valueStrings.join(",")};
    `;
    await c.query(sql, values);
  } finally {
    if (!client) c.release();
  }
}

export interface DatasetFilters {
  symbol?: string;
  timeframe?: string;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}

export async function listDatasets(filters: DatasetFilters = {}) {
  const {
    symbol,
    timeframe,
    from,
    to,
    limit = 50,
    offset = 0
  } = filters;

  const params: any[] = [];
  const where: string[] = [];

  if (symbol) {
    params.push(symbol);
    where.push(`symbol = $${params.length}`);
  }
  if (timeframe) {
    params.push(timeframe);
    where.push(`timeframe = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`start_time >= to_timestamp($${params.length} / 1000.0)`);
  }
  if (to) {
    params.push(to);
    where.push(`end_time <= to_timestamp($${params.length} / 1000.0)`);
  }

  params.push(limit);
  params.push(offset);

  const sql = `
    SELECT
      id,
      symbol,
      timeframe,
      timezone,
      source_file AS "sourceFile",
      rows,
      EXTRACT(EPOCH FROM start_time) * 1000 AS "startTime",
      EXTRACT(EPOCH FROM end_time) * 1000 AS "endTime",
      EXTRACT(EPOCH FROM created_at) * 1000 AS "createdAt",
      COUNT(*) OVER() AS total
    FROM datasets
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY created_at DESC
    LIMIT $${params.length - 1}
    OFFSET $${params.length}
  `;

  const res = await pool.query(sql, params);
  const total = res.rows[0]?.total ?? 0;
  const datasets = res.rows.map((row) => {
    const { total: _, ...rest } = row;
    return rest as Dataset;
  });
  return { datasets, total };
}

export async function updateDatasetTimezone(id: string, timezone: string, client?: PoolClient) {
  const c = client ?? (await pool.connect());
  try {
    const res = await c.query(
      `
      UPDATE datasets
      SET timezone = $2
      WHERE id = $1
      RETURNING id, symbol, timeframe, timezone, source_file AS "sourceFile",
        rows,
        EXTRACT(EPOCH FROM start_time) * 1000 AS "startTime",
        EXTRACT(EPOCH FROM end_time) * 1000 AS "endTime",
        EXTRACT(EPOCH FROM created_at) * 1000 AS "createdAt";
      `,
      [id, timezone]
    );
    return res.rows[0] as Dataset | undefined;
  } finally {
    if (!client) c.release();
  }
}

export interface BarsQuery {
  symbol: string;
  timeframe: string;
  datasetId?: string;
  from?: number;
  to?: number;
  limit?: number;
}

export async function fetchBars(params: BarsQuery) {
  const { symbol, timeframe, datasetId, from, to, limit = 500 } = params;
  const values: any[] = [];
  const where: string[] = [];

  if (datasetId) {
    values.push(datasetId);
    where.push(`dataset_id = $${values.length}`);
  }

  values.push(symbol, timeframe);
  where.push(`symbol = $${values.length - 1}`, `timeframe = $${values.length}`);

  if (from) {
    values.push(from);
    where.push(`timestamp >= to_timestamp($${values.length} / 1000.0)`);
  }
  if (to) {
    values.push(to);
    where.push(`timestamp <= to_timestamp($${values.length} / 1000.0)`);
  }
  values.push(limit);

  const sql = `
    SELECT
      symbol,
      timeframe,
      EXTRACT(EPOCH FROM timestamp) * 1000 AS "timestamp",
      open,
      high,
      low,
      close,
      volume
    FROM candles
    WHERE ${where.join(" AND ")}
    ORDER BY timestamp ASC
    LIMIT $${values.length}
  `;

  const res = await pool.query(sql, values);
  const rows = res.rows as BarEvent[];
  const seen = new Set<number>();
  const unique = [];
  for (const row of rows) {
    if (seen.has(row.timestamp)) continue;
    seen.add(row.timestamp);
    unique.push(row);
  }
  return unique;
}
