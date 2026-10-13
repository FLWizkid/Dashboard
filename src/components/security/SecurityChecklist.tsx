import { useState } from 'react';
import { ListChecks, Pencil, Plus, Sparkles } from 'lucide-react';
import type { SecurityArea, SecurityItem } from '@/lib/types';
import { cn, errorMessage, toDateKey } from '@/lib/utils';
import { prettyDate } from '@/lib/spend';
import { useInsertMany, useRecords, useSaveRecord } from '@/data/records';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { RecordDialog, type FieldSpec } from '@/components/records/RecordDialog';

export const AREAS: { value: SecurityArea; label: string }[] = [
  { value: 'accounts', label: 'Accounts & sign-in' },
  { value: 'devices', label: 'Devices' },
  { value: 'data', label: 'Data & backups' },
  { value: 'email', label: 'Email & domains' },
  { value: 'customer_readiness', label: 'Customer readiness' },
  { value: 'agent_governance', label: 'Agent governance' },
  { value: 'other', label: 'Other' },
];

const STARTER: [SecurityArea, string][] = [
  ['accounts', 'Two-step sign-in (MFA) on every admin account'],
  ['accounts', 'Password manager used for all shared credentials'],
  ['accounts', 'Break-glass admin account documented and stored safely'],
  ['devices', 'Disk encryption turned on for every laptop'],
  ['devices', 'Automatic updates turned on'],
  ['data', 'Backups run and a restore has been tested this quarter'],
  ['data', 'Customer data stored only in approved systems'],
  ['email', 'SPF, DKIM and DMARC set for every sending domain'],
  ['email', 'Domain registrar locked with auto-renew on'],
  ['customer_readiness', 'Security overview document ready to send to customers'],
  ['customer_readiness', 'Privacy policy and terms published and current'],
  ['customer_readiness', 'Vendor list (sub-processors) up to date'],
  ['agent_governance', 'Every Claude agent listed with its owner and purpose'],
  ['agent_governance', 'Agents use their own keys with least access needed'],
  ['agent_governance', 'Agent outputs reviewed before anything is sent to customers'],
];

const FIELDS: FieldSpec[] = [
  { key: 'title', label: 'Item', type: 'text', required: true, max: 200, wide: true },
  { key: 'area', label: 'Area', type: 'select', required: true, options: AREAS },
  {
    key: 'status', label: 'Status', type: 'select', required: true,
    options: [{ value: 'todo', label: 'To do' }, { value: 'done', label: 'Done' }, { value: 'not_applicable', label: 'Not applicable' }],
  },
  { key: 'company_id', label: 'Company', type: 'company' },
  { key: 'last_checked_on', label: 'Last checked', type: 'date' },
  { key: 'notes', label: 'Notes', type: 'textarea', max: 4000 },
];

export function SecurityChecklist() {
  const items = useRecords<SecurityItem>('cc_security_items');
  const save = useSaveRecord('cc_security_items');
  const seed = useInsertMany('cc_security_items');
  const toast = useToast();
  const [editing, setEditing] = useState<SecurityItem | 'new' | null>(null);
  const rows = items.data ?? [];
  const counted = rows.filter((r) => r.status !== 'not_applicable');
  const done = counted.filter((r) => r.status === 'done').length;

  const addStarter = () =>
    seed.mutate(STARTER.map(([area, title]) => ({ area, title })), {
      onSuccess: () => toast('Starter checklist added'),
      onError: (e) => toast(errorMessage(e), 'error'),
    });

  const setStatus = (item: SecurityItem, status: SecurityItem['status']) =>
    save.mutate({ id: item.id, status, last_checked_on: toDateKey(new Date()) }, { onError: (e) => toast(errorMessage(e), 'error') });

  return (
    <Panel
      title="Security checklist"
      icon={<ListChecks />}
      subtitle={counted.length ? `${done} of ${counted.length} done` : undefined}
      subtitleInline
      actions={<Button size="sm" variant="primary" onClick={() => setEditing('new')}><Plus /> Add item</Button>}
      loading={items.isLoading}
      error={items.error}
      empty={rows.length === 0}
      emptyState={
        <EmptyState
          icon={<ListChecks />}
          title="No checklist yet"
          text="Start with a recommended list covering sign-in, devices, backups, email, customer readiness and agent governance. You can edit or remove any item."
          action={<Button variant="primary" onClick={addStarter} disabled={seed.isPending}><Sparkles /> {seed.isPending ? 'Adding...' : 'Add starter checklist'}</Button>}
        />
      }
    >
      {counted.length > 0 && (
        <div className="mb-3 h-2 overflow-hidden rounded-full bg-raised">
          <div className="h-full rounded-full bg-success-500 transition-all duration-700" style={{ width: `${(done / counted.length) * 100}%` }} />
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {AREAS.map((area) => {
          const list = rows.filter((r) => r.area === area.value);
          if (!list.length) return null;
          return (
            <section key={area.value} className="rounded-lg border border-line p-3">
              <h3 className="mb-2 flex items-center justify-between text-sm font-semibold">
                {area.label}
                <span className="text-xs font-normal text-subtle">{list.filter((r) => r.status === 'done').length}/{list.filter((r) => r.status !== 'not_applicable').length}</span>
              </h3>
              <ul className="space-y-1">
                {list.map((it) => (
                  <li key={it.id} className="group flex items-start gap-2 rounded-md px-1 py-1 transition-colors hover:bg-raised/60">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-success-600"
                      checked={it.status === 'done'}
                      disabled={it.status === 'not_applicable' || save.isPending}
                      onChange={(e) => setStatus(it, e.target.checked ? 'done' : 'todo')}
                      aria-label={it.title}
                    />
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-sm', it.status === 'done' && 'text-muted', it.status === 'not_applicable' && 'text-subtle line-through')}>{it.title}</p>
                      {it.last_checked_on && <p className="text-xs text-subtle">Checked {prettyDate(it.last_checked_on)}</p>}
                    </div>
                    <Select
                      className="h-7 w-auto py-0 text-xs opacity-70 group-hover:opacity-100"
                      value={it.status}
                      onChange={(e) => setStatus(it, e.target.value as SecurityItem['status'])}
                      aria-label={`Status of ${it.title}`}
                    >
                      <option value="todo">To do</option>
                      <option value="done">Done</option>
                      <option value="not_applicable">N/A</option>
                    </Select>
                    <Button size="iconSm" variant="ghost" className="opacity-60 group-hover:opacity-100" onClick={() => setEditing(it)} aria-label={`Edit ${it.title}`}><Pencil /></Button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <RecordDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === 'new' ? 'Add checklist item' : 'Edit checklist item'}
        table="cc_security_items"
        fields={FIELDS}
        record={editing && editing !== 'new' ? editing : null}
        defaults={{ area: 'accounts', status: 'todo' }}
      />
    </Panel>
  );
}
