import { Settings, ChevronRight } from "lucide-react";
import { Avatar, AvatarFallback } from "./ui/avatar";

interface NavigationProps {
  title: string;
  breadcrumb?: string;
  rightContent?: React.ReactNode;
}

export function Navigation({ title, breadcrumb, rightContent }: NavigationProps) {
  return (
    <header className="h-16 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] flex items-center justify-between px-6">
      <div className="flex items-center gap-4">
        <div className="text-[var(--text-primary)] flex items-center gap-2">
          <span className="text-xl font-cyber glow-primary">{title}</span>
          {breadcrumb && (
            <>
              <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
              <span className="text-sm text-[var(--text-secondary)] font-mono-cyber">{breadcrumb}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        {rightContent}
        <button className="p-2 hover:bg-[var(--bg-surface)] rounded-lg transition-colors">
          <Settings className="w-5 h-5 text-[var(--text-secondary)]" />
        </button>
        <Avatar className="w-8 h-8">
          <AvatarFallback className="bg-[var(--accent-primary)] text-white text-xs">
            NT
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}