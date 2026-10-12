import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, Database, FolderKanban, ListTodo, Plug, RefreshCw, ShieldAlert, Trash2, Unplug } from 'lucide-react';
import { IDENTITIES, MAIL_PROVIDERS, type Identity, type MailAccount, type MailProvider } from '@/lib/types';
import { cn, errorMessage, relativeTime } from '@/lib/utils';
import { useConnectMail, useDisconnectMail, useMailAccounts, useMailStatus, useSyncMail, useUpdateMailAccount } from '@/data/mail';
import { useCompanies, useProjects } from '@/data/organization';
import { useTasks } from '@/data/tasks';
import {
  useClearRealData, useCreateTask, useDeleteCompany, useDeleteProject, useResetAll, useSaveCompany, useSaveProject,
} from '@/data/setup';
import { parseQuickAdd } from '@/lib/quick-add';
import { PageHeader, type PageTab } from '@/components/ui/page-header';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ProviderMark } from '@/components/mail/SourceBadge';

type Section = 'connectors' | 'data' | 'dangers';

const RETURN_MESSAGES: Record<string, [string, 'success' | 'error' | 'info']> = {
  connected: ['Account connected. Choose which identity it belongs to below.', 'success'],
  denied: ['Sign-in was cancelled, so nothing was connected.', 'info'],
  expired: ['That sign-in took too long. Click Connect to try again.', 'error'],
  error: ['The account could not be connected. Click Connect to try again.', 'error'],
};

function useReturnToast() {
  const toast = useToast();
  return useMemo(() => {
    const read = () => {
      const result = new URLSearchParams(window.location.search).get('mail');
      if (!result) return;
      const msg = RETURN_MESSAGES[result] ?? RETURN_MESSAGES.error;
      toast(msg[0], msg[1]);
      window.history.replaceState(null, '', '/setup');
    };
    return read;
  }, [toast]);
}

const SECRETS_STEP = 'In Bolt, click the database icon at the top of the screen, open Secrets, and add each key below with its exact name. Then come back here and click Connect.';

const MICROSOFT_STEPS = [
  'Open portal.azure.com and sign in with a theonefor.ai admin account.',
  'Search for "App registrations" and click New registration.',
  'Name: CIO Command Console. Supported accounts: "Accounts in this organizational directory only" (single tenant).',
  'Under Redirect URI, choose Web and paste the redirect address below. Click Register.',
  'From the overview page, copy the "Application (client) ID" and the "Directory (tenant) ID".',
  'Under Certificates & secrets, click New client secret (24 months), then copy the Value column right away; it is shown only once.',
  'Under API permissions, add these Microsoft Graph delegated permissions: User.Read, Mail.Read, Calendars.Read, offline_access, openid, email. Click "Grant admin consent".',
  SECRETS_STEP,
];

const GOOGLE_STEPS = [
  'Open console.cloud.google.com signed in as doug@encountive.com and create a project called "CIO Command Console".',
  'Under APIs & Services > Library, enable "Gmail API" and "Google Calendar API".',
  'Under OAuth consent screen, set the user type to Internal (this limits it to encountive.com accounts, so no Google review is needed).',
  'Under Credentials, click Create credentials > OAuth client ID, type Web application.',
  'Paste the redirect address below under Authorized redirect URIs, then copy the Client ID and Client secret.',
  SECRETS_STEP,
];

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-raised p-2">
      <code className="min-w-0 flex-1 break-all text-xs">{value}</code>
      <Button size="sm" onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch { setCopied(false); }
      }} aria-label="Copy value">
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

