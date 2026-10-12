import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, Database, FolderKanban, ListChecks, ListTodo, Plug, ShieldAlert, Trash2 } from 'lucide-react';
import { IDENTITIES, type Identity } from '@/lib/types';
import { errorMessage } from '@/lib/utils';
import { useCompanies, useProjects } from '@/data/organization';
import { useTasks } from '@/data/tasks';
import {
  useClearRealData, useCreateTask, useDeleteCompany, useDeleteProject, useResetAll, useSaveCompany, useSaveProject,
} from '@/data/setup';
import { parseQuickAdd } from '@/lib/quick-add';
import { PageHeader, type PageTab } from '@/components/ui/page-header';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { SetupSteps } from '@/components/setup/SetupSteps';
import { ConnectorsSection } from '@/components/setup/ConnectorsSection';

type Section = 'steps' | 'connectors' | 'data' | 'dangers';

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
      window.history.replaceState(null, '', '/setup?section=connectors');
    };
    return read;
  }, [toast]);
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
  const section: Section = sectionParam === 'connectors' || sectionParam === 'data' || sectionParam === 'dangers' ? sectionParam : 'steps';
  useEffect(() => { readToast(); }, [readToast]);
  const tabs: PageTab[] = [
    { key: 'steps', label: 'Your steps', to: '/setup', icon: ListChecks },
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
        {section === 'steps' && <SetupSteps />}
        {section === 'connectors' && <ConnectorsSection />}
        {section === 'data' && <DataSection />}
        {section === 'dangers' && <DangersSection />}
      </div>
    </div>
  );
}
