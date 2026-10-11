import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Settings } from '@/lib/types';
import { check, recordAudit, unwrap } from './core';

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async (): Promise<Settings> => {
      const existing = await supabase.from('cc_settings').select('*').maybeSingle();
      if (existing.error) throw new Error(existing.error.message);
      if (existing.data) return existing.data as Settings;
      const created = await supabase.from('cc_settings').insert({ notification_address: 'doug@theonefor.ai' });
      if (created.error && created.error.code !== '23505') throw new Error(created.error.message);
      return unwrap(await supabase.from('cc_settings').select('*').single()) as Settings;
    },
  });
}

export function useShowDemo() {
  return useSettings().data?.show_demo ?? true;
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Omit<Settings, 'user_id'>>) => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error('Not signed in.');
      check(await supabase.from('cc_settings').update(patch).eq('user_id', auth.user.id));
      const keys = Object.keys(patch).filter((k) => !k.startsWith('last_time'));
      if (keys.length) await recordAudit(`settings.update:${keys.join(',')}`.slice(0, 80), 'settings');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}
