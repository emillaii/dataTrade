import asyncio
import json
import os
from typing import List, Optional

import dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

# Load .env if present so local runs pick up DATABASE_URL and tuning flags.
dotenv.load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is required for the data streaming service.")

POLL_INTERVAL_SECONDS = float(os.getenv("STREAM_POLL_INTERVAL", "0.5"))
DEFAULT_BATCH_SIZE = int(os.getenv("STREAM_BATCH_SIZE", "500"))
MAX_BATCH_SIZE = int(os.getenv("STREAM_MAX_BATCH_SIZE", "2000"))
MIN_EMIT_DELAY_MS = float(os.getenv("STREAM_MIN_EMIT_DELAY_MS", "1"))  # clamp very small gaps
MAX_EMIT_DELAY_MS = float(os.getenv("STREAM_MAX_EMIT_DELAY_MS", "250"))  # cap so replay stays snappy
BASE_DELAY_MS = float(os.getenv("STREAM_BASE_DELAY_MS", "400"))  # baseline delay for a 15m delta at 1x
REFERENCE_DELTA_MS = float(os.getenv("STREAM_REFERENCE_DELTA_MS", str(15 * 60 * 1000)))  # 15 minutes

pool = AsyncConnectionPool(conninfo=DATABASE_URL, max_size=5, open=False)

app = FastAPI(title="Data Streaming Service", version="0.1.0")


@app.on_event("startup")
async def on_startup():
    await pool.open()
    await pool.wait()


@app.on_event("shutdown")
async def on_shutdown():
    await pool.close()


@app.get("/health")
async def health():
    return JSONResponse({"ok": True})


async def fetch_candles(
    symbol: str,
    timeframe: str,
    dataset_id: Optional[str],
    after_timestamp: Optional[int],
    limit: int
) -> List[dict]:
    filters = ["symbol = %s", "timeframe = %s"]
    params: List[object] = [symbol, timeframe]

    if dataset_id:
        filters.append("dataset_id = %s")
        params.append(dataset_id)

    if after_timestamp is not None:
        filters.append("timestamp > to_timestamp(%s / 1000.0)")
        params.append(after_timestamp)

    params.append(limit)

    query = f"""
    SELECT
      EXTRACT(EPOCH FROM timestamp) * 1000 AS timestamp,
      symbol,
      timeframe,
      dataset_id,
      open,
      high,
      low,
      close,
      volume
    FROM candles
    WHERE {' AND '.join(filters)}
    ORDER BY timestamp ASC
    LIMIT %s;
    """

    async with pool.connection() as conn:
        conn.row_factory = dict_row
        async with conn.cursor() as cur:
            await cur.execute(query, params)
            rows = await cur.fetchall()
            normalized: List[dict] = []
            for row in rows:
                dataset_val = row.get("dataset_id")
                normalized.append(
                    {
                        "timestamp": float(row["timestamp"]),
                        "symbol": row["symbol"],
                        "timeframe": row["timeframe"],
                        # Send both snake and camel to be friendly to clients; coerce UUID to str.
                        "dataset_id": str(dataset_val) if dataset_val is not None else None,
                        "datasetId": str(dataset_val) if dataset_val is not None else None,
                        "open": float(row["open"]),
                        "high": float(row["high"]),
                        "low": float(row["low"]),
                        "close": float(row["close"]),
                        "volume": float(row["volume"]),
                    }
                )
            return normalized


def clamp_batch_size(raw: Optional[str]) -> int:
    try:
        requested = int(raw) if raw else DEFAULT_BATCH_SIZE
    except ValueError:
        requested = DEFAULT_BATCH_SIZE
    return max(1, min(requested, MAX_BATCH_SIZE))


class SimpleMovingAverage:
    def __init__(self, period: int):
        self.period = max(1, int(period))
        self.window: List[float] = []
        self.sum = 0.0

    def update(self, value: float) -> Optional[float]:
        self.window.append(value)
        self.sum += value
        if len(self.window) > self.period:
            dropped = self.window.pop(0)
            self.sum -= dropped
        if len(self.window) < self.period:
            return None
        return self.sum / len(self.window)


