import { useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthProvider';
import { useRefreshMfa, useTotpFactors, verifyTotp } from './mfa';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';

export function MfaChallenge() {
  const { user } = useAuth();
  const factors = useTotpFactors();
  const refresh = useRefreshMfa();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const factor = (factors.data ?? []).find((f) => f.status === 'verified');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!factor) return;
    setBusy(true);
    setError(null);
    try {
      await verifyTotp(factor.id, code);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-surface p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary-600" />
          <h1 className="text-lg font-semibold">Enter your 6-digit code</h1>
        </div>
        <p className="text-sm text-muted">Open your authenticator app and type the current code for Command Center{user?.email ? ` (${user.email})` : ''}.</p>
        <Input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" aria-label="Code" />
        {error && <p className="text-sm text-error-700 dark:text-error-300" role="alert">{error}</p>}
        {factors.error && <p className="text-sm text-error-700 dark:text-error-300" role="alert">Could not load your sign-in settings. Reload the page.</p>}
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" onClick={() => supabase.auth.signOut()}>Sign out</Button>
          <Button type="submit" variant="primary" disabled={busy || !factor || code.replace(/\s/g, '').length < 6}>{busy ? 'Checking...' : 'Continue'}</Button>
        </div>
      </form>
    </div>
  );
}
