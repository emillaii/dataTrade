import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { Cloud, Download, CheckCircle2, Clock, AlertCircle, RefreshCw, Server } from "lucide-react";

interface SyncJob {
  id: string;
  symbol: string;
  timeframe: string;
  dateRange: string;
  status: "pending" | "syncing" | "completed" | "failed";
  progress: number;
  size: string;
  records: number;
}

const mockSyncJobs: SyncJob[] = [
  {
    id: "sync-001",
    symbol: "EURUSD",
    timeframe: "TICK",
    dateRange: "2024-01-01 to 2024-01-31",
    status: "completed",
    progress: 100,
    size: "2.4 GB",
    records: 15000000
  },
  {
    id: "sync-002",
    symbol: "GBPUSD",
    timeframe: "M15",
    dateRange: "2024-01-01 to 2024-03-31",
    status: "syncing",
    progress: 67,
    size: "450 MB",
    records: 8640
  },
  {
    id: "sync-003",
    symbol: "USDJPY",
    timeframe: "H1",
    dateRange: "2023-01-01 to 2023-12-31",
    status: "pending",
    progress: 0,
    size: "120 MB",
    records: 8760
  }
];

export function DataSync() {
  const [s3Bucket, setS3Bucket] = useState("nanotrade-tick-data");
  const [s3Region, setS3Region] = useState("us-east-1");
  const [symbol, setSymbol] = useState("EURUSD");
  const [timeframe, setTimeframe] = useState("M15");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [syncJobs, setSyncJobs] = useState<SyncJob[]>(mockSyncJobs);
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleStartSync = () => {
    // Mock sync job creation
    const newJob: SyncJob = {
      id: `sync-${Date.now()}`,
      symbol: symbol || "EURUSD",
      timeframe: timeframe || "M15",
      dateRange: `${startDate || "2024-01-01"} to ${endDate || "2024-12-31"}`,
      status: "pending",
      progress: 0,
      size: "calculating...",
      records: 0
    };
    setSyncJobs([newJob, ...syncJobs]);
  };

  const getStatusIcon = (status: SyncJob["status"]) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="w-5 h-5 text-[var(--trade-bullish)]" />;
      case "syncing":
        return <RefreshCw className="w-5 h-5 text-[var(--accent-primary)] animate-spin" />;
      case "pending":
        return <Clock className="w-5 h-5 text-[var(--text-muted)]" />;
      case "failed":
        return <AlertCircle className="w-5 h-5 text-[var(--trade-bearish)]" />;
    }
  };

  const getStatusBadge = (status: SyncJob["status"]) => {
    const styles = {
      completed: "bg-[var(--trade-bullish)]/20 text-[var(--trade-bullish)] border-[var(--trade-bullish)]/30",
      syncing: "bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] border-[var(--accent-primary)]/30",
      pending: "bg-[var(--text-muted)]/20 text-[var(--text-muted)] border-[var(--text-muted)]/30",
      failed: "bg-[var(--trade-bearish)]/20 text-[var(--trade-bearish)] border-[var(--trade-bearish)]/30"
    };

    return (
      <Badge className={`${styles[status]} border text-xs`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  return (
    <div className="flex-1 p-6 space-y-6 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl text-[var(--text-primary)] mb-2 font-cyber glow-primary">DATA SYNC</h1>
          <p className="text-sm text-[var(--text-secondary)] font-mono-cyber">
            Sync historical tick data from AWS S3 storage
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-surface)] rounded-lg border border-[var(--accent-secondary)] neon-border-green">
          <Server className="w-4 h-4 text-[var(--accent-secondary)]" />
          <span className="text-sm text-[var(--accent-secondary)] font-mono-cyber">S3 CONNECTED</span>
        </div>
      </div>

      {/* S3 Configuration Card */}
      <div className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)] shadow-lg p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-gradient-to-br from-orange-500/20 to-orange-600/20 rounded-lg flex items-center justify-center">
            <Cloud className="w-5 h-5 text-orange-500" />
          </div>
          <div>
            <h2 className="text-lg text-[var(--text-primary)] font-cyber glow-primary">AWS S3 CONFIGURATION</h2>
            <p className="text-sm text-[var(--text-muted)] font-mono-cyber">Configure your S3 bucket connection</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="space-y-2">
            <Label className="text-[var(--text-secondary)] text-xs">S3 Bucket Name</Label>
            <Input
              value={s3Bucket}
              onChange={(e) => setS3Bucket(e.target.value)}
              placeholder="my-tick-data-bucket"
              className="bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[var(--text-secondary)] text-xs">AWS Region</Label>
            <Select value={s3Region} onValueChange={setS3Region}>
              <SelectTrigger className="bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="us-east-1">US East (N. Virginia)</SelectItem>
                <SelectItem value="us-west-1">US West (N. California)</SelectItem>
                <SelectItem value="us-west-2">US West (Oregon)</SelectItem>
                <SelectItem value="eu-west-1">EU (Ireland)</SelectItem>
                <SelectItem value="ap-southeast-1">Asia Pacific (Singapore)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button variant="outline" className="border-[var(--border-subtle)] text-[var(--text-secondary)]">
          Test Connection
        </Button>
      </div>

      {/* New Sync Job Card */}
      <div className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)] shadow-lg p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-gradient-to-br from-[var(--accent-primary)]/20 to-[var(--accent-secondary)]/20 rounded-lg flex items-center justify-center">
            <Download className="w-5 h-5 text-[var(--accent-primary)]" />
          </div>
          <div>
            <h2 className="text-lg text-[var(--text-primary)] font-cyber glow-primary">CREATE SYNC JOB</h2>
            <p className="text-sm text-[var(--text-muted)] font-mono-cyber">Configure and start a new data synchronization</p>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="space-y-2">
            <Label className="text-[var(--text-secondary)] text-xs">Symbol</Label>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]">
                <SelectValue placeholder="Select Symbol" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EURUSD">EURUSD</SelectItem>
                <SelectItem value="GBPUSD">GBPUSD</SelectItem>
                <SelectItem value="USDJPY">USDJPY</SelectItem>
                <SelectItem value="AUDUSD">AUDUSD</SelectItem>
                <SelectItem value="USDCHF">USDCHF</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-[var(--text-secondary)] text-xs">Timeframe</Label>
            <Select value={timeframe} onValueChange={setTimeframe}>
              <SelectTrigger className="bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]">
                <SelectValue placeholder="Select Timeframe" />
              </SelectTrigger>
              <SelectContent>
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
        </div>

        <Button
          onClick={handleStartSync}
          className="bg-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/90 text-white"
        >
          <Download className="w-4 h-4 mr-2" />
          Start Sync Job
        </Button>
      </div>

      {/* Direct CSV Upload Card */}
      <div className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)] shadow-lg p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-gradient-to-br from-[var(--trade-bullish)]/20 to-[var(--accent-secondary)]/20 rounded-lg flex items-center justify-center">
            <Download className="w-5 h-5 text-[var(--trade-bullish)]" />
          </div>
          <div>
            <h2 className="text-lg text-[var(--text-primary)] font-cyber glow-primary">UPLOAD CSV TO DATABASE</h2>
            <p className="text-sm text-[var(--text-muted)] font-mono-cyber">
              Upload Tick Data Suite CSV and insert into Postgres via API.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="space-y-2">
            <Label className="text-[var(--text-secondary)] text-xs">Symbol</Label>
            <Input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="EURUSD"
              className="bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[var(--text-secondary)] text-xs">Timeframe</Label>
            <Select value={timeframe} onValueChange={setTimeframe}>
              <SelectTrigger className="bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]">
                <SelectValue placeholder="M15" />
              </SelectTrigger>
              <SelectContent>
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
            <Label className="text-[var(--text-secondary)] text-xs">CSV File</Label>
            <div className="relative flex items-center gap-3 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg px-3 py-2">
              <input
                id="csv-upload"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                aria-hidden="true"
                tabIndex={-1}
                className="absolute w-px h-px -m-px overflow-hidden whitespace-nowrap border-0 p-0"
                style={{ clip: "rect(0, 0, 0, 0)" }}
              />
              <Button
                variant="outline"
                className="border-[var(--accent-primary)] text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10"
                onClick={() => {
                  const el = document.getElementById("csv-upload") as HTMLInputElement | null;
                  el?.click();
                }}
              >
                Choose File
              </Button>
              <span className="text-sm text-[var(--text-secondary)] font-mono truncate max-w-[220px]">
                {file ? file.name : "No file selected"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={async () => {
              if (!file) {
                setUploadError("Select a CSV file to upload.");
                return;
              }
              setUploadError(null);
              setUploadStatus(null);
              setIsUploading(true);
              try {
                const form = new FormData();
                form.append("file", file);
                if (symbol) form.append("symbol", symbol);
                if (timeframe) form.append("timeframe", timeframe);
                const apiBase = import.meta.env.VITE_API_URL || "http://localhost:4000";
                const res = await fetch(`${apiBase}/api/import`, {
                  method: "POST",
                  body: form
                });
                if (!res.ok) {
                  const text = await res.text();
                  throw new Error(text || `Upload failed (${res.status})`);
                }
                const json = await res.json();
                setUploadStatus(`Inserted ${json.inserted} rows into dataset ${json.dataset?.id || ""}`);
              } catch (err) {
                setUploadError((err as Error).message);
              } finally {
                setIsUploading(false);
              }
            }}
            disabled={isUploading}
            className="bg-[var(--trade-bullish)] hover:bg-[var(--trade-bullish)]/90 text-white"
          >
            {isUploading ? "Uploading..." : "Upload & Import"}
          </Button>
          {uploadStatus && (
            <span className="text-sm text-[var(--trade-bullish)] font-mono">{uploadStatus}</span>
          )}
          {uploadError && <span className="text-sm text-[var(--trade-bearish)] font-mono">{uploadError}</span>}
        </div>
      </div>

      {/* Sync Jobs List */}
      <div className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)] shadow-lg">
        <div className="p-6 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg text-[var(--text-primary)] font-cyber glow-primary">SYNC JOBS MONITOR</h2>
          <p className="text-sm text-[var(--text-muted)] font-mono-cyber">Monitor your data synchronization jobs</p>
        </div>

        <div className="divide-y divide-[var(--border-subtle)]">
          {syncJobs.map((job) => (
            <div key={job.id} className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-start gap-4">
                  {getStatusIcon(job.status)}
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="text-[var(--text-primary)]">
                        {job.symbol} · {job.timeframe}
                      </h3>
                      {getStatusBadge(job.status)}
                    </div>
                    <p className="text-sm text-[var(--text-muted)] mb-2">{job.dateRange}</p>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-[var(--text-secondary)]">
                        Size: <span className="font-mono">{job.size}</span>
                      </span>
                      {job.records > 0 && (
                        <span className="text-[var(--text-secondary)]">
                          Records: <span className="font-mono">{job.records.toLocaleString()}</span>
                        </span>
                      )}
                      <span className="text-[var(--text-muted)]">
                        ID: <span className="font-mono">{job.id}</span>
                      </span>
                    </div>
                  </div>
                </div>

                {job.status === "syncing" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[var(--text-secondary)]"
                  >
                    Cancel
                  </Button>
                )}
                {job.status === "completed" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[var(--accent-primary)]"
                  >
                    View Dataset
                  </Button>
                )}
              </div>

              {job.status === "syncing" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-muted)]">Progress</span>
                    <span className="text-[var(--text-primary)] font-mono">{job.progress}%</span>
                  </div>
                  <Progress value={job.progress} className="h-2" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
