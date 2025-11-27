import { useEffect, useMemo, useState } from "react";
import { Dataset, DatasetQuery } from "../types/market";

const apiBase = import.meta.env.VITE_API_URL || "";

const toQueryString = (query: DatasetQuery) => {
  const params = new URLSearchParams();
  if (query.symbol) params.set("symbol", query.symbol);
  if (query.timeframe) params.set("timeframe", query.timeframe);
  if (query.start) params.set("from", query.start.toString());
  if (query.end) params.set("to", query.end.toString());
  if (query.limit) params.set("limit", query.limit.toString());
  if (query.offset) params.set("offset", query.offset.toString());
  return params.toString();
};

const toNumber = (value: unknown) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string") {
    const num = parseFloat(value);
    if (!Number.isNaN(num)) return num;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
};

const normalizeDataset = (dataset: Dataset): Dataset => {
  const start = toNumber(dataset.startTime);
  const end = toNumber(dataset.endTime);
  const rows = toNumber(dataset.rows) ?? 0;
  const created = toNumber(dataset.createdAt);
  return {
    ...dataset,
    startTime: start ?? dataset.startTime,
    endTime: end ?? dataset.endTime,
    rows,
    createdAt: created ?? dataset.createdAt
  };
};

export function useDatasets(initialQuery: DatasetQuery = {}) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<DatasetQuery>(initialQuery);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const fetchDatasets = async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = toQueryString(query);
        const url = `${apiBase}/api/datasets${qs ? `?${qs}` : ""}`;
        const response = await fetch(url, {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`Failed to load datasets (${response.status})`);
        }
        const payload = await response.json();
        const items = Array.isArray(payload) ? payload : payload.datasets ?? [];
        const normalized = items.map(normalizeDataset);
        setDatasets(normalized);
        setTotal(payload.total ?? normalized.length);
      } catch (err) {
        if ((err as any)?.name === "AbortError") return;
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };
    fetchDatasets();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(query), reloadKey]);

  const refetch = (partial?: DatasetQuery) => {
    if (partial) {
      setQuery((prev) => ({
        ...prev,
        ...partial,
        offset: partial.offset ?? partial.limit ? partial.offset ?? 0 : prev.offset
      }));
    } else {
      setReloadKey((k) => k + 1);
    }
  };

  const paginatedDatasets = useMemo(() => datasets, [datasets]);

  return {
    datasets: paginatedDatasets,
    total,
    loading,
    error,
    query,
    setQuery,
    refetch,
    refresh: () => setReloadKey((k) => k + 1)
  };
}
