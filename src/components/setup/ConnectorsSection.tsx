import { useState, type FormEvent, type ReactNode } from 'react';
import { CalendarPlus, Plug, RefreshCw, Unplug } from 'lucide-react';
import { IDENTITIES, MAIL_PROVIDERS, type Identity, type MailAccount } from '@/lib/types';
import { cn, errorMessage, relativeTime } from '@/lib/utils';
import {
  useAddCalendarLink, useConnectGoogle, useDisconnectMail, useMailAccounts, useMailStatus, useSyncMail, useUpdateMailAccount,
} from '@/data/mail';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ProviderMark } from '@/components/mail/SourceBadge';
import { CopyRow, GOOGLE_STEPS, OUTLOOK_CALENDAR_STEPS, SECRETS_STEPS } from './SetupSteps';

const REVOKE_HINT: Record<MailAccount['provider'], string> = {
  google: 'To fully revoke access, also remove "CIO Command Console" from your Google account third-party access page.',
  outlook_ics: 'To stop sharing completely, also click Unpublish under Settings > Calendar > Shared calendars in Outlook on the web.',
};

function StepsDialog({ open, onOpenChange, title, steps, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; steps: string[]; children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description="One-time setup. Access is read-only.">
      <ol className="list-decimal space-y-2 pl-5 text-sm">{steps.map((s) => <li key={s}>{s}</li>)}</ol>
      {children}
    </Dialog>
  );
}

export function GoogleRow({ configured, redirectUri, showGuide = true }: { configured: boolean; redirectUri: string; showGuide?: boolean }) {
  const [guide, setGuide] = useState(false);
  const connect = useConnectGoogle();
  const toast = useToast();
  const onConnect = () => connect.mutate(undefined, { onError: (e) => toast(errorMessage(e), 'error') });
  return (
    <div className={cn('rounded-md border p-3', configured ? 'border-line' : 'border-dashed border-line bg-raised/50')}>
      <div className="flex flex-wrap items-center gap-3">
        <ProviderMark provider="google" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{MAIL_PROVIDERS.google.label}</p>
          <p className="text-xs text-subtle">{configured ? 'Ready. Click Connect and sign in as doug@encountive.com.' : 'Not ready yet. Finish Parts A and B of step 2 on the Your steps tab, then Connect appears here.'}</p>
        </div>
        {configured ? (
          <Button variant="primary" size="sm" onClick={onConnect} disabled={connect.isPending}>
            <Plug /> {connect.isPending ? 'Opening sign-in...' : 'Connect'}
          </Button>
        ) : (
          <Button variant="primary" size="sm" disabled>Connect</Button>
        )}
        {showGuide && <Button size="sm" onClick={() => setGuide(true)}>Steps</Button>}
      </div>
      {connect.data?.framedUrl && (
        <div className="mt-3 rounded-md border border-line bg-raised/50 p-3 text-sm">
          <p className="mb-2">Google can't open inside this preview window. Click below to sign in on a new tab, then come back here and refresh.</p>
          <a
            href={connect.data.framedUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => connect.reset()}
            className="inline-flex items-center gap-2 rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-500"
          >
            Open Google sign-in
          </a>
        </div>
      )}
      <StepsDialog open={guide} onOpenChange={setGuide} title="Connect Google Workspace / Gmail" steps={[...GOOGLE_STEPS, ...SECRETS_STEPS]}>
        <p className="label mt-4">Redirect address</p>
        <CopyRow value={redirectUri} />
      </StepsDialog>
    </div>
  );
}

export function OutlookLinkRow({ showGuide = true }: { showGuide?: boolean }) {
  const [guide, setGuide] = useState(false);
  const [link, setLink] = useState('');
  const add = useAddCalendarLink();
  const toast = useToast();
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!link.trim()) return;
    add.mutate(link.trim(), {
      onSuccess: () => { setLink(''); toast('Outlook calendar added. Your events now show on Today and Calendar.'); },
      onError: (err) => toast(errorMessage(err), 'error'),
    });
  };
  return (
    <div className="rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center gap-3">
        <ProviderMark provider="outlook_ics" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Outlook calendar link (doug@theonefor.ai)</p>
          <p className="text-xs text-subtle">No Microsoft app or Azure needed. Publish your calendar in Outlook and paste the ICS link.</p>
        </div>
        {showGuide && <Button size="sm" onClick={() => setGuide(true)}>Steps</Button>}
      </div>
      <form onSubmit={onSubmit} className="mt-3 flex flex-wrap gap-2">
        <Input
          className="min-w-64 flex-1"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="Paste the ICS link from Outlook (ends in .ics)"
          aria-label="Outlook calendar ICS link"
          inputMode="url"
          autoComplete="off"
        />
        <Button type="submit" variant="primary" size="sm" disabled={add.isPending || !link.trim()}>
          <CalendarPlus /> {add.isPending ? 'Checking link...' : 'Add calendar'}
        </Button>
      </form>
      <StepsDialog open={guide} onOpenChange={setGuide} title="Show your Outlook calendar" steps={OUTLOOK_CALENDAR_STEPS} />
    </div>
  );
}

