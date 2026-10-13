import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { History, ListChecks, Plus, Siren } from 'lucide-react';
import type { ChangeRecord, Incident } from '@/lib/types';
import { useRecords } from '@/data/records';
import { PageHeader, type PageTab } from '@/components/ui/page-header';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { RecordDialog, type FieldSpec } from '@/components/records/RecordDialog';
import { Pill, RecordTable } from '@/components/records/RecordTable';
import { SecurityChecklist } from '@/components/security/SecurityChecklist';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

const SEVERITY_TONE = { low: 'neutral', medium: 'primary', high: 'warning', critical: 'error' } as const;

const INCIDENT_FIELDS: FieldSpec[] = [
  { key: 'title', label: 'What happened', type: 'text', required: true, max: 200, wide: true, placeholder: 'e.g. Phishing email reached Melissa' },
  {
    key: 'severity', label: 'Severity', type: 'select', required: true,
    options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'critical', label: 'Critical' }],
  },
  { key: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' }] },
  { key: 'occurred_at', label: 'When', type: 'datetime', required: true },
  { key: 'summary', label: 'Details', type: 'textarea', max: 8000, placeholder: 'Who was affected, what systems, how it was noticed' },
  { key: 'resolution', label: 'How it was fixed', type: 'textarea', max: 8000 },
];

const CHANGE_FIELDS: FieldSpec[] = [
  { key: 'title', label: 'Change', type: 'text', required: true, max: 200, wide: true, placeholder: 'e.g. Moved DNS for encountive.com to Cloudflare' },
  { key: 'system', label: 'System', type: 'text', max: 120, placeholder: 'e.g. DNS, Google Workspace' },
  { key: 'changed_at', label: 'When', type: 'datetime', required: true },
  {
    key: 'outcome', label: 'Outcome', type: 'select', required: true,
    options: [{ value: 'planned', label: 'Planned' }, { value: 'done', label: 'Done' }, { value: 'rolled_back', label: 'Rolled back' }],
  },
  { key: 'description', label: 'What changed', type: 'textarea', max: 8000 },
  { key: 'rollback_steps', label: 'How to undo it', type: 'textarea', required: true, max: 8000, hint: 'Required. Write the steps someone else could follow to put things back.' },
];

function IncidentLog() {
  const incidents = useRecords<Incident>('cc_incidents');
  const [editing, setEditing] = useState<Incident | 'new' | null>(null);
  const rows = incidents.data ?? [];
  const open = rows.filter((r) => r.status === 'open').length;
  return (
    <Panel
      title="Incident log"
      icon={<Siren />}
      subtitle={open ? `${open} open` : 'No open incidents'}
      subtitleInline
      actions={<Button size="sm" variant="primary" onClick={() => setEditing('new')}><Plus /> Log incident</Button>}
      loading={incidents.isLoading}
      error={incidents.error}
      empty={rows.length === 0}
      bodyClassName="p-0"
      emptyState={<div className="p-3"><EmptyState icon={<Siren />} title="No incidents logged" text="Record anything that went wrong: a phishing email, an outage, a lost device. A written history helps with customer security questions." /></div>}
    >
      <RecordTable
        table="cc_incidents"
        rows={rows}
        nameOf={(i) => i.title}
        onEdit={setEditing}
        columns={[
          { label: 'When', render: (i) => <span className="whitespace-nowrap text-muted">{when(i.occurred_at)}</span> },
          { label: 'Incident', render: (i) => <div><p className="font-medium">{i.title}</p>{i.summary && <p className="line-clamp-2 text-xs text-subtle">{i.summary}</p>}</div> },
          { label: 'Severity', render: (i) => <Pill tone={SEVERITY_TONE[i.severity]}>{i.severity[0].toUpperCase() + i.severity.slice(1)}</Pill> },
          { label: 'Status', render: (i) => <Pill tone={i.status === 'open' ? 'warning' : 'success'}>{i.status === 'open' ? 'Open' : 'Resolved'}</Pill> },
        ]}
      />
      <RecordDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === 'new' ? 'Log incident' : 'Edit incident'}
        table="cc_incidents"
        fields={INCIDENT_FIELDS}
        record={editing && editing !== 'new' ? editing : null}
        defaults={{ severity: 'medium', status: 'open', occurred_at: new Date().toISOString() }}
        transform={(v, prev) => ({ ...v, resolved_at: v.status === 'resolved' ? (prev?.resolved_at as string | null) ?? new Date().toISOString() : null })}
      />
    </Panel>
  );
}

