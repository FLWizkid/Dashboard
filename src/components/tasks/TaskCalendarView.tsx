import { useMemo, useState } from 'react';
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { Task } from '@/lib/types';
import { cn, toDateKey } from '@/lib/utils';
import { isDoneHidden } from '@/data/tasks';
import { Button } from '@/components/ui/button';
import { useUi } from '@/components/shell/ui-context';

export function TaskCalendarView({ tasks }: { tasks: Task[] }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const { openTask, openQuickAdd } = useUi();
  const today = toDateKey(new Date());

  const days = useMemo(
    () => eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }) }),
    [month],
  );
  const byDay = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.due_date || isDoneHidden(t)) continue;
      m.set(t.due_date, [...(m.get(t.due_date) ?? []), t]);
    }
    return m;
  }, [tasks]);
  const undated = tasks.filter((t) => !t.due_date && t.status !== 'done').length;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Button size="icon" variant="ghost" onClick={() => setMonth((m) => subMonths(m, 1))} aria-label="Previous month"><ChevronLeft /></Button>
        <h3 className="w-40 text-center text-lg font-semibold">{format(month, 'MMMM yyyy')}</h3>
        <Button size="icon" variant="ghost" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month"><ChevronRight /></Button>
        <Button size="sm" variant="ghost" onClick={() => setMonth(startOfMonth(new Date()))}>Today</Button>
        {undated > 0 && <span className="ml-auto text-xs text-subtle">{undated} open tasks without a due date are not shown</span>}
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-line bg-line gap-px">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="bg-surface px-2 py-1.5 text-xs font-medium text-subtle">{d}</div>
        ))}
        {days.map((d) => {
          const key = toDateKey(d);
          const rows = byDay.get(key) ?? [];
          return (
            <div key={key} className={cn('group min-h-[96px] bg-surface p-1.5', !isSameMonth(d, month) && 'bg-bg/60')}>
              <div className="mb-1 flex items-center justify-between">
                <span className={cn('flex size-6 items-center justify-center rounded-full text-xs', key === today ? 'bg-primary-600 font-semibold text-white' : isSameMonth(d, month) ? 'text-muted' : 'text-subtle/60')}>
                  {format(d, 'd')}
                </span>
                <button onClick={() => openQuickAdd(key)} className="rounded p-0.5 text-subtle opacity-0 transition-opacity hover:bg-raised hover:text-fg group-hover:opacity-100 focus:opacity-100" aria-label={`Add task on ${format(d, 'MMM d')}`}>
                  <Plus className="size-3.5" />
                </button>
              </div>
              <div className="space-y-0.5">
                {rows.slice(0, 3).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => openTask(t.id)}
                    className={cn(
                      'block w-full truncate rounded px-1.5 py-0.5 text-left text-xs transition-colors',
                      t.status === 'done' ? 'bg-raised text-subtle line-through' : key < today ? 'bg-error-500/15 text-error-700 hover:bg-error-500/25 dark:text-error-300' : 'bg-primary-500/10 text-fg hover:bg-primary-500/20',
                    )}
                  >
                    {t.title}
                  </button>
                ))}
                {rows.length > 3 && <p className="px-1.5 text-[11px] text-subtle">+{rows.length - 3} more</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
