import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { CalendarEvent, Identity, MailAccount, MailMessage, MailProvider } from '@/lib/types';
import { check, recordAudit, unwrap } from './core';

const STALE_AFTER_MS = 10 * 60_000;
const SIGN_IN_HOST = 'https://accounts.google.com/';

async function callMail<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('mail-connect', { body });
  if (error) {
    let message = 'The mail connection service did not respond. Try again shortly.';
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      if (payload && typeof payload.error === 'string') message = payload.error;
    }
    throw new Error(message);
  }
  if (!data || typeof data !== 'object') throw new Error('The mail connection service sent an unexpected reply.');
  return data as T;
}

export interface MailStatus {
  redirectUri: string;
  providers: Record<MailProvider, { configured: boolean }>;
}

export function useMailStatus() {
  return useQuery({
    queryKey: ['mail-status'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const s = await callMail<MailStatus>({ action: 'status' });
      if (typeof s.redirectUri !== 'string' || !s.providers) throw new Error('The mail connection service sent an unexpected reply.');
      return s;
    },
  });
}

export function useMailAccounts() {
  return useQuery({
    queryKey: ['mail-accounts'],
    queryFn: async () =>
      unwrap(await supabase.from('cc_mail_accounts').select('*').order('created_at')) as MailAccount[],
  });
}

export function useMailMessages() {
  return useQuery({
    queryKey: ['mail-messages'],
    queryFn: async () =>
      unwrap(await supabase.from('cc_mail_messages').select('*').order('received_at', { ascending: false }).limit(300)) as MailMessage[],
  });
}

export function useCalendarEvents() {
  return useQuery({
    queryKey: ['calendar-events'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('cc_calendar_events')
          .select('*')
          .gte('ends_at', new Date(Date.now() - 86_400_000).toISOString())
          .eq('is_cancelled', false)
          .order('starts_at')
          .limit(500),
      ) as CalendarEvent[],
  });
}

function invalidateMail(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['mail-accounts'] });
  qc.invalidateQueries({ queryKey: ['mail-messages'] });
  qc.invalidateQueries({ queryKey: ['calendar-events'] });
}

export function useConnectGoogle() {
  return useMutation({
    mutationFn: async (): Promise<{ framedUrl: string | null }> => {
      const { url } = await callMail<{ url?: string }>({ action: 'start', provider: 'google' });
      if (typeof url !== 'string' || !url.startsWith(SIGN_IN_HOST)) {
        throw new Error('The sign-in page address looked wrong, so it was not opened.');
      }
      await recordAudit('mail.connect_start', 'mail_account');
      // Google refuses to render inside a frame (e.g. an editor preview); the caller shows a link that opens a real tab.
      if (window.self !== window.top) return { framedUrl: url };
      window.location.assign(url);
      return { framedUrl: null };
    },
  });
}

export function useAddCalendarLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (link: string) => {
      const res = await callMail<{ ok?: boolean; error?: string }>({ action: 'add_calendar_link', link });
      if (!res.ok) throw new Error(res.error ?? 'The calendar link could not be added.');
      await recordAudit('mail.calendar_link_add', 'mail_account');
    },
    onSettled: () => invalidateMail(qc),
  });
}

export function useSyncMail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (accountId?: string) => {
      const res = await callMail<{ results?: { ok: boolean; error?: string }[] }>({ action: 'sync', accountId });
      const failed = (res.results ?? []).filter((r) => !r.ok);
      if (failed.length) throw new Error(failed[0].error ?? 'One account could not be refreshed.');
      return res.results?.length ?? 0;
    },
    onSettled: () => invalidateMail(qc),
  });
}

export function useUpdateMailAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, identity }: { id: string; identity: Identity | null }) => {
      check(await supabase.from('cc_mail_accounts').update({ identity }).eq('id', id));
      await recordAudit('mail.identity', 'mail_account', id);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['mail-accounts'] }),
  });
}

export function useDisconnectMail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      check(await supabase.from('cc_mail_accounts').delete().eq('id', id));
      await recordAudit('mail.disconnect', 'mail_account', id);
    },
    onSettled: () => invalidateMail(qc),
  });
}

export function useAutoSyncMail() {
  const accounts = useMailAccounts();
  const sync = useSyncMail();
  const started = useRef(false);
  const list = accounts.data ?? [];
  const oldest = list.reduce<number>((min, a) => Math.min(min, a.last_synced_at ? new Date(a.last_synced_at).getTime() : 0), Infinity);
  useEffect(() => {
    if (started.current || list.length === 0) return;
    if (Date.now() - oldest < STALE_AFTER_MS) return;
    started.current = true;
    sync.mutate(undefined);
  }, [list.length, oldest, sync]);
  return sync;
}

export function lastSynced(accounts: MailAccount[]) {
  const times = accounts.map((a) => (a.last_synced_at ? new Date(a.last_synced_at).getTime() : 0)).filter(Boolean);
  return times.length ? Math.min(...times) : 0;
}
