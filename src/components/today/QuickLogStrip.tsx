import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { BarChart3, ChevronDown, Pencil, Trash2 } from 'lucide-react';
import { categoryLabel, type TimeEntry } from '@/lib/types';
import { cn, errorMessage, formatMinutes } from '@/lib/utils';
import { useCompanies } from '@/data/organization';
import { useDeleteTimeEntry, useTimeEntries, weekRange } from '@/data/time';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { LogTimeForm } from '@/components/time/LogTimeForm';
import { TimeEntryEditor } from '@/components/time/TimeEntryEditor';

function EntryRow({ entry, onEdit }: { entry: TimeEntry; onEdit: () => void }) {
  const del = useDeleteTimeEntry();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const remove = async () => {
    try {
      await del.mutateAsync(entry.id);
      toast('Entry deleted');
    } catch (e) {
      toast(errorMessage(e), 'error');
      setConfirm(false);
    }
  };
  return (
    <li className="group flex items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-raised">
      <span className="w-14 shrink-0 text-subtle">{format(new Date(entry.started_at), 'EEE d')}</span>
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 truncate text-left hover:underline">
        {entry.description || categoryLabel(entry.category)}
      </button>
      <span className="font-mono tabular-nums">{formatMinutes(entry.minutes)}</span>
      {confirm ? (
        <>
          <Button size="sm" variant="danger" onClick={remove} disabled={del.isPending}>Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>
        </>
      ) : (
        <span className="flex opacity-60 transition-opacity group-hover:opacity-100">
          <Button size="iconSm" variant="ghost" onClick={onEdit} aria-label="Edit entry" title="Edit"><Pencil /></Button>
          <Button size="iconSm" variant="ghost" onClick={() => setConfirm(true)} aria-label="Delete entry" title="Delete"><Trash2 /></Button>
        </span>
      )}
    </li>
  );
}

export function QuickLogStrip() {
  const { start, end } = useMemo(() => weekRange(new Date()), []);
  const entries = useTimeEntries(start, end);
  const { data: companies = [] } = useCompanies();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const rows = entries.data ?? [];
  const total = rows.reduce((s, e) => s + e.minutes, 0);

  const byCompany = useMemo(() => {
    const map = new Map<string, TimeEntry[]>();
    for (const e of rows) {
      const key = e.company_id ?? 'none';
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return [...map.entries()]
      .map(([id, list]) => ({
        id,
        list: [...list].sort((a, b) => b.started_at.localeCompare(a.started_at)),
        minutes: list.reduce((s, e) => s + e.minutes, 0),
        name: companies.find((c) => c.id === id)?.name ?? 'No company',
      }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [rows, companies]);

  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_320px]">
      <Panel title="Quick time log" subtitle="Press T anywhere to log time" bodyClassName="py-2">
        <LogTimeForm layout="strip" />
      </Panel>
      <Panel
        title="Hours this week"
        subtitle="Click an entry to edit it, or the bin to delete it"
        icon={<BarChart3 />}
        demo={rows.some((r) => r.is_demo)}
        updatedAt={entries.dataUpdatedAt}
        onRefresh={() => entries.refetch()}
        refreshing={entries.isFetching}
        loading={entries.isLoading}
        error={entries.error}
        empty={rows.length === 0}
        emptyState={<EmptyState title="No hours logged this week" text="Log time on the left or finish a focus session." />}
        actions={<span className="font-mono text-base font-semibold tabular-nums">{formatMinutes(total)}</span>}
        bodyClassName="py-2"
      >
        <ul className="space-y-1.5">
          {byCompany.map((c) => {
            const expanded = !collapsed.has(c.id);
            return (
              <li key={c.id} className="text-sm">
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (expanded) next.add(c.id);
                      else next.delete(c.id);
                      return next;
                    })
                  }
                  aria-expanded={expanded}
                  className="w-full rounded-md text-left"
                >
                  <div className="mb-0.5 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1 text-muted">
                      <ChevronDown className={cn('size-3.5 transition-transform', !expanded && '-rotate-90')} />
                      {c.name}
                      <span className="text-xs text-subtle">({c.list.length})</span>
                    </span>
                    <span className="font-mono tabular-nums">{formatMinutes(c.minutes)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-raised">
                    <div className="h-full rounded-full bg-primary-500 transition-all duration-500" style={{ width: `${(c.minutes / total) * 100}%` }} />
                  </div>
                </button>
                {expanded && (
                  <ul className="mt-1.5 space-y-0.5 border-l border-line pl-2 animate-fade-in">
                    {c.list.map((e) => <EntryRow key={e.id} entry={e} onEdit={() => setEditing(e)} />)}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title="Edit time entry">
        {editing && <TimeEntryEditor key={editing.id} entry={editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}
