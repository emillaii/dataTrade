import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Play, Settings, TrendingUp, X } from "lucide-react";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import type { Dataset } from "../types/market";
import type { IndicatorMeta, IndicatorSpec } from "../types/indicator";
import { Modal } from "antd";

interface SimulationProps {
  onStartSimulation: (dataset: Dataset, indicators: IndicatorSpec[]) => void;
}

const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "";

type SavedSimulation = {
  id: string;
  name: string;
  datasetId: string;
  indicatorSpecs: IndicatorSpec[];
};

const formatISODate = (value?: number | string) => {
  if (value === undefined || value === null) return "—";
  const ts = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(ts)) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
};

export function Simulation({ onStartSimulation }: SimulationProps) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [indicatorCatalog, setIndicatorCatalog] = useState<IndicatorMeta[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [selectedIndicatorType, setSelectedIndicatorType] = useState<string>("");
  const [indicatorParams, setIndicatorParams] = useState<Record<string, number | string>>({});
  const [indicatorConfigs, setIndicatorConfigs] = useState<IndicatorSpec[]>([]);
  const [indicatorColor, setIndicatorColor] = useState<string>("#22d3ee");
  const [editingIndicatorId, setEditingIndicatorId] = useState<string | null>(null);
  const [isIndicatorModalOpen, setIsIndicatorModalOpen] = useState(false);
  const [configName, setConfigName] = useState<string>("");
  const [savedConfigs, setSavedConfigs] = useState<SavedSimulation[]>([]);
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = search ? `&symbol=${encodeURIComponent(search)}` : "";
        const [metaRes, datasetRes] = await Promise.all([
          fetch(`${apiBase}/api/indicators/meta`, { signal: controller.signal }),
          fetch(`${apiBase}/api/datasets?limit=200${qs}`, {
            signal: controller.signal
          })
        ]);
        if (!metaRes.ok) throw new Error("Failed to load indicators");
        if (!datasetRes.ok) throw new Error("Failed to load datasets");
        const metaPayload = await metaRes.json();
        const datasetPayload = await datasetRes.json();
        const loadedIndicators: IndicatorMeta[] = metaPayload?.indicators ?? [];
        const loadedDatasets: Dataset[] = datasetPayload?.datasets ?? [];
        setIndicatorCatalog(loadedIndicators);
        setDatasets(loadedDatasets);
        if (loadedDatasets.length && !selectedDatasetId) {
          setSelectedDatasetId(loadedDatasets[0].id);
        }
        if (loadedIndicators.length && !selectedIndicatorType) {
          setSelectedIndicatorType(loadedIndicators[0].type);
          const defaults: Record<string, number | string> = {};
          loadedIndicators[0].params.forEach((p) => {
            if (p.default !== undefined) defaults[p.name] = p.default;
          });
          setIndicatorParams((prev) => ({ ...defaults, ...prev }));
        }
      } catch (err) {
        if ((err as any)?.name === "AbortError") return;
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };
    load();
    return () => controller.abort();
  }, [search]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("sim-configs");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setSavedConfigs(parsed);
        }
      }
    } catch {
      // ignore bad storage
    }
  }, []);

  const persistSaved = (next: SavedSimulation[]) => {
    setSavedConfigs(next);
    try {
      localStorage.setItem("sim-configs", JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const selectedDataset = useMemo(
    () => datasets.find((d) => d.id === selectedDatasetId) ?? datasets[0],
    [datasets, selectedDatasetId]
  );

  const selectedMeta = useMemo(
    () => indicatorCatalog.find((m) => m.type === selectedIndicatorType),
    [indicatorCatalog, selectedIndicatorType]
  );

  useEffect(() => {
    if (!selectedMeta) return;
    setIndicatorParams((prev) => {
      const next = { ...prev };
      selectedMeta.params.forEach((p) => {
        if (next[p.name] === undefined && p.default !== undefined) {
          next[p.name] = p.default;
        }
      });
      return next;
    });
  }, [selectedMeta]);

  const canStart = !!selectedDataset && !!selectedIndicatorType;

  const addIndicator = () => {
    if (!selectedIndicatorType) return;
    const id = editingIndicatorId ?? `sim-${selectedIndicatorType}-${Date.now()}`;
    const spec: IndicatorSpec = {
      id,
      type: selectedIndicatorType,
      params: indicatorParams,
      color: indicatorColor
    };
    setIndicatorConfigs((prev) => {
      if (editingIndicatorId) {
        return prev.map((cfg) => (cfg.id === editingIndicatorId ? spec : cfg));
      }
      return [...prev, spec];
    });
    setEditingIndicatorId(null);
  };

  const removeIndicator = (id: string) => {
    setIndicatorConfigs((prev) => prev.filter((cfg) => (cfg.id ?? cfg.type) !== id));
  };

  const handleStart = () => {
    if (!selectedDataset || !selectedIndicatorType) return;
    const activeIndicators = indicatorConfigs.length
      ? indicatorConfigs
      : [
          {
            id: `sim-${selectedIndicatorType}-${Date.now()}`,
            type: selectedIndicatorType,
            params: indicatorParams,
            color: indicatorColor
          }
        ];
    onStartSimulation(selectedDataset, activeIndicators);
  };

  const handleSaveConfig = () => {
    if (!selectedDataset) return;
    const activeIndicators = indicatorConfigs.length
      ? indicatorConfigs
      : [
          {
            id: `sim-${selectedIndicatorType}-${Date.now()}`,
            type: selectedIndicatorType,
            params: indicatorParams
          }
        ];
    const isEdit = editingConfigId !== null;
    const next: SavedSimulation = {
      id: isEdit ? editingConfigId : crypto.randomUUID ? crypto.randomUUID() : `sim-${Date.now()}`,
      name: configName.trim() || `${selectedDataset.symbol} · ${selectedIndicatorType || "indicator"}`,
      datasetId: selectedDataset.id,
      indicatorSpecs: activeIndicators
    };
    if (isEdit) {
      const updated = savedConfigs.map((cfg) => (cfg.id === editingConfigId ? next : cfg));
      persistSaved(updated);
    } else {
      persistSaved([...savedConfigs, next]);
    }
    setConfigName("");
    setEditingConfigId(null);
    setIsIndicatorModalOpen(false);
  };

  const handleDeleteConfig = (id: string) => {
    persistSaved(savedConfigs.filter((c) => c.id !== id));
  };

  const handleLoadConfig = (config: SavedSimulation) => {
    setSelectedDatasetId(config.datasetId);
    setIndicatorConfigs(config.indicatorSpecs);
    setSelectedIndicatorType(config.indicatorSpecs[0]?.type ?? selectedIndicatorType);
    setConfigName(config.name);
    setEditingConfigId(config.id);
    const first = config.indicatorSpecs[0];
    if (first?.params) {
      setIndicatorParams(first.params);
    }
    if (first?.color) {
      setIndicatorColor(first.color);
    }
    setEditingIndicatorId(null);
  };

  const closeIndicatorModal = () => {
    setIsIndicatorModalOpen(false);
    setEditingIndicatorId(null);
  };

  return (
    <div className="flex-1 p-6 space-y-6 overflow-auto">
      <div>
        <h1 className="text-2xl text-[var(--text-primary)] mb-2">Simulation</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Configure a dataset and indicator, then jump into a playback session with that setup.
        </p>
        {loading && <p className="text-xs text-[var(--text-muted)] mt-1">Loading simulation presets…</p>}
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>

      <div className="flex flex-row flex-wrap gap-4 items-start w-full">
        <div className="flex-1 min-w-[320px] bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)] shadow-lg p-5 space-y-4">
          <div className="flex items-start gap-3">
            <Settings className="w-5 h-5 text-[var(--accent-primary)] mt-1" />
            <div>
              <p className="text-[var(--text-primary)] font-medium">Simulation builder</p>
              <p className="text-xs text-[var(--text-muted)]">Pick a dataset, choose an indicator, set parameters.</p>
            </div>
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
                  <div className="px-3 py-2">
                    <Input
                      placeholder="Filter datasets…"
                      className="bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-primary)]"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      autoFocus
                    />
                  </div>
                  {datasets.map((ds) => (
                    <SelectItem key={ds.id} value={ds.id}>
                      {ds.symbol} · {ds.timeframe} · {ds.rows} rows
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedDataset && (
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <CalendarRange className="w-3 h-3" />
                  <span>
                    {formatISODate(selectedDataset.startTime)} — {formatISODate(selectedDataset.endTime)}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm text-[var(--text-secondary)]">Indicator</p>
              <Select value={selectedIndicatorType} onValueChange={(val) => setSelectedIndicatorType(val)}>
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
              {selectedMeta && (
                <div className="flex flex-wrap gap-2">
                  {selectedMeta.outputs.map((output) => (
                    <Badge key={output} variant="outline" className="text-[11px] text-[var(--text-secondary)] border-[var(--border-subtle)]">
                      outputs: {output}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm text-[var(--text-secondary)]">Series color</p>
              <input
                type="color"
                value={indicatorColor}
                onChange={(e) => setIndicatorColor(e.target.value)}
                className="h-10 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
              />
              <p className="text-[11px] text-[var(--text-muted)]">
                Pick a color for this indicator series in playback.
              </p>
            </div>
          </div>

          {selectedMeta && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {selectedMeta.params.map((param) => (
                <div
                  key={param.name}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm text-[var(--text-primary)]">{param.label}</p>
                      <p className="text-[11px] font-mono text-[var(--text-muted)]">{param.name}</p>
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
                  {(() => {
                    const raw = indicatorParams[param.name];
                    const numeric = typeof raw === "number" ? raw : Number(raw);
                    const isEmpty = raw === "" || raw === undefined;
                    const isInvalidNumber = Number.isNaN(numeric);
                    const belowMin = param.min !== undefined && Number.isFinite(numeric) && numeric < param.min;
                    const aboveMax = param.max !== undefined && Number.isFinite(numeric) && numeric > param.max;
                    const invalid = isEmpty || isInvalidNumber || belowMin || aboveMax;
                    return (
                      <>
                        <Input
                          type="number"
                          value={raw ?? param.default ?? ""}
                          min={param.min}
                          max={param.max}
                          step={param.step}
                          onChange={(e) => {
                            const val = e.target.value === "" ? "" : Number(e.target.value);
                            setIndicatorParams((prev) => ({ ...prev, [param.name]: val }));
                          }}
                          className={`bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-primary)] ${
                            invalid ? "border-[var(--trade-bearish)]/60" : ""
                          }`}
                        />
                        <div className="flex gap-2 text-[11px] text-[var(--text-muted)]">
                          <span>Type: {param.type}</span>
                          {(param.min !== undefined || param.max !== undefined) && (
                            <span>
                              Range {param.min ?? "—"} to {param.max ?? "—"}
                            </span>
                          )}
                          {param.step !== undefined && <span>Step {param.step}</span>}
                        </div>
                        {invalid && (
                          <p className="text-[11px] text-[var(--trade-bearish)]">
                            Please enter a number{param.min !== undefined ? ` ≥ ${param.min}` : ""}{" "}
                            {param.max !== undefined ? ` and ≤ ${param.max}` : ""}.
                          </p>
                        )}
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between">
            <Button
              variant="default"
              className="bg-[var(--accent-primary)] text-white border border-[var(--accent-primary)] shadow-md shadow-[var(--accent-primary)]/30 hover:bg-[var(--accent-primary)]/90"
              onClick={addIndicator}
              disabled={!selectedIndicatorType}
            >
              {editingIndicatorId ? "Save indicator" : "Add indicator"}
            </Button>
            <span className="text-xs text-[var(--text-muted)]">
              {editingIndicatorId ? "Editing an indicator…" : `Added: ${indicatorConfigs.length || 0}`}
            </span>
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.08em] text-[var(--text-muted)]">Indicators in this run</p>
            {indicatorConfigs.length === 0 && (
              <div className="rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-sm text-[var(--text-secondary)]">
                None added yet. Add the current indicator to include it in the run.
              </div>
            )}
            {indicatorConfigs.map((cfg) => (
              <div
                key={cfg.id ?? cfg.type}
                className="flex items-start justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3"
              >
                <div className="space-y-1 text-sm text-[var(--text-primary)]">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="bg-[var(--accent-primary)]/10 border-[var(--accent-primary)]/30 text-[var(--accent-primary)]">
                      {cfg.type.toUpperCase()}
                    </Badge>
                    <span className="text-[var(--text-secondary)] font-mono text-[11px]">{cfg.id ?? cfg.type}</span>
                    {cfg.color && <span className="w-3 h-3 rounded-sm border border-[var(--border-subtle)]" style={{ background: cfg.color }} />}
                  </div>
                  <div className="text-xs text-[var(--text-muted)] font-mono">
                    Params: {Object.entries(cfg.params ?? {}).map(([k, v]) => `${k}=${v}`).join(", ")}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="icon"
                    className="bg-[var(--accent-primary)]/90 text-white"
                    onClick={() => {
                      setSelectedIndicatorType(cfg.type);
                      setIndicatorParams(cfg.params ?? {});
                      setIndicatorColor(cfg.color ?? "#22d3ee");
                      setEditingIndicatorId(cfg.id ?? cfg.type);
                      setIsIndicatorModalOpen(true);
                    }}
                    aria-label="Edit indicator"
                  >
                    <Settings className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    className="bg-[var(--trade-bearish)]/90 text-white"
                    onClick={() => removeIndicator(cfg.id ?? cfg.type)}
                    aria-label="Remove indicator"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 min-w-[320px] md:max-w-[42%] bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)] shadow-lg p-5 space-y-4">
          <div className="flex items-start gap-3">
            <TrendingUp className="w-5 h-5 text-[var(--accent-primary)] mt-1" />
            <div>
              <p className="text-[var(--text-primary)] font-medium">Run with these settings</p>
              <p className="text-xs text-[var(--text-muted)]">We’ll launch a playback session using your selections.</p>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 space-y-2">
            <p className="text-xs uppercase tracking-[0.08em] text-[var(--text-muted)]">Summary</p>
            <div className="space-y-1 text-sm text-[var(--text-primary)]">
              <p><span className="text-[var(--text-secondary)]">Dataset:</span> {selectedDataset ? `${selectedDataset.symbol} · ${selectedDataset.timeframe}` : "—"}</p>
              <p>
                <span className="text-[var(--text-secondary)]">Indicator:</span>{" "}
                {(selectedMeta?.label ?? selectedIndicatorType) || "—"}
              </p>
              {selectedMeta && (
                <p className="text-xs text-[var(--text-muted)] font-mono">
                  Params: {selectedMeta.params.map((p) => `${p.name}=${indicatorParams[p.name] ?? p.default ?? "?"}`).join(", ")}
                </p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 space-y-2">
            <p className="text-xs uppercase tracking-[0.08em] text-[var(--text-muted)]">Save this setup</p>
            <Input
              placeholder="Name this simulation"
              value={configName}
              onChange={(e) => setConfigName(e.target.value)}
              className="bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-primary)]"
            />
            <Button
              onClick={handleSaveConfig}
              disabled={!canStart}
              className="w-full bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-subtle)]"
              variant="outline"
            >
              {editingConfigId ? "Save changes" : "Save configuration"}
            </Button>
          </div>

          <Button
            onClick={handleStart}
            disabled={!canStart}
            className="w-full bg-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/90 text-white"
          >
            <Play className="w-4 h-4 mr-2" />
            Start Simulation (go to playback)
          </Button>

          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 space-y-3">
            <p className="text-xs uppercase tracking-[0.08em] text-[var(--text-muted)]">Saved simulations</p>
            {savedConfigs.length === 0 && (
              <p className="text-sm text-[var(--text-secondary)]">No saved configurations yet.</p>
            )}
            {savedConfigs.map((cfg) => {
              const ds = datasets.find((d) => d.id === cfg.datasetId);
              return (
                <div
                  key={cfg.id}
                  className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 space-y-2"
                >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[var(--text-primary)] font-medium">{cfg.name}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {ds ? `${ds.symbol} · ${ds.timeframe}` : "Dataset missing"}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="icon"
                          className="bg-[var(--accent-primary)]/90 text-white"
                          onClick={() => handleLoadConfig(cfg)}
                          aria-label="Edit configuration"
                        >
                          <Settings className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          className="bg-[var(--accent-primary)]/90 text-white"
                          onClick={() => ds && onStartSimulation(ds, cfg.indicatorSpecs)}
                          disabled={!ds}
                          aria-label="Play configuration"
                        >
                          <Play className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          className="bg-[var(--trade-bearish)]/90 text-white"
                          onClick={() => handleDeleteConfig(cfg.id)}
                          aria-label="Delete configuration"
                        >
                          ×
                        </Button>
                    </div>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] font-mono">
                    Indicators: {cfg.indicatorSpecs.map((s) => s.type).join(", ")}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Modal
        title={<h3 className="text-[var(--text-primary)] font-cyber text-lg">Edit Indicator</h3>}
        open={isIndicatorModalOpen}
        onCancel={closeIndicatorModal}
        centered
        width={720}
        destroyOnClose
        okText="Save indicator"
        cancelText="Cancel"
        className="indicator-modal-panel"
        okButtonProps={{ className: "bg-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/90 text-white" }}
        cancelButtonProps={{ className: "border-[var(--border-subtle)] text-[var(--text-secondary)]" }}
        rootClassName="indicator-modal"
        maskStyle={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)" }}
        styles={{
          header: {
            background: "var(--bg-app)",
            color: "var(--text-primary)",
            borderBottom: "1px solid var(--border-subtle)",
            padding: "16px 20px"
          },
          body: {
            background: "var(--bg-app)",
            color: "var(--text-primary)",
            padding: "20px"
          },
          footer: {
            background: "var(--bg-app)",
            borderTop: "1px solid var(--border-subtle)",
            padding: "16px 20px"
          },
          content: {
            background: "var(--bg-app)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 12,
            boxShadow: "0 18px 60px rgba(0,0,0,0.4)"
          }
        }}
        onOk={() => {
          addIndicator();
          closeIndicatorModal();
        }}
      >
        <div className="space-y-3 pt-2">
          <p className="text-sm text-[var(--text-secondary)]">
            Update indicator type, params, and color.
          </p>
          <div className="space-y-2">
            <p className="text-sm text-[var(--text-secondary)]">Indicator</p>
            <Select value={selectedIndicatorType} onValueChange={(val) => setSelectedIndicatorType(val)}>
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

          {selectedMeta && (
            <div className="space-y-3 max-h-[50vh] overflow-auto pr-1">
              {selectedMeta.params.map((param) => {
                const raw = indicatorParams[param.name];
                const numeric = typeof raw === "number" ? raw : Number(raw);
                const isEmpty = raw === "" || raw === undefined;
                const isInvalidNumber = Number.isNaN(numeric);
                const belowMin = param.min !== undefined && Number.isFinite(numeric) && numeric < param.min;
                const aboveMax = param.max !== undefined && Number.isFinite(numeric) && numeric > param.max;
                const invalid = isEmpty || isInvalidNumber || belowMin || aboveMax;
                return (
                  <div
                    key={param.name}
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm text-[var(--text-primary)]">{param.label}</p>
                        <p className="text-[11px] font-mono text-[var(--text-muted)]">{param.name}</p>
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
                    <Input
                      type="number"
                      value={raw ?? param.default ?? ""}
                      min={param.min}
                      max={param.max}
                      step={param.step}
                      onChange={(e) => {
                        const val = e.target.value === "" ? "" : Number(e.target.value);
                        setIndicatorParams((prev) => ({ ...prev, [param.name]: val }));
                      }}
                      className={`bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[var(--text-primary)] ${
                        invalid ? "border-[var(--trade-bearish)]/60" : ""
                      }`}
                    />
                    <div className="flex gap-2 text-[11px] text-[var(--text-muted)]">
                      <span>Type: {param.type}</span>
                      {(param.min !== undefined || param.max !== undefined) && (
                        <span>
                          Range {param.min ?? "—"} to {param.max ?? "—"}
                        </span>
                      )}
                      {param.step !== undefined && <span>Step {param.step}</span>}
                    </div>
                    {invalid && (
                      <p className="text-[11px] text-[var(--trade-bearish)]">
                        Please enter a number{param.min !== undefined ? ` ≥ ${param.min}` : ""}{" "}
                        {param.max !== undefined ? ` and ≤ ${param.max}` : ""}.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm text-[var(--text-secondary)]">Series color</p>
            <input
              type="color"
              value={indicatorColor}
              onChange={(e) => setIndicatorColor(e.target.value)}
              className="h-10 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)]"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
