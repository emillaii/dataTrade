import { useEffect, useMemo, useState } from "react";
import { Navigation } from "./Navigation";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Slider } from "./ui/slider";
import { Badge } from "./ui/badge";
import { Play, Pause, SkipBack, SkipForward, TrendingUp, TrendingDown, ArrowLeft } from "lucide-react";
import { Dataset, BarEvent, MarketEvent } from "../types/market";
import { usePlaybackSession } from "../hooks/usePlaybackSession";

interface CandleData {
  time: string;
  date: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface PlaybackChartProps {
  dataset: Dataset;
  onBack: () => void;
}

const toMs = (n: number) => (n < 1e12 ? n * 1000 : n);
const normalizeTimestamp = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return toMs(value);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
    const asNum = Number(value);
    if (!Number.isNaN(asNum)) return toMs(asNum);
  }
  return null;
};

const isValidTimestamp = (value: unknown): value is number =>
  normalizeTimestamp(value) !== null;

const parseTimezoneOffsetMinutes = (tz?: string) => {
  if (!tz) return 0;
  const match = /^(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(tz.trim());
  if (!match) return 0;
  const [, sign, hh, mm] = match;
  const minutes = Number(hh) * 60 + Number(mm || 0);
  return sign === "-" ? -minutes : minutes;
};

const formatTimestamp = (value?: number | null, offsetMs = 0, tzLabel = "UTC") => {
  if (!isValidTimestamp(value)) return "—";
  const d = new Date(value + offsetMs);
  if (Number.isNaN(d.getTime())) return "—";
  const iso = d.toISOString().replace("T", " ").slice(0, 16);
  return `${iso} ${tzLabel}`;
};

const formatDateTimeParts = (value: number, offsetMs: number) => {
  const d = new Date(value + offsetMs);
  if (Number.isNaN(d.getTime())) return { date: "—", time: "—" };
  const iso = d.toISOString();
  return {
    date: iso.slice(0, 10),
    time: iso.slice(11, 16)
  };
};

const describeEvent = (event: MarketEvent) => {
  if (event.type === "BAR") {
    return `${event.symbol} ${event.timeframe} O:${event.open.toFixed(5)} H:${event.high.toFixed(5)} L:${event.low.toFixed(5)} C:${event.close.toFixed(5)}`;
  }
  return `${event.symbol} bid:${event.bid.toFixed(5)} ask:${event.ask.toFixed(5)}`;
};

const normalizeBar = (bar: BarEvent): BarEvent => ({
  ...bar,
  timestamp: typeof bar.timestamp === "string" ? Date.parse(bar.timestamp) : bar.timestamp
});

export function PlaybackChart({ dataset, onBack }: PlaybackChartProps) {
  const [selectedTimeframe, setSelectedTimeframe] = useState(dataset.timeframe);
  const [visibleCandles, setVisibleCandles] = useState(120);
  const [initialBars, setInitialBars] = useState<BarEvent[]>([]);
  const [barsLoading, setBarsLoading] = useState(false);
  const [barsError, setBarsError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<{ candle: CandleData; x: number; y: number } | null>(null);
  const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
  const timezoneLabel = dataset.timezone ?? "UTC";
  const timezoneOffsetMs = parseTimezoneOffsetMinutes(timezoneLabel) * 60 * 1000;
  const maxBars = Number.isFinite(dataset.rows) ? Math.max(1000, dataset.rows + 100) : 10000;

  const sessionDataset = useMemo(
    () => ({ ...dataset, timeframe: selectedTimeframe }),
    [dataset, selectedTimeframe]
  );

  const {
    bars: liveBars,
    events,
    status,
    speed,
    cursor,
    error: sessionError,
    loadedBars: sessionLoadedBars,
    play,
    pause,
    setSpeed: updateSpeed,
    seek,
    step
  } = usePlaybackSession(sessionDataset);

  useEffect(() => {
    setSelectedTimeframe(dataset.timeframe);
  }, [dataset.timeframe]);

  useEffect(() => {
    const controller = new AbortController();
    const loadBars = async () => {
      setBarsLoading(true);
      setBarsError(null);
      try {
        const chunkSize = 1000;
        const all: BarEvent[] = [];
        let from = sessionDataset.startTime;

        while (all.length < maxBars) {
          const params = new URLSearchParams({
            symbol: sessionDataset.symbol,
            timeframe: sessionDataset.timeframe,
            datasetId: sessionDataset.id,
            from: from.toString(),
            limit: chunkSize.toString()
          });
          const res = await fetch(`${apiBase}/api/bars?${params.toString()}`, { signal: controller.signal });
          if (!res.ok) throw new Error(`Failed to load bars (${res.status})`);
          const payload = await res.json();
          const bars: BarEvent[] = Array.isArray(payload) ? payload : payload.bars ?? [];
          const normalized = bars.map(normalizeBar).filter((bar) => isValidTimestamp(bar.timestamp));
          if (!normalized.length) break;
          all.push(...normalized);

          if (all.length >= totalBars) break;
          if (normalized.length < chunkSize) break;
          const lastTs = normalized[normalized.length - 1]?.timestamp;
          if (!lastTs) break;
          from = lastTs + 1; // advance to next bar
        }

        setInitialBars(all);
      } catch (err) {
        if ((err as any)?.name === "AbortError") return;
        setBarsError((err as Error).message);
      } finally {
        setBarsLoading(false);
      }
    };
    loadBars();
    return () => controller.abort();
  }, [sessionDataset, maxBars, apiBase]);

  const combinedBars = useMemo(() => {
    const map = new Map<number, BarEvent>();
    [...initialBars, ...liveBars].forEach((bar) => {
      const ts = normalizeTimestamp(bar.timestamp);
      if (ts === null || Number.isNaN(new Date(ts).getTime())) return;
      map.set(ts, { ...bar, timestamp: ts });
    });
    return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
  }, [initialBars, liveBars]);

  const candleData = useMemo<CandleData[]>(() => {
    return combinedBars.map((bar) => {
      const { date, time } = formatDateTimeParts(bar.timestamp, timezoneOffsetMs);

      return {
        time,
        date,
        timestamp: bar.timestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume
      };
    });
  }, [combinedBars]);

  const displayData = useMemo(() => {
    return candleData.slice(Math.max(0, candleData.length - visibleCandles));
  }, [candleData, visibleCandles]);

  const currentPrice = displayData[displayData.length - 1]?.close ?? 0;
  const priceChange =
    displayData.length >= 2
      ? ((displayData[displayData.length - 1].close - displayData[displayData.length - 2].close) /
          displayData[displayData.length - 2].close) *
        100
      : 0;
  const isPositive = priceChange >= 0;

  const high = displayData.length ? Math.max(...displayData.map((d) => d.high)) : 0;
  const low = displayData.length ? Math.min(...displayData.map((d) => d.low)) : 0;
  const volume = displayData.reduce((sum, d) => sum + d.volume, 0);
  const totalBars = Number.isFinite(dataset.rows) ? dataset.rows : combinedBars.length;
  const loadedBars = Math.max(sessionLoadedBars, combinedBars.length);

  const sliderMin = isValidTimestamp(sessionDataset.startTime) ? sessionDataset.startTime : 0;
  const sliderMax = isValidTimestamp(sessionDataset.endTime) ? sessionDataset.endTime : sliderMin + 1;
  const sliderValue = isValidTimestamp(cursor) ? cursor : sliderMin;
  const statusLabel =
    status === "connecting"
      ? "Connecting..."
      : status === "playing"
        ? `Playing at ${speed}x`
        : status === "paused"
          ? "Paused"
          : status === "error"
            ? "Error"
            : "Idle";
  const formattedCursor = formatTimestamp(sliderValue, timezoneOffsetMs, timezoneLabel);
  const simulatedLabel =
    status === "playing"
      ? `Simulated time: playing at ${speed}x`
      : `Simulated time: ${formattedCursor} · ${statusLabel}`;

  const CustomChart = () => {
    if (!displayData.length) {
      return (
        <div className="relative w-full h-full min-h-[500px] flex items-center justify-center text-[var(--text-muted)]">
          {barsLoading ? "Loading bars..." : "No bars loaded yet."}
        </div>
      );
    }

    const chartHeight = 400;
    const padding = { top: 20, right: 60, bottom: 40, left: 60 };
    const chartWidth = 1000;

    const priceMin = Math.min(...displayData.map((d) => d.low));
    const priceMax = Math.max(...displayData.map((d) => d.high));
    const priceRange = priceMax - priceMin || 1;
    const yScale = (price: number) => {
      return (
        padding.top +
        (1 - (price - priceMin) / priceRange) * (chartHeight - padding.top - padding.bottom)
      );
    };

    const barWidth = (chartWidth - padding.left - padding.right) / displayData.length;

    const labelInterval = Math.max(1, Math.ceil(displayData.length / 12));

    return (
      <div className="relative w-full h-full bg-[var(--bg-surface)]" style={{ minHeight: "500px" }}>
        <svg width="100%" height={chartHeight + 100} className="overflow-visible">
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
            const y = padding.top + ratio * (chartHeight - padding.top - padding.bottom);
            const price = priceMax - ratio * priceRange;
            return (
              <g key={i}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={chartWidth - padding.right}
                  y2={y}
                  stroke="var(--chart-grid)"
                  strokeWidth={1}
                />
                <text
                  x={chartWidth - padding.right + 10}
                  y={y + 4}
                  fill="var(--text-muted)"
                  fontSize="11"
                  fontFamily="monospace"
                >
                  {price.toFixed(5)}
                </text>
              </g>
            );
          })}

          {displayData.map((candle, i) => {
            const x = padding.left + i * barWidth;
            const isBullish = candle.close >= candle.open;
            const color = isBullish ? "var(--trade-bullish)" : "var(--trade-bearish)";

            const bodyTop = Math.min(yScale(candle.open), yScale(candle.close));
            const bodyHeight = Math.abs(yScale(candle.open) - yScale(candle.close));

            return (
              <g
                key={i}
                onMouseEnter={() => setHovered({ candle, x: x + barWidth / 2, y: bodyTop })}
                onMouseMove={() => setHovered({ candle, x: x + barWidth / 2, y: bodyTop })}
                onMouseLeave={() => setHovered(null)}
              >
                <line
                  x1={x + barWidth / 2}
                  y1={yScale(candle.high)}
                  x2={x + barWidth / 2}
                  y2={yScale(candle.low)}
                  stroke={color}
                  strokeWidth={1}
                />
                <rect
                  x={x + barWidth * 0.2}
                  y={bodyTop}
                  width={barWidth * 0.6}
                  height={Math.max(bodyHeight, 1)}
                  fill={color}
                />
              </g>
            );
          })}

          {displayData.map((candle, i) => {
            const x = padding.left + i * barWidth;
            const isBullish = candle.close >= candle.open;
            const color = isBullish ? "var(--trade-bullish)" : "var(--trade-bearish)";
            const maxVolume = Math.max(...displayData.map((d) => d.volume));
            const volumeHeight = maxVolume ? (candle.volume / maxVolume) * 60 : 0;

            return (
              <rect
                key={`vol-${i}`}
                x={x + barWidth * 0.2}
                y={chartHeight + 20}
                width={barWidth * 0.6}
                height={volumeHeight}
                fill={color}
                opacity={0.3}
              />
            );
          })}

          {displayData.map((candle, i) => {
            if (i % labelInterval !== 0) return null;
            const x = padding.left + i * barWidth;
            return (
              <text
                key={`time-${i}`}
                x={x}
                y={chartHeight + 95}
                fill="var(--text-muted)"
                fontSize="10"
                fontFamily="sans-serif"
              >
                {candle.time}
              </text>
            );
          })}
        </svg>
        {hovered && (
          <div
            className="absolute z-10 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-md shadow-lg p-3 text-xs font-mono text-[var(--text-primary)]"
            style={{
              left: Math.max(8, Math.min(hovered.x, chartWidth - 180)),
              top: Math.max(8, hovered.y + 20)
            }}
          >
            <div className="text-[var(--text-secondary)] mb-1">
              {hovered.candle.date} · {hovered.candle.time} {timezoneLabel}
            </div>
            <div>O: {hovered.candle.open.toFixed(5)}</div>
            <div>H: {hovered.candle.high.toFixed(5)}</div>
            <div>L: {hovered.candle.low.toFixed(5)}</div>
            <div>C: {hovered.candle.close.toFixed(5)}</div>
            <div>Vol: {hovered.candle.volume.toLocaleString()}</div>
          </div>
        )}
      </div>
    );
  };

  const handlePlayToggle = () => {
    if (status === "playing") {
      pause();
    } else {
      play();
    }
  };

  const handleSpeedChange = (value: string) => {
    const numeric = Number(value.replace("x", "")) || 1;
    updateSpeed(numeric);
  };

  const handleSeek = (value: number[]) => {
    if (!value?.length) return;
    seek(value[0]);
  };

  return (
    <div className="h-screen bg-[var(--bg-app)] flex flex-col">
      <Navigation
        title="Playback & Chart"
        breadcrumb="Playback"
        rightContent={
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-surface)] rounded-md border border-[var(--border-subtle)]">
            <span className="text-sm text-[var(--text-primary)] font-mono">{dataset.symbol}</span>
            <span className="text-[var(--text-muted)]">·</span>
            <span className="text-sm text-[var(--text-secondary)]">{selectedTimeframe}</span>
          </div>
        }
      />

      <main className="flex-1 p-6 overflow-auto space-y-4">
        {barsError && (
          <div className="bg-[var(--bg-elevated)] border border-[var(--trade-bearish)]/50 text-[var(--trade-bearish)] rounded-md px-4 py-2">
            {barsError}
          </div>
        )}
        {sessionError && (
          <div className="bg-[var(--bg-elevated)] border border-[var(--trade-bearish)]/50 text-[var(--trade-bearish)] rounded-md px-4 py-2">
            {sessionError}
          </div>
        )}

        <div className="bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-subtle)] p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={onBack}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Datasets
              </Button>
              <div className="h-6 w-px bg-[var(--border-subtle)]" />
              <div>
                <h1 className="text-[var(--text-primary)] mb-1 font-cyber">{dataset.symbol}</h1>
                <p className="text-sm text-[var(--text-secondary)] font-mono-cyber">
                  Historical playback · Simulated feed
                </p>
              </div>
            </div>

            <div className="flex items-center gap-8">
              <div className="text-center">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[var(--text-primary)]">
                    {currentPrice ? currentPrice.toFixed(5) : "—"}
                  </span>
                  <Badge
                    className={`${
                      isPositive
                        ? "bg-[var(--trade-bullish)]/20 text-[var(--trade-bullish)]"
                        : "bg-[var(--trade-bearish)]/20 text-[var(--trade-bearish)]"
                    } border-0`}
                  >
                    {isPositive ? (
                      <TrendingUp className="w-3 h-3 mr-1" />
                    ) : (
                      <TrendingDown className="w-3 h-3 mr-1" />
                    )}
                    {priceChange.toFixed(2)}%
                  </Badge>
                </div>
                <div className="flex gap-4 mt-2 text-xs">
                  <span className="text-[var(--text-muted)]">
                    H: <span className="text-[var(--text-secondary)] font-mono">{high.toFixed(5)}</span>
                  </span>
                  <span className="text-[var(--text-muted)]">
                    L: <span className="text-[var(--text-secondary)] font-mono">{low.toFixed(5)}</span>
                  </span>
                  <span className="text-[var(--text-muted)]">
                    Vol: <span className="text-[var(--text-secondary)] font-mono">{volume.toLocaleString()}</span>
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <div className="flex gap-1 p-1 bg-[var(--bg-surface)] rounded-md border border-[var(--border-subtle)]">
                  {["M1", "M5", "M15", "H1", "D1"].map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setSelectedTimeframe(tf)}
                      className={`px-3 py-1 text-xs rounded transition-colors ${
                        selectedTimeframe === tf
                          ? "bg-[var(--accent-primary)] text-white"
                          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-[var(--border-subtle)] text-[var(--text-secondary)]"
                >
                  Indicators
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)] shadow-lg p-4">
          <CustomChart />
        </div>

        <div className="bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-subtle)] p-4">
          <div className="flex items-center justify-between gap-8">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="w-9 h-9 p-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                onClick={() => step("backward", 1)}
              >
                <SkipBack className="w-5 h-5" />
              </Button>
              <Button
                size="sm"
                className={`w-9 h-9 p-0 ${
                  status === "playing"
                    ? "bg-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/90"
                    : "bg-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/90"
                } text-white`}
                onClick={handlePlayToggle}
                disabled={status === "connecting" || status === "error"}
              >
                {status === "playing" ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="w-9 h-9 p-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                onClick={() => step("forward", 1)}
              >
                <SkipForward className="w-5 h-5" />
              </Button>
            </div>

              <div className="flex items-center gap-4">
                <span className="text-sm text-[var(--text-secondary)]">Speed</span>
                <div className="flex gap-1 p-1 bg-[var(--bg-surface)] rounded-md border border-[var(--border-subtle)]">
                  {["1x", "2x", "5x", "10x", "20x", "40x", "80x", "100x"].map((s) => (
                    <button
                      key={s}
                      onClick={() => handleSpeedChange(s)}
                      className={`px-3 py-1 text-xs rounded transition-colors ${
                        `${speed}x` === s
                        ? "bg-[var(--bg-app)] text-[var(--accent-primary)] border border-[var(--accent-primary)]"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-4">
              <span className="text-sm text-[var(--text-secondary)]">Visible bars</span>
              <Select
                value={visibleCandles.toString()}
                onValueChange={(value) => setVisibleCandles(Number(value))}
              >
                <SelectTrigger className="w-28 h-8 bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="60">60</SelectItem>
                  <SelectItem value="120">120</SelectItem>
                  <SelectItem value="240">240</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 max-w-2xl">
              <Slider
                value={[sliderValue]}
                onValueChange={handleSeek}
                min={sliderMin}
                max={sliderMax}
                step={60000}
                className="w-full"
              />
              <p
                className="text-xs text-[var(--text-muted)] mt-1 text-center font-mono"
                style={{ minWidth: "240px", margin: "0 auto", fontVariantNumeric: "tabular-nums" }}
              >
                {simulatedLabel}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)] p-4">
            <h3 className="text-[var(--text-primary)] mb-4 font-cyber text-sm glow-primary">EVENT STREAM</h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {events.length === 0 && (
                <p className="text-[var(--text-muted)] text-sm">Waiting for stream events...</p>
              )}
              {events
                .slice()
                .reverse()
                .map((event, i) => (
                  <div key={`${event.timestamp}-${i}`} className="text-sm">
                    <span className="text-[var(--text-secondary)] font-mono">
                      {formatTimestamp(event.timestamp, timezoneOffsetMs, timezoneLabel)}
                    </span>
                    <span className="text-[var(--text-muted)] mx-2">—</span>
                    <span className="text-[var(--text-primary)]">{describeEvent(event)}</span>
                  </div>
                ))}
            </div>
          </div>

          <div className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)] p-4">
            <h3 className="text-[var(--text-primary)] mb-4 font-cyber text-sm glow-primary">SESSION DETAILS</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Symbol:</span>
                <span className="text-[var(--text-primary)] font-mono">{dataset.symbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Timeframe:</span>
                <span className="text-[var(--text-primary)]">{selectedTimeframe}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">From:</span>
                <span className="text-[var(--text-secondary)] font-mono">{formatTimestamp(dataset.startTime)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">To:</span>
                <span className="text-[var(--text-secondary)] font-mono">{formatTimestamp(dataset.endTime)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Total bars:</span>
                <span className="text-[var(--text-primary)] font-mono">
                  {totalBars.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Loaded bars:</span>
                <span className="text-[var(--text-secondary)] font-mono">
                  {loadedBars.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-[var(--border-subtle)]">
                <span className="text-[var(--text-muted)]">Status:</span>
                <span className="text-[var(--accent-secondary)]">{statusLabel}</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
