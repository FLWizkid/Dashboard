import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, Columns3, List, Search } from 'lucide-react';
import { IDENTITIES, PRIORITIES } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useTasks } from '@/data/tasks';
import { useCompanies, useProjects } from '@/data/organization';
import { Panel } from '@/components/ui/panel';
import { Select } from '@/components/ui/field';
import { QuickAdd } from '@/components/tasks/QuickAdd';
import { TaskListView } from '@/components/tasks/TaskListView';
import { TaskBoardView } from '@/components/tasks/TaskBoardView';
import { TaskCalendarView } from '@/components/tasks/TaskCalendarView';

const VIEWS = [
  { value: 'list', label: 'List', icon: List },
  { value: 'board', label: 'Board', icon: Columns3 },
  { value: 'calendar', label: 'Calendar', icon: CalendarDays },
] as const;

export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') ?? 'list') as (typeof VIEWS)[number]['value'];
  const identity = params.get('identity') ?? '';
  const company = params.get('company') ?? '';
  const project = params.get('project') ?? '';
  const priority = params.get('priority') ?? '';
  const [q, setQ] = useState('');
  const [showHidden, setShowHidden] = useState(false);

  const tasks = useTasks();
  const { data: companies = [] } = useCompanies();
  const { data: projects = [] } = useProjects();

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (tasks.data ?? []).filter(
      (t) =>
        (!term || t.title.toLowerCase().includes(term) || (t.category ?? '').toLowerCase().includes(term)) &&
        (!identity || (identity === 'unset' ? !t.identity : t.identity === identity)) &&
        (!company || t.company_id === company) &&
        (!project || t.project_id === project) &&
        (!priority || t.priority === priority),
    );
  }, [tasks.data, q, identity, company, project, priority]);

  const anyFilter = q || identity || company || project || priority;

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <div className="ml-auto flex rounded-md border border-line bg-surface p-0.5" role="tablist">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              role="tab"
              aria-selected={view === v.value}
              onClick={() => setParam('view', v.value === 'list' ? '' : v.value)}
              className={cn('flex h-7 items-center gap-1.5 rounded px-3 text-sm transition-colors', view === v.value ? 'bg-raised font-medium text-fg' : 'text-muted hover:text-fg')}
            >
              <v.icon className="size-4" /> {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface p-4">
        <QuickAdd />
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <input className="input pl-8" placeholder="Filter tasks" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="w-auto" value={identity} onChange={(e) => setParam('identity', e.target.value)} aria-label="Identity filter">
          <option value="">All identities</option>
          <option value="unset">Identity unset</option>
          {IDENTITIES.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
        </Select>
        <Select className="w-auto" value={company} onChange={(e) => setParam('company', e.target.value)} aria-label="Company filter">
          <option value="">All companies</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select className="w-auto" value={project} onChange={(e) => setParam('project', e.target.value)} aria-label="Project filter">
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select className="w-auto" value={priority} onChange={(e) => setParam('priority', e.target.value)} aria-label="Priority filter">
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </Select>
        {anyFilter && (
          <button className="text-sm text-primary-600 hover:underline dark:text-primary-400" onClick={() => { setQ(''); setParams(view === 'list' ? {} : { view }, { replace: true }); }}>
            Clear filters
          </button>
        )}
      </div>

      <Panel
        title={VIEWS.find((v) => v.value === view)?.label ?? 'List'}
        subtitle={`${filtered.filter((t) => t.status !== 'done').length} open`}
        demo={filtered.some((t) => t.is_demo)}
        updatedAt={tasks.dataUpdatedAt}
        onRefresh={() => tasks.refetch()}
        refreshing={tasks.isFetching}
        loading={tasks.isLoading}
        error={tasks.error}
      >
        {view === 'board' ? (
          <TaskBoardView tasks={filtered} companies={companies} />
        ) : view === 'calendar' ? (
          <TaskCalendarView tasks={filtered} />
        ) : (
          <div className="-mx-2"><TaskListView tasks={filtered} companies={companies} showHidden={showHidden} onShowHidden={() => setShowHidden(true)} /></div>
        )}
      </Panel>
    </div>
  );
}
