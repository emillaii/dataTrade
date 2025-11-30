import express from "express";
import cors from "cors";
import multer from "multer";
import morgan from "morgan";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse";
import { ensureSchema, fetchBars, insertCandles, insertDataset, listDatasets, pool, updateDatasetTimezone } from "./db.js";
import { computeIndicatorSeries, getIndicatorMeta } from "./indicators.js";
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
        const csvOptions = {
            columns: ((header) => {
                const lower = header.map((h) => String(h || "").toLowerCase().trim());
                const known = ["timestamp", "time", "date", "open", "high", "low", "close", "volume", "symbol", "timeframe", "datetime"];
                const hasKnown = lower.some((h) => known.includes(h));
                return hasKnown ? header : false; // false => return rows as arrays
            }),
            delimiter: [",", ";", "\t"],
            skip_empty_lines: true,
            relax_column_count: true,
            trim: true
        };
        const stream = fs.createReadStream(filePath).pipe(parse(csvOptions));
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
app.get("/api/indicators/meta", (_req, res) => {
    res.json({ indicators: getIndicatorMeta() });
});
app.post("/api/indicators/compute", async (req, res) => {
    const { symbol, timeframe, datasetId, from, to, limit, indicators } = req.body ?? {};
    if (!symbol || !timeframe) {
        res.status(400).json({ error: "symbol and timeframe are required" });
        return;
    }
    if (!Array.isArray(indicators) || indicators.length === 0) {
        res.status(400).json({ error: "indicators array is required" });
        return;
    }
    try {
        const cappedLimit = Math.min(Math.max(Number(limit) || 1000, 1), 5000);
        const bars = await fetchBars({
            symbol: String(symbol),
            timeframe: String(timeframe),
            datasetId: datasetId ? String(datasetId) : undefined,
            from: from ? Number(from) : undefined,
            to: to ? Number(to) : undefined,
            limit: cappedLimit
        });
        const results = indicators.map((spec) => computeIndicatorSeries(bars, spec));
        res.json({ bars, indicators: results });
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
// Bind to all interfaces by default so ws/http work for localhost/127.0.0.1/::1
const host = process.env.HOST || "0.0.0.0";
const start = async () => {
    try {
        await ensureSchema();
        app.listen(port, host, () => {
            console.log(`API server listening on ${host}:${port}`);
        });
    }
    catch (err) {
        console.error("Failed to start server:", err);
        process.exit(1);
    }
};
start();
