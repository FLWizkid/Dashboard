import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, BellRing, CircleDashed, Fingerprint, ListTodo } from 'lucide-react';
import { toDateKey } from '@/lib/utils';
import { SETUP } from '@/lib/integrations';
import { useTasks, isOverdue } from '@/data/tasks';
import { useCompanies } from '@/data/organization';
import { useOpsHealth } from '@/data/ops';
import { Panel, EmptyState } from '@/components/ui/panel';
import { NotConnected } from '@/components/ui/field';
import { StatusPill } from '@/components/ui/badge';
import { TaskRow } from '@/components/tasks/TaskRow';
import { QuickAdd } from '@/components/tasks/QuickAdd';

const PENDING_SOURCES = [
  { label: 'Critical unread mail (VIP / flagged)', phase: 4 },
  { label: 'Renewals due in 14 days or less', phase: 3 },
  { label: 'Open partner IT requests', phase: 3 },
  { label: 'Failed or missed agent runs', phase: 3 },
];

export function NeedsAttention() {
  const tasks = useTasks();
  const { data: companies = [] } = useCompanies();
  const today = toDateKey(new Date());
  const overdue = (tasks.data ?? []).filter((t) => isOverdue(t, today));
  const unset = (tasks.data ?? []).filter((t) => t.status !== 'done' && !t.identity);
  const ops = useOpsHealth();
  const red = ops.health.filter((h) => h.status === 'action');

  return (
    <Panel
      title="Needs attention"
      icon={<BellRing />}
      demo={overdue.some((t) => t.is_demo)}
      updatedAt={tasks.dataUpdatedAt}
      onRefresh={() => tasks.refetch()}
      refreshing={tasks.isFetching}
      loading={tasks.isLoading}
      error={tasks.error}
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <AlertTriangle className="size-4 text-error-500" />
            <p className="flex-1 text-sm font-medium">Overdue tasks</p>
            <StatusPill status={overdue.length ? 'action' : 'healthy'} label={overdue.length ? `${overdue.length} overdue` : 'None overdue'} />
          </div>
          {overdue.slice(0, 5).map((t) => <TaskRow key={t.id} task={t} companies={companies} />)}
          {overdue.length > 5 && <Link to="/tasks" className="block px-2 text-xs text-primary-600 hover:underline dark:text-primary-400">+{overdue.length - 5} more in Tasks</Link>}
        </div>
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Activity className="size-4 text-error-500" />
            <p className="flex-1 text-sm font-medium">Red health lights</p>
            {ops.loading ? (
              <span className="skeleton h-6 w-24" aria-label="Loading" />
            ) : ops.error ? (
              <StatusPill status="unknown" label="Could not load" />
            ) : (
              <StatusPill status={red.length ? 'action' : 'healthy'} label={red.length ? `${red.length} red` : 'None red'} />
            )}
          </div>
          {red.map((h) => (
            <Link key={h.monitor.id} to="/ops" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-raised">
              <span className="min-w-0 flex-1 truncate"><span className="font-medium">{h.monitor.label}</span> <span className="text-muted">{h.summary}</span></span>
            </Link>
          ))}
        </div>
        {unset.length > 0 && (
          <Link to="/tasks?identity=unset" className="flex items-center gap-2 rounded-md border border-warning-500/40 bg-warning-500/10 px-3 py-2 text-sm transition-colors hover:bg-warning-500/15">
            <Fingerprint className="size-4 text-warning-600 dark:text-warning-400" />
            <span className="flex-1">{unset.length} open {unset.length === 1 ? 'task has' : 'tasks have'} no identity yet</span>
            <span className="text-xs font-medium text-warning-800 dark:text-warning-300">Review</span>
          </Link>
        )}
        <ul className="space-y-1 border-t border-line pt-3">
          {PENDING_SOURCES.map((s) => (
            <li key={s.label} className="flex items-center gap-2 text-sm text-subtle">
              <CircleDashed className="size-3.5" />
              <span className="flex-1">{s.label}</span>
              <span className="text-xs">Not connected · Phase {s.phase}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

export function DueToday() {
  const tasks = useTasks();
  const { data: companies = [] } = useCompanies();
  const today = toDateKey(new Date());
  const rows = (tasks.data ?? []).filter((t) => t.status !== 'done' && t.due_date && t.due_date <= today);
  const doneToday = (tasks.data ?? []).filter((t) => t.status === 'done' && t.completed_at && toDateKey(new Date(t.completed_at)) === today);

  return (
    <Panel
      title="Due today and overdue"
      icon={<ListTodo />}
      subtitle={doneToday.length ? `${doneToday.length} completed today` : undefined}
      demo={rows.some((t) => t.is_demo)}
      updatedAt={tasks.dataUpdatedAt}
      onRefresh={() => tasks.refetch()}
      refreshing={tasks.isFetching}
      loading={tasks.isLoading}
      error={tasks.error}
    >
      <div className="mb-3">
        <QuickAdd defaultDue={today} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nothing due today" text="You are clear. Pull something forward from Tasks, or add a task above." />
      ) : (
        <div className="-mx-2">{rows.map((t) => <TaskRow key={t.id} task={t} companies={companies} />)}</div>
      )}
    </Panel>
  );
}

export function NotConnectedPanel({ title, icon, setup }: { title: string; icon: ReactNode; setup: keyof typeof SETUP }) {
  return (
    <Panel title={title} icon={icon} subtitle={`Phase ${SETUP[setup].phase}`}>
      <NotConnected title={title} info={SETUP[setup]} />
    </Panel>
  );
}
