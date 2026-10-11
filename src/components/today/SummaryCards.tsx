import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Activity, CalendarCheck, ChevronRight, Clock, UserRoundX } from 'lucide-react';
import { formatMinutes, toDateKey } from '@/lib/utils';
import { isOverdue, useTasks } from '@/data/tasks';
import { useTimeEntries, weekRange } from '@/data/time';
import { useOpsHealth } from '@/data/ops';
import { StatusPill, type HealthStatus } from '@/components/ui/badge';

interface CardProps {
  to: string;
  icon: ReactNode;
  label: string;
  loading: boolean;
  error: unknown;
  value: string;
  status: HealthStatus;
  statusLabel: string;
}

function SummaryCard({ to, icon, label, loading, error, value, status, statusLabel }: CardProps) {
  return (
    <Link
      to={to}
      className="group flex flex-col gap-2 rounded-lg border border-line bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-primary-500/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <div className="flex items-center gap-2 text-sm text-muted [&_svg]:size-4">
        {icon}
        <span className="flex-1">{label}</span>
        <ChevronRight className="opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      {loading ? (
        <>
          <div className="skeleton h-8 w-20" aria-label="Loading" />
          <div className="skeleton h-6 w-28" />
        </>
      ) : error ? (
        <p className="text-sm text-error-700 dark:text-error-300">Could not load. Open to retry.</p>
      ) : (
        <>
          <p className="text-2xl font-semibold tabular-nums text-fg">{value}</p>
          <div><StatusPill status={status} label={statusLabel} /></div>
        </>
      )}
    </Link>
  );
}

export function SummaryCards() {
  const tasks = useTasks();
  const range = useMemo(() => weekRange(new Date()), []);
  const time = useTimeEntries(range.start, range.end);
  const ops = useOpsHealth();

  const t = useMemo(() => {
    const today = toDateKey(new Date());
    const open = (tasks.data ?? []).filter((x) => x.status !== 'done');
    return {
      dueToday: open.filter((x) => x.due_date === today).length,
      overdue: open.filter((x) => isOverdue(x, today)).length,
      unset: open.filter((x) => !x.identity).length,
    };
  }, [tasks.data]);

  const weekMinutes = (time.data ?? []).reduce((sum, e) => sum + e.minutes, 0);
  const red = ops.health.filter((h) => h.status === 'action').length;
  const amber = ops.health.filter((h) => h.status === 'attention').length;
  const healthy = ops.health.filter((h) => h.status === 'healthy').length;

  return (
    <section aria-label="Today at a glance" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard
        to="/tasks"
        icon={<CalendarCheck />}
        label="Due today"
        loading={tasks.isLoading}
        error={tasks.error}
        value={String(t.dueToday)}
        status={t.overdue ? 'action' : 'healthy'}
        statusLabel={t.overdue ? `${t.overdue} overdue` : 'Nothing overdue'}
      />
      <SummaryCard
        to="/time"
        icon={<Clock />}
        label="Logged this week"
        loading={time.isLoading}
        error={time.error}
        value={formatMinutes(weekMinutes)}
        status={weekMinutes ? 'healthy' : 'unknown'}
        statusLabel={weekMinutes ? `${time.data?.length ?? 0} entries` : 'No time logged yet'}
      />
      <SummaryCard
        to="/ops"
        icon={<Activity />}
        label="Health lights"
        loading={ops.loading}
        error={ops.error}
        value={ops.health.length ? `${healthy}/${ops.health.length}` : '0'}
        status={red ? 'action' : amber ? 'attention' : ops.health.length ? 'healthy' : 'unknown'}
        statusLabel={red ? `${red} need action` : amber ? `${amber} need attention` : ops.health.length ? 'All healthy' : 'Nothing watched yet'}
      />
      <SummaryCard
        to="/tasks?identity=unset"
        icon={<UserRoundX />}
        label="Identity not chosen"
        loading={tasks.isLoading}
        error={tasks.error}
        value={String(t.unset)}
        status={t.unset ? 'attention' : 'healthy'}
        statusLabel={t.unset ? 'Pick an identity' : 'All set'}
      />
    </section>
  );
}
