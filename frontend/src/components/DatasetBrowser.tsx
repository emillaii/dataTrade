import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { ChevronLeft, ChevronRight, Eye, Trash2, Clock3 } from "lucide-react";
import { useDatasets } from "../hooks/useDatasets";
import { Dataset } from "../types/market";

interface DatasetBrowserProps {
  onOpenDataset: (dataset: Dataset) => void;
}

const formatTimestamp = (value?: number) => {
  if (!value || Number.isNaN(value)) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().replace("T", " ").slice(0, 16);
};

export function DatasetBrowser({ onOpenDataset }: DatasetBrowserProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const timezoneOptions = useMemo(
    () =>
      Array.from({ length: 27 }, (_, idx) => idx - 12) // -12..14
        .map((offset) => {
          const sign = offset >= 0 ? "+" : "";
          return {
            value: `UTC${sign}${offset}`,
            label: `UTC${sign}${offset} (GMT${sign}${offset})`
          };
        })
        .concat([{ value: "UTC", label: "UTC (GMT+0)" }]),
    []
  );
  const [symbol, setSymbol] = useState<string>("all");
  const [timeframe, setTimeframe] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [rowsPerPage, setRowsPerPage] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [appliedFilters, setAppliedFilters] = useState({});
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editDataset, setEditDataset] = useState<Dataset | null>(null);
  const [editTz, setEditTz] = useState<string>("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const { datasets, total, loading, error, refetch, refresh } = useDatasets({
    limit: rowsPerPage,
    offset: 0
  });

  const totalPages = Math.max(1, Math.ceil((total || datasets.length || 0) / rowsPerPage));

  const handleApplyFilters = () => {
    const parsedFilters: Record<string, unknown> = {
      symbol: symbol === "all" ? undefined : symbol,
      timeframe: timeframe === "all" ? undefined : timeframe,
      start: startDate ? Date.parse(startDate) : undefined,
      end: endDate ? Date.parse(endDate) : undefined,
      limit: rowsPerPage,
      offset: 0
    };
    setAppliedFilters(parsedFilters);
    setCurrentPage(1);
    refetch(parsedFilters);
  };

  const handlePageChange = (nextPage: number) => {
    const clamped = Math.max(1, Math.min(totalPages, nextPage));
    setCurrentPage(clamped);
    refetch({
      ...(appliedFilters as any),
      limit: rowsPerPage,
      offset: (clamped - 1) * rowsPerPage
    });
  };

  const handleRowsPerPageChange = (value: number) => {
    setRowsPerPage(value);
    setCurrentPage(1);
    refetch({
      ...(appliedFilters as any),
      limit: value,
      offset: 0
    });
  };

  useEffect(() => {
    refetch({
      ...(appliedFilters as any),
      limit: rowsPerPage,
      offset: (currentPage - 1) * rowsPerPage
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displayedDatasets = useMemo(() => datasets, [datasets]);
  const apiBase = import.meta.env.VITE_API_URL || "";

  const handleDelete = async (id: string) => {
    setDeleteError(null);
    try {
      const res = await fetch(`${apiBase}/api/datasets/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to delete dataset (${res.status})`);
      }
      await refetch({
        ...(appliedFilters as any),
        limit: rowsPerPage,
        offset: (currentPage - 1) * rowsPerPage
      });
      refresh();
    } catch (err) {
      setDeleteError((err as Error).message);
    } finally {
      setConfirmId(null);
    }
  };

  return (
    <div ref={containerRef} className="relative flex-1 flex overflow-hidden">
      {/* Left Sidebar - Filters */}
      <aside className="w-64 bg-[var(--bg-surface)] border-r border-[var(--border-subtle)] p-6 flex flex-col gap-6">
        <div>
          <h3 className="text-[var(--text-primary)] mb-4 font-cyber text-sm">FILTERS</h3>
          
          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label className="text-[var(--text-secondary)] text-xs">Symbol</Label>
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger className="bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]">
                  <SelectValue placeholder="All Symbols" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Symbols</SelectItem>
                  <SelectItem value="EURUSD">EURUSD</SelectItem>
                  <SelectItem value="GBPUSD">GBPUSD</SelectItem>
                  <SelectItem value="USDJPY">USDJPY</SelectItem>
                  <SelectItem value="GBPJPY">GBPJPY</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[var(--text-secondary)] text-xs">Timeframe</Label>
              <Select value={timeframe} onValueChange={setTimeframe}>
                <SelectTrigger className="bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]">
                  <SelectValue placeholder="All Timeframes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Timeframes</SelectItem>
                  <SelectItem value="TICK">TICK</SelectItem>
                  <SelectItem value="M1">M1</SelectItem>
                  <SelectItem value="M5">M5</SelectItem>
                  <SelectItem value="M15">M15</SelectItem>
                  <SelectItem value="H1">H1</SelectItem>
                  <SelectItem value="D1">D1</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[var(--text-secondary)] text-xs">Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[var(--text-secondary)] text-xs">End Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]"
              />
            </div>

            <Button
              className="w-full bg-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/90 text-white"
              onClick={handleApplyFilters}
              disabled={loading}
            >
              Apply Filters
            </Button>
          </div>
        </div>

        <div className="mt-auto p-4 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border-subtle)]">
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            <span className="text-[var(--text-secondary)] block mb-1">Imported datasets from Tick Data Suite</span>
            Historical market data imported from CSV files. Select a dataset to start playback and backtesting.
          </p>
        </div>
      </aside>

      {/* Main Content - Dataset Table */}
      <main className="flex-1 p-6 overflow-auto">
        <div className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)] shadow-lg">
          <div className="p-6 border-b border-[var(--border-subtle)] flex items-center justify-between">
            <h2 className="text-[var(--text-primary)] font-cyber text-xl glow-primary">AVAILABLE DATASETS</h2>
            <Button variant="ghost" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              Import new CSV
            </Button>
          </div>

          {error && (
            <div className="px-6 py-3 text-sm text-[var(--trade-bearish)] border-b border-[var(--border-subtle)]">
              {error}
            </div>
          )}
          {deleteError && (
            <div className="px-6 py-3 text-sm text-[var(--trade-bearish)] border-b border-[var(--border-subtle)]">
              {deleteError}
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow className="border-[var(--border-subtle)] hover:bg-transparent">
                <TableHead className="text-[var(--text-secondary)] text-xs">Symbol</TableHead>
                <TableHead className="text-[var(--text-secondary)] text-xs">Timeframe</TableHead>
                <TableHead className="text-[var(--text-secondary)] text-xs">Timezone</TableHead>
                <TableHead className="text-[var(--text-secondary)] text-xs">Start Time</TableHead>
                <TableHead className="text-[var(--text-secondary)] text-xs">End Time</TableHead>
                <TableHead className="text-[var(--text-secondary)] text-xs text-right">Rows</TableHead>
                <TableHead className="text-[var(--text-secondary)] text-xs">Source File</TableHead>
                <TableHead className="text-[var(--text-secondary)] text-xs text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading && displayedDatasets.length === 0 && (
                <TableRow className="border-[var(--border-subtle)]">
                  <TableCell
                    colSpan={8}
                    className="text-center text-[var(--text-muted)] py-10"
                  >
                    No datasets found. Adjust your filters or import a new CSV.
                  </TableCell>
                </TableRow>
              )}
              {loading && (
                <TableRow className="border-[var(--border-subtle)]">
                  <TableCell
                    colSpan={8}
                    className="text-center text-[var(--text-secondary)] py-10"
                  >
                    Loading datasets...
                  </TableCell>
                </TableRow>
              )}
              {displayedDatasets.map((dataset, index) => (
                <TableRow 
                  key={dataset.id}
                  className={`border-[var(--border-subtle)] ${
                    index % 2 === 0 ? 'bg-transparent' : 'bg-[var(--bg-elevated)]/50'
                  }`}
                >
                  <TableCell className="text-[var(--text-primary)]">{dataset.symbol}</TableCell>
                  <TableCell className="text-[var(--text-primary)]">{dataset.timeframe}</TableCell>
                 <TableCell className="text-[var(--text-secondary)]">{dataset.timezone || "UTC"}</TableCell>
                  <TableCell className="text-[var(--text-secondary)] font-mono text-sm">
                    {formatTimestamp(dataset.startTime)}
                  </TableCell>
                  <TableCell className="text-[var(--text-secondary)] font-mono text-sm">
                    {formatTimestamp(dataset.endTime)}
                  </TableCell>
                  <TableCell className="text-[var(--text-primary)] font-mono text-sm text-right">
                    {typeof dataset.rows === "number" ? dataset.rows.toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-[var(--text-muted)] text-sm">{dataset.sourceFile}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button
                      size="icon"
                      variant="outline"
                      className="border-[var(--border-subtle)] text-[var(--text-secondary)]"
                      onClick={() => {
                        setEditDataset(dataset);
                        setEditTz(dataset.timezone || "UTC");
                        setEditError(null);
                      }}
                      aria-label="Edit timezone"
                    >
                      <Clock3 className="w-4 h-4" />
                    </Button>
                    <Button 
                      size="icon"
                      className="bg-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/90 text-white"
                      onClick={() => onOpenDataset(dataset)}
                      disabled={loading}
                      aria-label="Open dataset"
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      className="border-[var(--border-subtle)] text-[var(--trade-bearish)]"
                      onClick={() => setConfirmId(dataset.id)}
                      aria-label="Delete dataset"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="p-4 border-t border-[var(--border-subtle)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--text-secondary)]">Rows per page:</span>
              <Select 
                value={rowsPerPage.toString()} 
                onValueChange={(value) => handleRowsPerPageChange(Number(value))}
              >
                <SelectTrigger className="w-20 h-8 bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5</SelectItem>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--text-secondary)]">
                Page {currentPage} of {totalPages}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="h-8 w-8 p-0 text-[var(--text-secondary)]"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages || totalPages === 0}
                  className="h-8 w-8 p-0 text-[var(--text-secondary)]"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <ConfirmModal
        open={!!confirmId}
        datasetId={confirmId}
        onCancel={() => setConfirmId(null)}
        onConfirm={() => confirmId && handleDelete(confirmId)}
        container={containerRef.current}
      />
      <TimezoneModal
        open={!!editDataset}
        dataset={editDataset}
        value={editTz}
        onChange={setEditTz}
        options={timezoneOptions}
        onCancel={() => {
          setEditDataset(null);
          setEditSaving(false);
          setEditError(null);
        }}
        onSave={async () => {
          if (!editDataset) return;
          setEditSaving(true);
          setEditError(null);
          try {
            const res = await fetch(`${apiBase}/api/datasets/${editDataset.id}/timezone`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ timezone: editTz })
            });
            if (!res.ok) {
              const text = await res.text();
              throw new Error(text || `Failed to update timezone (${res.status})`);
            }
            await refetch({
              ...(appliedFilters as any),
              limit: rowsPerPage,
              offset: (currentPage - 1) * rowsPerPage
            });
            refresh();
            setEditDataset(null);
          } catch (err) {
            setEditError((err as Error).message);
          } finally {
            setEditSaving(false);
          }
        }}
        loading={editSaving}
        error={editError}
        container={containerRef.current}
      />
    </div>
  );
}

