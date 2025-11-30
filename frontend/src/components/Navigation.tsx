import { Settings, ChevronRight, Menu, X } from "lucide-react";
import { Avatar, AvatarFallback } from "./ui/avatar";

interface NavigationProps {
  title: string;
  breadcrumb?: string;
  rightContent?: React.ReactNode;
  onMenuToggle?: () => void;
  isMenuOpen?: boolean;
}

export function Navigation({ title, breadcrumb, rightContent, onMenuToggle, isMenuOpen }: NavigationProps) {
  return (
    <header className="h-16 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] flex items-center justify-between px-4 sm:px-6">
      <div className="flex items-center gap-3 sm:gap-4">
        {onMenuToggle && (
          <button
            onClick={onMenuToggle}
            className="p-2 rounded-lg hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] transition-colors lg:hidden"
            aria-label="Toggle navigation"
          >
            {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        )}
        <div className="text-[var(--text-primary)] flex items-center gap-2">
          <span className="text-lg sm:text-xl font-cyber glow-primary line-clamp-1">{title}</span>
          {breadcrumb && (
            <>
              <ChevronRight className="w-4 h-4 text-[var(--text-muted)] hidden sm:block" />
              <span className="hidden sm:block text-sm text-[var(--text-secondary)] font-mono-cyber">{breadcrumb}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 sm:gap-4">
        {rightContent}
        <button className="p-2 hover:bg-[var(--bg-surface)] rounded-lg transition-colors">
          <Settings className="w-5 h-5 text-[var(--text-secondary)]" />
        </button>
        <Avatar className="w-9 h-9">
          <AvatarFallback className="bg-[var(--accent-primary)] text-white text-xs">
            NT
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
