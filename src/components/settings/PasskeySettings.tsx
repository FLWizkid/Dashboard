import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Fingerprint, Plus, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { passkeyError, passkeySupported, useAuthSettings } from '@/auth/passkey';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';

const KEY = ['passkeys'];

export function PasskeySettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const settings = useAuthSettings();
  const enabled = settings.data?.passkeys_enabled === true;
  const list = useQuery({
    queryKey: KEY,
    enabled,
    queryFn: async () => {
      const { data, error: err } = await supabase.auth.passkey.list();
      if (err) throw err;
      return data ?? [];
    },
    retry: false,
  });
  const add = useMutation({
    mutationFn: async () => {
      const { error: err } = await supabase.auth.registerPasskey();
      if (err) throw err;
    },
    onSuccess: () => {
      setError(null);
      toast('Windows Hello is on for this PC.', 'success');
      qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (err: Error) => setError(passkeyError(err)),
  });
  const remove = useMutation({
    mutationFn: async (passkeyId: string) => {
      const { error: err } = await supabase.auth.passkey.delete({ passkeyId });
      if (err) throw err;
    },
    onSuccess: () => {
      toast('Removed. That device can no longer sign in with Windows Hello.', 'success');
      qc.invalidateQueries({ queryKey: KEY });
    },
    onError: () => toast('Could not remove it. Try again.', 'error'),
  });

  if (!passkeySupported()) {
    return <p className="text-sm text-muted">This browser does not support Windows Hello sign-in. Use Edge or Chrome on Windows.</p>;
  }

  const keys = list.data ?? [];
  const unavailable = !enabled || list.isError;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Fingerprint className="size-4 text-muted" />
        <span className="text-sm font-medium">Windows Hello</span>
        {settings.isLoading || list.isLoading ? null : unavailable ? (
          <StatusPill status="unknown" label="Not switched on for this app yet" />
        ) : keys.length ? (
          <StatusPill status="healthy" label={`On · ${keys.length} device${keys.length > 1 ? 's' : ''}`} />
        ) : (
          <StatusPill status="unknown" label="Not set up" />
        )}
        <Button variant="secondary" size="sm" className="ml-auto" onClick={() => add.mutate()} disabled={add.isPending || !enabled}>
          <Plus /> {add.isPending ? 'Waiting for Windows Hello...' : 'Add this PC'}
        </Button>
      </div>
      {!enabled && !settings.isLoading && (
        <p className="text-sm text-muted">Windows Hello is set aside for now. Password sign-in keeps working.</p>
      )}
      {error && <p className="rounded-md border border-error-500/40 bg-error-500/10 p-2 text-sm text-error-700 dark:text-error-300" role="alert">{error}</p>}
      {keys.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1 truncate">{k.friendly_name || 'Windows Hello device'}</span>
              <span className="text-xs text-subtle">
                Added {format(new Date(k.created_at), 'MMM d, yyyy')}
                {k.last_used_at ? ` · last used ${format(new Date(k.last_used_at), 'MMM d')}` : ''}
              </span>
              <Button variant="ghost" size="sm" aria-label="Remove this device" onClick={() => remove.mutate(k.id)} disabled={remove.isPending}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-subtle">Your password keeps working. Windows Hello uses your PC's PIN, fingerprint or face, and nothing biometric leaves your PC.</p>
    </div>
  );
}
