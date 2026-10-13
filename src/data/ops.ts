import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { CheckResult, CheckStatus, Monitor } from '@/lib/types';
import { check, recordAudit, unwrap } from './core';

const STALE_AFTER_MS = 12 * 3_600_000;

export function useMonitors() {
  return useQuery({
    queryKey: ['monitors'],
    queryFn: async () => unwrap(await supabase.from('cc_monitors').select('*').order('kind').order('label')) as Monitor[],
  });
}

export function useCheckResults() {
  return useQuery({
    queryKey: ['check-results'],
    queryFn: async () =>
      unwrap(await supabase.from('cc_check_results').select('*').order('checked_at', { ascending: false }).limit(1000)) as CheckResult[],
  });
}

export interface MonitorHealth {
  monitor: Monitor;
  status: CheckStatus;
  label: string;
  summary: string;
  latest: CheckResult | null;
  history: CheckResult[];
}

const STATUS_LABEL: Record<CheckStatus, string> = { healthy: 'Healthy', attention: 'Attention', action: 'Action needed', unknown: 'Unknown' };

export function deriveHealth(monitor: Monitor, history: CheckResult[]): MonitorHealth {
  const latest = history[0] ?? null;
  const base = { monitor, latest, history };
  if (!monitor.enabled) return { ...base, status: 'unknown', label: 'Paused', summary: 'This check is paused.' };
  if (!latest) {
    return monitor.kind === 'manual'
      ? { ...base, status: 'unknown', label: 'Never confirmed', summary: 'Confirm it once to start the schedule.' }
      : { ...base, status: 'unknown', label: 'Not checked yet', summary: 'Run checks to get a first result.' };
  }
  if (monitor.kind === 'manual') {
    const ageDays = (Date.now() - new Date(latest.checked_at).getTime()) / 86_400_000;
    if (ageDays > monitor.check_every_days) {
      return { ...base, status: 'attention', label: 'Overdue', summary: `Last confirmed ${Math.floor(ageDays)} days ago. Due every ${monitor.check_every_days} days.` };
    }
  }
  return { ...base, status: latest.status, label: STATUS_LABEL[latest.status], summary: latest.summary };
}

const RANK: Record<CheckStatus, number> = { action: 0, attention: 1, unknown: 2, healthy: 3 };

export function useOpsHealth() {
  const monitors = useMonitors();
  const results = useCheckResults();
  const health = useMemo(() => {
    const byMonitor = new Map<string, CheckResult[]>();
    for (const r of results.data ?? []) {
      const list = byMonitor.get(r.monitor_id) ?? [];
      list.push(r);
      byMonitor.set(r.monitor_id, list);
    }
    return (monitors.data ?? [])
      .map((m) => deriveHealth(m, byMonitor.get(m.id) ?? []))
      .sort((a, b) => RANK[a.status] - RANK[b.status] || a.monitor.label.localeCompare(b.monitor.label));
  }, [monitors.data, results.data]);
  const lastChecked = (results.data ?? []).find((r) => r.source === 'auto')?.checked_at ?? null;
  return {
    health,
    lastChecked,
    loading: monitors.isLoading || results.isLoading,
    error: monitors.error ?? results.error,
    fetching: monitors.isFetching || results.isFetching,
    updatedAt: Math.min(...[monitors.dataUpdatedAt, results.dataUpdatedAt].filter(Boolean), Date.now()),
    refetch: () => Promise.all([monitors.refetch(), results.refetch()]),
  };
}

async function callOpsCheck(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('ops-check', { body });
  if (error) {
    let message = 'The health check service did not respond. Try again shortly.';
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      if (payload && typeof payload.error === 'string') message = payload.error;
    }
    throw new Error(message);
  }
  if (!data || typeof data !== 'object') throw new Error('The health check service sent an unexpected reply.');
  return data as { checked?: number; skipped?: number; ok?: boolean };
}

export function useRunChecks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (monitorIds?: string[]) => {
      const res = await callOpsCheck(monitorIds ? { monitor_ids: monitorIds } : {});
      await recordAudit('ops.run_checks', 'monitor', monitorIds?.length === 1 ? monitorIds[0] : null);
      return res;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['check-results'] }),
  });
}

export function useConfirmManual() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { monitorId: string; status: Exclude<CheckStatus, 'unknown'>; note: string }) => {
      await callOpsCheck({ action: 'manual', monitor_id: input.monitorId, status: input.status, note: input.note });
      await recordAudit('ops.manual_confirm', 'monitor', input.monitorId);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['check-results'] }),
  });
}

export type MonitorInput = Omit<Monitor, 'id' | 'created_at' | 'updated_at'> & { id?: string };

export function useSaveMonitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...m }: MonitorInput) => {
      if (id) {
        check(await supabase.from('cc_monitors').update(m).eq('id', id));
        return id;
      }
      const row = unwrap(await supabase.from('cc_monitors').insert(m).select('id').single());
      await recordAudit('monitor.create', 'monitor', row.id);
      return row.id as string;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['monitors'] }),
  });
}

export function useDeleteMonitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      check(await supabase.from('cc_monitors').delete().eq('id', id));
      await recordAudit('monitor.delete', 'monitor', id);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['monitors'] });
      qc.invalidateQueries({ queryKey: ['check-results'] });
    },
  });
}

const DEFAULT_MONITORS = [
  { kind: 'domain', label: 'encountive.com domain', target: 'encountive.com', identity: 'encountive' },
  { kind: 'domain', label: 'theonefor.ai domain', target: 'theonefor.ai', identity: 'doug_it' },
  { kind: 'email_auth', label: 'encountive.com email authentication', target: 'encountive.com', identity: 'encountive' },
  { kind: 'email_auth', label: 'theonefor.ai email authentication', target: 'theonefor.ai', identity: 'doug_it' },
  { kind: 'website', label: 'Encountive website', target: 'https://encountive.com', identity: 'encountive', warn_days: 14, critical_days: 7 },
  { kind: 'database', label: 'Command Console database', target: null, identity: 'doug_it' },
  { kind: 'manual', label: 'Backup restore test', target: null, identity: null, check_every_days: 7, notes: 'Restore one file from backup and confirm it opens.' },
];

export async function seedMonitorsIfFirstRun(userId: string) {
  const claim = await supabase.from('cc_settings').update({ ops_seeded: true }).eq('user_id', userId).eq('ops_seeded', false).select('user_id');
  check(claim);
  if (!claim.data?.length) return false;
  const existing = unwrap(await supabase.from('cc_monitors').select('id').limit(1));
  if (existing.length === 0) check(await supabase.from('cc_monitors').insert(DEFAULT_MONITORS));
  await recordAudit('ops.seed', 'monitor');
  return true;
}

export function useAutoRunStaleChecks() {
  const { health, lastChecked, loading } = useOpsHealth();
  const run = useRunChecks();
  const started = useRef(false);
  const hasAuto = health.some((h) => h.monitor.enabled && h.monitor.kind !== 'manual');
  useEffect(() => {
    if (loading || started.current || !hasAuto) return;
    if (lastChecked && Date.now() - new Date(lastChecked).getTime() < STALE_AFTER_MS) return;
    started.current = true;
    run.mutate(undefined);
  }, [loading, hasAuto, lastChecked, run]);
  return run;
}