function ConfirmModal({
  open,
  onCancel,
  onConfirm,
  datasetId,
  container
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  datasetId?: string | null;
  container?: HTMLElement | null;
}) {
  if (!open) return null;

  const portalTarget = container ?? document.body;
  const positionClass = container ? "absolute" : "fixed";

  return createPortal(
    <div className={`${positionClass} inset-0 z-[9999] flex items-center justify-center`}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg shadow-2xl p-6 space-y-4 mx-4">
        <h3 className="text-lg font-cyber text-[var(--text-primary)]">Delete dataset?</h3>
        <p className="text-sm text-[var(--text-secondary)]">
          This will remove dataset <span className="font-mono text-[var(--text-primary)]">{datasetId}</span> and its
          candles. This action cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            className="border-[var(--border-subtle)] text-[var(--text-secondary)]"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            className="bg-[var(--trade-bearish)] hover:bg-[var(--trade-bearish)]/90 text-white"
            onClick={onConfirm}
          >
            Confirm Delete
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function TimezoneModal({
  open,
  dataset,
  value,
  onChange,
  options,
  onCancel,
  onSave,
  loading,
  error,
  container
}: {
  open: boolean;
  dataset: Dataset | null;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  onCancel: () => void;
  onSave: () => void;
  loading: boolean;
  error: string | null;
  container?: HTMLElement | null;
}) {
  if (!open || !dataset) return null;
  const portalTarget = container ?? document.body;
  const positionClass = container ? "absolute" : "fixed";

  return createPortal(
    <div className={`${positionClass} inset-0 z-[9999] flex items-center justify-center`}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg shadow-2xl p-6 space-y-4 mx-4">
        <div>
          <h3 className="text-lg font-cyber text-[var(--text-primary)]">Edit Timezone</h3>
          <p className="text-sm text-[var(--text-secondary)]">
            {dataset.symbol} · {dataset.timeframe} (current: {dataset.timezone || "UTC"})
          </p>
        </div>
        <div className="space-y-2">
          <Label className="text-[var(--text-secondary)] text-xs">Timezone</Label>
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger className="bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {error && (
          <div className="text-sm text-[var(--trade-bearish)] bg-[var(--bg-elevated)] border border-[var(--trade-bearish)]/40 rounded-md px-3 py-2">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            className="border-[var(--border-subtle)] text-[var(--text-secondary)]"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            className="bg-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/90 text-white"
            onClick={onSave}
            disabled={loading}
          >
            {loading ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>,
    portalTarget
  );
}
