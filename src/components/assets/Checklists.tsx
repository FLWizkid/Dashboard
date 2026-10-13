import { useState, type FormEvent } from 'react';
import { CheckCircle2, ClipboardList, Plus, Trash2 } from 'lucide-react';
import type { Checklist, ChecklistItem, Company } from '@/lib/types';
import { cn, errorMessage } from '@/lib/utils';
import { prettyDate } from '@/lib/spend';
import { useDeleteRecord, useRecords, useSaveRecord } from '@/data/records';
import { useCompanies } from '@/data/organization';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { CompanyPicker } from '@/components/companies/CompanyPicker';
import { Pill } from '@/components/records/RecordTable';

const TEMPLATES: Record<Checklist['kind'], string[]> = {
  onboarding: [
    'Create company email account',
    'Turn on two-step sign-in (MFA)',
    'Add to password manager and shared vaults',
    'Grant access to required tools (record each in Access)',
    'Issue laptop or device (record in Hardware)',
    'Share runbooks and who-to-call list',
    'Confirm backups cover their files',
  ],
  offboarding: [
    'Disable email sign-in and reset password',
    'Revoke access to every tool in the Access list',
    'Transfer file and document ownership',
    'Remove from password manager and shared vaults',
    'Collect laptop, phone and security keys',
    'Rotate any shared passwords or API keys they knew',
    'Set email forwarding or auto-reply',
    'Cancel or reassign paid seats',
  ],
};

function NewChecklistDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const save = useSaveRecord('cc_checklists');
  const toast = useToast();
  const [kind, setKind] = useState<Checklist['kind']>('onboarding');
  const [person, setPerson] = useState('');
  const [companyId, setCompanyId] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!person.trim()) return;
    const items: ChecklistItem[] = TEMPLATES[kind].map((label) => ({ label, done: false }));
    save.mutate({ kind, person: person.trim(), company_id: companyId || null, items }, {
      onSuccess: () => { setPerson(''); onOpenChange(false); toast('Checklist started'); },
      onError: (err) => toast(errorMessage(err), 'error'),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Start a checklist" description="Uses a standard list of steps you can tick off as you go.">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value as Checklist['kind'])}>
            <option value="onboarding">Onboarding (someone joining)</option>
            <option value="offboarding">Offboarding (someone leaving)</option>
          </Select>
        </Field>
        <Field label="Person">
          <Input autoFocus value={person} maxLength={120} onChange={(e) => setPerson(e.target.value)} placeholder="Full name" />
        </Field>
        <Field label="Company">
          <CompanyPicker value={companyId} onChange={(id) => setCompanyId(id)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!person.trim() || save.isPending}>{save.isPending ? 'Starting...' : 'Start checklist'}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function ChecklistCard({ list, company }: { list: Checklist; company: Company | undefined }) {
  const save = useSaveRecord('cc_checklists');
  const remove = useDeleteRecord('cc_checklists');
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const items = Array.isArray(list.items) ? list.items : [];
  const done = items.filter((i) => i.done).length;

  const toggle = (idx: number) => {
    const next = items.map((it, i) => (i === idx ? { ...it, done: !it.done } : it));
    const complete = next.length > 0 && next.every((i) => i.done);
    save.mutate({ id: list.id, items: next, completed_at: complete ? list.completed_at ?? new Date().toISOString() : null }, {
      onError: (err) => toast(errorMessage(err), 'error'),
    });
  };

  const del = () => {
    if (!confirm) return setConfirm(true);
    remove.mutate(list.id, { onSuccess: () => toast('Checklist removed'), onError: (e) => toast(errorMessage(e), 'error') });
  };

  return (
    <div className="rounded-lg border border-line bg-surface p-3 transition-shadow hover:shadow-sm">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{list.person}</p>
          <p className="text-xs text-subtle">
            {list.kind === 'onboarding' ? 'Onboarding' : 'Offboarding'}{company ? ` · ${company.name}` : ''} · started {prettyDate(list.started_on)}
          </p>
        </div>
        {list.completed_at ? <Pill tone="success"><CheckCircle2 className="mr-1 size-3" /> Complete</Pill> : <Pill tone="primary">{done}/{items.length}</Pill>}
        <Button size={confirm ? 'sm' : 'iconSm'} variant={confirm ? 'danger' : 'ghost'} onClick={del} onBlur={() => setConfirm(false)} aria-label={`Remove checklist for ${list.person}`}>
          <Trash2 /> {confirm && 'Confirm'}
        </Button>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
        <div className="h-full rounded-full bg-success-500 transition-all duration-500" style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
      </div>
      <ul className="mt-3 space-y-1">
        {items.map((it, i) => (
          <li key={i}>
            <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-sm transition-colors hover:bg-raised/60">
              <input type="checkbox" className="mt-0.5 size-4 accent-success-600" checked={it.done} onChange={() => toggle(i)} disabled={save.isPending} />
              <span className={cn(it.done && 'text-subtle line-through')}>{it.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Checklists() {
  const lists = useRecords<Checklist>('cc_checklists');
  const companies = useCompanies();
  const [open, setOpen] = useState(false);
  const rows = lists.data ?? [];
  const companyById = new Map((companies.data ?? []).map((c) => [c.id, c]));
  const active = rows.filter((r) => !r.completed_at);
  const finished = rows.filter((r) => r.completed_at);

  return (
    <Panel
      title="Onboarding and offboarding"
      icon={<ClipboardList />}
      subtitle={`${active.length} in progress · ${finished.length} complete`}
      subtitleInline
      actions={<Button size="sm" variant="primary" onClick={() => setOpen(true)}><Plus /> Start checklist</Button>}
      loading={lists.isLoading}
      error={lists.error}
      empty={rows.length === 0}
      emptyState={<EmptyState icon={<ClipboardList />} title="No checklists yet" text="Start one when someone joins or leaves so nothing is missed." action={<Button variant="primary" onClick={() => setOpen(true)}><Plus /> Start checklist</Button>} />}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {[...active, ...finished].map((l) => <ChecklistCard key={l.id} list={l} company={l.company_id ? companyById.get(l.company_id) : undefined} />)}
      </div>
      <NewChecklistDialog open={open} onOpenChange={setOpen} />
    </Panel>
  );
}
