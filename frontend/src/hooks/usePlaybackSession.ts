import { useEffect, useRef, useState } from "react";
import { BarEvent, Dataset, MarketEvent } from "../types/market";

export type PlaybackStatus = "idle" | "connecting" | "playing" | "paused" | "error" | "disconnected";
type PlaybackMode = "ws" | "local";

interface PlaybackState {
  status: PlaybackStatus;
  speed: number;
  cursor?: number;
  error?: string | null;
  mode: PlaybackMode;
  loadedBars: number;
}

interface PlaybackSessionResult extends PlaybackState {
  bars: BarEvent[];
  events: MarketEvent[];
  play: () => void;
  pause: () => void;
  setSpeed: (speed: number) => void;
  seek: (timestamp: number) => void;
  step: (direction: "forward" | "backward", size?: number) => void;
}

const buildWsUrl = () => {
  const envUrl = import.meta.env.VITE_API_WS_URL as string | undefined;
  if (envUrl) return envUrl;

  const apiBase = import.meta.env.VITE_API_URL as string | undefined;
  if (apiBase) {
    const sanitized = apiBase.replace(/\/+$/, "");
    return sanitized.replace(/^http/, "ws") + "/ws/playback";
  }

  const origin = window.location.origin.replace(/^http/, "ws");
  return `${origin}/ws/playback`;
};

