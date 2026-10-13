import { useEffect, useState, type ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { cn, errorMessage, relativeTime } from '@/lib/utils';
import { Button } from './button';
import { DemoBadge } from './badge';

function useTick(ms = 30_000) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

interface PanelProps {
  title: string;
  icon?: ReactNode;
  subtitle?: ReactNode;
  demo?: boolean;
  updatedAt?: number;
  onRefresh?: () => void;
  refreshing?: boolean;
  actions?: ReactNode;
  loading?: boolean;
  error?: unknown;
  empty?: boolean;
  emptyState?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}

export function Panel(props: PanelProps) {
  const { title, icon, subtitle, demo, updatedAt, onRefresh, refreshing, actions, loading, error, empty, emptyState, className, bodyClassName, children } = props;
  useTick();
  return (
    <section className={cn('flex min-w-0 flex-col rounded-lg border border-line bg-surface animate-fade-in', className)}>
      <header className="flex min-h-[36px] items-center gap-2 border-b border-line px-3 py-1">
        {icon && <span className="text-subtle [&_svg]:size-4">{icon}</span>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-sm font-semibold">{title}</h2>
            {demo && <DemoBadge />}
          </div>
          {subtitle && <p className="truncate text-xs text-subtle">{subtitle}</p>}
        </div>
        {actions}
        {updatedAt !== undefined && (
          <span className="hidden text-xs text-subtle sm:inline" title={updatedAt ? new Date(updatedAt).toLocaleString() : undefined}>
            Updated {relativeTime(updatedAt || null)}
          </span>
        )}
        {onRefresh && (
          <Button variant="ghost" size="iconSm" onClick={onRefresh} aria-label={`Refresh ${title}`} title="Refresh">
            <RefreshCw className={cn(refreshing && 'animate-spin')} />
          </Button>
        )}
      </header>
      <div className={cn('flex-1 p-3', bodyClassName)}>
        {loading ? (
          <PanelSkeleton />
        ) : error ? (
          <PanelError error={error} onRetry={onRefresh} />
        ) : empty ? (
          emptyState
        ) : (
          children
        )}
      </div>
    </section>
  );
}

export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-5" style={{ width: `${90 - i * 15}%` }} />
      ))}
    </div>
  );
}

export function PanelError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-error-500/40 bg-error-500/10 p-3 text-sm">
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-error-600 dark:text-error-400" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-error-700 dark:text-error-300">Could not load this panel</p>
        <p className="text-muted">{errorMessage(error)}. Check your connection, then try again.</p>
      </div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-2 text-center">
      {icon && <div className="text-subtle [&_svg]:size-6">{icon}</div>}
      <p className="font-medium">{title}</p>
      {text && <p className="max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
