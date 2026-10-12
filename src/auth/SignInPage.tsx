import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Eye, EyeOff, Fingerprint, KeyRound, Mail, Terminal } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useAuth } from './AuthProvider';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { passkeyError, passkeySupported, useAuthSettings } from './passkey';

type Mode = 'signin' | 'signup';

function friendly(msg: string) {
  if (/invalid login/i.test(msg)) return 'That email and password do not match. Check them, or create an account first.';
  if (/already registered/i.test(msg)) return 'An account already exists for this email. Sign in instead.';
  if (/database error saving new user|signup_not_allowed/i.test(msg)) return 'This console is private. Only approved email addresses can create an account.';
  if (/password/i.test(msg) && /6/.test(msg)) return 'Use a password of at least 8 characters.';
  if (/fetch/i.test(msg)) return 'Could not reach the server. Check your internet connection.';
  return msg;
}

export function SignInPage() {
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('doug@theonefor.ai');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const authSettings = useAuthSettings();
  const helloReady = passkeySupported() && authSettings.data?.passkeys_enabled === true;
  const signupOpen = authSettings.data?.disable_signup !== true;

  if (!loading && user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (password.length < 8) return setError('Use a password of at least 8 characters.');
    setBusy(true);
    const res = mode === 'signin' ? await supabase.auth.signInWithPassword({ email, password }) : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (res.error) return setError(friendly(res.error.message));
    if (mode === 'signup' && !res.data.session) setNotice('Account created. Sign in to continue.');
  }

  async function windowsHello() {
    setError(null);
    setNotice(null);
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPasskey();
    setBusy(false);
    if (err) setError(passkeyError(err));
  }

  async function magicLink() {
    setError(null);
    setNotice(null);
    if (!email) return setError('Enter your email first.');
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin, shouldCreateUser: false } });
    setBusy(false);
    if (err) return setError(friendly(err.message));
    setNotice(`Sign-in link sent to ${email}. It only works once this app's web address is allowed in the sign-in settings.`);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary-600 text-white">
            <Terminal className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">CIO Command Console</h1>
            <p className="text-sm text-muted">Private console · Encountive & Doug IT</p>
          </div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-6">
          {signupOpen && (
          <div className="mb-4 grid grid-cols-2 rounded-md bg-raised p-1 text-sm">
            {(['signin', 'signup'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={cn('rounded py-1.5 font-medium transition-colors', mode === m ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}>
                {m === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>
          )}
          <form onSubmit={submit} className="space-y-3">
            <Field label="Email">
              <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters' : undefined}>
              <div className="relative">
                <input
                  className="input pr-20"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-pressed={showPassword}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-1 top-1/2 flex h-7 -translate-y-1/2 items-center gap-1 rounded px-2 text-xs font-medium text-muted transition-colors hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </Field>
            {error && <p className="rounded-md border border-error-500/40 bg-error-500/10 p-2 text-sm text-error-700 dark:text-error-300" role="alert">{error}</p>}
            {notice && <p className="rounded-md border border-success-500/40 bg-success-500/10 p-2 text-sm text-success-700 dark:text-success-300">{notice}</p>}
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              <KeyRound />
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </form>
          {mode === 'signin' && helloReady && (
            <>
              <div className="my-4 flex items-center gap-3 text-xs text-subtle">
                <span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" />
              </div>
              <Button variant="secondary" className="w-full" onClick={windowsHello} disabled={busy}>
                <Fingerprint /> Sign in with Windows Hello
              </Button>
            </>
          )}
          {mode === 'signin' && (
            <Button variant="ghost" className="mt-2 w-full" onClick={magicLink} disabled={busy}>
              <Mail /> Email me a sign-in link instead
            </Button>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-subtle">{helloReady ? 'First time on this PC? Sign in with your password, then add Windows Hello in Settings, Account.' : 'Windows Hello sign-in appears here once it is switched on.'}</p>
      </div>
    </div>
  );
}
