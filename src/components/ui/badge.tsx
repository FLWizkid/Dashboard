import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, FlaskConical, OctagonAlert } from 'lucide-react';
import { IDENTITIES, type Identity } from '@/lib/types';
import { cn } from '@/lib/utils';

export function Badge({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex h-5 items-center gap-1 rounded border border-line bg-raised px-1.5 text-xs font-medium text-muted [&_svg]:size-3', className)}>
      {children}
    </span>
  );
}

export function DemoBadge() {
  return (
    <Badge className="border-warning-500/50 bg-warning-500/15 text-warning-800 dark:text-warning-300" title="This panel includes seeded demo data. Turn it off in Settings.">
      <FlaskConical />
      DEMO DATA
    </Badge>
  );
}

export function IdentityBadge({ identity, compact }: { identity: Identity | null; compact?: boolean }) {
  const def = IDENTITIES.find((i) => i.value === identity);
  if (!def) {
    return (
      <Badge className="border-warning-500/50 bg-warning-500/10 text-warning-800 dark:text-warning-300" title="Identity not chosen yet">
        <AlertTriangle />
        {compact ? 'Set identity' : 'Identity unset'}
      </Badge>
    );
  }
  return (
    <Badge className={def.tone} title={`${def.label} (${def.address})`}>
      {def.label}
    </Badge>
  );
}

export type HealthStatus = 'healthy' | 'attention' | 'action' | 'unknown';

const STATUS: Record<HealthStatus, { label: string; icon: typeof CheckCircle2; cls: string; dot: string }> = {
  healthy: { label: 'Healthy', icon: CheckCircle2, cls: 'text-success-700 dark:text-success-400 bg-success-500/10 border-success-500/40', dot: 'bg-success-500' },
  attention: { label: 'Attention', icon: AlertTriangle, cls: 'text-warning-800 dark:text-warning-400 bg-warning-500/10 border-warning-500/40', dot: 'bg-warning-500' },
  action: { label: 'Action needed', icon: OctagonAlert, cls: 'text-error-700 dark:text-error-400 bg-error-500/10 border-error-500/40', dot: 'bg-error-500' },
  unknown: { label: 'Not connected', icon: CircleDashed, cls: 'text-muted bg-raised border-line', dot: 'bg-subtle' },
};

export function StatusPill({ status, label }: { status: HealthStatus; label?: string }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs font-medium', s.cls)}>
      <Icon className="size-3.5" />
      {label ?? s.label}
    </span>
  );
}
