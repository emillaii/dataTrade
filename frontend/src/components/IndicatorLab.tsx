import { useEffect, useState } from "react";
import { ListChecks, Sparkles } from "lucide-react";
import type { IndicatorMeta } from "../types/indicator";
import { Badge } from "./ui/badge";

const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "";

export function IndicatorLab() {
  const [indicatorCatalog, setIndicatorCatalog] = useState<IndicatorMeta[]>([]);
  const [indicatorType, setIndicatorType] = useState<string>("sma");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const metaRes = await fetch(`${apiBase}/api/indicators/meta`, { signal: controller.signal });
        if (!metaRes.ok) throw new Error("Failed to load indicator catalog");
        const metaPayload = await metaRes.json();
        const loadedIndicators: IndicatorMeta[] = metaPayload?.indicators ?? [];
        setIndicatorCatalog(loadedIndicators);
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

  return (
    <div className="flex-1 p-6 space-y-6 overflow-auto">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl text-[var(--text-primary)]">Indicator Lab</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Spin up indicator plugins (starting with SMA) and stream them to the chart via the new subscription API.
        </p>
        {loading && <p className="text-xs text-[var(--text-muted)]">Loading indicator catalog…</p>}
        {loadError && <p className="text-xs text-red-400">Failed to load indicators: {loadError}</p>}
      </div>

      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4 shadow-lg space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <ListChecks className="w-5 h-5 text-[var(--accent-primary)] mt-0.5" />
            <div>
              <p className="text-[var(--text-primary)] font-medium">Indicator catalog</p>
              <p className="text-xs text-[var(--text-muted)]">
                Browse what is available and inspect the inputs each indicator expects. Click a card to load it in the builder.
              </p>
            </div>
          </div>
          <Badge variant="secondary" className="bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]">
            {indicatorCatalog.length || 0} live
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {indicatorCatalog.length ? (
            indicatorCatalog.map((meta) => {
              const isActive = meta.type === indicatorType;
              return (
                <button
                  key={meta.type}
                  type="button"
                  onClick={() => setIndicatorType(meta.type)}
                  className={`text-left rounded-lg border transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] ${
                    isActive
                      ? "border-[var(--accent-primary)] bg-[var(--bg-elevated)]/80 shadow-md"
                      : "border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
                  }`}
                >
                  <div className="p-3 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs uppercase tracking-[0.08em] text-[var(--text-muted)]">Indicator</p>
                        <p className="text-lg text-[var(--text-primary)] font-semibold leading-tight">{meta.label}</p>
                        <p className="text-[11px] text-[var(--text-secondary)] font-mono">{meta.type}</p>
                      </div>
                      <Badge
                        variant={isActive ? "secondary" : "outline"}
                        className={`flex items-center gap-1 ${
                          isActive
                            ? "bg-[var(--accent-primary)]/10 border-[var(--accent-primary)]/30 text-[var(--accent-primary)]"
                            : "bg-transparent border-[var(--border-subtle)] text-[var(--text-secondary)]"
                        }`}
                      >
                        <Sparkles className="w-3 h-3" />
                        {isActive ? "Active" : "Use"}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {meta.outputs.map((output) => (
                        <Badge
                          key={output}
                          variant="outline"
                          className="bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-secondary)] font-mono text-[11px]"
                        >
                          output: {output}
                        </Badge>
                      ))}
                    </div>

                    <div className="space-y-2">
                      {meta.params.length ? (
                        meta.params.map((param) => (
                          <div
                            key={param.name}
                            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <p className="text-sm text-[var(--text-primary)]">{param.label}</p>
                                <p className="text-[11px] text-[var(--text-muted)] font-mono">{param.name}</p>
                              </div>
                              {param.default !== undefined && (
                                <Badge variant="secondary" className="bg-[var(--accent-primary)]/10 border-[var(--accent-primary)]/30 text-[var(--accent-primary)]">
                                  Default {param.default}
                                </Badge>
                              )}
                            </div>
                            {param.description && (
                              <p className="text-xs text-[var(--text-secondary)]">{param.description}</p>
                            )}
                            <div className="flex flex-wrap gap-3 text-[11px] text-[var(--text-muted)]">
                              <span>Type: {param.type}</span>
                              {(param.min !== undefined || param.max !== undefined) && (
                                <span>
                                  Range {param.min ?? "—"} to {param.max ?? "—"}
                                </span>
                              )}
                              {param.step !== undefined && <span>Step {param.step}</span>}
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-[var(--text-muted)]">This indicator has no inputs.</p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="col-span-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 text-sm text-[var(--text-muted)]">
              No indicators available yet. Hook up metadata to see them listed here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
