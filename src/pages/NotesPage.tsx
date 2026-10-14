import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, CheckSquare, Download, Eye, FilePlus2, NotebookPen, Pencil, Pin, PinOff, Search, Trash2 } from 'lucide-react';
import { RUNBOOK_TEMPLATES, useDeleteNote, useNotes, useSaveNote, type NoteInput } from '@/data/notes';
import { useCompanies } from '@/data/organization';
import { useCreateTask } from '@/data/tasks';
import type { Note } from '@/lib/types';
import { cn, errorMessage, relativeTime } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { Markdown } from '@/components/reports/Markdown';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'note'}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

const BLANK: NoteInput = { title: '', body: '', kind: 'note', company_id: null, pinned: false };

function NoteEditor({ note, template }: { note: Note | null; template: NoteInput | null }) {
  const save = useSaveNote();
  const remove = useDeleteNote();
  const createTask = useCreateTask();
  const companies = useCompanies();
  const toast = useToast();
  const navigate = useNavigate();
  const area = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState<NoteInput>(note ? { id: note.id, title: note.title, body: note.body, kind: note.kind, company_id: note.company_id, pinned: note.pinned } : (template ?? BLANK));
  const [preview, setPreview] = useState(!!note);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (patch: Partial<NoteInput>) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = !note || draft.title !== note.title || draft.body !== note.body || draft.kind !== note.kind || draft.company_id !== note.company_id || draft.pinned !== note.pinned;

  const submit = () => {
    if (!draft.title.trim()) return toast('Give the note a title first.', 'error');
    save.mutate({ ...draft, title: draft.title.trim() }, {
      onSuccess: (id) => { toast('Saved'); setPreview(true); if (!note) navigate(`/notes/${id}`, { replace: true }); },
      onError: (e) => toast(errorMessage(e), 'error'),
    });
  };

  const taskFromSelection = () => {
    const el = area.current;
    const picked = el ? draft.body.slice(el.selectionStart, el.selectionEnd).trim() : '';
    if (!picked) return toast('Highlight some text in the note first, then press Make task.', 'error');
    const firstLine = picked.split('\n')[0].replace(/^[-*#>\s]+|\[[ xX]\]\s*/g, '').trim();
    createTask.mutate(
      { title: (firstLine || picked).slice(0, 200), notes: `From note: ${draft.title || 'Untitled'}\n\n${picked}`.slice(0, 5000), company_id: draft.company_id },
      { onSuccess: () => toast('Task created from your selection'), onError: (e) => toast(errorMessage(e), 'error') },
    );
  };

  const del = () => {
    if (!note) return navigate('/notes');
    if (!confirmDelete) return setConfirmDelete(true);
    remove.mutate(note.id, { onSuccess: () => { toast('Note deleted'); navigate('/notes'); }, onError: (e) => toast(errorMessage(e), 'error') });
  };

  return (
    <Panel
      title={note ? 'Edit note' : 'New note'}
      icon={<NotebookPen />}
      subtitle={note ? `Updated ${relativeTime(note.updated_at)}` : undefined}
      subtitleInline
      actions={
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setPreview((p) => !p)}>{preview ? <Pencil /> : <Eye />} {preview ? 'Edit' : 'Preview'}</Button>
          <Button size="sm" variant="ghost" onClick={() => download(draft.title, `# ${draft.title}\n\n${draft.body}`)} aria-label="Download as Markdown"><Download /></Button>
          <Button size="sm" variant={confirmDelete ? 'danger' : 'ghost'} onClick={del} onBlur={() => setConfirmDelete(false)} disabled={remove.isPending} aria-label="Delete note">
            <Trash2 /> {confirmDelete && 'Confirm'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_140px_200px]">
          <Field label="Title"><Input value={draft.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. How the weekly backup works" /></Field>
          <Field label="Type">
            <Select value={draft.kind} onChange={(e) => set({ kind: e.target.value as Note['kind'] })}>
              <option value="note">Note</option>
              <option value="runbook">Runbook</option>
            </Select>
          </Field>
          <Field label="Company">
            <Select value={draft.company_id ?? ''} onChange={(e) => set({ company_id: e.target.value || null })}>
              <option value="">None</option>
              {(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        </div>
        {preview ? (
          <div className="min-h-[300px] rounded-md border border-line p-4">
            {draft.body.trim() ? <Markdown text={draft.body} /> : <p className="text-sm text-muted">Nothing written yet.</p>}
          </div>
        ) : (
          <>
            <textarea
              ref={area}
              className="input min-h-[360px] font-mono text-[13px] leading-relaxed"
              value={draft.body}
              maxLength={100000}
              onChange={(e) => set({ body: e.target.value })}
              placeholder={'Write in plain text. Use # for headings, - for bullets, and - [ ] for checklists.'}
              aria-label="Note text"
            />
            <p className="text-xs text-subtle">Tip: highlight a line and press Make task to turn it into a task.</p>
          </>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={draft.pinned} onChange={(e) => set({ pinned: e.target.checked })} className="size-4 accent-primary-600" /> Pin to top
          </label>
          <div className="flex gap-2">
            {!preview && <Button onClick={taskFromSelection} disabled={createTask.isPending}><CheckSquare /> Make task</Button>}
            <Button variant="primary" onClick={submit} disabled={!dirty || save.isPending}>{save.isPending ? 'Saving...' : 'Save'}</Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

export function NotesPage() {
  const { id } = useParams();
  const notes = useNotes();
  const companies = useCompanies();
  const save = useSaveNote();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | Note['kind']>('all');
  const [template, setTemplate] = useState<NoteInput | null>(null);
  const navigate = useNavigate();

  const all = notes.data ?? [];
  const companyName = useMemo(() => new Map((companies.data ?? []).map((c) => [c.id, c.name])), [companies.data]);
  const q = search.trim().toLowerCase();
  const list = all.filter((n) => (kind === 'all' || n.kind === kind) && (!q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)));
  const isNew = id === 'new';
  const current = !isNew && id ? all.find((n) => n.id === id) ?? null : null;

  const startNew = (t: NoteInput | null) => { setTemplate(t); navigate('/notes/new'); };
  const togglePin = (n: Note) =>
    save.mutate({ id: n.id, title: n.title, body: n.body, kind: n.kind, company_id: n.company_id, pinned: !n.pinned }, { onError: (e) => toast(errorMessage(e), 'error') });
  const exportAll = () => download('notes-and-runbooks', all.map((n) => `# ${n.title}\n\n_${n.kind === 'runbook' ? 'Runbook' : 'Note'}${n.company_id ? `, ${companyName.get(n.company_id) ?? ''}` : ''}_\n\n${n.body}`).join('\n\n---\n\n'));

  const chip = (active: boolean) => cn('rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors', active ? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300' : 'border-line text-muted hover:text-fg');

  return (
    <div className="mx-auto max-w-[1600px] space-y-3">
      <PageHeader
        title="Runbooks & Notes"
        description="Step-by-step runbooks and everyday notes in one place. Turn any line into a task."
        actions={
          <>
            {all.length > 0 && <Button onClick={exportAll}><Download /> Export all</Button>}
            <Button variant="primary" onClick={() => startNew(null)}><FilePlus2 /> New note</Button>
          </>
        }
      />
      <div className="grid gap-3 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <div className={cn('space-y-2', id && 'hidden lg:block')}>
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <input className="input pl-8" placeholder="Search notes" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search notes" />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {(['all', 'runbook', 'note'] as const).map((k) => (
              <button key={k} className={chip(kind === k)} onClick={() => setKind(k)}>{k === 'all' ? 'All' : k === 'runbook' ? 'Runbooks' : 'Notes'}</button>
            ))}
          </div>
          <Panel
            title="Notes"
            icon={<BookOpen />}
            subtitle={`${list.length} shown`}
            subtitleInline
            loading={notes.isLoading}
            error={notes.error}
            empty={list.length === 0}
            bodyClassName="p-0"
            emptyState={
              <div className="p-3">
                <EmptyState icon={<BookOpen />} title={all.length ? 'Nothing matches' : 'No notes yet'} text={all.length ? 'Try a different search.' : 'Start a blank note or pick a runbook template.'} />
              </div>
            }
          >
            <ul className="max-h-[60vh] overflow-y-auto">
              {list.map((n) => (
                <li key={n.id} className={cn('group flex items-start gap-1 border-b border-line last:border-0 hover:bg-raised/60', n.id === id && 'bg-primary-500/10 hover:bg-primary-500/10')}>
                  <Link to={`/notes/${n.id}`} className="min-w-0 flex-1 px-3 py-2.5">
                    <p className="truncate text-sm font-medium">{n.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {n.kind === 'runbook' ? 'Runbook' : 'Note'}{n.company_id && companyName.get(n.company_id) ? ` · ${companyName.get(n.company_id)}` : ''} · {relativeTime(n.updated_at)}
                    </p>
                  </Link>
                  <button
                    onClick={() => togglePin(n)}
                    className={cn('m-2 rounded p-1 text-subtle transition hover:bg-raised hover:text-fg', n.pinned ? 'text-primary-600' : 'opacity-0 focus:opacity-100 group-hover:opacity-100')}
                    aria-label={n.pinned ? `Unpin ${n.title}` : `Pin ${n.title}`}
                  >
                    {n.pinned ? <Pin className="size-3.5" /> : <PinOff className="size-3.5" />}
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
          <div className="rounded-lg border border-line p-3">
            <p className="label mb-2">Start from a runbook template</p>
            <div className="flex flex-wrap gap-1.5">
              {RUNBOOK_TEMPLATES.map((t) => (
                <button key={t.name} className={chip(false)} onClick={() => startNew({ title: t.title, body: t.body, kind: 'runbook', company_id: null, pinned: false })}>{t.name}</button>
              ))}
            </div>
          </div>
        </div>
        <div className={cn(!id && 'hidden lg:block')}>
          {id ? (
            <div className="space-y-2">
              <Button asChild size="sm" variant="ghost" className="lg:hidden"><Link to="/notes"><ArrowLeft /> All notes</Link></Button>
              {isNew ? (
                <NoteEditor key={`new-${template?.title ?? ''}`} note={null} template={template} />
              ) : notes.isLoading ? (
                <Panel title="Note" icon={<NotebookPen />} loading>{null}</Panel>
              ) : current ? (
                <NoteEditor key={current.id} note={current} template={null} />
              ) : (
                <EmptyState icon={<BookOpen />} title="Note not found" text="It may have been deleted." action={<Button asChild size="sm"><Link to="/notes">Back to notes</Link></Button>} />
              )}
            </div>
          ) : (
            <div className="flex h-full min-h-[300px] items-center justify-center rounded-lg border border-dashed border-line p-6 text-center text-sm text-muted">
              Pick a note on the left, or start a new one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
