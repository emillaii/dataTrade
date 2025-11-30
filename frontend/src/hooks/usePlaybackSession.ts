import { useEffect, useRef, useState } from "react";
import { BarEvent, Dataset, MarketEvent, IndicatorResult } from "../types/market";
import type { IndicatorSpec } from "../types/indicator";

export type PlaybackStatus = "idle" | "connecting" | "playing" | "paused" | "error" | "disconnected";
type StreamTransport = "playback" | "candles";
type PlaybackMode = "ws" | "local";

interface PlaybackState {
  status: PlaybackStatus;
  speed: number;
  cursor?: number;
  error?: string | null;
  mode: PlaybackMode;
  transport: StreamTransport;
  loadedBars: number;
  indicators?: IndicatorResult[];
}

interface PlaybackSessionResult extends PlaybackState {
  bars: BarEvent[];
  events: MarketEvent[];
  indicators?: IndicatorResult[];
  play: () => void;
  pause: () => void;
  setSpeed: (speed: number) => void;
  seek: (timestamp: number) => void;
  step: (direction: "forward" | "backward", size?: number) => void;
}

const buildWsConfig = (
  dataset: Dataset,
  speed: number,
  indicators: IndicatorSpec[] = []
): { url: string; transport: StreamTransport } => {
  const streamBase = import.meta.env.VITE_DATA_STREAM_WS_URL as string | undefined;
  if (streamBase) {
    const sanitized = streamBase.replace(/\/+$/, "");
    const withPath = /\/ws(\/|$)/i.test(sanitized) ? sanitized : `${sanitized}/ws/candles`;
    const wsBase = withPath.startsWith("ws") ? withPath : withPath.replace(/^http/, "ws");
    const params = new URLSearchParams({
      symbol: dataset.symbol,
      timeframe: dataset.timeframe,
      datasetId: dataset.id,
      batch: "1000",
      speed: String(speed || 1)
    });
    if (indicators.length > 0) {
      params.set("indicators", JSON.stringify(indicators));
    }
    if (Number.isFinite(dataset.startTime)) {
      params.set("after", String(Math.max(Number(dataset.startTime) - 1, 0)));
    }
    return {
      url: `${wsBase}?${params.toString()}`,
      transport: "candles"
    };
  }

  const explicit = import.meta.env.VITE_API_WS_URL as string | undefined;
  if (explicit) {
    const trimmed = explicit.replace(/\/+$/, "");
    // If caller already provided a full ws path, use as-is; otherwise append playback path.
    const url = /\/ws(\/|$)/i.test(new URL(trimmed, "http://placeholder").pathname)
      ? trimmed
      : `${trimmed}/ws/playback`;
    return { url, transport: "playback" };
  }

  const apiBase = import.meta.env.VITE_API_URL as string | undefined;
  if (apiBase) {
    const sanitized = apiBase.replace(/\/+$/, "");
    return { url: sanitized.replace(/^http/, "ws") + "/ws/playback", transport: "playback" };
  }

  const origin = window.location.origin.replace(/^http/, "ws");
  return { url: `${origin}/ws/playback`, transport: "playback" };
};