function GuideDialog({ open, onOpenChange, provider, redirectUri }: {
  open: boolean; onOpenChange: (open: boolean) => void; provider: MailProvider; redirectUri: string;
}) {
  const steps = provider === 'microsoft' ? MICROSOFT_STEPS : GOOGLE_STEPS;
  const keys = provider === 'microsoft'
    ? [['MICROSOFT_CLIENT_ID', 'the Application (client) ID'], ['MICROSOFT_CLIENT_SECRET', 'the secret Value'], ['MICROSOFT_TENANT', 'the Directory (tenant) ID']]
    : [['GOOGLE_CLIENT_ID', 'the Client ID'], ['GOOGLE_CLIENT_SECRET', 'the Client secret']];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Connect ${MAIL_PROVIDERS[provider].label}`} description="One-time setup. Access is read-only.">
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        {steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
      <p className="label mt-4">Redirect address</p>
      <CopyRow value={redirectUri} />
      <p className="label mt-4">Keys to add in Bolt (database icon, then Secrets)</p>
      <ul className="space-y-1 text-sm">
        {keys.map(([k, d]) => (
          <li key={k}><code className="rounded bg-raised px-1.5 py-0.5 text-xs">{k}</code> — {d}</li>
        ))}
      </ul>
    </Dialog>
  );
}

function ConnectorRow({ provider, configured, redirectUri }: { provider: MailProvider; configured: boolean; redirectUri: string }) {
  const [guide, setGuide] = useState(false);
  const connect = useConnectMail();
  const toast = useToast();
  const onConnect = () => connect.mutate(provider, { onError: (e) => toast(errorMessage(e), 'error') });
  return (
    <div className={cn('rounded-md border p-3', configured ? 'border-line' : 'border-dashed border-line bg-raised/50')}>
      <div className="flex flex-wrap items-center gap-3">
        <ProviderMark provider={provider} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{MAIL_PROVIDERS[provider].label}</p>
          <p className="text-xs text-subtle">{configured ? 'Keys are in place. You can connect an account.' : 'Waiting on you: follow Steps, add the keys in Bolt, then Connect appears here.'}</p>
        </div>
        {configured ? (
          <Button variant="primary" size="sm" onClick={onConnect} disabled={connect.isPending}>
            <Plug /> {connect.isPending ? 'Opening sign-in...' : 'Connect'}
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={() => setGuide(true)}>Set up</Button>
        )}
        <Button size="sm" onClick={() => setGuide(true)}>Steps</Button>
      </div>
      <GuideDialog open={guide} onOpenChange={setGuide} provider={provider} redirectUri={redirectUri} />
    </div>
  );
}

function AccountRow({ account }: { account: MailAccount }) {
  const update = useUpdateMailAccount();
  const sync = useSyncMail();
  const disconnect = useDisconnectMail();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const onSync = () => sync.mutate(account.id, {
    onSuccess: () => toast('Account refreshed.'),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const onDisconnect = () => disconnect.mutate(account.id, {
    onSuccess: () => { setConfirm(false); toast('Disconnected. Its sign-in and cached mail were deleted.'); },
    onError: () => toast('Could not disconnect. Try again.', 'error'),
  });
  return (
    <div className="rounded-md border border-line p-3">
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
        {account.status === 'error' && (
          <ReconnectButton provider={account.provider} />
        )}
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
    </div>
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

function ConnectorsSection() {
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
          <p className="label">Providers</p>
          <div className="space-y-2">
            {status.data && (Object.keys(MAIL_PROVIDERS) as MailProvider[]).map((p) => (
              <ConnectorRow key={p} provider={p} configured={status.data.providers[p]?.configured ?? false} redirectUri={status.data.redirectUri} />
            ))}
          </div>
        </div>
        <p className="rounded-md bg-raised p-3 text-sm text-muted">
          Superhuman reads your Gmail and Outlook inboxes, so connecting those accounts covers it — nothing separate to connect.
          Proton Mail needs Proton Mail Bridge on your Windows PC and arrives in a later phase.
        </p>
      </div>
    </Panel>
  );
}

function DeleteCompanyRow({ id, name, count }: { id: string; name: string; count: number }) {
  const del = useDeleteCompany();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="flex items-center gap-2 rounded-md border border-error-500/40 px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
      {count > 0 && <span className="shrink-0 text-xs text-subtle">{count} linked</span>}
      <Button variant="ghost" size="iconSm" onClick={() => setConfirm(true)} aria-label={`Delete ${name}`} title="Delete"><Trash2 /></Button>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete ${name}?`}
        description="Companies are only deleted when nothing is linked to them."
        footer={<>
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => del.mutate(id, {
            onSuccess: () => { setConfirm(false); toast(`${name} deleted.`); },
            onError: () => toast('This company still has tasks, projects or hours linked to it, so it was not deleted.', 'error'),
          })} disabled={del.isPending}>Delete</Button>
        </>}
      >
        <p className="text-sm text-muted">If anything is linked, the delete is refused so no records are lost.</p>
      </Dialog>
    </li>
  );
}

