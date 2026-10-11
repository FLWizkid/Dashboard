import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Company, Task } from '@/lib/types';
import { priorityRank } from '@/lib/types';
import { toDateKey } from '@/lib/utils';
import { isDoneHidden, DONE_VISIBLE_DAYS } from '@/data/tasks';
import { EmptyState } from '@/components/ui/panel';
import { TaskRow } from './TaskRow';

function sortTasks(a: Task, b: Task) {
  if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
  return priorityRank(b.priority) - priorityRank(a.priority);
}

export function TaskListView({ tasks, companies, showHidden, onShowHidden }: { tasks: Task[]; companies: Company[]; showHidden: boolean; onShowHidden: () => void }) {
  const [doneOpen, setDoneOpen] = useState(false);
  const today = toDateKey(new Date());

  const groups = useMemo(() => {
    const open = tasks.filter((t) => t.status !== 'done').sort(sortTasks);
    return [
      { key: 'overdue', label: 'Overdue', tone: 'text-error-600 dark:text-error-400', rows: open.filter((t) => t.due_date && t.due_date < today) },
      { key: 'today', label: 'Today', tone: 'text-fg', rows: open.filter((t) => t.due_date === today) },
      { key: 'upcoming', label: 'Upcoming', tone: 'text-fg', rows: open.filter((t) => t.due_date && t.due_date > today) },
      { key: 'nodate', label: 'No due date', tone: 'text-muted', rows: open.filter((t) => !t.due_date) },
    ];
  }, [tasks, today]);

  const doneAll = tasks.filter((t) => t.status === 'done').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  const hiddenCount = doneAll.filter(isDoneHidden).length;
  const done = showHidden ? doneAll : doneAll.filter((t) => !isDoneHidden(t));

  if (tasks.length === 0) return <EmptyState title="No tasks match" text="Add a task above, or clear the filters." />;

  return (
    <div className="space-y-5">
      {groups.map((g) =>
        g.rows.length === 0 ? null : (
          <section key={g.key}>
            <h3 className={`mb-1 flex items-center gap-2 px-2 text-xs font-semibold uppercase tracking-wider ${g.tone}`}>
              {g.label} <span className="font-mono font-normal text-subtle">{g.rows.length}</span>
            </h3>
            <div>{g.rows.map((t) => <TaskRow key={t.id} task={t} companies={companies} />)}</div>
          </section>
        ),
      )}
      <section className="border-t border-line pt-3">
        <button onClick={() => setDoneOpen((o) => !o)} className="flex items-center gap-1 px-2 text-xs font-semibold uppercase tracking-wider text-muted hover:text-fg">
          {doneOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          Done (last {DONE_VISIBLE_DAYS} days) <span className="font-mono font-normal text-subtle">{done.length}</span>
        </button>
        {doneOpen && <div className="mt-1">{done.map((t) => <TaskRow key={t.id} task={t} companies={companies} showSnooze={false} />)}</div>}
        {hiddenCount > 0 && !showHidden && (
          <p className="mt-2 px-2 text-xs text-subtle">
            {hiddenCount} completed {hiddenCount === 1 ? 'task' : 'tasks'} hidden (older than {DONE_VISIBLE_DAYS} days, never deleted).{' '}
            <button className="text-primary-600 hover:underline dark:text-primary-400" onClick={() => { onShowHidden(); setDoneOpen(true); }}>Show them</button>
          </p>
        )}
      </section>
    </div>
  );
}