function AccountRow({ account }: { account: MailAccount }) {
  const update = useUpdateMailAccount();
  const sync = useSyncMail();
  const disconnect = useDisconnectMail();
  const connect = useConnectGoogle();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const isLink = account.provider === 'outlook_ics';
  const onSync = () => sync.mutate(account.id, {
    onSuccess: () => toast('Account refreshed.'),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const onDisconnect = () => disconnect.mutate(account.id, {
    onSuccess: () => { setConfirm(false); toast(isLink ? 'Calendar link removed, with its cached events.' : 'Disconnected. Its sign-in and cached mail were deleted.'); },
    onError: () => toast('Could not disconnect. Try again.', 'error'),
  });
  return (
    <div className="rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center gap-3">
        <ProviderMark provider={account.provider} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{account.email}</p>
          <p className="text-xs text-subtle">{isLink ? 'Outlook calendar' : MAIL_PROVIDERS[account.provider].app} · synced {relativeTime(account.last_synced_at)}</p>
        </div>
        {account.status === 'connected'
          ? <StatusPill status="healthy" label="Connected" />
          : <StatusPill status="action" label="Needs attention" />}
      </div>
      {account.last_error && <p className="mt-2 text-sm text-error-700 dark:text-error-300">{account.last_error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Field label="Identity" className="min-w-44">
          <Select
            value={account.identity ?? ''}
            onChange={(e) => update.mutate({ id: account.id, identity: (e.target.value || null) as Identity | null }, {
              onSuccess: () => toast('Identity saved.'),
              onError: () => toast('Could not save the identity. Try again.', 'error'),
            })}
            className={cn(!account.identity && 'border-warning-500')}
            aria-label={`Identity for ${account.email}`}
          >
            <option value="">Not chosen</option>
            {IDENTITIES.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
          </Select>
        </Field>
        <span className="flex-1" />
        <Button size="sm" onClick={onSync} disabled={sync.isPending}>
          <RefreshCw className={cn(sync.isPending && 'animate-spin')} /> Sync now
        </Button>
        {account.status === 'error' && !isLink && (
          <Button variant="primary" size="sm" disabled={connect.isPending}
            onClick={() => connect.mutate(undefined, { onError: (e) => toast(errorMessage(e), 'error') })}>
            <Plug /> Reconnect
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}><Unplug /> {isLink ? 'Remove' : 'Disconnect'}</Button>
      </div>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`${isLink ? 'Remove' : 'Disconnect'} ${account.email}?`}
        description={isLink ? 'Deletes the saved calendar link and all cached events from it.' : 'Deletes the saved sign-in and all cached mail and events for this account.'}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="danger" onClick={onDisconnect} disabled={disconnect.isPending}>{isLink ? 'Remove' : 'Disconnect'}</Button>
          </>
        }
      >
        <p className="text-sm text-muted">{REVOKE_HINT[account.provider]}</p>
      </Dialog>
    </div>
  );
}

export function ConnectorsSection() {
  const status = useMailStatus();
  const accounts = useMailAccounts();
  const list = accounts.data ?? [];
  const unset = list.filter((a) => !a.identity).length;
  return (
    <Panel
      title="Connectors"
      icon={<Plug />}
      subtitle="One-time setup, then connect accounts. Access is read-only and sign-ins are stored only on the server."
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
        <div>
          <p className="label">Connected accounts</p>
          {list.length === 0 ? (
            <p className="rounded-md border border-dashed border-line bg-raised/50 p-3 text-sm text-muted">No accounts connected yet.</p>
          ) : (
            <div className="space-y-2">{list.map((a) => <AccountRow key={a.id} account={a} />)}</div>
          )}
        </div>
        <div>
          <p className="label">Add a source</p>
          <div className="space-y-2">
            <OutlookLinkRow />
            {status.data && <GoogleRow configured={status.data.providers.google?.configured ?? false} redirectUri={status.data.redirectUri} />}
          </div>
        </div>
        <p className="rounded-md bg-raised p-3 text-sm text-muted">
          doug@theonefor.ai mail stays in its own Outlook mailbox and is kept separate from Encountive; reading it here would need a Microsoft app, which is skipped because you do not use Azure. Its calendar comes in through the link above.
          Proton Mail (dougtully@protonmail.com) needs Proton Mail Bridge on your Windows PC and arrives in a later phase.
        </p>
      </div>
    </Panel>
  );
}
