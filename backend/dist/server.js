import express from "express";
import cors from "cors";
import multer from "multer";
import morgan from "morgan";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { parse } from "csv-parse";
import { ensureSchema, fetchBars, insertCandles, insertDataset, listDatasets, pool, updateDatasetTimezone } from "./db.ts";
dotenv.config();
const app = express();
const uploadDir = path.join(process.cwd(), "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.get("/health", (_req, res) => {
    res.json({ ok: true });
});
app.get("/api/datasets", async (req, res) => {
    try {
        const { symbol, timeframe, from, to, limit, offset } = req.query;
        const { datasets, total } = await listDatasets({
            symbol: typeof symbol === "string" && symbol !== "" ? symbol : undefined,
            timeframe: typeof timeframe === "string" && timeframe !== "" ? timeframe : undefined,
            from: from ? Number(from) : undefined,
            to: to ? Number(to) : undefined,
            limit: limit ? Number(limit) : undefined,
            offset: offset ? Number(offset) : undefined
        });
        res.json({ datasets, total });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});
const parseTimestamp = (primary, secondary) => {
    if (primary === undefined || primary === null)
        return NaN;
    const primaryStr = String(primary).trim();
    const secondaryStr = secondary ? String(secondary).trim() : "";
    // Numeric epoch
    const num = Number(primaryStr);
    if (!Number.isNaN(num)) {
        return num > 1e12 ? num : num * 1000; // allow seconds
    }
    const combined = secondaryStr ? `${primaryStr} ${secondaryStr}` : primaryStr;
    const normalized = combined.replace(/\./g, "-").replace(/_/g, " ").replace(/,/g, " ").trim();
    // Try YYYY.MM.DD and HH:MM pattern manually (UTC)
    const dateTimeMatch = /^(\d{4})[.\-\/](\d{2})[.\-\/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(combined);
    if (dateTimeMatch) {
        const [, y, m, d, hh, mm, ss] = dateTimeMatch;
        return Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss) || 0);
    }
    // Fallback to Date.parse (may treat as local time if no timezone info)
    const parsed = Date.parse(normalized);
    if (!Number.isNaN(parsed))
        return parsed;
    return NaN;
};
const parseTimezoneOffsetMinutes = (tz) => {
    if (!tz)
        return 0;
    const match = /^(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(tz.trim());
    if (!match)
        return 0;
    const [, sign, hh, mm] = match;
    const minutes = Number(hh) * 60 + Number(mm || 0);
    return sign === "-" ? -minutes : minutes;
};
app.post("/api/import", upload.single("file"), async (req, res) => {
    if (!req.file) {
        res.status(400).json({ error: "file is required (field name 'file')" });
        return;
    }
    const sourceFile = req.file.originalname;
    const derived = deriveMetaFromFilename(sourceFile);
    const symbol = req.body.symbol || derived.symbol || "UNKNOWN";
    const timeframe = req.body.timeframe || derived.timeframe || "M15";
    const timezone = req.body.timezone || derived.timezone || "UTC";
    const tzOffsetMs = parseTimezoneOffsetMinutes(timezone) * 60 * 1000;
    const filePath = req.file.path;
    const candles = [];
    try {
        await ensureSchema();
        const stream = fs.createReadStream(filePath).pipe(parse({
            columns: (header) => {
                const lower = header.map((h) => String(h || "").toLowerCase().trim());
                const known = ["timestamp", "time", "date", "open", "high", "low", "close", "volume", "symbol", "timeframe", "datetime"];
                const hasKnown = lower.some((h) => known.includes(h));
                return hasKnown ? header : false; // false => return rows as arrays
            },
            delimiter: [",", ";", "\t"],
            skip_empty_lines: true,
            relax_column_count: true,
            trim: true
        }));
        for await (const record of stream) {
            const row = record;
            let ts;
            let o;
            let h;
            let l;
            let c;
            let v;
            let rowSymbol;
            let rowTimeframe;
            if (Array.isArray(row)) {
                // Try [date, time, open, high, low, close, volume]
                if (row.length >= 6) {
                    ts = parseTimestamp(row[0], row[1]);
                    if (Number.isNaN(ts))
                        ts = parseTimestamp(row[0]); // maybe first col is timestamp
                    // Assume OHLCV start at index 2 or 1 depending on timestamp
                    o = row[2] ?? row[1];
                    h = row[3] ?? row[2];
                    l = row[4] ?? row[3];
                    c = row[5] ?? row[4];
                    v = row[6] ?? row[5] ?? 0;
                }
            }
            else {
                const r = row;
                // Normalize keys to lowercase so we can handle CSV headers like "Date"/"Time".
                const lower = {};
                for (const key of Object.keys(r)) {
                    lower[key.toLowerCase()] = r[key];
                }
                const datePart = lower.date ?? lower.datetime ?? lower.timestamp;
                if (datePart && lower.time) {
                    ts = parseTimestamp(datePart, lower.time);
                }
                else if (lower.datetime || lower.timestamp) {
                    ts = parseTimestamp(lower.datetime ?? lower.timestamp);
                }
                else if (datePart) {
                    ts = parseTimestamp(datePart);
                }
                o = lower.open ?? lower.o;
                h = lower.high ?? lower.h;
                l = lower.low ?? lower.l;
                c = lower.close ?? lower.c;
                v = lower.volume ?? lower["tick volume"] ?? lower.v ?? 0;
                rowSymbol = lower.symbol;
                rowTimeframe = lower.timeframe;
            }
            const timestampLocal = Number.isNaN(ts) ? NaN : typeof ts === "number" ? ts : parseTimestamp(ts);
            if (!timestampLocal || Number.isNaN(timestampLocal))
                continue;
            // Treat CSV times as local in provided timezone; store UTC by subtracting offset.
            const timestamp = timestampLocal - tzOffsetMs;
            const open = Number(o);
            const high = Number(h);
            const low = Number(l);
            const close = Number(c);
            const volume = Number(v ?? 0);
            if ([open, high, low, close].some((n) => Number.isNaN(n)))
                continue;
            const bar = {
                type: "BAR",
                symbol: rowSymbol || symbol,
                timeframe: rowTimeframe || timeframe,
                timestamp,
                open,
                high,
                low,
                close,
                volume
            };
            candles.push(bar);
        }
        if (!candles.length) {
            res.status(400).json({ error: "No valid candle rows parsed from CSV" });
            return;
        }
        const startTime = Math.min(...candles.map((c) => c.timestamp));
        const endTime = Math.max(...candles.map((c) => c.timestamp));
        const rows = candles.length;
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const dataset = await insertDataset({ symbol, timeframe, timezone, sourceFile, rows, startTime, endTime }, client);
            // insert in batches for large files
            const batchSize = 1000;
            for (let i = 0; i < candles.length; i += batchSize) {
                const batch = candles.slice(i, i + batchSize);
                await insertCandles(dataset.id, batch, client);
            }
            await client.query("COMMIT");
            res.json({ dataset, inserted: rows });
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
    finally {
        fs.unlink(filePath, () => { });
    }
});
// Derive symbol/timeframe from filenames like EURUSD_GMT+8_NO-DST_M15.csv or eurusd_m15.csv
function deriveMetaFromFilename(name) {
    const base = name.toUpperCase();
    const parts = base.split(/[^A-Z0-9+:-]+/).filter(Boolean);
    let symbol;
    let timeframe;
    let timezone;
    const symCandidate = parts.find((p) => /^[A-Z]{6}$/.test(p));
    if (symCandidate)
        symbol = symCandidate;
    const tfCandidate = parts.find((p) => /^(M1|M5|M15|M30|H1|H4|D1|TICK)$/.test(p));
    if (tfCandidate)
        timeframe = tfCandidate;
    const tzCandidate = parts.find((p) => /^GMT[+-]\d{1,2}$/.test(p) || /^UTC[+-]\d{1,2}$/.test(p));
    if (tzCandidate)
        timezone = tzCandidate.replace("GMT", "UTC");
    return { symbol, timeframe, timezone };
}
app.get("/api/bars", async (req, res) => {
    const { symbol, timeframe, datasetId } = req.query;
    if (!symbol || !timeframe) {
        res.status(400).json({ error: "symbol and timeframe are required" });
        return;
    }
    try {
        const bars = await fetchBars({
            symbol: String(symbol),
            timeframe: String(timeframe),
            datasetId: datasetId ? String(datasetId) : undefined,
            from: req.query.from ? Number(req.query.from) : undefined,
            to: req.query.to ? Number(req.query.to) : undefined,
            limit: req.query.limit ? Number(req.query.limit) : undefined
        });
        res.json({ bars });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});
app.delete("/api/datasets/:id", async (req, res) => {
    const { id } = req.params;
    if (!id) {
        res.status(400).json({ error: "id is required" });
        return;
    }
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query("DELETE FROM datasets WHERE id = $1", [id]);
        await client.query("COMMIT");
        res.json({ ok: true });
    }
    catch (err) {
        await client.query("ROLLBACK");
        console.error(err);
        res.status(500).json({ error: err.message });
    }
    finally {
        client.release();
    }
});
app.patch("/api/datasets/:id/timezone", async (req, res) => {
    const { id } = req.params;
    const { timezone } = req.body ?? {};
    if (!id || typeof timezone !== "string" || timezone.trim() === "") {
        res.status(400).json({ error: "id and timezone are required" });
        return;
    }
    try {
        await ensureSchema();
        const updated = await updateDatasetTimezone(id, timezone.trim());
        if (!updated) {
            res.status(404).json({ error: "dataset not found" });
            return;
        }
        res.json({ dataset: updated });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});
const port = Number(process.env.PORT) || 4000;
const host = process.env.HOST || "127.0.0.1";
const server = createServer(app);
const broadcastState = (ws, session) => {
    const payload = {
        type: "SESSION_STATE",
        state: session.status,
        speed: session.speed,
        cursor: session.bars[session.cursor]?.timestamp ?? null
    };
    ws.send(JSON.stringify(payload));
};
const sendBar = (ws, bar) => {
    ws.send(JSON.stringify({
        ...bar,
        type: "BAR",
        timestamp: bar.timestamp
    }));
};
const wss = new WebSocketServer({ server, path: "/ws/playback" });
wss.on("connection", (ws) => {
    const session = {
        bars: [],
        cursor: 0,
        speed: 1,
        status: "paused",
        timer: null
    };
    const clearTimer = () => {
        if (session.timer) {
            clearInterval(session.timer);
            session.timer = null;
        }
    };
    const startTimer = () => {
        clearTimer();
        if (!session.bars.length)
            return;
        session.status = "playing";
        // Allow very fast playback; clamp at 5ms and send multiple bars per tick.
        const intervalMs = Math.max(5, 1000 / Math.max(0.25, session.speed));
        const barsPerTick = Math.max(1, Math.round(session.speed * 2));
        session.timer = setInterval(() => {
            if (session.cursor >= session.bars.length) {
                clearTimer();
                session.status = "paused";
                broadcastState(ws, session);
                return;
            }
            for (let i = 0; i < barsPerTick && session.cursor < session.bars.length; i++) {
                const bar = session.bars[session.cursor];
                sendBar(ws, bar);
                session.cursor = Math.min(session.cursor + 1, session.bars.length);
            }
            if (session.cursor >= session.bars.length) {
                clearTimer();
                session.status = "paused";
            }
            broadcastState(ws, session);
        }, intervalMs);
    };
    ws.on("message", async (raw) => {
        let message = null;
        try {
            message = JSON.parse(raw.toString());
        }
        catch (err) {
            ws.send(JSON.stringify({ type: "ERROR", error: "Invalid message" }));
            return;
        }
        if (message.type === "INIT") {
            try {
                const { symbol, timeframe, datasetId, from, to, speed } = message.payload;
                const bars = await fetchBars({ symbol, timeframe, datasetId, from, to, limit: 5000 });
                session.bars = bars;
                session.cursor = 0;
                session.speed = speed ?? 1;
                session.status = "paused";
                broadcastState(ws, session);
                if (session.bars.length === 0) {
                    ws.send(JSON.stringify({ type: "ERROR", error: "No bars found for requested range." }));
                }
            }
            catch (err) {
                ws.send(JSON.stringify({ type: "ERROR", error: err.message }));
            }
            return;
        }
        if (message.type === "PLAY") {
            if (session.bars.length === 0) {
                ws.send(JSON.stringify({ type: "ERROR", error: "No bars loaded. Send INIT first." }));
                return;
            }
            startTimer();
            return;
        }
        if (message.type === "PAUSE") {
            clearTimer();
            session.status = "paused";
            broadcastState(ws, session);
            return;
        }
        if (message.type === "SET_SPEED") {
            session.speed = Math.max(0.25, message.speed || 1);
            if (session.status === "playing") {
                startTimer();
            }
            else {
                broadcastState(ws, session);
            }
            return;
        }
        if (message.type === "SEEK") {
            const idx = session.bars.findIndex((b) => b.timestamp >= message.timestamp);
            session.cursor = idx >= 0 ? idx : session.bars.length - 1;
            clearTimer();
            session.status = "paused";
            const bar = session.bars[session.cursor];
            if (bar)
                sendBar(ws, bar);
            broadcastState(ws, session);
            return;
        }
        if (message.type === "STEP") {
            const delta = message.direction === "forward" ? (message.size ?? 1) : -(message.size ?? 1);
            session.cursor = Math.min(Math.max(0, session.cursor + delta), Math.max(0, session.bars.length - 1));
            clearTimer();
            session.status = "paused";
            const bar = session.bars[session.cursor];
            if (bar)
                sendBar(ws, bar);
            broadcastState(ws, session);
            return;
        }
    });
    ws.on("close", () => {
        clearTimer();
    });
});
const start = async () => {
    try {
        await ensureSchema();
        server.listen(port, host, () => {
            console.log(`API server listening on ${host}:${port}`);
        });
    }
    catch (err) {
        console.error("Failed to start server:", err);
        process.exit(1);
    }
};
start();
