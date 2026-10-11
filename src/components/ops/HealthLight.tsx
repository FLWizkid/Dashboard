import { format } from 'date-fns';
import { Database, Globe, Hand, Mail, MonitorSmartphone } from 'lucide-react';
import type { CheckResult, CheckStatus, MonitorKind } from '@/lib/types';
import { cn, relativeTime } from '@/lib/utils';
import type { MonitorHealth } from '@/data/ops';
import { IdentityBadge, StatusPill } from '@/components/ui/badge';

export const KIND_ICON: Record<MonitorKind, typeof Globe> = {
  domain: Globe,
  email_auth: Mail,
  website: MonitorSmartphone,
  database: Database,
  manual: Hand,
};

const DOT: Record<CheckStatus, string> = {
  healthy: 'bg-success-500',
  attention: 'bg-warning-500',
  action: 'bg-error-500',
  unknown: 'bg-neutral-400 dark:bg-neutral-600',
};

const ACCENT: Record<CheckStatus, string> = {
  healthy: 'before:bg-success-500',
  attention: 'before:bg-warning-500',
  action: 'before:bg-error-500',
  unknown: 'before:bg-transparent',
};

export function HistoryStrip({ history, max = 14 }: { history: CheckResult[]; max?: number }) {
  const items = history.slice(0, max).reverse();
  const counts = items.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  const label = `Last ${items.length} results: ${Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(', ')}`;
  return (
    <div className="flex items-end gap-0.5" role="img" aria-label={label}>
      {items.map((r) => (
        <span
          key={r.id}
          title={`${format(new Date(r.checked_at), 'MMM d, h:mm a')}: ${r.summary}`}
          className={cn('h-4 w-1.5 rounded-sm', DOT[r.status], r.status === 'unknown' && 'h-2')}
        />
      ))}
    </div>
  );
}

export function HealthLight({ health, onOpen }: { health: MonitorHealth; onOpen: () => void }) {
  const { monitor, latest, history } = health;
  const Icon = KIND_ICON[monitor.kind];
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group relative flex w-full flex-col gap-2 overflow-hidden rounded-lg border border-line bg-surface p-4 text-left transition-all',
        'before:absolute before:inset-y-0 before:left-0 before:w-1 hover:-translate-y-px hover:border-primary-500/50 hover:shadow-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
        ACCENT[health.status],
        !monitor.enabled && 'opacity-70',
      )}
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-subtle" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{monitor.label}</p>
          {monitor.target && <p className="truncate text-xs text-subtle">{monitor.target}</p>}
        </div>
        <StatusPill status={health.status} label={health.label} />
      </div>
      <p className="line-clamp-2 min-h-[40px] text-sm text-muted">{health.summary}</p>
      <div className="flex items-center gap-2">
        {!monitor.identity && <IdentityBadge identity={null} compact />}
        <span className="flex-1 text-xs text-subtle">{latest ? `Checked ${relativeTime(latest.checked_at)}` : 'No result yet'}</span>
        {history.length > 1 && <HistoryStrip history={history} />}
      </div>
    </button>
  );
}
