import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LifeBuoy, Plus, Printer } from 'lucide-react';
import type { PartnerRequest, RequestStatus } from '@/lib/types';
import { PRIORITIES } from '@/lib/types';
import { cn, errorMessage, relativeTime } from '@/lib/utils';
import { daysUntil, prettyDate } from '@/lib/spend';
import { useRecords, useSaveRecord } from '@/data/records';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { RecordDialog, type FieldSpec } from '@/components/records/RecordDialog';
import { Pill, RecordTable } from '@/components/records/RecordTable';

export const REQUEST_STATUSES: { value: RequestStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'done', label: 'Done' },
];

const FIELDS: FieldSpec[] = [
  { key: 'title', label: 'Request', type: 'text', required: true, max: 200, wide: true, placeholder: 'e.g. Set up email for new contractor' },
  { key: 'requested_by', label: 'Requested by', type: 'text', required: true, max: 120 },
  { key: 'priority', label: 'Priority', type: 'select', required: true, options: PRIORITIES.map((p) => ({ value: p.value, label: p.label })).reverse() },
  { key: 'status', label: 'Status', type: 'select', required: true, options: REQUEST_STATUSES },
  { key: 'due_date', label: 'Needed by', type: 'date' },
  { key: 'company_id', label: 'Company', type: 'company' },
  { key: 'details', label: 'Details', type: 'textarea', max: 8000 },
  { key: 'resolution', label: 'What was done', type: 'textarea', max: 8000, hint: 'Shown in plain words on the printable status page' },
];

const STATUS_TONE = { new: 'primary', in_progress: 'warning', waiting: 'neutral', done: 'success' } as const;

type View = 'open' | 'done' | 'all';

export function RequestsPage() {
  const requests = useRecords<PartnerRequest>('cc_requests');
  const save = useSaveRecord('cc_requests');
  const toast = useToast();
  const [view, setView] = useState<View>('open');
  const [editing, setEditing] = useState<PartnerRequest | 'new' | null>(null);

  const all = requests.data ?? [];
  const openCount = all.filter((r) => r.status !== 'done').length;
  const rows = all.filter((r) => (view === 'all' ? true : view === 'open' ? r.status !== 'done' : r.status === 'done'));

  const setStatus = (r: PartnerRequest, status: RequestStatus) =>
    save.mutate({ id: r.id, status, completed_at: status === 'done' ? r.completed_at ?? new Date().toISOString() : null }, {
      onSuccess: () => toast(`Marked ${REQUEST_STATUSES.find((s) => s.value === status)?.label.toLowerCase()}`),
      onError: (e) => toast(errorMessage(e), 'error'),
    });

  return (
    <div className="mx-auto max-w-[1600px] space-y-3">
      <PageHeader
        title="Partner Requests"
        description="IT requests from Melissa and others, and where each one stands."
        actions={<>
          <Button asChild><Link to="/requests/status" target="_blank"><Printer /> Printable status</Link></Button>
          <Button variant="primary" onClick={() => setEditing('new')}><Plus /> New request</Button>
        </>}
      />

      <div className="flex gap-1" role="tablist" aria-label="Filter requests">
        {([['open', `Open (${openCount})`], ['done', 'Done'], ['all', 'All']] as [View, string][]).map(([v, label]) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={cn('rounded-full px-3 py-1 text-sm transition-colors', view === v ? 'bg-primary-600 text-white' : 'text-muted hover:bg-raised hover:text-fg')}
          >
            {label}
          </button>
        ))}
      </div>

      <Panel
        title="Requests"
        icon={<LifeBuoy />}
        loading={requests.isLoading}
        error={requests.error}
        empty={rows.length === 0}
        bodyClassName="p-0"
        emptyState={
          <div className="p-3">
            <EmptyState
              icon={<LifeBuoy />}
              title={view === 'open' ? 'No open requests' : 'Nothing here yet'}
              text="Add each request Melissa sends so nothing slips. She can see progress on the printable status page."
              action={<Button variant="primary" onClick={() => setEditing('new')}><Plus /> New request</Button>}
            />
          </div>
        }
      >
        <RecordTable
          table="cc_requests"
          rows={rows}
          nameOf={(r) => r.title}
          onEdit={setEditing}
          columns={[
            {
              label: 'Request',
              render: (r) => (
                <div>
                  <p className="font-medium">{r.title}</p>
                  <p className="text-xs text-subtle">{r.requested_by} · {relativeTime(r.created_at)}</p>
                </div>
              ),
            },
            { label: 'Priority', render: (r) => <span className={cn('text-sm', PRIORITIES.find((p) => p.value === r.priority)?.tone)}>{PRIORITIES.find((p) => p.value === r.priority)?.label}</span>, wideOnly: true },
            {
              label: 'Needed by',
              render: (r) => {
                if (!r.due_date) return <span className="text-subtle">-</span>;
                const late = r.status !== 'done' && daysUntil(r.due_date) < 0;
                return <span className={cn('whitespace-nowrap', late ? 'font-medium text-error-700 dark:text-error-300' : 'text-muted')}>{prettyDate(r.due_date)}{late && ' (late)'}</span>;
              },
            },
            {
              label: 'Status',
              render: (r) => (
                <div className="flex items-center gap-2">
                  <Pill tone={STATUS_TONE[r.status]}>{REQUEST_STATUSES.find((s) => s.value === r.status)?.label}</Pill>
                  <Select className="hidden h-7 w-auto py-0 text-xs sm:block" value={r.status} onChange={(e) => setStatus(r, e.target.value as RequestStatus)} aria-label={`Change status of ${r.title}`} disabled={save.isPending}>
                    {REQUEST_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </Select>
                </div>
              ),
            },
          ]}
        />
      </Panel>

      <RecordDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === 'new' ? 'New request' : 'Edit request'}
        table="cc_requests"
        fields={FIELDS}
        record={editing && editing !== 'new' ? editing : null}
        defaults={{ requested_by: 'Melissa', priority: 'medium', status: 'new' }}
        transform={(v, prev) => ({ ...v, completed_at: v.status === 'done' ? (prev?.completed_at as string | null) ?? new Date().toISOString() : null })}
      />
    </div>
  );
}
