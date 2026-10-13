import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Agent } from '@/lib/types';
import { check, recordAudit, unwrap } from './core';

const STALE_RUN_MS = 6 * 3_600_000;

export const AGENT_REPORT_URL = `${import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/agent-report`;

export type AgentState = 'running' | 'stalled' | 'succeeded' | 'failed' | 'never';

export function agentState(a: Agent): AgentState {
  if (!a.last_status) return 'never';
  if (a.last_status === 'running') {
    const started = a.last_started_at ? new Date(a.last_started_at).getTime() : 0;
    return Date.now() - started > STALE_RUN_MS ? 'stalled' : 'running';
  }
  return a.last_status;
}

export const lastRunAt = (a: Agent) => a.last_started_at ?? a.last_finished_at;

export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: async () => unwrap(await supabase.from('cc_agents').select('*').order('name')) as Agent[],
    refetchInterval: 60_000,
  });
}

export function useSaveAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, notes }: { name: string; notes: string | null }) => {
      const payload = { name: name.trim().replace(/\s+/g, ' '), notes: notes?.trim() || null };
      const row = unwrap(await supabase.from('cc_agents').insert(payload).select('id').single()) as { id: string };
      await recordAudit('agent.create', 'agent', row.id);
      return row.id;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      check(await supabase.from('cc_agents').delete().eq('id', id));
      await recordAudit('agent.delete', 'agent', id);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useAgentKey() {
  return useQuery({
    queryKey: ['agent-key'],
    queryFn: async () => {
      const res = await supabase.from('cc_agent_keys').select('key_hint, created_at').maybeSingle();
      check(res);
      return res.data as { key_hint: string; created_at: string } | null;
    },
  });
}

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(30));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function useCreateAgentKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error('Not signed in.');
      const key = randomKey();
      const row = { user_id: auth.user.id, key_hash: await sha256Hex(key), key_hint: key.slice(-4) };
      check(await supabase.from('cc_agent_keys').upsert(row, { onConflict: 'user_id' }));
      await recordAudit('agent.key_created', 'agent');
      return key;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['agent-key'] }),
  });
}

export function checkInUrl(key: string, agent: string, status: 'started' | 'succeeded' | 'failed') {
  const p = new URLSearchParams({ key, agent, status });
  return `${AGENT_REPORT_URL}?${p.toString()}`;
}