function ChangeLog() {
  const changes = useRecords<ChangeRecord>('cc_changes');
  const [editing, setEditing] = useState<ChangeRecord | 'new' | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const rows = changes.data ?? [];
  return (
    <Panel
      title="Change log"
      icon={<History />}
      subtitle="Every change records how to undo it"
      subtitleInline
      actions={<Button size="sm" variant="primary" onClick={() => setEditing('new')}><Plus /> Log change</Button>}
      loading={changes.isLoading}
      error={changes.error}
      empty={rows.length === 0}
      bodyClassName="p-0"
      emptyState={<div className="p-3"><EmptyState icon={<History />} title="No changes logged" text="Note each change to DNS, email, accounts or hosting with the steps to roll it back." /></div>}
    >
      <RecordTable
        table="cc_changes"
        rows={rows}
        nameOf={(c) => c.title}
        onEdit={setEditing}
        columns={[
          { label: 'When', render: (c) => <span className="whitespace-nowrap text-muted">{when(c.changed_at)}</span> },
          {
            label: 'Change',
            render: (c) => (
              <div>
                <p className="font-medium">{c.title}{c.system && <span className="ml-2 text-xs font-normal text-subtle">{c.system}</span>}</p>
                <button type="button" className="text-xs text-primary-700 hover:underline dark:text-primary-300" onClick={() => setExpanded((x) => (x === c.id ? null : c.id))}>
                  {expanded === c.id ? 'Hide undo steps' : 'Show undo steps'}
                </button>
                {expanded === c.id && <p className="mt-1 whitespace-pre-wrap rounded-md bg-raised p-2 text-xs animate-fade-in">{c.rollback_steps}</p>}
              </div>
            ),
          },
          { label: 'Outcome', render: (c) => <Pill tone={c.outcome === 'done' ? 'success' : c.outcome === 'planned' ? 'primary' : 'warning'}>{c.outcome === 'done' ? 'Done' : c.outcome === 'planned' ? 'Planned' : 'Rolled back'}</Pill> },
        ]}
      />
      <RecordDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === 'new' ? 'Log change' : 'Edit change'}
        table="cc_changes"
        fields={CHANGE_FIELDS}
        record={editing && editing !== 'new' ? editing : null}
        defaults={{ outcome: 'done', changed_at: new Date().toISOString() }}
      />
    </Panel>
  );
}

const SECTIONS: (PageTab & { description: string })[] = [
  { key: 'checklist', label: 'Checklist', to: '/security/checklist', icon: ListChecks, description: 'Security basics, customer readiness and agent governance.' },
  { key: 'incidents', label: 'Incidents', to: '/security/incidents', icon: Siren, description: 'What went wrong and how it was handled.' },
  { key: 'changes', label: 'Change log', to: '/security/changes', icon: History, description: 'What was changed, when, and how to undo it.' },
];

export function SecurityPage() {
  const { section } = useParams();
  const incidents = useRecords<Incident>('cc_incidents');
  const open = (incidents.data ?? []).filter((i) => i.status === 'open').length;
  const current = SECTIONS.find((s) => s.key === section);
  if (!current) return <Navigate to="/security/checklist" replace />;
  const tabs = SECTIONS.map((s) => (s.key === 'incidents' && open ? { ...s, count: open, tone: 'alert' as const } : s));
  return (
    <div className="mx-auto max-w-[1600px] space-y-3">
      <PageHeader title="Security" description={current.description} tabs={tabs} activeTab={current.key} />
      <div className="animate-fade-in" key={current.key}>
        {current.key === 'checklist' && <SecurityChecklist />}
        {current.key === 'incidents' && <IncidentLog />}
        {current.key === 'changes' && <ChangeLog />}
      </div>
    </div>
  );
}
