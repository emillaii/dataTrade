const registry = new Map();
export const registerIndicator = (plugin) => {
    registry.set(plugin.type, plugin);
};
export const getIndicatorMeta = () => {
    return Array.from(registry.values()).map(({ type, label, params, outputs }) => ({
        type,
        label,
        params,
        outputs
    }));
};
const toRecord = (value) => {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "number")
        return { value };
    return value;
};
const applyDefaults = (params, schema) => {
    const next = { ...params };
    for (const param of schema) {
        if (next[param.name] === undefined && param.default !== undefined) {
            next[param.name] = param.default;
        }
    }
    return next;
};
export function computeIndicatorSeries(bars, spec) {
    const plugin = registry.get(spec.type);
    if (!plugin) {
        throw new Error(`Unknown indicator type: ${spec.type}`);
    }
    const params = applyDefaults(spec.params ?? {}, plugin.params);
    plugin.validate?.(params);
    const instance = plugin.create(params);
    const key = spec.id ??
        `${spec.type}-${Object.entries(params)
            .map(([k, v]) => `${k}:${v}`)
            .join("|") || "default"}`;
    const points = [];
    for (const bar of bars) {
        const updateResult = instance.update(bar);
        const values = toRecord(updateResult);
        const resolved = {};
        if (values) {
            for (const out of plugin.outputs) {
                resolved[out] = values[out] ?? null;
            }
        }
        else {
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
class SimpleMovingAverage {
    period;
    window = [];
    sum = 0;
    warmup;
    constructor(period) {
        this.period = Math.max(1, Math.floor(period));
        this.warmup = Math.max(0, this.period - 1);
    }
    update(bar) {
        const close = bar.close;
        this.window.push(close);
        this.sum += close;
        if (this.window.length > this.period) {
            const dropped = this.window.shift();
            if (typeof dropped === "number") {
                this.sum -= dropped;
            }
        }
        if (this.window.length < this.period)
            return null;
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
