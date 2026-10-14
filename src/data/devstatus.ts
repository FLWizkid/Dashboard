import { FunctionsHttpError } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { CheckStatus } from '@/lib/types';

export interface DevItem { label: string; status: CheckStatus; detail: string; url?: string }
export interface DevService { key: 'github' | 'vercel' | 'resend'; configured: boolean; status: CheckStatus; summary: string; items: DevItem[]; error?: string }

export function useDevStatus() {
  return useQuery({
    queryKey: ['dev-status'],
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('dev-status', { body: {} });
      if (error) {
        let message = 'The status service did not respond. Try again shortly.';
        if (error instanceof FunctionsHttpError) {
          const payload = await error.context.json().catch(() => null);
          if (payload && typeof payload.error === 'string') message = payload.error;
        }
        throw new Error(message);
      }
      if (!data || !Array.isArray(data.services)) throw new Error('The status service sent an unexpected reply.');
      return data.services as DevService[];
    },
  });
}
