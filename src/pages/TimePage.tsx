import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addWeeks, format, isSameWeek, subWeeks } from 'date-fns';
import { BarChart3, ChevronLeft, ChevronRight, Clock, ListChecks, Pencil, Play, Timer } from 'lucide-react';
import { TIME_CATEGORIES, categoryLabel, type TimeEntry } from '@/lib/types';
import { cn, formatMinutes } from '@/lib/utils';
import { useCompanies } from '@/data/organization';
import { useFocusHistory, useTimeEntries, weekRange } from '@/data/time';
import { Panel, EmptyState } from '@/components/ui/panel';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Badge, DemoBadge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { LogTimeForm } from '@/components/time/LogTimeForm';
import { TimeEntryEditor } from '@/components/time/TimeEntryEditor';
import { useUi } from '@/components/shell/ui-context';

const TABS = [
  { key: 'overview', label: 'Overview', to: '/time', icon: BarChart3 },
  { key: 'entries', label: 'Entries', to: '/time?tab=entries', icon: ListChecks },
  { key: 'focus', label: 'Focus sessions', to: '/time?tab=focus', icon: Timer },
];

const FOCUS_STATUS = { running: 'Running', completed: 'Completed', cancelled: 'Cancelled' } as const;

export function TimePage() {
  const [anchor, setAnchor] = useState(() => new Date());
  const { start, end } = weekRange(anchor);
  const entries = useTimeEntries(start, end);
  const focus = useFocusHistory(start, end);
  const { data: companies = [] } = useCompanies();
  const { openFocus } = useUi();
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const isThisWeek = isSameWeek(anchor, new Date(), { weekStartsOn: 1 });
  const [params] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab')! : 'overview';

  const rows = entries.data ?? [];
  const total = rows.reduce((s, e) => s + e.minutes, 0);
  const byCategory = useMemo(
    () => TIME_CATEGORIES.map((c) => ({ ...c, minutes: rows.filter((e) => e.category === c.value).reduce((s, e) => s + e.minutes, 0) })),
    [rows],
  );
  const byCompany = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of rows) m.set(e.company_id ?? '', (m.get(e.company_id ?? '') ?? 0) + e.minutes);
    return [...m.entries()]
      .map(([id, minutes]) => ({ name: companies.find((c) => c.id === id)?.name ?? 'No company', minutes }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [rows, companies]);
  const max = Math.max(1, ...byCategory.map((c) => c.minutes));

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <PageHeader
        title="Time & Focus"
        description={`${formatMinutes(total)} logged ${isThisWeek ? 'this week' : `the week of ${format(start, 'MMM d')}`}.`}
        tabs={TABS.map((t) => ({ ...t, count: t.key === 'entries' ? rows.length : t.key === 'focus' ? (focus.data ?? []).length : undefined }))}
        activeTab={tab}
        actions={
          <>
            <div className="flex items-center gap-1 rounded-md border border-line bg-surface p-0.5">
              <Button size="iconSm" variant="ghost" onClick={() => setAnchor((a) => subWeeks(a, 1))} aria-label="Previous week"><ChevronLeft /></Button>
              <span className="min-w-[140px] text-center text-sm font-medium">{format(start, 'MMM d')} – {format(end, 'MMM d')}</span>
              <Button size="iconSm" variant="ghost" onClick={() => setAnchor((a) => addWeeks(a, 1))} aria-label="Next week"><ChevronRight /></Button>
            </div>
            {!isThisWeek && <Button size="sm" variant="ghost" onClick={() => setAnchor(new Date())}>This week</Button>}
            <Button variant="primary" size="sm" onClick={openFocus}><Play /> Start focus</Button>
          </>
        }
      />

      {tab === 'overview' && (
        <div className="grid gap-4 animate-fade-in lg:grid-cols-12">
          <div className="lg:col-span-8">
          <Panel
            title="Weekly report"
            icon={<BarChart3 />}
            subtitle={`${formatMinutes(total)} logged`}
            demo={rows.some((e) => e.is_demo)}
            updatedAt={entries.dataUpdatedAt}
            onRefresh={() => entries.refetch()}
            refreshing={entries.isFetching}
            loading={entries.isLoading}
            error={entries.error}
            empty={rows.length === 0}
            emptyState={<EmptyState icon={<Clock />} title="No time logged this week" text="Log time with the form beside this, or finish a focus session." />}
          >
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">By category</h3>
                <ul className="space-y-2">
                  {byCategory.map((c) => (
                    <li key={c.value} className="grid grid-cols-[110px_1fr_56px] items-center gap-2 text-sm">
                      <span className="truncate text-muted">{c.label}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-raised">
                        <span className={cn('block h-full rounded-full transition-[width] duration-500', c.bar)} style={{ width: `${(c.minutes / max) * 100}%` }} />
                      </span>
                      <span className="text-right font-mono">{formatMinutes(c.minutes)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-subtle">By company</h3>
                <ul className="divide-y divide-line">
                  {byCompany.map((c) => (
                    <li key={c.name} className="flex items-center justify-between py-1.5 text-sm">
                      <span>{c.name}</span>
                      <span className="font-mono text-muted">{formatMinutes(c.minutes)} <span className="text-subtle">· {Math.round((c.minutes / total) * 100)}%</span></span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Panel>

          </div>
          <div className="lg:col-span-4">
          <Panel title="Log time" icon={<Clock />}>
            <LogTimeForm layout="stack" />
          </Panel>
          </div>
        </div>
      )}
      {tab === 'entries' && <div className="animate-fade-in">
          <Panel
            title="Entries"
            icon={<ListChecks />}
            subtitle={`${rows.length} this week`}
            demo={rows.some((e) => e.is_demo)}
            updatedAt={entries.dataUpdatedAt}
            onRefresh={() => entries.refetch()}
            refreshing={entries.isFetching}
            loading={entries.isLoading}
            error={entries.error}
            empty={rows.length === 0}
            emptyState={<EmptyState title="No entries" text="Entries you log this week appear here." />}
            bodyClassName="p-0"
          >
            <ul className="divide-y divide-line">
              {rows.map((e) => (
                <li key={e.id}>
                  <button onClick={() => setEditing(e)} className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-raised/60">
                    <span className="w-20 shrink-0 text-xs text-subtle">{format(new Date(e.started_at), 'EEE MMM d')}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{e.description ?? <span className="text-subtle">No description</span>}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        {categoryLabel(e.category)}
                        {e.company_id && <span>· {companies.find((c) => c.id === e.company_id)?.name}</span>}
                        {e.source === 'focus' && <Badge className="py-0"><Timer className="size-3" /> Focus</Badge>}
                        {e.is_demo && <DemoBadge />}
                      </span>
                    </span>
                    <span className="font-mono text-sm">{formatMinutes(e.minutes)}</span>
                    <Pencil className="size-3.5 text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
      </div>}
      {tab === 'focus' && <div className="max-w-3xl animate-fade-in">
          <Panel
            title="Focus sessions"
            icon={<Timer />}
            updatedAt={focus.dataUpdatedAt}
            onRefresh={() => focus.refetch()}
            refreshing={focus.isFetching}
            loading={focus.isLoading}
            error={focus.error}
            empty={(focus.data ?? []).length === 0}
            emptyState={<EmptyState icon={<Timer />} title="No focus sessions this week" text="Press F to start one. It logs time automatically when it ends." action={<Button size="sm" variant="primary" onClick={openFocus}><Play /> Start focus</Button>} />}
          >
            <ul className="space-y-2">
              {(focus.data ?? []).map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{s.label ?? categoryLabel(s.category)}</span>
                  <span className="text-xs text-subtle">{format(new Date(s.started_at), 'EEE HH:mm')}</span>
                  <Badge className={s.status === 'completed' ? 'border-success-500/40 text-success-700 dark:text-success-400' : s.status === 'running' ? 'border-primary-500/40 text-primary-700 dark:text-primary-300' : 'text-subtle'}>
                    {FOCUS_STATUS[s.status]} · {s.planned_minutes}m
                  </Badge>
                </li>
              ))}
            </ul>
          </Panel>
      </div>}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title="Edit time entry">
        {editing && <TimeEntryEditor key={editing.id} entry={editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}
