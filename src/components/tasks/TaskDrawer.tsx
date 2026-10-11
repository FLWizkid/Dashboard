import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { IDENTITIES, PRIORITIES, RECURRENCES, TASK_STATUSES, type Identity, type Priority, type Recurrence, type Task, type TaskStatus } from '@/lib/types';
import { errorMessage } from '@/lib/utils';
import { useTasks, useUpdateTask, useDeleteTask } from '@/data/tasks';
import { useCompanies, useUsageRank } from '@/data/organization';
import { ProjectPicker } from '@/components/projects/ProjectPicker';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/field';
import { DemoBadge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { useUi } from '@/components/shell/ui-context';

export function TaskDrawer() {
  const { state, close } = useUi();
  const { data: tasks = [] } = useTasks();
  const task = tasks.find((t) => t.id === state.taskId);
  return (
    <Dialog open={!!state.taskId && !!task} onOpenChange={(o) => !o && close('taskId')} title="Edit task" side="right">
      {task && <TaskForm key={task.id} task={task} onDone={() => close('taskId')} />}
    </Dialog>
  );
}

function TaskForm({ task, onDone }: { task: Task; onDone: () => void }) {
  const [form, setForm] = useState(task);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data: companies = [] } = useCompanies();
  const rank = useUsageRank();
  const update = useUpdateTask();
  const del = useDeleteTask();
  const toast = useToast();
  const set = (patch: Partial<Task>) => setForm((f) => ({ ...f, ...patch }));
  const readyBlocked = form.status === 'ready' && (!form.priority || !form.due_date);

  async function save() {
    if (!form.title.trim()) return toast('A task needs a title.', 'error');
    if (readyBlocked) return toast('Ready needs a priority and a due date.', 'error');
    try {
      const { id, title, notes, status, priority, due_date, category, company_id, project_id, identity, recurrence } = form;
      await update.mutateAsync({
        id, title: title.trim(), notes, status, priority, due_date, category, company_id, project_id, identity, recurrence,
        ...(status === 'done' && task.status !== 'done' ? { completed_at: new Date().toISOString() } : {}),
      });
      toast('Task saved');
      onDone();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function remove() {
    try {
      await del.mutateAsync(task.id);
      toast('Task deleted');
      onDone();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <div className="space-y-4">
      {task.is_demo && <DemoBadge />}
      <Field label="Title">
        <input className="input" value={form.title} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status" hint={readyBlocked ? <span className="text-error-600 dark:text-error-400">Ready needs a priority and due date</span> : undefined}>
          <Select value={form.status} onChange={(e) => set({ status: e.target.value as TaskStatus })}>
            {TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={form.priority ?? ''} onChange={(e) => set({ priority: (e.target.value || null) as Priority | null })}>
            <option value="">None</option>
            {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
        </Field>
        <Field label="Due date">
          <input type="date" className="input" value={form.due_date ?? ''} onChange={(e) => set({ due_date: e.target.value || null })} />
        </Field>
        <Field label="Repeats">
          <Select value={form.recurrence} onChange={(e) => set({ recurrence: e.target.value as Recurrence })}>
            {RECURRENCES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
        </Field>
        <Field label="Company">
          <Select
            value={form.company_id ?? ''}
            onChange={(e) => {
              const c = companies.find((x) => x.id === e.target.value);
              set({ company_id: c?.id ?? null, identity: form.identity ?? c?.identity ?? null });
            }}
          >
            <option value="">None</option>
            {rank(companies, 'company', (c) => c.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Identity" hint={!form.identity ? <span className="text-warning-700 dark:text-warning-400">Choose who this belongs to</span> : undefined}>
          <Select value={form.identity ?? ''} onChange={(e) => set({ identity: (e.target.value || null) as Identity | null })}>
            <option value="">Unset</option>
            {IDENTITIES.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
          </Select>
        </Field>
        <Field label="Project">
          <ProjectPicker
            value={form.project_id ?? ''}
            companyId={form.company_id}
            noneLabel="None"
            onChange={(id, p) => set({ project_id: id || null, ...(p?.company_id && !form.company_id ? { company_id: p.company_id } : {}) })}
          />
        </Field>
        <Field label="Category">
          <input className="input" value={form.category ?? ''} onChange={(e) => set({ category: e.target.value || null })} placeholder="IT, Security…" />
        </Field>
      </div>
      <Field label="Notes">
        <textarea className="input min-h-[96px] py-2" value={form.notes ?? ''} onChange={(e) => set({ notes: e.target.value || null })} />
      </Field>
      <p className="text-xs text-subtle">
        Created {format(new Date(task.created_at), 'MMM d, yyyy')}
        {task.completed_at && ` · Completed ${format(new Date(task.completed_at), 'MMM d, yyyy')}`}
      </p>
      <div className="flex items-center gap-2 border-t border-line pt-4">
        {confirmDelete ? (
          <>
            <span className="text-sm text-muted">Delete permanently?</span>
            <Button size="sm" variant="danger" onClick={remove} disabled={del.isPending}>Delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep</Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Delete
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={update.isPending}>Save</Button>
      </div>
    </div>
  );
}