export function usePlaybackSession(dataset: Dataset, indicatorSpecs: IndicatorSpec[] = []): PlaybackSessionResult {
  const normalizeTimestamp = (value: any) => {
    const toMs = (n: number) => (n < 1e12 ? n * 1000 : n); // accept seconds or ms
    if (typeof value === "number" && Number.isFinite(value)) return toMs(value);
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return parsed;
      const asNum = Number(value);
      if (!Number.isNaN(asNum)) return toMs(asNum);
    }
    return null;
  };

  const socketRef = useRef<WebSocket | null>(null);
  const transportRef = useRef<StreamTransport>("playback");
  const pausedRef = useRef<boolean>(false);
  const bufferedBarsRef = useRef<BarEvent[]>([]);
  const flushBufferedBarsRef = useRef<() => void>(() => {});
  const [bars, setBars] = useState<BarEvent[]>([]);
  const [events, setEvents] = useState<MarketEvent[]>([]);
  const receivedCountRef = useRef<number>(0);
  const [state, setState] = useState<PlaybackState>({
    status: "idle",
    speed: 1,
    cursor: dataset.startTime,
    error: null,
    mode: "ws",
    transport: "playback",
    loadedBars: 0
  });

  const stopLocalTimer = () => {};

  // Note: removed REST preload/local fallback. Visualization now relies solely on websocket playback stream.

  useEffect(() => {
    setBars([]);
    setEvents([]);
    receivedCountRef.current = 0;
    bufferedBarsRef.current = [];
    pausedRef.current = false;
    const { url: wsUrl, transport } = buildWsConfig(dataset, state.speed, indicatorSpecs);
    transportRef.current = transport;
    setState((prev) => ({
      ...prev,
      status: "connecting",
      cursor: dataset.startTime,
      error: null,
      mode: "ws",
      transport,
      loadedBars: 0,
      indicators: []
    }));
    stopLocalTimer();

    console.debug("[playback] connecting ws", wsUrl, "transport", transport, "indicators", indicatorSpecs);
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    const pushBars = (incoming: BarEvent[]) => {
      setBars((prev) => {
        const merged = [...prev, ...incoming];
        const map = new Map<number, BarEvent>();
        merged.forEach((bar) => {
          map.set(bar.timestamp, bar);
        });
        return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
      });
    };

    const pushIndicatorValues = (timestamp: number, indicatorValues: Record<string, any> | undefined) => {
      if (!indicatorSpecs.length || !indicatorValues) return;
      setState((prev) => {
        const nextIndicators = indicatorSpecs.map((spec) => {
          const id = spec.id ?? spec.type;
          const prevResult =
            prev.indicators?.find((r) => r.spec.id === id || r.key === id) ??
            prev.indicators?.find((r) => r.spec.type === spec.type);
          const points = prevResult ? [...prevResult.points] : [];
          const rawValue = (indicatorValues as any)[id] ?? (indicatorValues as any)[spec.type];
          const value =
            rawValue === undefined || rawValue === null || Number.isNaN(Number(rawValue))
              ? null
              : Number(rawValue);
          points.push({ timestamp, values: { value } });
          const period = Number((spec.params as any)?.period ?? 0);
          return {
            key: prevResult?.key ?? id,
            label: prevResult?.label ?? spec.type.toUpperCase(),
            spec,
            warmup: Math.max(0, Math.floor(period) - 1),
            points: points.slice(-5000)
          };
        });
        return { ...prev, indicators: nextIndicators };
      });
    };

    const flushBufferedBars = () => {
      if (!bufferedBarsRef.current.length) return;
      pushBars(bufferedBarsRef.current);
      const last = bufferedBarsRef.current[bufferedBarsRef.current.length - 1];
      bufferedBarsRef.current = [];
      if (last) {
        setState((prev) => ({
          ...prev,
          cursor: last.timestamp,
          loadedBars: Math.max(prev.loadedBars, receivedCountRef.current)
        }));
      }
    };
    flushBufferedBarsRef.current = flushBufferedBars;

    const sendInit = () => {
      const payload = {
        type: "INIT",
        payload: {
          symbol: dataset.symbol,
          timeframe: dataset.timeframe,
          datasetId: dataset.id,
          from: dataset.startTime,
          to: dataset.endTime,
          speed: state.speed,
          indicators: indicatorSpecs
        }
      };
      socket.send(JSON.stringify(payload));
    };

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        if (transport === "candles") {
          const raw = (data?.type === "CANDLE" ? data.payload : data) as Partial<BarEvent> & { dataset_id?: string };
          if (!raw) return;
          const ts = normalizeTimestamp((raw as any).timestamp) ?? dataset.startTime ?? Date.now();
          const bar: BarEvent = {
            type: "BAR",
            symbol: raw.symbol ?? dataset.symbol,
            timeframe: raw.timeframe ?? dataset.timeframe,
            timestamp: ts,
            open: Number(raw.open ?? 0),
            high: Number(raw.high ?? 0),
            low: Number(raw.low ?? 0),
            close: Number(raw.close ?? 0),
            volume: Number((raw as any).volume ?? 0)
          };
          pushIndicatorValues(ts, (raw as any).indicators);
          receivedCountRef.current += 1;
          const marketEvent: MarketEvent = { ...bar };
          setEvents((prev) => [...prev.slice(-199), marketEvent]);
          if (pausedRef.current) {
            bufferedBarsRef.current.push(bar);
          } else {
            pushBars([bar]);
            setState((prev) => ({
              ...prev,
              cursor: ts,
              loadedBars: Math.max(prev.loadedBars, receivedCountRef.current),
              status: prev.status === "connecting" ? "playing" : prev.status
            }));
          }
          return;
        }

        // Debug: log incoming session state with indicators
        if (data?.type === "SESSION_STATE" && data?.indicators) {
          console.debug("[playback] received indicators", data.indicators.map((i: any) => ({ key: i.key, points: i.points?.length })));
        }
        if (data.type === "BAR" || data.type === "TICK") {
          const marketEvent = data as MarketEvent;
          const ts = normalizeTimestamp(marketEvent.timestamp) ?? dataset.startTime ?? Date.now();
          const normalizedEvent = { ...marketEvent, timestamp: ts } as MarketEvent;
          setEvents((prev) => [...prev.slice(-199), normalizedEvent]);
          if (normalizedEvent.type === "BAR") {
            receivedCountRef.current += 1;
            setBars((prev) => [...prev.slice(-499), normalizedEvent]);
            setState((prev) => ({
              ...prev,
              cursor: ts,
              loadedBars: Math.max(prev.loadedBars, receivedCountRef.current)
            }));
          } else {
            setState((prev) => ({ ...prev, cursor: ts }));
          }
          return;
        }

        if (data.type === "SESSION_STATE") {
          setState((prev) => ({
            ...prev,
            status: data.state ?? prev.status,
            speed: data.speed ?? prev.speed,
            cursor: data.cursor ?? prev.cursor,
            indicators: data.indicators ?? prev.indicators
          }));
          return;
        }
      } catch (err) {
        setState((prev) => ({ ...prev, error: (err as Error).message, status: "error" }));
      }
    };

    socket.addEventListener("open", () => {
      if (transport === "candles") {
        setState((prev) => ({ ...prev, status: "playing", cursor: dataset.startTime }));
        return;
      }
      setState((prev) => ({ ...prev, status: "paused", cursor: dataset.startTime }));
      sendInit();
    });
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("error", () => {
      setState((prev) => ({
        ...prev,
        status: "error",
        mode: "ws",
        error: "Playback websocket unavailable. Check API WS URL."
      }));
    });
    socket.addEventListener("close", () => {
      setState((prev) => ({ ...prev, status: "disconnected" }));
    });

    return () => {
      socket.removeEventListener("message", handleMessage);
      socket.close();
      stopLocalTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset.id, dataset.symbol, dataset.timeframe, dataset.startTime, dataset.endTime, JSON.stringify(indicatorSpecs)]);

  const sendMessage = (message: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  };

  const play = () => {
    if (transportRef.current === "candles") {
      pausedRef.current = false;
      sendMessage({ type: "PLAY" });
      setState((prev) => ({ ...prev, status: "playing" }));
      flushBufferedBarsRef.current();
      return;
    }
    if (sendMessage({ type: "PLAY" })) {
      setState((prev) => ({ ...prev, status: "playing" }));
    }
  };

  const pause = () => {
    if (transportRef.current === "candles") {
      pausedRef.current = true;
      sendMessage({ type: "PAUSE" });
      setState((prev) => ({ ...prev, status: "paused" }));
      return;
    }
    if (sendMessage({ type: "PAUSE" })) {
      setState((prev) => ({ ...prev, status: "paused" }));
    }
  };

  const setSpeed = (speed: number) => {
    setState((prev) => ({ ...prev, speed }));
    sendMessage({ type: "SET_SPEED", speed });
  };

  const seek = (timestamp: number) => {
    setState((prev) => ({ ...prev, cursor: timestamp }));
    if (transportRef.current === "playback") {
      sendMessage({ type: "SEEK", timestamp });
    }
  };

  const step = (direction: "forward" | "backward", size = 1) => {
    if (transportRef.current === "playback") {
      sendMessage({ type: "STEP", direction, size });
    }
  };

  return {
    bars,
    events,
    indicators: state.indicators,
    status: state.status,
    speed: state.speed,
    cursor: state.cursor,
    error: state.error,
    loadedBars: state.loadedBars,
    play,
    pause,
    setSpeed,
    seek,
    step
  };
}
