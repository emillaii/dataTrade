import { BarChart3 } from "lucide-react";

export function Analytics() {
  return (
    <div className="flex-1 p-6 space-y-6 overflow-auto">
      <div>
        <h1 className="text-2xl text-[var(--text-primary)] mb-2">Analytics</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Analyze your trading performance and strategies
        </p>
      </div>

      <div className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)] shadow-lg p-12 flex flex-col items-center justify-center min-h-[500px]">
        <div className="w-16 h-16 bg-gradient-to-br from-[var(--accent-primary)]/20 to-[var(--accent-secondary)]/20 rounded-full flex items-center justify-center mb-4">
          <BarChart3 className="w-8 h-8 text-[var(--accent-primary)]" />
        </div>
        <h3 className="text-xl text-[var(--text-primary)] mb-2">Analytics Dashboard</h3>
        <p className="text-[var(--text-muted)] text-center max-w-md">
          Coming soon: Advanced analytics and performance metrics for your trading strategies.
        </p>
      </div>
    </div>
  );
}
