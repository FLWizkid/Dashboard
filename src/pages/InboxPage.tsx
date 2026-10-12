import { useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatDistanceToNowStrict } from 'date-fns';
import { ExternalLink, Inbox, ListPlus, Mail, RefreshCw, Star } from 'lucide-react';
import { MAIL_PROVIDERS, type MailAccount, type MailMessage } from '@/lib/types';
import { cn, errorMessage, safeHref } from '@/lib/utils';
import { lastSynced, useAutoSyncMail, useMailAccounts, useMailMessages } from '@/data/mail';
import { useCreateTask } from '@/data/tasks';
import { PageHeader, type PageTab } from '@/components/ui/page-header';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ProviderMark, SourceBadge } from '@/components/mail/SourceBadge';

function MessageRow({ m, account }: { m: MailMessage; account: MailAccount | undefined }) {
  const create = useCreateTask();
  const toast = useToast();
  const href = safeHref(m.web_link);
  const sender = m.from_name || m.from_email || 'Unknown sender';
  const makeTask = () =>
    create.mutate(
      {
        title: (m.subject || `Email from ${sender}`).slice(0, 300),
        identity: account?.identity ?? null,
        notes: [`From: ${sender}${m.from_email ? ` <${m.from_email}>` : ''}`, account ? `To: ${account.email}` : '', href ?? ''].filter(Boolean).join('\n'),
      },
      { onSuccess: () => toast('Task created from email.'), onError: () => toast('Could not create the task. Try again.', 'error') },
    );
  return (
    <li className="group flex gap-3 rounded-md px-2 py-3 transition-colors hover:bg-raised">
      <span className={cn('mt-2 size-2 shrink-0 rounded-full', m.is_unread ? 'bg-primary-500' : 'bg-transparent')} aria-label={m.is_unread ? 'Unread' : undefined} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('truncate text-sm', m.is_unread ? 'font-semibold' : 'font-medium text-muted')}>{sender}</span>
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
          <Button variant="ghost" size="sm" onClick={makeTask} disabled={create.isPending}><ListPlus /> Make task</Button>
          {href && account && (
            <Button asChild variant="ghost" size="sm">
              <a href={href} target="_blank" rel="noopener noreferrer"><ExternalLink /> Open in {MAIL_PROVIDERS[account.provider].app}</a>
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

export function InboxPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'unread' || params.get('tab') === 'important' ? params.get('tab')! : 'all';
  const source = params.get('source');
  const accounts = useMailAccounts();
  const messages = useMailMessages();
  const sync = useAutoSyncMail();
  const toast = useToast();
  const list = accounts.data ?? [];
  const byId = useMemo(() => new Map(list.map((a) => [a.id, a])), [list]);
  const all = messages.data ?? [];
  const inSource = source ? all.filter((m) => m.account_id === source) : all;
  const shown = inSource.filter((m) => (tab === 'unread' ? m.is_unread : tab === 'important' ? m.is_important : true));

  const link = (t: string) => {
    const p = new URLSearchParams(params);
    if (t === 'all') p.delete('tab'); else p.set('tab', t);
    return `/inbox?${p.toString()}`;
  };
  const tabs: PageTab[] = [
    { key: 'all', label: 'All', to: link('all') },
    { key: 'unread', label: 'Unread', to: link('unread'), count: inSource.filter((m) => m.is_unread).length },
    { key: 'important', label: 'Important', to: link('important'), count: inSource.filter((m) => m.is_important).length, tone: 'alert' },
  ];
  const setSource = (id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set('source', id); else p.delete('source');
    setParams(p, { replace: true });
  };
  const refresh = () => sync.mutate(undefined, { onError: (e) => toast(errorMessage(e), 'error') });

  const noAccounts = !accounts.isLoading && !accounts.error && list.length === 0;

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <PageHeader
        title="Unified Inbox"
        description="Triage only. Every message shows which inbox it arrived in and which identity it belongs to."
        tabs={noAccounts ? undefined : tabs}
        activeTab={tab}
        actions={!noAccounts && (
          <Button onClick={refresh} disabled={sync.isPending}><RefreshCw className={cn(sync.isPending && 'animate-spin')} /> Sync</Button>
        )}
      />
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
        title={tab === 'unread' ? 'Unread' : tab === 'important' ? 'Important' : 'Latest mail'}
        icon={<Inbox />}
        subtitle={noAccounts ? undefined : 'Most recent 50 inbox messages per Outlook account, 30 per Gmail account.'}
        updatedAt={noAccounts ? undefined : lastSynced(list)}
        onRefresh={noAccounts ? undefined : refresh}
        refreshing={sync.isPending || messages.isFetching}
        loading={accounts.isLoading || messages.isLoading}
        error={accounts.error ?? messages.error}
        empty={noAccounts || shown.length === 0}
        emptyState={noAccounts ? (
          <EmptyState icon={<Mail />} title="Not connected yet, so there is no mail to show" text="Outlook and Google each need a one-time setup from you; Setup walks you through it."
            action={<Button asChild variant="primary"><Link to="/setup">Open setup steps</Link></Button>} />
        ) : (
          <EmptyState icon={<Inbox />} title={tab === 'all' ? 'Inbox is empty' : `Nothing ${tab}`} text="New mail appears after the next sync." />
        )}
        bodyClassName="p-2"
      >
        <ul className="divide-y divide-line">
          {shown.map((m) => <MessageRow key={m.id} m={m} account={byId.get(m.account_id)} />)}
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
