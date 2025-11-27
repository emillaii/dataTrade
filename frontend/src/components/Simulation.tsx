import { Play, Settings, TrendingUp } from "lucide-react";
import { Button } from "./ui/button";

export function Simulation() {
  return (
    <div className="flex-1 p-6 space-y-6 overflow-auto">
      <div>
        <h1 className="text-2xl text-[var(--text-primary)] mb-2">Simulation</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Run backtesting simulations on your strategies
        </p>
      </div>

      <div className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)] shadow-lg p-12 flex flex-col items-center justify-center min-h-[500px]">
        <div className="w-16 h-16 bg-gradient-to-br from-[var(--accent-primary)]/20 to-[var(--accent-secondary)]/20 rounded-full flex items-center justify-center mb-4">
          <Play className="w-8 h-8 text-[var(--accent-primary)]" />
        </div>
        <h3 className="text-xl text-[var(--text-primary)] mb-2">Simulation Engine</h3>
        <p className="text-[var(--text-muted)] text-center max-w-md mb-6">
          Configure and run backtesting simulations with historical data to validate your trading strategies.
        </p>
        <Button className="bg-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/90 text-white">
          <Settings className="w-4 h-4 mr-2" />
          Configure Simulation
        </Button>
      </div>
    </div>
  );
}
