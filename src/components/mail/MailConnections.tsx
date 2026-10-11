import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Info, Mail, Plug, RefreshCw, Unplug } from 'lucide-react';
import { IDENTITIES, MAIL_PROVIDERS, type Identity, type MailAccount, type MailProvider } from '@/lib/types';
import { cn, errorMessage, relativeTime } from '@/lib/utils';
import {
  useConnectMail, useDisconnectMail, useMailAccounts, useMailStatus, useSyncMail, useUpdateMailAccount,
} from '@/data/mail';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { NotConnected, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ProviderMark } from './SourceBadge';
import { SetupGuide } from './SetupGuide';

const RETURN_MESSAGES: Record<string, [string, 'success' | 'error' | 'info']> = {
  connected: ['Account connected. Choose which identity it belongs to below.', 'success'],
  denied: ['Sign-in was cancelled, so nothing was connected.', 'info'],
  expired: ['That sign-in took too long. Click Connect to try again.', 'error'],
  error: ['The account could not be connected. Click Connect to try again.', 'error'],
};

const PROTON = {
  phase: 5,
  what: 'Proton Mail (dougtully@proton.me) has no online access for other apps. It needs a paid Proton plan with Proton Mail Bridge running on your Windows PC, plus a small relay program.',
  steps: [
    'Confirm your Proton plan includes Proton Mail Bridge (Mail Plus or higher).',
    'Install Proton Mail Bridge on your Windows PC and sign in.',
    'A relay program for your PC will be provided in a later phase; it sends only sender, subject and time to the console.',
  ],
};

function useReturnToast() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const result = params.get('mail');
  useEffect(() => {
    if (!result) return;
    const msg = RETURN_MESSAGES[result] ?? RETURN_MESSAGES.error;
    toast(msg[0], msg[1]);
    params.delete('mail');
    setParams(params, { replace: true });
  }, [result, params, setParams, toast]);
}

function ProviderRow({ provider, configured, redirectUri }: { provider: MailProvider; configured: boolean; redirectUri: string }) {
  const [guide, setGuide] = useState(false);
  const connect = useConnectMail();
  const toast = useToast();
  const p = MAIL_PROVIDERS[provider];
  const onConnect = () => connect.mutate(provider, { onError: (e) => toast(errorMessage(e), 'error') });
  return (
    <li className={cn('flex flex-wrap items-center gap-3 rounded-md border p-3', configured ? 'border-line' : 'border-dashed border-line bg-raised/50')}>
      <ProviderMark provider={provider} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{p.label}</p>
        <p className="text-xs text-subtle">{configured ? 'Ready. Connect one or more accounts.' : 'Not connected. Needs a one-time setup.'}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={() => setGuide(true)}>Setup steps</Button>
      {configured ? (
        <Button variant="primary" size="sm" onClick={onConnect} disabled={connect.isPending}>
          <Plug /> {connect.isPending ? 'Opening sign-in...' : 'Connect'}
        </Button>
      ) : (
        <Button size="sm" onClick={() => setGuide(true)}>Set up</Button>
      )}
      <SetupGuide provider={provider} redirectUri={redirectUri} open={guide} onOpenChange={setGuide} />
    </li>
  );
}

