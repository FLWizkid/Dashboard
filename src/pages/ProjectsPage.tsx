import { useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { FolderKanban, Milestone, Pencil, Plus, Trash2 } from 'lucide-react';
import { IDENTITIES, PROJECT_STATUSES, type Identity, type Project, type ProjectStatus } from '@/lib/types';
import { cn, errorMessage, fromDateKey } from '@/lib/utils';
import { useCompanies, useDeleteProject, useProjects, useSaveProject, type ProjectInput } from '@/data/organization';
import { useTasks } from '@/data/tasks';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Badge, IdentityBadge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { CompanyPicker } from '@/components/companies/CompanyPicker';

const STATUS_TONE: Record<ProjectStatus, string> = {
  planned: 'text-muted',
  active: 'border-success-500/40 bg-success-500/10 text-success-700 dark:text-success-400',
  on_hold: 'border-warning-500/40 bg-warning-500/10 text-warning-800 dark:text-warning-400',
  done: 'text-subtle',
};

const EMPTY: ProjectInput = { name: '', description: null, status: 'active', owner: 'Doug', next_milestone: null, milestone_date: null, company_id: null, identity: null };

export function ProjectsPage() {
  const projects = useProjects();
  const { data: companies = [] } = useCompanies();
  const { data: tasks = [] } = useTasks();
  const [editing, setEditing] = useState<ProjectInput | null>(null);

  const rows = projects.data ?? [];
  return (
    <div className="mx-auto max-w-[1600px] space-y-3">
      <PageHeader
        title="Projects"
        description="Projects group related tasks and time so you can see progress per company."
        actions={<Button variant="primary" onClick={() => setEditing(EMPTY)}><Plus /> New project</Button>}
      />
      <Panel
        title="All projects"
        icon={<FolderKanban />}
        demo={rows.some((p) => p.is_demo)}
        updatedAt={projects.dataUpdatedAt}
        onRefresh={() => projects.refetch()}
        refreshing={projects.isFetching}
        loading={projects.isLoading}
        error={projects.error}
        empty={rows.length === 0}
        emptyState={<EmptyState title="No projects yet" text="Projects group tasks and time." action={<Button variant="primary" size="sm" onClick={() => setEditing(EMPTY)}><Plus /> New project</Button>} />}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => {
            const open = tasks.filter((t) => t.project_id === p.id && t.status !== 'done').length;
            const company = companies.find((c) => c.id === p.company_id);
            return (
              <article key={p.id} className="group flex flex-col rounded-lg border border-line p-4 transition-colors hover:border-subtle">
                <div className="flex items-start gap-2">
                  <h3 className="flex-1 font-semibold">{p.name}</h3>
                  <Button size="iconSm" variant="ghost" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}><Pencil /></Button>
                </div>
                {p.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{p.description}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Badge className={STATUS_TONE[p.status]}>{PROJECT_STATUSES.find((s) => s.value === p.status)?.label}</Badge>
                  {company && <Badge>{company.name}</Badge>}
                  <IdentityBadge identity={p.identity} compact />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div><dt className="text-xs text-subtle">Owner</dt><dd>{p.owner}</dd></div>
                  <div><dt className="text-xs text-subtle">Open tasks</dt><dd className="font-mono">{open}</dd></div>
                  <div className="col-span-2">
                    <dt className="flex items-center gap-1 text-xs text-subtle"><Milestone className="size-3" /> Next milestone</dt>
                    <dd className={cn(!p.next_milestone && 'text-subtle')}>
                      {p.next_milestone ?? 'Not set'}
                      {p.milestone_date && <span className="text-muted"> · {format(fromDateKey(p.milestone_date), 'MMM d')}</span>}
                    </dd>
                  </div>
                </dl>
                <Link to={`/tasks?project=${p.id}`} className="mt-3 text-sm text-primary-600 hover:underline dark:text-primary-400">View tasks</Link>
              </article>
            );
          })}
        </div>
      </Panel>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing?.id ? 'Edit project' : 'New project'}>
        {editing && <ProjectForm key={editing.id ?? 'new'} initial={editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}

function ProjectForm({ initial, onDone }: { initial: ProjectInput | Project; onDone: () => void }) {
  const [f, setF] = useState<ProjectInput>({
    id: initial.id, name: initial.name, description: initial.description, status: initial.status, owner: initial.owner,
    next_milestone: initial.next_milestone, milestone_date: initial.milestone_date, company_id: initial.company_id, identity: initial.identity,
  });
  const [confirm, setConfirm] = useState(false);
  const save = useSaveProject();
  const del = useDeleteProject();
  const toast = useToast();
  const set = (p: Partial<ProjectInput>) => setF((x) => ({ ...x, ...p }));

  async function submit() {
    if (!f.name.trim()) return toast('A project needs a name.', 'error');
    try {
      await save.mutateAsync({ ...f, name: f.name.trim(), owner: f.owner.trim() || 'Doug' });
      toast('Project saved');
      onDone();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <div className="space-y-3">
      <Field label="Name"><input className="input" autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
      <Field label="Description"><textarea className="input min-h-[72px] py-2" value={f.description ?? ''} onChange={(e) => set({ description: e.target.value || null })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status">
          <Select value={f.status} onChange={(e) => set({ status: e.target.value as ProjectStatus })}>
            {PROJECT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </Field>
        <Field label="Owner"><input className="input" value={f.owner} onChange={(e) => set({ owner: e.target.value })} /></Field>
        <Field label="Company">
          <CompanyPicker value={f.company_id ?? ''} noneLabel="None" onChange={(id, c) => set({ company_id: id || null, identity: f.identity ?? c?.identity ?? null })} />
        </Field>
        <Field label="Identity">
          <Select value={f.identity ?? ''} onChange={(e) => set({ identity: (e.target.value || null) as Identity | null })}>
            <option value="">Unset</option>
            {IDENTITIES.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
          </Select>
        </Field>
        <Field label="Next milestone"><input className="input" value={f.next_milestone ?? ''} onChange={(e) => set({ next_milestone: e.target.value || null })} /></Field>
        <Field label="Milestone date"><input type="date" className="input" value={f.milestone_date ?? ''} onChange={(e) => set({ milestone_date: e.target.value || null })} /></Field>
      </div>
      <div className="flex items-center gap-2 border-t border-line pt-3">
        {f.id && (confirm ? (
          <>
            <span className="text-sm text-muted">Delete? Tasks stay, unlinked.</span>
            <Button size="sm" variant="danger" onClick={async () => { try { await del.mutateAsync(f.id!); toast('Project deleted'); onDone(); } catch (e) { toast(errorMessage(e), 'error'); } }}>Delete</Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}><Trash2 /> Delete</Button>
        ))}
        <div className="flex-1" />
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={save.isPending}>Save</Button>
      </div>
    </div>
  );
}
