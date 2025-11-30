import { useEffect, useMemo, useState } from "react";
import { Activity, PlugZap, RefreshCcw, Signal } from "lucide-react";
import { Dataset } from "../types/market";
import type { IndicatorMeta } from "../types/indicator";
import { useIndicatorSubscription } from "../hooks/useIndicatorSubscription";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "./ui/table";

const formatTimestamp = (value?: number | null) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 19);
};

const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "";

export function IndicatorLab() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [indicatorCatalog, setIndicatorCatalog] = useState<IndicatorMeta[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [indicatorType, setIndicatorType] = useState<string>("sma");
  const [limit, setLimit] = useState<number>(750);
  const [params, setParams] = useState<Record<string, number | string>>({ period: 20 });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const { status, error: wsError, snapshot, subscribe, disconnect } = useIndicatorSubscription();

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [metaRes, datasetRes] = await Promise.all([
          fetch(`${apiBase}/api/indicators/meta`, { signal: controller.signal }),
          fetch(`${apiBase}/api/datasets?limit=200`, { signal: controller.signal })
        ]);
        if (!metaRes.ok) throw new Error("Failed to load indicator catalog");
        if (!datasetRes.ok) throw new Error("Failed to load datasets");
        const metaPayload = await metaRes.json();
        const datasetsPayload = await datasetRes.json();
        const loadedIndicators: IndicatorMeta[] = metaPayload?.indicators ?? [];
        const loadedDatasets: Dataset[] = datasetsPayload?.datasets ?? [];
        setIndicatorCatalog(loadedIndicators);
        setDatasets(loadedDatasets);
        if (!selectedDatasetId && loadedDatasets.length) {
          setSelectedDatasetId(loadedDatasets[0].id);
        }
        if (loadedIndicators.length && !indicatorType) {
          setIndicatorType(loadedIndicators[0].type);
        }
      } catch (err) {
        if ((err as any)?.name === "AbortError") return;
        setLoadError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };
    load();
    return () => controller.abort();
  }, []);

  const selectedDataset = useMemo(
    () => datasets.find((d) => d.id === selectedDatasetId) ?? datasets[0],
    [datasets, selectedDatasetId]
  );

  const selectedMeta = useMemo(
    () => indicatorCatalog.find((ind) => ind.type === indicatorType),
    [indicatorCatalog, indicatorType]
  );

  useEffect(() => {
    if (!selectedMeta) return;
    setParams((prev) => {
      const next: Record<string, number | string> = { ...prev };
      for (const param of selectedMeta.params) {
        if (next[param.name] === undefined && param.default !== undefined) {
          next[param.name] = param.default;
        }
      }
      return next;
    });
  }, [selectedMeta]);

  const barMap = useMemo(() => {
    const map = new Map<number, { close: number; open: number; high: number; low: number }>();
    snapshot?.bars?.forEach((bar) => {
      map.set(bar.timestamp, {
        close: bar.close,
        open: bar.open,
        high: bar.high,
        low: bar.low
      });
    });
    return map;
  }, [snapshot]);

  const primaryIndicator = snapshot?.indicators?.[0];
  const latestValue =
    primaryIndicator?.points
      ?.filter((p) => p.values.value !== null)
      ?.slice(-1)[0]?.values.value ?? null;
  const latestTimestamp =
    primaryIndicator?.points?.slice(-1)[0]?.timestamp ?? snapshot?.bars?.slice(-1)[0]?.timestamp ?? null;

  const previewRows = useMemo(() => {
    if (!primaryIndicator) return [];
    const points = primaryIndicator.points.slice(-30);
    return points.map((p) => {
      const bar = barMap.get(p.timestamp);
      return {
        timestamp: p.timestamp,
        close: bar?.close ?? null,
        indicator: p.values.value
      };
    });
  }, [barMap, primaryIndicator]);

  const handleSubscribe = () => {
    if (!selectedDataset) {
      setLoadError("Select a dataset to subscribe");
      return;
    }
    subscribe({
      symbol: selectedDataset.symbol,
      timeframe: selectedDataset.timeframe,
      datasetId: selectedDataset.id,
      from: selectedDataset.startTime,
      to: selectedDataset.endTime,
      limit,
      indicators: [
        {
          type: indicatorType || "sma",
          params
        }
      ]
    });
  };

  const protocolPreview = useMemo(() => {
    if (!selectedDataset) return "";
    const payload = {
      type: "SUBSCRIBE",
      payload: {
        symbol: selectedDataset.symbol,
        timeframe: selectedDataset.timeframe,
        datasetId: selectedDataset.id,
        from: selectedDataset.startTime,
        to: selectedDataset.endTime,
        limit,
        indicators: [
          {
            type: indicatorType || "sma",
            params
          }
        ]
      }
    };
    return JSON.stringify(payload, null, 2);
  }, [indicatorType, limit, params, selectedDataset]);

  return (
    <div className="flex-1 p-6 space-y-6 overflow-auto">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl text-[var(--text-primary)]">Indicator Lab</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Spin up indicator plugins (starting with SMA) and stream them to the chart via the new subscription API.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4">
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4 shadow-lg space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <PlugZap className="w-5 h-5 text-[var(--accent-primary)]" />
              <div>
                <p className="text-[var(--text-primary)] font-medium">Subscription builder</p>
                <p className="text-xs text-[var(--text-muted)]">Pick dataset, indicator, and params</p>
              </div>
            </div>
            {status === "ready" ? (
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                Live
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-300 border-amber-500/30">
                {status === "connecting" ? "Connecting" : "Idle"}
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-sm text-[var(--text-secondary)]">Dataset</p>
              <Select
                value={selectedDataset?.id ?? ""}
                onValueChange={(val) => setSelectedDatasetId(val)}
              >
                <SelectTrigger className="bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]">
                  <SelectValue placeholder="Choose dataset" />
                </SelectTrigger>
                <SelectContent>
                  {datasets.map((ds) => (
                    <SelectItem key={ds.id} value={ds.id}>
                      {ds.symbol} · {ds.timeframe} · {ds.rows} rows
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-[var(--text-secondary)]">Indicator</p>
              <Select value={indicatorType} onValueChange={(val) => setIndicatorType(val)}>
                <SelectTrigger className="bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]">
                  <SelectValue placeholder="Choose indicator" />
                </SelectTrigger>
                <SelectContent>
                  {indicatorCatalog.map((ind) => (
                    <SelectItem key={ind.type} value={ind.type}>
                      {ind.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedMeta && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {selectedMeta.params.map((param) => (
                <div key={param.name} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-[var(--text-secondary)]">{param.label}</p>
                    {param.description && (
                      <span className="text-[11px] text-[var(--text-muted)]">{param.description}</span>
                    )}
                  </div>
                  <Input
                    type="number"
                    value={params[param.name] ?? param.default ?? ""}
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setParams((prev) => ({ ...prev, [param.name]: next }));
                    }}
                    className="bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]"
                  />
                </div>
              ))}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-[var(--text-secondary)]">Max bars</p>
                  <span className="text-[11px] text-[var(--text-muted)]">Caps the backfill</span>
                </div>
                <Input
                  type="number"
                  value={limit}
                  min={50}
                  max={5000}
                  step={50}
                  onChange={(e) => setLimit(Number(e.target.value) || 0)}
                  className="bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]"
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={handleSubscribe} disabled={loading || !selectedDataset}>
              <Signal className="w-4 h-4 mr-2" />
              Subscribe
            </Button>
            <Button variant="outline" onClick={disconnect}>
              <RefreshCcw className="w-4 h-4 mr-2" />
              Disconnect
            </Button>
            {loadError && <span className="text-sm text-red-400">{loadError}</span>}
            {wsError && <span className="text-sm text-red-400">{wsError}</span>}
          </div>
        </div>

        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4 shadow-lg space-y-3">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-[var(--accent-primary)]" />
            <div>
              <p className="text-[var(--text-primary)] font-medium">Live signal</p>
              <p className="text-xs text-[var(--text-muted)]">Latest emitted value</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
              <p className="text-xs text-[var(--text-muted)]">Latest {primaryIndicator?.label ?? "Indicator"}</p>
              <p className="text-2xl text-[var(--text-primary)] font-semibold">
                {latestValue !== null ? latestValue.toFixed(5) : "—"}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
              <p className="text-xs text-[var(--text-muted)]">As of</p>
              <p className="text-sm text-[var(--text-primary)]">{formatTimestamp(latestTimestamp)}</p>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
            <p className="text-xs text-[var(--text-muted)] mb-1">Status</p>
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  status === "ready"
                    ? "bg-emerald-400"
                    : status === "connecting"
                      ? "bg-amber-300"
                      : "bg-[var(--text-muted)]"
                }`}
              />
              <span className="text-sm text-[var(--text-primary)] capitalize">{status}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[var(--text-primary)] font-medium">Streamed points</p>
              <p className="text-xs text-[var(--text-muted)]">Backfill preview (last 30 rows)</p>
            </div>
            <Badge variant="secondary">{previewRows.length} rows</Badge>
          </div>
          <Table className="text-[var(--text-primary)]">
            <TableCaption className="text-[var(--text-muted)]">
              Values are computed server-side via /ws/indicators subscription.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[var(--text-primary)]">Timestamp</TableHead>
                <TableHead className="text-right text-[var(--text-primary)]">Close</TableHead>
                <TableHead className="text-right text-[var(--text-primary)]">{primaryIndicator?.label ?? "Indicator"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.map((row) => (
                <TableRow key={row.timestamp} className="text-[var(--text-primary)]">
                  <TableCell className="font-mono text-xs text-[var(--text-primary)]">{formatTimestamp(row.timestamp)}</TableCell>
                  <TableCell className="text-right text-sm text-[var(--text-primary)]">
                    {row.close !== null ? row.close.toFixed(5) : "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm text-[var(--text-primary)]">
                    {row.indicator !== null ? row.indicator.toFixed(5) : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {!previewRows.length && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-[var(--text-muted)]">
                    Subscribe to see indicator values
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4 shadow-lg space-y-3">
          <div className="flex items-center gap-3">
            <Signal className="w-5 h-5 text-[var(--accent-primary)]" />
            <div>
              <p className="text-[var(--text-primary)] font-medium">Protocol preview</p>
              <p className="text-xs text-[var(--text-muted)]">Copy/paste for SDK clients</p>
            </div>
          </div>
          <pre className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg p-3 text-xs text-[var(--text-primary)] overflow-x-auto">
            {protocolPreview}
          </pre>
          <p className="text-xs text-[var(--text-muted)]">
            The same payload works over REST at <code className="font-mono">POST /api/indicators/compute</code>; swap
            <code className="font-mono px-1">type: "SUBSCRIBE"</code> with a direct JSON body.
          </p>
        </div>
      </div>
    </div>
  );
}
