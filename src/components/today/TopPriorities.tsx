import { useMemo, useState } from 'react';
import { Pencil, Sparkles, Target, X } from 'lucide-react';
import type { Task } from '@/lib/types';
import { priorityRank } from '@/lib/types';
import { errorMessage, toDateKey } from '@/lib/utils';
import { useTasks, isOverdue } from '@/data/tasks';
import { useCompanies } from '@/data/organization';
import { usePriorities, useSetPriorities } from '@/data/priorities';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { CompleteButton, TaskMeta } from '@/components/tasks/TaskRow';
import { useUi } from '@/components/shell/ui-context';

function suggestionScore(t: Task, today: string) {
  return (isOverdue(t, today) ? 10 : 0) + priorityRank(t.priority) * 2 + (t.due_date === today ? 3 : 0);
}

export function TopPriorities() {
  const tasks = useTasks();
  const picks = usePriorities();
  const setPicks = useSetPriorities();
  const { data: companies = [] } = useCompanies();
  const { openTask } = useUi();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const today = toDateKey(new Date());

  const open = useMemo(() => (tasks.data ?? []).filter((t) => t.status !== 'done'), [tasks.data]);
  const picked = (picks.data ?? []).map((p) => (tasks.data ?? []).find((t) => t.id === p.task_id)).filter((t): t is Task => !!t);
  const suggestions = useMemo(
    () => [...open].filter((t) => !picked.some((p) => p.id === t.id)).sort((a, b) => suggestionScore(b, today) - suggestionScore(a, today)).slice(0, 6),
    [open, picked, today],
  );

  async function save(ids: string[]) {
    try {
      await setPicks.mutateAsync(ids);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <Panel
      title="Top 3 priorities"
      icon={<Target />}
      subtitle="You pick them. Suggestions come from overdue and high-priority work."
      demo={picked.some((t) => t.is_demo)}
      updatedAt={picks.dataUpdatedAt}
      onRefresh={() => picks.refetch()}
      refreshing={picks.isFetching}
      loading={picks.isLoading || tasks.isLoading}
      error={picks.error || tasks.error}
      actions={
        (picked.length > 0 || editing) && (
          <Button size="sm" variant="ghost" onClick={() => setEditing((e) => !e)}>
            <Pencil /> {editing ? 'Done' : 'Change'}
          </Button>
        )
      }
    >
      {picked.length > 0 && (
        <ol className="space-y-1">
          {picked.map((t, i) => (
            <li key={t.id} className="group/row flex items-start gap-3 rounded-md px-2 py-2 hover:bg-raised">
              <span className="w-4 pt-0.5 font-mono text-sm font-semibold text-primary-600 dark:text-primary-400">{i + 1}</span>
              <div className="pt-0.5"><CompleteButton task={t} /></div>
              <button className="min-w-0 flex-1 text-left" onClick={() => openTask(t.id)}>
                <p className={t.status === 'done' ? 'truncate text-subtle line-through' : 'truncate font-medium'}>{t.title}</p>
                <TaskMeta task={t} companies={companies} />
              </button>
              {editing && (
                <Button size="iconSm" variant="ghost" aria-label={`Remove ${t.title} from priorities`} onClick={() => save(picked.filter((p) => p.id !== t.id).map((p) => p.id))}>
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
      {picked.length < 3 && (editing || picked.length === 0) ? (
        <div className={picked.length ? 'mt-3 border-t border-line pt-3' : ''}>
          {suggestions.length === 0 ? (
            <EmptyState title="Nothing to suggest" text="Add a few tasks and they will show up here as candidates." />
          ) : (
            <>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-subtle"><Sparkles className="size-3.5" /> Suggested · click to add ({3 - picked.length} left)</p>
              <ul className="space-y-1">
                {suggestions.map((t) => (
                  <li key={t.id}>
                    <button
                      className="w-full rounded-md border border-dashed border-line px-3 py-2 text-left transition-colors hover:border-primary-500/60 hover:bg-primary-500/5"
                      onClick={() => save([...picked.map((p) => p.id), t.id])}
                      disabled={setPicks.isPending}
                    >
                      <p className="truncate text-sm">{t.title}</p>
                      <TaskMeta task={t} companies={companies} hideIdentity />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </Panel>
  );
}
