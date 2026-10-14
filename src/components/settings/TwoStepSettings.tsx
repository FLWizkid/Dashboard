import { useState } from 'react';
import { KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAssurance, useRefreshMfa, useTotpFactors, verifyTotp } from '@/auth/mfa';
import { errorMessage } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/badge';
import { Input } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

interface Pending { id: string; qr: string; secret: string }

export function TwoStepSettings() {
  const factors = useTotpFactors();
  const aal = useAssurance();
  const refresh = useRefreshMfa();
  const toast = useToast();
  const [pending, setPending] = useState<Pending | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const verified = (factors.data ?? []).filter((f) => f.status === 'verified');

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data: existing } = await supabase.auth.mfa.listFactors();
      for (const f of existing?.all ?? []) if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
      if (err) throw err;
      setPending({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await verifyTotp(pending.id, code);
      setPending(null);
      setCode('');
      refresh();
      toast('Two-step sign-in is on.', 'success');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirmRemove) return setConfirmRemove(true);
    setBusy(true);
    try {
      for (const f of verified) {
        const { error: err } = await supabase.auth.mfa.unenroll({ factorId: f.id });
        if (err) throw err;
      }
      refresh();
      toast('Two-step sign-in is off. Connecting new mailboxes now needs it switched back on.');
    } catch (err) {
      toast(/aal2/i.test(errorMessage(err)) ? 'Sign out and back in with your code first, then try again.' : errorMessage(err), 'error');
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="size-4 text-muted" />
        <span className="text-sm font-medium">Two-step sign-in (authenticator app)</span>
        {factors.isLoading ? null : verified.length ? (
          <StatusPill status="healthy" label={aal.data?.verified ? 'On, verified this session' : 'On'} />
        ) : (
          <StatusPill status="attention" label="Off" />
        )}
        <span className="ml-auto" />
        {verified.length ? (
          <Button variant={confirmRemove ? 'danger' : 'ghost'} size="sm" onClick={remove} onBlur={() => setConfirmRemove(false)} disabled={busy}>
            <Trash2 /> {confirmRemove ? 'Confirm turn off' : 'Turn off'}
          </Button>
        ) : !pending && (
          <Button variant="secondary" size="sm" onClick={start} disabled={busy || factors.isLoading}><KeyRound /> {busy ? 'Starting...' : 'Turn on'}</Button>
        )}
      </div>
      {pending && (
        <div className="grid gap-4 rounded-md border border-line p-3 sm:grid-cols-[160px_1fr]">
          <img src={pending.qr} alt="QR code for your authenticator app" className="size-40 rounded bg-white p-2" />
          <div className="space-y-2 text-sm">
            <p>1. In Microsoft Authenticator, Google Authenticator or 1Password, add an account and scan this code.</p>
            <p className="text-xs text-muted">Cannot scan? Enter this key: <span className="break-all font-mono text-fg">{pending.secret}</span></p>
            <p>2. Type the 6-digit code it shows.</p>
            <div className="flex gap-2">
              <Input inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" aria-label="Code from your app" className="max-w-36" />
              <Button variant="primary" size="sm" onClick={confirm} disabled={busy || code.replace(/\s/g, '').length < 6}>{busy ? 'Checking...' : 'Confirm'}</Button>
              <Button variant="ghost" size="sm" onClick={() => { setPending(null); setCode(''); }}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
      {error && <p className="rounded-md border border-error-500/40 bg-error-500/10 p-2 text-sm text-error-700 dark:text-error-300" role="alert">{error}</p>}
      <p className="text-xs text-subtle">Required before connecting a mailbox. After you turn it on, the console asks for a code from your phone each time you sign in.</p>
    </div>
  );
}
