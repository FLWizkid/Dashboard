import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthProvider';

export function useAssurance() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['aal', session?.access_token ?? null],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) throw error;
      return { current: data.currentLevel, next: data.nextLevel, verified: data.currentLevel === 'aal2' };
    },
    staleTime: 30_000,
  });
}

export function useTotpFactors() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['mfa-factors', session?.user.id ?? null],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      return data.totp;
    },
  });
}

export function useRefreshMfa() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['aal'] });
    qc.invalidateQueries({ queryKey: ['mfa-factors'] });
  };
}

export async function verifyTotp(factorId: string, code: string) {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s+/g, '') });
  if (error) throw new Error(/invalid|expired/i.test(error.message) ? 'That code did not match. Check the time on your phone and try the newest code.' : error.message);
}
