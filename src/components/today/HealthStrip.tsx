import { Link } from 'react-router-dom';
import { Activity, ChevronRight } from 'lucide-react';
import { relativeTime } from '@/lib/utils';
import { useAutoRunStaleChecks, useOpsHealth } from '@/data/ops';
import { StatusPill } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function HealthStrip() {
  const ops = useOpsHealth();
  const run = useAutoRunStaleChecks();
  const shown = ops.health.slice(0, 6);

  return (
    <section className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2">
      <Activity className="size-4 text-subtle" />
      <h2 className="text-sm font-semibold">Health lights</h2>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {ops.loading ? (
          <div className="skeleton h-6 w-64" aria-label="Loading" />
        ) : ops.error ? (
          <span className="text-sm text-error-700 dark:text-error-300">Could not load health lights.</span>
        ) : shown.length === 0 ? (
          <span className="text-sm text-subtle">Nothing is being watched yet.</span>
        ) : (
          shown.map((h) => (
            <Link key={h.monitor.id} to="/ops" title={h.summary} className="rounded-full transition-opacity hover:opacity-80">
              <StatusPill status={h.status} label={`${h.monitor.label}: ${h.label}`} />
            </Link>
          ))
        )}
        {ops.health.length > shown.length && <span className="text-xs text-subtle">+{ops.health.length - shown.length} more</span>}
      </div>
      <span className="hidden text-xs text-subtle sm:inline">{run.isPending ? 'Checking now...' : `Checked ${relativeTime(ops.lastChecked)}`}</span>
      <Button asChild size="sm" variant="ghost">
        <Link to="/ops">Open <ChevronRight /></Link>
      </Button>
    </section>
  );
}
