import { FunctionsHttpError } from '@supabase/supabase-js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { OutboundEmail } from '@/lib/types';
import { unwrap } from './core';

async function callEmail<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('console-email', { body });
  if (error) {
    let message = 'The email service did not respond. Try again shortly.';
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      if (payload && typeof payload.error === 'string') message = payload.error;
    }
    throw new Error(message);
  }
  if (!data || typeof data !== 'object') throw new Error('The email service sent an unexpected reply.');
  return data as T;
}

export function useEmailStatus() {
  return useQuery({
    queryKey: ['email-status'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const s = await callEmail<{ configured: boolean; from: string }>({ action: 'status' });
      if (typeof s.configured !== 'boolean') throw new Error('The email service sent an unexpected reply.');
      return s;
    },
  });
}

export function useEmailLog() {
  return useQuery({
    queryKey: ['email-log'],
    queryFn: async () =>
      unwrap(await supabase.from('cc_outbound_email_log').select('*').order('created_at', { ascending: false }).limit(10)) as OutboundEmail[],
  });
}

export function useSendTestEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => callEmail<{ ok: true; to: string }>({ action: 'test' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['email-log'] }),
  });
}
