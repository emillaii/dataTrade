import type { BarEvent } from "./types.js";

export type IndicatorParams = Record<string, string | number>;

export interface IndicatorSpec {
  type: string;
  id?: string;
  params?: IndicatorParams;
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

interface IndicatorInstance {
  warmup: number;
  update: (bar: BarEvent) => Record<string, number> | number | null;
}

interface IndicatorPlugin extends IndicatorMeta {
  create: (params: IndicatorParams) => IndicatorInstance;
  validate?: (params: IndicatorParams) => void;
}

const registry = new Map<string, IndicatorPlugin>();

export const registerIndicator = (plugin: IndicatorPlugin) => {
  registry.set(plugin.type, plugin);
};

export const getIndicatorMeta = (): IndicatorMeta[] => {
  return Array.from(registry.values()).map(({ type, label, params, outputs }) => ({
    type,
    label,
    params,
    outputs
  }));
};

const toRecord = (value: Record<string, number> | number | null) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return { value };
  return value;
};

const applyDefaults = (params: IndicatorParams, schema: IndicatorParamSchema[]) => {
  const next: IndicatorParams = { ...params };
  for (const param of schema) {
    if (next[param.name] === undefined && param.default !== undefined) {
      next[param.name] = param.default;
    }
  }
  return next;
};

export function computeIndicatorSeries(bars: BarEvent[], spec: IndicatorSpec): IndicatorResult {
  const plugin = registry.get(spec.type);
  if (!plugin) {
    throw new Error(`Unknown indicator type: ${spec.type}`);
  }
  const params = applyDefaults(spec.params ?? {}, plugin.params);
  plugin.validate?.(params);

  const instance = plugin.create(params);
  const key =
    spec.id ??
    `${spec.type}-${Object.entries(params)
      .map(([k, v]) => `${k}:${v}`)
      .join("|") || "default"}`;

  const points: IndicatorPoint[] = [];
  for (const bar of bars) {
    const updateResult = instance.update(bar);
    const values = toRecord(updateResult);
    const resolved: Record<string, number | null> = {};

    if (values) {
      for (const out of plugin.outputs) {
        resolved[out] = values[out] ?? null;
      }
    } else {
      for (const out of plugin.outputs) {
        resolved[out] = null;
      }
    }

    points.push({ timestamp: bar.timestamp, values: resolved });
  }

  return {
    key,
    label: plugin.label,
    spec: { ...spec, params },
    warmup: instance.warmup,
    points
  };
}

class SimpleMovingAverage implements IndicatorInstance {
  private readonly period: number;
  private readonly window: number[] = [];
  private sum = 0;
  public warmup: number;

  constructor(period: number) {
    this.period = Math.max(1, Math.floor(period));
    this.warmup = Math.max(0, this.period - 1);
  }

  update(bar: BarEvent) {
    const close = bar.close;
    this.window.push(close);
    this.sum += close;
    if (this.window.length > this.period) {
      const dropped = this.window.shift();
      if (typeof dropped === "number") {
        this.sum -= dropped;
      }
    }
    if (this.window.length < this.period) return null;
    return { value: this.sum / this.window.length };
  }
}

registerIndicator({
  type: "sma",
  label: "Simple Moving Average",
  params: [
    {
      name: "period",
      type: "number",
      label: "Period",
      description: "Number of bars to average",
      min: 1,
      max: 5000,
      step: 1,
      default: 20
    }
  ],
  outputs: ["value"],
  validate: (params) => {
    const period = Number(params.period ?? 0);
    if (!Number.isFinite(period) || period < 1) {
      throw new Error("SMA period must be a positive number");
    }
  },
  create: (params) => {
    const period = Number(params.period ?? 20);
    return new SimpleMovingAverage(period);
  }
});