function AccountRow({ account }: { account: MailAccount }) {
  const update = useUpdateMailAccount();
  const sync = useSyncMail();
  const disconnect = useDisconnectMail();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const onIdentity = (v: string) =>
    update.mutate({ id: account.id, identity: (v || null) as Identity | null }, {
      onSuccess: () => toast('Identity saved.'),
      onError: () => toast('Could not save the identity. Try again.', 'error'),
    });
  const onSync = () => sync.mutate(account.id, {
    onSuccess: () => toast('Account refreshed.'),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const onDisconnect = () => disconnect.mutate(account.id, {
    onSuccess: () => { setConfirm(false); toast('Disconnected. Its sign-in and cached mail were deleted.'); },
    onError: () => toast('Could not disconnect. Try again.', 'error'),
  });
  return (
    <li className="rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center gap-3">
        <ProviderMark provider={account.provider} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{account.email}</p>
          <p className="text-xs text-subtle">{MAIL_PROVIDERS[account.provider].app} · synced {relativeTime(account.last_synced_at)}</p>
        </div>
        {account.status === 'connected'
          ? <StatusPill status="healthy" label="Connected" />
          : <StatusPill status="action" label="Needs attention" />}
      </div>
      {account.last_error && <p className="mt-2 text-sm text-error-700 dark:text-error-300">{account.last_error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Identity</span>
          <Select
            value={account.identity ?? ''}
            onChange={(e) => onIdentity(e.target.value)}
            className={cn('w-44', !account.identity && 'border-warning-500')}
            aria-label={`Identity for ${account.email}`}
          >
            <option value="">Not chosen</option>
            {IDENTITIES.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
          </Select>
        </label>
        <span className="flex-1" />
        <Button size="sm" onClick={onSync} disabled={sync.isPending}>
          <RefreshCw className={cn(sync.isPending && 'animate-spin')} /> Sync now
        </Button>
        {account.status === 'error' && <ReconnectButton provider={account.provider} />}
        <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}><Unplug /> Disconnect</Button>
      </div>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Disconnect ${account.email}?`}
        description="Deletes the saved sign-in and all cached mail and events for this account."
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="danger" onClick={onDisconnect} disabled={disconnect.isPending}>Disconnect</Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          To fully revoke access, also remove "CIO Command Console" from your {account.provider === 'microsoft' ? 'Microsoft account apps (myapps.microsoft.com)' : 'Google account third-party access page'}.
        </p>
      </Dialog>
    </li>
  );
}

function ReconnectButton({ provider }: { provider: MailProvider }) {
  const connect = useConnectMail();
  const toast = useToast();
  return (
    <Button variant="primary" size="sm" disabled={connect.isPending}
      onClick={() => connect.mutate(provider, { onError: (e) => toast(errorMessage(e), 'error') })}>
      <Plug /> Reconnect
    </Button>
  );
}

export function MailConnections() {
  useReturnToast();
  const status = useMailStatus();
  const accounts = useMailAccounts();
  const list = accounts.data ?? [];
  const unset = list.filter((a) => !a.identity).length;
  return (
    <Panel
      title="Email and calendar"
      icon={<Mail />}
      subtitle="Read-only. Each account's mail and events are labelled with where they came from."
      updatedAt={accounts.dataUpdatedAt}
      onRefresh={() => { accounts.refetch(); status.refetch(); }}
      refreshing={accounts.isFetching || status.isFetching}
      loading={accounts.isLoading || status.isLoading}
      error={accounts.error ?? status.error}
    >
      <div className="space-y-4">
        {unset > 0 && (
          <p className="rounded-md border border-warning-500/40 bg-warning-500/10 px-3 py-2 text-sm text-warning-800 dark:text-warning-300">
            {unset === 1 ? 'One connected account has' : `${unset} connected accounts have`} no identity yet. Choose one so every email and event shows the right badge.
          </p>
        )}
        {list.length > 0 && (
          <div>
            <p className="label">Connected accounts</p>
            <ul className="space-y-2">{list.map((a) => <AccountRow key={a.id} account={a} />)}</ul>
          </div>
        )}
        <div>
          <p className="label">Providers</p>
          <ul className="space-y-2">
            {status.data && (Object.keys(MAIL_PROVIDERS) as MailProvider[]).map((p) => (
              <ProviderRow key={p} provider={p} configured={status.data.providers[p]?.configured ?? false} redirectUri={status.data.redirectUri} />
            ))}
            <li className="flex items-center gap-3">
              <span className="inline-flex size-5 shrink-0 items-center justify-center rounded bg-neutral-600 text-xs font-semibold text-white" aria-hidden>P</span>
              <div className="min-w-0 flex-1"><NotConnected title="Proton Mail" info={PROTON} compact /></div>
            </li>
          </ul>
        </div>
        <p className="flex gap-2 rounded-md bg-raised p-3 text-sm text-muted">
          <Info className="mt-0.5 size-4 shrink-0" />
          Superhuman reads your Gmail and Outlook inboxes, so connecting those accounts covers it. Nothing separate to connect.
        </p>
      </div>
    </Panel>
  );
}
