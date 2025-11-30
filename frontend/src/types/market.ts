export type MarketEventType = "BAR" | "TICK";

export interface MarketEventBase {
  type: MarketEventType;
  symbol: string;
  timestamp: number; // epoch ms UTC
}

export interface BarEvent extends MarketEventBase {
  type: "BAR";
  timeframe: string; // e.g. M15
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TickEvent extends MarketEventBase {
  type: "TICK";
  bid: number;
  ask: number;
  bidVolume?: number;
  askVolume?: number;
}

export type MarketEvent = BarEvent | TickEvent;

export interface Dataset {
  id: string;
  symbol: string;
  timeframe: string;
  timezone?: string;
  startTime: number; // epoch ms UTC
  endTime: number; // epoch ms UTC
  rows: number;
  sourceFile: string;
  createdAt?: number;
}

export interface IndicatorPoint {
  timestamp: number;
  values: Record<string, number | null>;
}

export interface IndicatorResult {
  key: string;
  label: string;
  warmup: number;
  spec: { type: string; id?: string; params?: Record<string, string | number> };
  points: IndicatorPoint[];
}

export interface DatasetQuery {
  symbol?: string;
  timeframe?: string;
  start?: number;
  end?: number;
  limit?: number;
  offset?: number;
}
