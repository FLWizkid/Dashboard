import { useQuery } from '@tanstack/react-query';
import { fetchAuthSettings } from '@/lib/supabase';

export const passkeySupported = () => typeof window !== 'undefined' && 'PublicKeyCredential' in window;

export function useAuthSettings() {
  return useQuery({ queryKey: ['auth-settings'], queryFn: fetchAuthSettings, staleTime: 5 * 60_000, retry: 1 });
}

export function passkeyError(err: { message?: string; name?: string } | null | undefined): string {
  const msg = `${err?.name ?? ''} ${err?.message ?? ''}`;
  if (/NotAllowed|cancel|abort|timed out/i.test(msg)) return 'Windows Hello was cancelled or timed out. Try again.';
  if (/not enabled|disabled|passkey.*not/i.test(msg)) return 'Windows Hello sign-in is not switched on for this app yet. Sign in with your password, then see Setup, Your steps, step 5.';
  if (/rp|origin|SecurityError|relying/i.test(msg)) return 'Windows Hello is not set up for this web address yet. Use your password on this address.';
  if (/InvalidState|already/i.test(msg)) return 'This PC already has Windows Hello saved for your account.';
  if (/fetch/i.test(msg)) return 'Could not reach the server. Check your internet connection.';
  return 'Windows Hello did not work. Use your password, then try again.';
}
