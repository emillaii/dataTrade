import { Database, BarChart3, Play, Settings, FileText, Download, TrendingUp } from "lucide-react";
import { cn } from "./ui/utils";

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: string;
}

interface LeftSidebarProps {
  currentSection: string;
  onSectionChange: (section: string) => void;
}

const navItems: NavItem[] = [
  {
    id: "data-sync",
    label: "Data Sync",
    icon: <Download className="w-5 h-5" />,
    badge: "New"
  },
  {
    id: "datasets",
    label: "Datasets",
    icon: <Database className="w-5 h-5" />
  },
  {
    id: "simulation",
    label: "Simulation",
    icon: <Play className="w-5 h-5" />
  },
  {
    id: "analytics",
    label: "Analytics",
    icon: <BarChart3 className="w-5 h-5" />
  },
  {
    id: "strategies",
    label: "Strategies",
    icon: <TrendingUp className="w-5 h-5" />
  },
  {
    id: "reports",
    label: "Reports",
    icon: <FileText className="w-5 h-5" />
  }
];

export function LeftSidebar({ currentSection, onSectionChange }: LeftSidebarProps) {
  return (
    <aside className="w-64 bg-[var(--bg-surface)] border-r border-[var(--border-subtle)] flex flex-col">
      {/* Logo Section */}
      <div className="h-16 px-6 flex items-center border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-[var(--accent-primary)] to-[var(--accent-secondary)] rounded-lg flex items-center justify-center neon-border">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl text-[var(--text-primary)] font-cyber glow-primary">NanoTrade</span>
        </div>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 p-4 space-y-1">
        <div className="mb-4">
          <p className="px-3 text-xs text-[var(--text-muted)] mb-2 font-cyber">MAIN MENU</p>
        </div>
        
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onSectionChange(item.id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
              currentSection === item.id
                ? "bg-[var(--accent-primary)] text-white shadow-lg shadow-[var(--accent-primary)]/20"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            )}
          >
            <span className={cn(
              currentSection === item.id ? "text-white" : "text-[var(--text-secondary)]"
            )}>
              {item.icon}
            </span>
            <span className="flex-1 text-left text-sm">{item.label}</span>
            {item.badge && currentSection !== item.id && (
              <span className="px-2 py-0.5 bg-[var(--accent-secondary)]/20 text-[var(--accent-secondary)] text-xs rounded-full">
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Bottom Section */}
      <div className="p-4 border-t border-[var(--border-subtle)]">
        <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] transition-all duration-200">
          <Settings className="w-5 h-5" />
          <span className="flex-1 text-left text-sm">Settings</span>
        </button>

        <div className="mt-4 p-3 bg-gradient-to-br from-[var(--accent-primary)]/10 to-[var(--accent-secondary)]/10 rounded-lg border border-[var(--accent-primary)]/20">
          <p className="text-xs text-[var(--text-primary)] mb-1">Pro Plan</p>
          <p className="text-xs text-[var(--text-muted)]">Unlimited data sync</p>
        </div>
      </div>
    </aside>
  );
}