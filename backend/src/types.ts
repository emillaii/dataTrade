export type MarketEventType = "BAR" | "TICK";

export interface MarketEventBase {
  type: MarketEventType;
  symbol: string;
  timestamp: number;
}

export interface BarEvent extends MarketEventBase {
  type: "BAR";
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Dataset {
  id: string;
  symbol: string;
  timeframe: string;
  timezone?: string;
  startTime: number;
  endTime: number;
  rows: number;
  sourceFile: string;
  createdAt?: number;
}
