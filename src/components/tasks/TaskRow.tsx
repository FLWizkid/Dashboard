import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { format, isToday, isTomorrow } from 'date-fns';
import { AlarmClock, Check, Flag, Repeat } from 'lucide-react';
import type { Task, Company } from '@/lib/types';
import { PRIORITIES } from '@/lib/types';
import { cn, errorMessage, fromDateKey, toDateKey } from '@/lib/utils';
import { useCompleteTask, useSnoozeTask, isOverdue, type SnoozeOption } from '@/data/tasks';
import { IdentityBadge, Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { useUi } from '@/components/shell/ui-context';

export function dueLabel(due: string) {
  const d = fromDateKey(due);
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  return format(d, d.getFullYear() === new Date().getFullYear() ? 'EEE, MMM d' : 'MMM d, yyyy');
}

export function CompleteButton({ task, size = 'md' }: { task: Task; size?: 'sm' | 'md' }) {
  const complete = useCompleteTask();
  const toast = useToast();
  const done = task.status === 'done';
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        if (done) return;
        try {
          const res = await complete.mutateAsync(task);
          toast(res.nextDue ? `Completed. Next one scheduled for ${dueLabel(res.nextDue)}.` : 'Task completed');
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
      }}
      aria-label={done ? 'Completed' : `Complete ${task.title}`}
      className={cn(
        'group flex shrink-0 items-center justify-center rounded-full border-2 transition-all',
        size === 'sm' ? 'size-4' : 'size-[18px]',
        done ? 'border-success-500 bg-success-500 text-white' : 'border-subtle hover:border-success-500 hover:bg-success-500/10',
      )}
    >
      <Check className={cn('size-3 transition-opacity', done ? 'opacity-100' : 'opacity-0 group-hover:opacity-60 text-success-500')} strokeWidth={3} />
    </button>
  );
}

export function SnoozeButton({ task }: { task: Task }) {
  const [open, setOpen] = useState(false);
  const { snooze } = useSnoozeTask();
  const toast = useToast();
  const opts: { value: SnoozeOption; label: string }[] = [
    { value: 'tomorrow', label: 'Tomorrow' },
    { value: 'three_days', label: 'In 3 days' },
    { value: 'next_week', label: 'Next Monday' },
  ];
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        onClick={(e) => e.stopPropagation()}
        className="rounded p-1 text-subtle opacity-0 transition-all hover:bg-raised hover:text-fg focus:opacity-100 group-hover/row:opacity-100"
        aria-label={`Snooze ${task.title}`}
        title="Snooze"
      >
        <AlarmClock className="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={4} className="z-50 w-40 rounded-md border border-line bg-surface p-1 shadow-xl animate-fade-in" onClick={(e) => e.stopPropagation()}>
          <p className="px-2 py-1 text-xs text-subtle">Snooze until</p>
          {opts.map((o) => (
            <button
              key={o.value}
              className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-raised"
              onClick={async () => {
                setOpen(false);
                try {
                  await snooze(task, o.value);
                  toast(`Snoozed to ${o.label.toLowerCase()}`);
                } catch (err) {
                  toast(errorMessage(err), 'error');
                }
              }}
            >
              {o.label}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function TaskMeta({ task, companies, hideIdentity }: { task: Task; companies: Company[]; hideIdentity?: boolean }) {
  const pr = PRIORITIES.find((p) => p.value === task.priority);
  const company = companies.find((c) => c.id === task.company_id);
  const overdue = isOverdue(task, toDateKey(new Date()));
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {task.due_date && (
        <span className={cn('font-medium', overdue ? 'text-error-600 dark:text-error-400' : 'text-muted')}>
          {overdue ? 'Overdue · ' : ''}
          {dueLabel(task.due_date)}
        </span>
      )}
      {pr && (
        <span className={cn('inline-flex items-center gap-0.5 font-medium', pr.tone)}>
          <Flag className="size-3" />
          {pr.label}
        </span>
      )}
      {task.recurrence !== 'none' && (
        <span className="inline-flex items-center gap-0.5 text-subtle" title={`Repeats ${task.recurrence}`}>
          <Repeat className="size-3" />
          {task.recurrence}
        </span>
      )}
      {task.category && <Badge>#{task.category}</Badge>}
      {company && <Badge>{company.name}</Badge>}
      {!hideIdentity && <IdentityBadge identity={task.identity} compact />}
    </div>
  );
}

export function TaskRow({ task, companies, showSnooze = true }: { task: Task; companies: Company[]; showSnooze?: boolean }) {
  const { openTask } = useUi();
  const done = task.status === 'done';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openTask(task.id)}
      onKeyDown={(e) => e.key === 'Enter' && openTask(task.id)}
      className="group/row flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-raised"
    >
      <div className="pt-0.5">
        <CompleteButton task={task} />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn('truncate', done && 'text-subtle line-through')}>{task.title}</p>
        <TaskMeta task={task} companies={companies} />
      </div>
      {showSnooze && !done && <SnoozeButton task={task} />}
    </div>
  );
}
