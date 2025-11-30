import type { BarEvent } from "./market";

export interface IndicatorParamSchema {
  name: string;
  type: "number" | "string";
  label: string;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  default?: number | string;
}

export interface IndicatorMeta {
  type: string;
  label: string;
  params: IndicatorParamSchema[];
  outputs: string[];
}

export interface IndicatorSpec {
  type: string;
  id?: string;
  params?: Record<string, string | number>;
}

export interface IndicatorPoint {
  timestamp: number;
  values: Record<string, number | null>;
}

export interface IndicatorResult {
  key: string;
  label: string;
  spec: IndicatorSpec;
  warmup: number;
  points: IndicatorPoint[];
}

export interface IndicatorSnapshotMessage {
  type: "INDICATOR_SNAPSHOT";
  subscriptionId: string;
  bars: BarEvent[];
  indicators: IndicatorResult[];
}

export interface IndicatorErrorMessage {
  type: "ERROR";
  error: string;
  subscriptionId?: string;
  code?: string;
}

export type IndicatorMessage = IndicatorSnapshotMessage | IndicatorErrorMessage;

export interface IndicatorSubscribePayload {
  subscriptionId?: string;
  symbol: string;
  timeframe: string;
  datasetId?: string;
  from?: number;
  to?: number;
  limit?: number;
  indicators: IndicatorSpec[];
}