export function usePlaybackSession(dataset: Dataset): PlaybackSessionResult {
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
  const [bars, setBars] = useState<BarEvent[]>([]);
  const [events, setEvents] = useState<MarketEvent[]>([]);
  const [localBars, setLocalBars] = useState<BarEvent[]>([]);
  const receivedCountRef = useRef<number>(0);
  const localIndexRef = useRef<number>(0);
  const localTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [state, setState] = useState<PlaybackState>({
    status: "idle",
    speed: 1,
    cursor: dataset.startTime,
    error: null,
    mode: "ws",
    loadedBars: 0
  });

  useEffect(() => {
    const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "";
    const maxBars = Number.isFinite(dataset.rows) ? Math.max(1000, dataset.rows + 100) : 10000;

    // Preload bars so we can fall back to local playback if websocket isn't available
    const controller = new AbortController();
    const loadLocalBars = async () => {
      try {
        const chunkSize = 1000;
        const collected: BarEvent[] = [];
        let from = dataset.startTime;

        while (collected.length < maxBars) {
          const params = new URLSearchParams({
            symbol: dataset.symbol,
            timeframe: dataset.timeframe,
            datasetId: dataset.id,
            from: from.toString(),
            limit: chunkSize.toString()
          });
          const res = await fetch(`${apiBase}/api/bars?${params.toString()}`, { signal: controller.signal });
          if (!res.ok) throw new Error(`Failed to load bars (${res.status})`);
          const payload = await res.json();
          const rows = (Array.isArray(payload) ? payload : payload.bars ?? []) as BarEvent[];
          const normalized = rows
            .map((bar) => ({
              ...bar,
              timestamp: normalizeTimestamp(bar.timestamp) ?? dataset.startTime
            }))
            .filter((bar) => typeof bar.timestamp === "number" && Number.isFinite(bar.timestamp));

          if (!normalized.length) break;
          collected.push(...normalized);

          if (collected.length >= maxBars) break;
          if (normalized.length < chunkSize) break;
          const lastTs = normalized[normalized.length - 1]?.timestamp;
          if (!lastTs) break;
          from = lastTs + 1;
        }

        setLocalBars(collected);
        // Reset counters; actual playback progress is tracked as events arrive.
        receivedCountRef.current = 0;
        setState((prev) => ({ ...prev, loadedBars: 0 }));
      } catch (err) {
        if ((err as any)?.name === "AbortError") return;
        // Keep state but note we couldn't preload
        setState((prev) => ({ ...prev, error: (err as Error).message }));
      }
    };
    loadLocalBars();

    return () => {
      controller.abort();
    };
  }, [dataset]);

  const startLocalPlayback = () => {
    if (!localBars.length) {
      setState((prev) => ({ ...prev, status: "error", error: "No bars available for local playback" }));
      return;
    }
    const tick = () => {
      localIndexRef.current = Math.min(localBars.length - 1, localIndexRef.current + Math.max(1, Math.round(state.speed)));
      const nextBar = localBars[localIndexRef.current];
      if (!nextBar) {
        pause();
        return;
      }
      receivedCountRef.current = Math.max(receivedCountRef.current, localIndexRef.current + 1);
      setBars(localBars.slice(0, localIndexRef.current + 1));
      setEvents((prev) => [...prev.slice(-199), { ...nextBar, type: "BAR" } as MarketEvent]);
      setState((prev) => ({
        ...prev,
        cursor: nextBar.timestamp,
        loadedBars: Math.max(prev.loadedBars, receivedCountRef.current)
      }));
      if (localIndexRef.current >= localBars.length - 1) {
        pause();
      }
    };

    if (localTimerRef.current) clearInterval(localTimerRef.current);
    // Speed multiplier = more bars per second; allow down to 10ms
    const intervalMs = Math.max(10, 1000 / Math.max(1, state.speed));
    localTimerRef.current = setInterval(tick, intervalMs);
    setState((prev) => ({ ...prev, status: "playing", mode: "local", error: null }));
  };

  const stopLocalTimer = () => {
    if (localTimerRef.current) {
      clearInterval(localTimerRef.current);
      localTimerRef.current = null;
    }
  };

  const resetLocalCursor = (timestamp?: number) => {
    if (!localBars.length) return;
    const idx = timestamp
      ? Math.max(
          0,
          localBars.findIndex((bar) => bar.timestamp >= timestamp)
        )
      : 0;
    localIndexRef.current = idx;
    const bar = localBars[idx];
    setBars(localBars.slice(0, idx + 1));
    setState((prev) => ({ ...prev, cursor: bar?.timestamp ?? dataset.startTime }));
  };

  useEffect(() => {
    setBars([]);
    setEvents([]);
    receivedCountRef.current = 0;
    setState((prev) => ({
      ...prev,
      status: "connecting",
      cursor: dataset.startTime,
      error: null,
      mode: "ws",
      loadedBars: 0
    }));
    stopLocalTimer();

    const wsUrl = buildWsUrl();
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    const sendInit = () => {
          const payload = {
            type: "INIT",
            payload: {
              symbol: dataset.symbol,
              timeframe: dataset.timeframe,
              datasetId: dataset.id,
              from: dataset.startTime,
              to: dataset.endTime,
              speed: state.speed
            }
          };
          socket.send(JSON.stringify(payload));
    };

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
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
            cursor: data.cursor ?? prev.cursor
          }));
          return;
        }
      } catch (err) {
        setState((prev) => ({ ...prev, error: (err as Error).message, status: "error" }));
      }
    };

    socket.addEventListener("open", () => {
      setState((prev) => ({ ...prev, status: "paused", cursor: dataset.startTime }));
      sendInit();
    });
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("error", () => {
      setState((prev) => ({
        ...prev,
        status: "paused",
        mode: "local",
        error: "Playback websocket unavailable. Falling back to local playback."
      }));
      resetLocalCursor(dataset.startTime);
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
  }, [dataset.id, dataset.symbol, dataset.timeframe, dataset.startTime, dataset.endTime]);

  const sendMessage = (message: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  };

  const play = () => {
    if (state.mode === "local") {
      startLocalPlayback();
      return;
    }
    if (sendMessage({ type: "PLAY" })) {
      setState((prev) => ({ ...prev, status: "playing" }));
    } else {
      // If websocket not open, fall back
      setState((prev) => ({ ...prev, mode: "local" }));
      startLocalPlayback();
    }
  };

  const pause = () => {
    if (state.mode === "local") {
      stopLocalTimer();
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
    if (state.mode === "local" && state.status === "playing") {
      startLocalPlayback();
    }
  };

  const seek = (timestamp: number) => {
    setState((prev) => ({ ...prev, cursor: timestamp }));
    sendMessage({ type: "SEEK", timestamp });
    if (state.mode === "local") {
      stopLocalTimer();
      resetLocalCursor(timestamp);
    }
  };

  const step = (direction: "forward" | "backward", size = 1) => {
    sendMessage({ type: "STEP", direction, size });
    if (state.mode === "local") {
      stopLocalTimer();
      const delta = direction === "forward" ? size : -size;
      localIndexRef.current = Math.min(
        Math.max(0, localIndexRef.current + delta),
        Math.max(0, localBars.length - 1)
      );
      const bar = localBars[localIndexRef.current];
      if (bar) {
        setBars(localBars.slice(0, localIndexRef.current + 1));
        setEvents((prev) => [...prev.slice(-199), { ...bar, type: "BAR" } as MarketEvent]);
        setState((prev) => ({
          ...prev,
          cursor: bar.timestamp,
          status: "paused",
          loadedBars: Math.max(prev.loadedBars, localIndexRef.current + 1)
        }));
      }
    }
  };

  return {
    bars,
    events,
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
