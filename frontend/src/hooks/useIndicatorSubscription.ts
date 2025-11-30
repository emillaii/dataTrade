import { useEffect, useRef, useState } from "react";
import type {
  IndicatorMessage,
  IndicatorSubscribePayload,
  IndicatorSnapshotMessage
} from "../types/indicator";

type IndicatorStatus = "idle" | "connecting" | "ready" | "error";

const buildWsUrl = () => {
  const explicit = import.meta.env.VITE_API_WS_URL as string | undefined;
  if (explicit) {
    const trimmed = explicit.replace(/\/+$/, "");
    return /\/ws(\/|$)/i.test(new URL(trimmed, "http://placeholder").pathname)
      ? trimmed
      : `${trimmed}/ws/indicators`;
  }

  const apiBase = import.meta.env.VITE_API_URL as string | undefined;
  if (apiBase) {
    const sanitized = apiBase.replace(/\/+$/, "");
    return sanitized.replace(/^http/, "ws") + "/ws/indicators";
  }

  const origin = window.location.origin.replace(/^http/, "ws");
  return `${origin}/ws/indicators`;
};

export function useIndicatorSubscription() {
  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<IndicatorStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<IndicatorSnapshotMessage | null>(null);

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, []);

  const subscribe = (payload: IndicatorSubscribePayload) => {
    if (socketRef.current) {
      socketRef.current.close();
    }
    setStatus("connecting");
    setError(null);

    const wsUrl = buildWsUrl();
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;
    const subscriptionId =
      payload.subscriptionId || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `ind-${Date.now()}`);

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          type: "SUBSCRIBE",
          payload: { ...payload, subscriptionId }
        })
      );
    });

    socket.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data) as IndicatorMessage;
        if (data.type === "INDICATOR_SNAPSHOT") {
          setSnapshot(data);
          setStatus("ready");
          return;
        }
        if (data.type === "ERROR") {
          setError(data.error);
          setStatus("error");
          return;
        }
      } catch (err) {
        setError((err as Error).message);
        setStatus("error");
      }
    });

    socket.addEventListener("error", () => {
      setError("Indicator websocket unavailable");
      setStatus("error");
    });

    socket.addEventListener("close", () => {
      setStatus((prev) => (prev === "ready" ? "ready" : "idle"));
    });
  };

  const disconnect = () => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setStatus("idle");
  };

  return { status, error, snapshot, subscribe, disconnect };
}
