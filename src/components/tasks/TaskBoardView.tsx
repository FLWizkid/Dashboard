import { useState, type DragEvent } from 'react';
import type { Company, Task, TaskStatus } from '@/lib/types';
import { TASK_STATUSES } from '@/lib/types';
import { cn, errorMessage } from '@/lib/utils';
import { useUpdateTask, isDoneHidden } from '@/data/tasks';
import { useToast } from '@/components/ui/toast';
import { useUi } from '@/components/shell/ui-context';
import { CompleteButton, TaskMeta } from './TaskRow';

export function TaskBoardView({ tasks, companies }: { tasks: Task[]; companies: Company[] }) {
  const update = useUpdateTask();
  const toast = useToast();
  const { openTask } = useUi();
  const [over, setOver] = useState<TaskStatus | null>(null);

  async function move(id: string, status: TaskStatus) {
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status === status) return;
    if (status === 'ready' && (!task.priority || !task.due_date)) {
      toast('Ready needs a priority and a due date. Add them, then move it again.', 'error');
      openTask(task.id);
      return;
    }
    try {
      await update.mutateAsync({ id, status, ...(status === 'done' ? { completed_at: new Date().toISOString() } : {}) });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  function onDrop(e: DragEvent, status: TaskStatus) {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData('text/task-id');
    if (id) move(id, status);
  }

  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
      {TASK_STATUSES.map((col) => {
        const rows = tasks.filter((t) => t.status === col.value && !isDoneHidden(t));
        return (
          <div
            key={col.value}
            onDragOver={(e) => { e.preventDefault(); setOver(col.value); }}
            onDragLeave={() => setOver((o) => (o === col.value ? null : o))}
            onDrop={(e) => onDrop(e, col.value)}
            className={cn('flex w-[272px] shrink-0 flex-col rounded-lg border bg-raised/40 transition-colors', over === col.value ? 'border-primary-500 bg-primary-500/5' : 'border-line')}
          >
            <div className="flex items-center gap-2 px-3 py-2">
              <h3 className="text-sm font-semibold">{col.label}</h3>
              <span className="font-mono text-xs text-subtle">{rows.length}</span>
              {col.value === 'ready' && <span className="ml-auto text-[11px] text-subtle">needs priority + due</span>}
            </div>
            <div className="flex min-h-[120px] flex-1 flex-col gap-2 p-2 pt-0">
              {rows.map((t) => (
                <div
                  key={t.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/task-id', t.id)}
                  onClick={() => openTask(t.id)}
                  className="group cursor-grab rounded-md border border-line bg-surface p-2.5 shadow-sm transition-all hover:-translate-y-px hover:border-subtle hover:shadow-md active:cursor-grabbing"
                >
                  <div className="flex items-start gap-2">
                    <div className="pt-0.5"><CompleteButton task={t} size="sm" /></div>
                    <p className={cn('flex-1 text-sm', t.status === 'done' && 'text-subtle line-through')}>{t.title}</p>
                  </div>
                  <div className="mt-1.5 pl-6"><TaskMeta task={t} companies={companies} /></div>
                  <label className="mt-2 block pl-6 sm:hidden" onClick={(e) => e.stopPropagation()}>
                    <span className="sr-only">Move to</span>
                    <select className="input h-7 text-xs" value={t.status} onChange={(e) => move(t.id, e.target.value as TaskStatus)}>
                      {TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </label>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
