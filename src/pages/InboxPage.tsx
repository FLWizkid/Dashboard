import { useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatDistanceToNowStrict } from 'date-fns';
import { Crown, ExternalLink, Inbox, ListPlus, Mail, RefreshCw, Star } from 'lucide-react';
import { IDENTITIES, MAIL_PROVIDERS, type MailAccount, type MailMessage } from '@/lib/types';
import { useSettings, useUpdateSettings } from '@/data/settings';
import { cn, errorMessage, safeHref } from '@/lib/utils';
import { lastSynced, useAutoSyncMail, useMailAccounts, useMailMessages } from '@/data/mail';
import { useCreateTask } from '@/data/tasks';
import { PageHeader, type PageTab } from '@/components/ui/page-header';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ProviderMark, SourceBadge } from '@/components/mail/SourceBadge';

const SUPERHUMAN_URL = 'https://mail.superhuman.com/';

function MessageRow({ m, account, vip, onToggleVip }: { m: MailMessage; account: MailAccount | undefined; vip: boolean; onToggleVip: (() => void) | null }) {
  const create = useCreateTask();
  const toast = useToast();
  const providerHref = safeHref(m.web_link);
  const href = account?.open_in === 'superhuman' ? SUPERHUMAN_URL : providerHref;
  const appName = account?.open_in === 'superhuman' ? 'Superhuman' : account ? MAIL_PROVIDERS[account.provider].app : '';
  const sender = m.from_name || m.from_email || 'Unknown sender';
  const makeTask = () =>
    create.mutate(
      {
        title: (m.subject || `Email from ${sender}`).slice(0, 300),
        identity: account?.identity ?? null,
        notes: [`From: ${sender}${m.from_email ? ` <${m.from_email}>` : ''}`, account ? `To: ${account.email}` : '', providerHref ?? ''].filter(Boolean).join('\n'),
      },
      { onSuccess: () => toast('Task created from email.'), onError: () => toast('Could not create the task. Try again.', 'error') },
    );
  return (
    <li className="group flex gap-3 rounded-md px-2 py-3 transition-colors hover:bg-raised">
      <span className={cn('mt-2 size-2 shrink-0 rounded-full', m.is_unread ? 'bg-primary-500' : 'bg-transparent')} aria-label={m.is_unread ? 'Unread' : undefined} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('truncate text-sm', m.is_unread ? 'font-semibold' : 'font-medium text-muted')}>{sender}</span>
          {vip && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary-500/15 px-1.5 text-xs font-medium text-primary-700 dark:text-primary-300">
              <Crown className="size-3" /> VIP
            </span>
          )}
          {m.is_important && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-warning-800 dark:text-warning-300">
              <Star className="size-3.5" /> Important
            </span>
          )}
          <span className="ml-auto shrink-0 text-xs text-subtle" title={new Date(m.received_at).toLocaleString()}>
            {formatDistanceToNowStrict(new Date(m.received_at), { addSuffix: true })}
          </span>
        </div>
        <p className={cn('truncate text-sm', m.is_unread && 'font-medium')}>{m.subject || '(no subject)'}</p>
        {m.snippet && <p className="line-clamp-1 text-sm text-subtle">{m.snippet}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <SourceBadge account={account} />
          <span className="flex-1" />
          {onToggleVip && (
            <Button variant="ghost" size="sm" onClick={onToggleVip} className="opacity-70 group-hover:opacity-100">
              <Crown /> {vip ? 'Remove VIP' : 'Make VIP'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={makeTask} disabled={create.isPending}><ListPlus /> Make task</Button>
          {href && account && (
            <Button asChild variant="ghost" size="sm">
              <a href={href} target="_blank" rel="noopener noreferrer"><ExternalLink /> Open in {appName}</a>
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

export function InboxPage() {
  const [params, setParams] = useSearchParams();
  const tab = ['unread', 'important', 'vip'].includes(params.get('tab') ?? '') ? params.get('tab')! : 'all';
  const source = params.get('source');
  const identity = params.get('identity');
  const settings = useSettings();
  const updateSettings = useUpdateSettings();
  const vips = useMemo(() => new Set((settings.data?.vip_senders ?? []).map((v) => v.toLowerCase())), [settings.data]);
  const isVip = (m: MailMessage) => !!m.from_email && vips.has(m.from_email.toLowerCase());
  const accounts = useMailAccounts();
  const messages = useMailMessages();
  const sync = useAutoSyncMail();
  const toast = useToast();
  const list = useMemo(() => (accounts.data ?? []).filter((a) => a.provider !== 'outlook_ics'), [accounts.data]);
  const byId = useMemo(() => new Map(list.map((a) => [a.id, a])), [list]);
  const all = messages.data ?? [];
  const identities = IDENTITIES.filter((i) => list.some((a) => a.identity === i.value));
  const inSource = all.filter((m) => (!source || m.account_id === source) && (!identity || byId.get(m.account_id)?.identity === identity));
  const shown = inSource.filter((m) => (tab === 'unread' ? m.is_unread : tab === 'important' ? m.is_important : tab === 'vip' ? isVip(m) : true));
  const toggleVip = (email: string) => {
    const e = email.toLowerCase();
    const next = vips.has(e) ? [...vips].filter((v) => v !== e) : [...vips, e];
    if (next.length > 200) return toast('You can have up to 200 VIP senders.', 'error');
    updateSettings.mutate({ vip_senders: next }, {
      onSuccess: () => toast(vips.has(e) ? `${email} is no longer a VIP.` : `${email} is now a VIP.`),
      onError: (err) => toast(errorMessage(err), 'error'),
    });
  };

  const link = (t: string) => {
    const p = new URLSearchParams(params);
    if (t === 'all') p.delete('tab'); else p.set('tab', t);
    return `/inbox?${p.toString()}`;
  };
  const tabs: PageTab[] = [
    { key: 'all', label: 'All', to: link('all') },
    { key: 'unread', label: 'Unread', to: link('unread'), count: inSource.filter((m) => m.is_unread).length },
    { key: 'important', label: 'Important', to: link('important'), count: inSource.filter((m) => m.is_important).length, tone: 'alert' },
    { key: 'vip', label: 'VIP', to: link('vip'), count: inSource.filter(isVip).length },
  ];
  const setIdentity = (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set('identity', id); else p.delete('identity');
    setParams(p, { replace: true });
  };
  const setSource = (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set('source', id); else p.delete('source');
    setParams(p, { replace: true });
  };
  const refresh = () => sync.mutate(undefined, { onError: (e) => toast(errorMessage(e), 'error') });

  const noAccounts = !accounts.isLoading && !accounts.error && list.length === 0;

  return (
    <div className="mx-auto max-w-[1100px] space-y-3">
      <PageHeader
        title="Unified Inbox"
        description="Triage only. Every message shows which inbox it arrived in and which identity it belongs to. Previews older than 30 days are cleared automatically."
        tabs={noAccounts ? undefined : tabs}
        activeTab={tab}
        actions={!noAccounts && (
          <Button onClick={refresh} disabled={sync.isPending}><RefreshCw className={cn(sync.isPending && 'animate-spin')} /> Sync</Button>
        )}
      />
      {identities.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by identity">
          <SourceChip active={!identity} onClick={() => setIdentity(null)}>All identities</SourceChip>
          {identities.map((i) => <SourceChip key={i.value} active={identity === i.value} onClick={() => setIdentity(i.value)}>{i.label}</SourceChip>)}
        </div>
      )}
      {list.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by inbox">
          <SourceChip active={!source} onClick={() => setSource(null)}>All inboxes</SourceChip>
          {list.map((a) => (
            <SourceChip key={a.id} active={source === a.id} onClick={() => setSource(a.id)}>
              <ProviderMark provider={a.provider} className="size-4" /> {a.email}
            </SourceChip>
          ))}
        </div>
      )}
      <Panel
        title={tab === 'unread' ? 'Unread' : tab === 'important' ? 'Important' : tab === 'vip' ? 'VIP senders' : 'Latest mail'}
        icon={<Inbox />}
        subtitle={noAccounts ? undefined : 'Most recent 30 inbox messages per Gmail account.'}
        updatedAt={noAccounts ? undefined : lastSynced(list)}
        onRefresh={noAccounts ? undefined : refresh}
        refreshing={sync.isPending || messages.isFetching}
        loading={accounts.isLoading || messages.isLoading}
        error={accounts.error ?? messages.error}
        empty={noAccounts || shown.length === 0}
        emptyState={noAccounts ? (
          <EmptyState icon={<Mail />} title="Not connected yet, so there is no mail to show" text="Connect Microsoft 365 (doug@theonefor.ai) or Gmail (doug@encountive.com) from Setup to see your inbox here."
            action={<Button asChild variant="primary"><Link to="/setup">Open setup steps</Link></Button>} />
        ) : (
          <EmptyState icon={<Inbox />} title={tab === 'all' ? 'Inbox is empty' : tab === 'vip' ? 'No mail from VIPs' : `Nothing ${tab}`} text={tab === 'vip' ? 'Press Make VIP on any message to always see that sender here.' : 'New mail appears after the next sync.'} />
        )}
        bodyClassName="p-2"
      >
        <ul className="divide-y divide-line">
          {shown.map((m) => (
            <MessageRow key={m.id} m={m} account={byId.get(m.account_id)} vip={isVip(m)} onToggleVip={m.from_email && settings.data ? () => toggleVip(m.from_email as string) : null} />
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function SourceChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-sm transition-colors',
        active ? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300' : 'border-line text-muted hover:bg-raised hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}