function DeleteProjectRow({ id, name, count }: { id: string; name: string; count: number }) {
  const del = useDeleteProject();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="flex items-center gap-2 rounded-md border border-error-500/40 px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
      {count > 0 && <span className="shrink-0 text-xs text-subtle">{count} linked</span>}
      <Button variant="ghost" size="iconSm" onClick={() => setConfirm(true)} aria-label={`Delete ${name}`} title="Delete"><Trash2 /></Button>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete ${name}?`}
        description="Projects are only deleted when nothing is linked to them."
        footer={<>
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => del.mutate(id, {
            onSuccess: () => { setConfirm(false); toast(`${name} deleted.`); },
            onError: () => toast('This project still has tasks or hours linked to it, so it was not deleted.', 'error'),
          })} disabled={del.isPending}>Delete</Button>
        </>}
      >
        <p className="text-sm text-muted">If anything is linked, the delete is refused so no records are lost.</p>
      </Dialog>
    </li>
  );
}

function DataSection() {
  const companies = useCompanies();
  const projects = useProjects();
  const tasks = useTasks();
  const createCompany = useSaveCompany();
  const createProject = useSaveProject();
  const createTask = useCreateTask();
  const toast = useToast();
  const [companyName, setCompanyName] = useState('');
  const [companyIdentity, setCompanyIdentity] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [taskText, setTaskText] = useState('');
  const companiesList = companies.data ?? [];
  const projectsList = projects.data ?? [];
  const taskCount = (id: string) => (tasks.data ?? []).filter((t: { company_id: string | null }) => t.company_id === id).length;
  const projectUse = (id: string) => (tasks.data ?? []).filter((t: { project_id: string | null }) => t.project_id === id).length;
  const invalidProject = projectId !== '' && !projectsList.some((p) => p.id === projectId);

  const addCompany = () => {
    if (!companyName.trim()) { toast('Give the company a name first.', 'error'); return; }
    createCompany.mutate(
      { name: companyName.trim(), identity: (companyIdentity || null) as Identity | null },
      { onSuccess: () => { toast(`${companyName.trim()} added.`); setCompanyName(''); setCompanyIdentity(''); },
        onError: (e) => toast(errorMessage(e), 'error') },
    );
  };
  const addProject = () => {
    if (!projectName.trim()) { toast('Give the project a name first.', 'error'); return; }
    if (invalidProject) { toast('The company selected no longer exists. Pick another.', 'error'); return; }
    createProject.mutate(
      { name: projectName.trim(), company_id: projectId || null, identity: null },
      { onSuccess: () => { toast(`${projectName.trim()} added.`); setProjectName(''); },
        onError: (e: unknown) => toast(errorMessage(e), 'error') },
    );
  };
  const addTask = () => {
    const text = taskText.trim();
    if (!text) { toast('Type the task first.', 'error'); return; }
    const parsed = parseQuickAdd(text, companiesList);
    const company = companiesList.find((c) => c.id === parsed.company_id);
    createTask.mutate(
      {
        title: parsed.title,
        due_date: parsed.due_date,
        priority: parsed.priority,
        category: parsed.category,
        company_id: parsed.company_id,
        identity: parsed.identity ?? company?.identity ?? null,
        recurrence: parsed.recurrence,
        status: parsed.priority && parsed.due_date ? 'ready' : 'backlog',
      },
      { onSuccess: () => { toast(`Task added: ${parsed.title}`); setTaskText(''); },
        onError: (e) => toast(errorMessage(e), 'error') },
    );
  };

  return (
    <div className="space-y-4">
      <Panel title="Companies" icon={<Building2 />} subtitle="Use the same names you type after @ in quick add."
        loading={companies.isLoading} error={companies.error} onRefresh={() => companies.refetch()} refreshing={companies.isFetching} updatedAt={companies.dataUpdatedAt}>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <Input placeholder="Company name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} aria-label="Company name" />
            <Select value={companyIdentity} onChange={(e) => setCompanyIdentity(e.target.value)} className="w-40" aria-label="Identity for new company">
              <option value="">Identity: not chosen</option>
              {IDENTITIES.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
            </Select>
            <Button variant="primary" onClick={addCompany} disabled={createCompany.isPending}>Add company</Button>
          </div>
          {companiesList.length === 0 ? (
            <EmptyState title="No companies yet" text="Companies connect tasks, hours and health checks to one identity." />
          ) : (
            <ul className="space-y-1">
              {companiesList.map((c) => <DeleteCompanyRow key={c.id} id={c.id} name={`${c.name} (${c.slug})`} count={taskCount(c.id)} />)}
            </ul>
          )}
        </div>
      </Panel>
      <Panel title="Projects" icon={<FolderKanban />} subtitle="Optional. Projects group tasks and hours."
        loading={projects.isLoading} error={projects.error} onRefresh={() => projects.refetch()} refreshing={projects.isFetching} updatedAt={projects.dataUpdatedAt}>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <Input placeholder="Project name" value={projectName} onChange={(e) => setProjectName(e.target.value)} aria-label="Project name" />
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-48" aria-label="Company for new project">
              <option value="">No company</option>
              {companiesList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Button variant="primary" onClick={addProject} disabled={createProject.isPending}>Add project</Button>
          </div>
          {projectsList.length === 0 ? (
            <EmptyState title="No projects yet" />
          ) : (
            <ul className="space-y-1">
              {projectsList.map((p) => <DeleteProjectRow key={p.id} id={p.id} name={p.name} count={projectUse(p.id)} />)}
            </ul>
          )}
        </div>
      </Panel>
      <Panel title="Add tasks" icon={<ListTodo />} subtitle="Same shorthand as everywhere else: dates, !priority, #category, @company, every week."
        loading={false}>
        <div className="flex gap-2">
          <Input
            placeholder="Renew domains !high fri @encountive"
            value={taskText}
            onChange={(e) => setTaskText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addTask(); }}
            aria-label="Quick add task"
          />
          <Button variant="primary" onClick={addTask} disabled={createTask.isPending}>Add task</Button>
        </div>
        {tasks.isLoading && <p className="mt-2 text-xs text-subtle">Loading existing tasks…</p>}
        {tasks.error && <p className="mt-2 text-sm text-error-700 dark:text-error-300">Could not load existing tasks.</p>}
      </Panel>
    </div>
  );
}

function DangerRow({ title, description, confirmText, onConfirm, pending, destructive }: {
  title: string; description: string; confirmText: string;
  onConfirm: () => void; pending: boolean; destructive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  return (
    <li className="rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-subtle">{description}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { setOpen(true); setText(''); }}><ShieldAlert /> Run</Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description="This cannot be undone. Real records are deleted; demo records stay for the walkthrough."
        footer={<>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="danger" disabled={pending || text.trim().toUpperCase() !== 'RESET'} onClick={() => onConfirm()}>
            {confirmText}
          </Button>
        </>}
      >
        <p className="text-sm text-muted">{destructive ? 'Everything real you entered is removed. Type RESET to confirm.' : 'Type RESET to confirm.'}</p>
        <Input className="mt-3" value={text} onChange={(e) => setText(e.target.value)} aria-label="Type RESET to confirm" placeholder="RESET" />
      </Dialog>
    </li>
  );
}

function DangersSection() {
  const reset = useResetAll();
  const clear = useClearRealData();
  const toast = useToast();
  return (
    <Panel title="Reset data" icon={<Trash2 />} subtitle="Start-over buttons. Demo data survives so the walkthrough still works.">
      <ul className="space-y-2">
        <DangerRow
          title="Clear tasks and hours"
          description="Deletes every task and time entry, then restores the demo set."
          confirmText="Clear tasks and hours"
          pending={clear.isPending}
          destructive
          onConfirm={() => clear.mutate(undefined, {
            onSuccess: () => { toast('Tasks and hours cleared. Demo data restored.'); },
            onError: () => toast('Could not clear the data. Try again.', 'error'),
          })}
        />
        <DangerRow
          title="Reset everything"
          description="Deletes companies, projects, tasks and hours, then reseeds from scratch."
          confirmText="Reset everything"
          pending={reset.isPending}
          destructive
          onConfirm={() => reset.mutate(undefined, {
            onSuccess: () => { toast('Everything was reset.'); },
            onError: () => toast('Could not reset. Try again.', 'error'),
          })}
        />
      </ul>
      <p className="mt-3 rounded-md bg-raised p-3 text-xs text-muted">
        Companies and projects cannot be deleted while tasks or hours point at them — clear tasks and hours first.
      </p>
    </Panel>
  );
}

export function SetupPage() {
  const [params] = useSearchParams();
  const readToast = useReturnToast();
  const sectionParam = params.get('section');
  const section: Section = sectionParam === 'data' || sectionParam === 'dangers' ? sectionParam : 'connectors';
  useEffect(() => { readToast(); }, [readToast]);
  const tabs: PageTab[] = [
    { key: 'connectors', label: 'Connectors', to: '/setup?section=connectors', icon: Plug },
    { key: 'data', label: 'Enter data', to: '/setup?section=data', icon: Database },
    { key: 'dangers', label: 'Reset', to: '/setup?section=dangers', icon: Trash2 },
  ];
  return (
    <div className="mx-auto max-w-[960px] space-y-6">
      <PageHeader
        title="Setup"
        description="Behind-the-scenes controls: connect accounts, enter raw data, or start over."
        tabs={tabs}
        activeTab={section}
      />
      <div key={section} className="animate-fade-in space-y-4">
        {section === 'connectors' && <ConnectorsSection />}
        {section === 'data' && <DataSection />}
        {section === 'dangers' && <DangersSection />}
      </div>
    </div>
  );
}