async def _handle_candle_stream(ws: WebSocket):
    await ws.accept()
    params = ws.query_params
    symbol = params.get("symbol")
    timeframe = params.get("timeframe")
    dataset_id = params.get("datasetId") or params.get("dataset_id")
    after_raw = params.get("after") or params.get("from")
    batch_size = clamp_batch_size(params.get("batch"))
    speed_raw = params.get("speed")
    try:
        speed = max(0.1, float(speed_raw)) if speed_raw is not None else 1.0
    except ValueError:
        speed = 1.0
    paused = False
    last_sent_ts: Optional[float] = None

    if not symbol or not timeframe:
        await ws.send_json({"type": "ERROR", "error": "symbol and timeframe query params are required"})
        await ws.close()
        return

    try:
        last_timestamp = int(after_raw) if after_raw is not None else None
    except ValueError:
        await ws.send_json({"type": "ERROR", "error": "after/from must be a unix epoch in milliseconds"})
        await ws.close()
        return

    indicator_instances = []
    indicators_raw = params.get("indicators")
    if indicators_raw:
        try:
            specs = json.loads(indicators_raw)
            if isinstance(specs, list):
                for spec in specs:
                    if not isinstance(spec, dict):
                        continue
                    if spec.get("type") != "sma":
                        continue
                    period_raw = (spec.get("params") or {}).get("period", 20)
                    try:
                        period_val = max(1, int(period_raw))
                    except (TypeError, ValueError):
                        continue
                    indicator_instances.append(
                        {
                            "id": spec.get("id") or f"sma-{period_val}",
                            "warmup": max(0, period_val - 1),
                            "impl": SimpleMovingAverage(period_val),
                        }
                    )
        except json.JSONDecodeError:
            await ws.send_json({"type": "ERROR", "error": "invalid indicators payload"})
            await ws.close()
            return

    async def control_listener():
        nonlocal speed, paused
        try:
            while True:
                message = await ws.receive_json()
                if not isinstance(message, dict):
                    continue
                msg_type = message.get("type")
                if msg_type == "SET_SPEED":
                    try:
                        next_speed = float(message.get("speed"))
                        speed = max(0.1, next_speed)
                    except (TypeError, ValueError):
                        continue
                elif msg_type == "PAUSE":
                    paused = True
                elif msg_type == "PLAY":
                    paused = False
        except WebSocketDisconnect:
            return
        except Exception:
            return

    ctrl_task = asyncio.create_task(control_listener())

    try:
        while True:
            if paused:
                await asyncio.sleep(0.05)
                continue

            rows = await fetch_candles(symbol, timeframe, dataset_id, last_timestamp, batch_size)
            if rows:
                for row in rows:
                    payload = dict(row)
                    indicator_payload = {}
                    if indicator_instances:
                        for instance in indicator_instances:
                            value = instance["impl"].update(float(row["close"]))
                            indicator_payload[instance["id"]] = value
                    if indicator_payload:
                        payload["indicators"] = indicator_payload

                    ts = payload["timestamp"]
                    await ws.send_json({"type": "CANDLE", "payload": payload})

                    # Compute delay based on timestamp deltas and current speed.
                    if last_sent_ts is not None and ts is not None:
                        delta_ms = max(1.0, float(ts) - float(last_sent_ts))
                        # Compress real-world time gaps into a small window so speed scaling is noticeable.
                        normalized = (delta_ms / REFERENCE_DELTA_MS) * BASE_DELAY_MS
                        delay_ms = normalized / max(speed, 0.1)
                        # At high speeds, tighten the max clamp to keep motion smooth.
                        dynamic_max = max(20.0, MAX_EMIT_DELAY_MS / max(1.0, speed / 10.0))
                        delay_ms = max(MIN_EMIT_DELAY_MS, min(dynamic_max, delay_ms))
                        await asyncio.sleep(delay_ms / 1000.0)

                    last_timestamp = ts
                    last_sent_ts = ts

                # small guard to avoid tight loop when rows exist
                await asyncio.sleep(0)
            else:
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
    except WebSocketDisconnect:
        return
    finally:
        ctrl_task.cancel()


@app.websocket("/ws/candles")
async def candle_stream(ws: WebSocket):
    # Primary endpoint
    return await _handle_candle_stream(ws)


@app.websocket("/ws")
async def candle_stream_alias(ws: WebSocket):
    # Backward-compatible endpoint if the base URL already includes /ws
    return await _handle_candle_stream(ws)


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("STREAM_PORT", "5001"))
    host = os.getenv("STREAM_HOST", "0.0.0.0")
    # Run directly so executing `python server.py` from this folder works without PYTHONPATH tweaks.
    uvicorn.run(app, host=host, port=port, reload=False)
