import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endOfWeek, startOfWeek } from 'date-fns';
import { supabase } from '@/lib/supabase';
import type { FocusSession, TimeCategory, TimeEntry } from '@/lib/types';
import { check, recordAudit, unwrap } from './core';
import { useShowDemo } from './settings';

export function weekRange(anchor: Date) {
  return { start: startOfWeek(anchor, { weekStartsOn: 1 }), end: endOfWeek(anchor, { weekStartsOn: 1 }) };
}

export function useTimeEntries(start: Date, end: Date) {
  const showDemo = useShowDemo();
  return useQuery({
    queryKey: ['time', start.toISOString(), end.toISOString()],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('cc_time_entries')
          .select('*')
          .gte('started_at', start.toISOString())
          .lte('started_at', end.toISOString())
          .order('started_at', { ascending: false }),
      ) as TimeEntry[],
    select: (rows) => (showDemo ? rows : rows.filter((r) => !r.is_demo)),
  });
}

export type TimeEntryInput = {
  id?: string;
  started_at?: string;
  minutes: number;
  category: TimeCategory;
  company_id: string | null;
  project_id: string | null;
  task_id?: string | null;
  description: string | null;
};

export function useSaveTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: TimeEntryInput) => {
      if (id) {
        check(await supabase.from('cc_time_entries').update(input).eq('id', id));
        await recordAudit('time.update', 'time_entry', id);
        return;
      }
      const row = unwrap(await supabase.from('cc_time_entries').insert(input).select('id').single());
      await recordAudit('time.log', 'time_entry', row.id);
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        await supabase
          .from('cc_settings')
          .update({ last_time_description: input.description, last_time_category: input.category, last_time_company_id: input.company_id })
          .eq('user_id', auth.user.id);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['time'] });
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['usage'] });
    },
  });
}

export function useDeleteTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      check(await supabase.from('cc_time_entries').delete().eq('id', id));
      await recordAudit('time.delete', 'time_entry', id);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['time'] }),
  });
}

export function useRunningFocus() {
  return useQuery({
    queryKey: ['focus', 'running'],
    queryFn: async () => {
      const res = await supabase.from('cc_focus_sessions').select('*').eq('status', 'running').maybeSingle();
      if (res.error) throw new Error(res.error.message);
      return (res.data as FocusSession | null) ?? null;
    },
  });
}

export function useFocusHistory(start: Date, end: Date) {
  return useQuery({
    queryKey: ['focus', 'history', start.toISOString()],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('cc_focus_sessions')
          .select('*')
          .gte('started_at', start.toISOString())
          .lte('started_at', end.toISOString())
          .order('started_at', { ascending: false }),
      ) as FocusSession[],
  });
}

export function useStartFocus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { task_id: string | null; label: string | null; category: TimeCategory; company_id: string | null; planned_minutes: number }) => {
      const res = await supabase.from('cc_focus_sessions').insert(input).select('id').single();
      if (res.error?.code === '23505') throw new Error('A focus session is already running. Finish or cancel it first.');
      const row = unwrap(res);
      await recordAudit('focus.start', 'focus_session', row.id);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['focus'] }),
  });
}

export function useFinishFocus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ session, outcome }: { session: FocusSession; outcome: 'completed' | 'cancelled' }) => {
      const endedAt = new Date();
      const claim = await supabase
        .from('cc_focus_sessions')
        .update({ status: outcome, ended_at: endedAt.toISOString() })
        .eq('id', session.id)
        .eq('status', 'running')
        .select('id');
      check(claim);
      if (!claim.data?.length) return { logged: 0 };
      await recordAudit(`focus.${outcome}`, 'focus_session', session.id);
      if (outcome === 'cancelled') return { logged: 0 };

      const elapsed = Math.round((endedAt.getTime() - new Date(session.started_at).getTime()) / 60000);
      const minutes = Math.max(1, Math.min(session.planned_minutes, elapsed));
      const entry = unwrap(
        await supabase
          .from('cc_time_entries')
          .insert({
            started_at: session.started_at,
            minutes,
            category: session.category,
            company_id: session.company_id,
            task_id: session.task_id,
            description: session.label ? `Focus: ${session.label}` : 'Focus session',
            source: 'focus',
          })
          .select('id')
          .single(),
      );
      check(await supabase.from('cc_focus_sessions').update({ time_entry_id: entry.id }).eq('id', session.id));
      await recordAudit('time.log_from_focus', 'time_entry', entry.id);
      return { logged: minutes };
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['focus'] });
      qc.invalidateQueries({ queryKey: ['time'] });
    },
  });
}
