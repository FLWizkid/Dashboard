import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, nextMonday, subDays } from 'date-fns';
import { supabase } from '@/lib/supabase';
import type { Task } from '@/lib/types';
import { nextOccurrence } from '@/lib/quick-add';
import { toDateKey } from '@/lib/utils';
import { check, recordAudit, unwrap } from './core';
import { useShowDemo } from './settings';

export const DONE_VISIBLE_DAYS = 30;

export function useTasks() {
  const showDemo = useShowDemo();
  return useQuery({
    queryKey: ['tasks'],
    queryFn: async () =>
      unwrap(await supabase.from('cc_tasks').select('*').order('due_date', { ascending: true, nullsFirst: false }).order('created_at')) as Task[],
    select: (rows) => (showDemo ? rows : rows.filter((r) => !r.is_demo)),
  });
}

export function isDoneHidden(t: Task) {
  if (t.status !== 'done' || !t.completed_at) return false;
  return new Date(t.completed_at) < subDays(new Date(), DONE_VISIBLE_DAYS);
}

export function isOverdue(t: Task, todayKey = toDateKey(new Date())) {
  return t.status !== 'done' && !!t.due_date && t.due_date < todayKey;
}

export type TaskInput = Partial<Omit<Task, 'id' | 'is_demo' | 'created_at' | 'updated_at'>> & { title: string };

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['tasks'] });
  qc.invalidateQueries({ queryKey: ['priorities'] });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TaskInput) => {
      const row = unwrap(await supabase.from('cc_tasks').insert(input).select('*').single()) as Task;
      await recordAudit('task.create', 'task', row.id);
      return row;
    },
    onSettled: () => invalidate(qc),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<Task> & { id: string }) => {
      const next = { ...patch };
      if (patch.status && patch.status !== 'done') next.completed_at = null;
      check(await supabase.from('cc_tasks').update(next).eq('id', id));
      await recordAudit('task.update', 'task', id);
    },
    onMutate: async ({ id, ...patch }) => {
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const prev = qc.getQueryData<Task[]>(['tasks']);
      qc.setQueryData<Task[]>(['tasks'], (rows) => rows?.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['tasks'], ctx.prev),
    onSettled: () => invalidate(qc),
  });
}

export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (task: Task) => {
      const res = await supabase
        .from('cc_tasks')
        .update({ status: 'done', completed_at: new Date().toISOString() })
        .eq('id', task.id)
        .neq('status', 'done')
        .select('id');
      check(res);
      await recordAudit('task.complete', 'task', task.id);
      if (task.recurrence !== 'none' && res.data && res.data.length > 0) {
        const base = task.due_date ?? toDateKey(new Date());
        const due = nextOccurrence(base, task.recurrence);
        const { title, notes, priority, category, company_id, project_id, identity, recurrence } = task;
        const row = unwrap(
          await supabase
            .from('cc_tasks')
            .insert({ title, notes, priority, category, company_id, project_id, identity, recurrence, due_date: due, status: priority && due ? 'ready' : 'backlog', is_demo: task.is_demo })
            .select('id')
            .single(),
        );
        await recordAudit('task.recur', 'task', row.id);
        return { nextDue: due };
      }
      return { nextDue: null };
    },
    onMutate: async (task) => {
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const prev = qc.getQueryData<Task[]>(['tasks']);
      qc.setQueryData<Task[]>(['tasks'], (rows) =>
        rows?.map((r) => (r.id === task.id ? { ...r, status: 'done', completed_at: new Date().toISOString() } : r)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['tasks'], ctx.prev),
    onSettled: () => invalidate(qc),
  });
}

export type SnoozeOption = 'tomorrow' | 'three_days' | 'next_week';

export function snoozeDate(option: SnoozeOption) {
  const today = new Date();
  if (option === 'tomorrow') return toDateKey(addDays(today, 1));
  if (option === 'three_days') return toDateKey(addDays(today, 3));
  return toDateKey(nextMonday(today));
}

export function useSnoozeTask() {
  const update = useUpdateTask();
  return {
    ...update,
    snooze: (task: Task, option: SnoozeOption) => {
      const date = snoozeDate(option);
      return update.mutateAsync({ id: task.id, due_date: date, snoozed_until: date });
    },
  };
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      check(await supabase.from('cc_tasks').delete().eq('id', id));
      await recordAudit('task.delete', 'task', id);
    },
    onSettled: () => invalidate(qc),
  });
}
