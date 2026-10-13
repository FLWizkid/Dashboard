import { useState } from 'react';
import { ArrowRight, ArrowRightLeft, CheckCircle2, Pencil, Plus } from 'lucide-react';
import { IDENTITIES, type ChecklistItem, type IdentityMigration, type MigrationStatus, type SaasTool } from '@/lib/types';
import { cn, errorMessage } from '@/lib/utils';
import { daysUntil, prettyDate } from '@/lib/spend';
import { useRecords, useSaveRecord } from '@/data/records';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { RecordDialog, type FieldSpec } from '@/components/records/RecordDialog';
import { Pill } from '@/components/records/RecordTable';

const STEP_TEMPLATE = [
  'Add the new email address to the account (or invite it)',
  'Confirm the new address and turn on two-step sign-in',
  'Give the new address admin or owner rights',
  'Move billing and receipts to the new address',
  'Update the password manager entry',
  'Sign in with the new address to confirm it works',
  'Remove the old address from the account',
];

const STATUS: Record<MigrationStatus, { label: string; tone: 'neutral' | 'primary' | 'warning' | 'success' }> = {
  planned: { label: 'Planned', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'primary' },
  blocked: { label: 'Blocked', tone: 'warning' },
  done: { label: 'Done', tone: 'success' },
};

function moveFields(tools: SaasTool[]): FieldSpec[] {
  return [
    { key: 'title', label: 'What is moving', type: 'text', required: true, max: 200, wide: true, placeholder: 'e.g. Move GoDaddy login to Encountive' },
    { key: 'tool_id', label: 'Tool', type: 'select', options: tools.map((t) => ({ value: t.id, label: t.name })), hint: 'Optional. Its login is updated when the move is done.' },
    { key: 'to_identity', label: 'Moving to identity', type: 'select', options: IDENTITIES.map((i) => ({ value: i.value, label: i.label })) },
    { key: 'from_address', label: 'From address', type: 'text', max: 200 },
    { key: 'to_address', label: 'To address', type: 'text', max: 200 },
    { key: 'status', label: 'Status', type: 'select', required: true, options: Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label })) },
    { key: 'due_date', label: 'Finish by', type: 'date' },
    { key: 'notes', label: 'Notes', type: 'textarea', max: 4000 },
  ];
}

interface MoveDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  record: IdentityMigration | null;
  defaults?: Record<string, unknown>;
}

export function MoveDialog({ open, onOpenChange, record, defaults }: MoveDialogProps) {
  const tools = useRecords<SaasTool>('cc_saas_tools');
  return (
    <RecordDialog
      open={open}
      onOpenChange={onOpenChange}
      title={record ? 'Edit move' : 'Plan a move'}
      description={record ? undefined : 'Moves an account from one email address to another. A standard step list is added for you.'}
      table="cc_identity_migrations"
      fields={moveFields(tools.data ?? [])}
      record={record}
      defaults={defaults ?? { status: 'planned' }}
      transform={(v, prev) => ({
        ...v,
        ...(prev ? {} : { steps: STEP_TEMPLATE.map((label) => ({ label, done: false })) }),
        completed_at: v.status === 'done' ? (prev?.completed_at as string | null) ?? new Date().toISOString() : null,
      })}
    />
  );
}

function MoveCard({ move, tool, onEdit }: { move: IdentityMigration; tool: SaasTool | undefined; onEdit: () => void }) {
  const save = useSaveRecord('cc_identity_migrations');
  const saveTool = useSaveRecord('cc_saas_tools');
  const toast = useToast();
  const steps: ChecklistItem[] = Array.isArray(move.steps) ? move.steps : [];
  const done = steps.filter((s) => s.done).length;
  const late = move.status !== 'done' && move.due_date && daysUntil(move.due_date) < 0;

  const toggle = (idx: number) => {
    const next = steps.map((s, i) => (i === idx ? { ...s, done: !s.done } : s));
    const complete = next.length > 0 && next.every((s) => s.done);
    const status: MigrationStatus = complete ? 'done' : move.status === 'done' || move.status === 'planned' ? 'in_progress' : move.status;
    save.mutate({ id: move.id, steps: next, status, completed_at: complete ? move.completed_at ?? new Date().toISOString() : null }, {
      onSuccess: () => {
        if (!complete || move.status === 'done' || !tool || !move.to_address) return;
        saveTool.mutate({ id: tool.id, login_account: move.to_address, ...(move.to_identity ? { identity: move.to_identity } : {}) }, {
          onSuccess: () => toast(`${tool.name} now signs in with ${move.to_address}`),
          onError: (e) => toast(errorMessage(e), 'error'),
        });
      },
      onError: (e) => toast(errorMessage(e), 'error'),
    });
  };

  return (
    <div className="rounded-lg border border-line bg-surface p-3 transition-shadow hover:shadow-sm">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{move.title}</p>
          {(move.from_address || move.to_address) && (
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">
              <span>{move.from_address || 'old address'}</span><ArrowRight className="size-3" /><span>{move.to_address || 'new address'}</span>
            </p>
          )}
          <p className="text-xs text-subtle">
            {tool ? tool.name : 'No tool linked'}
            {move.due_date && <span className={cn(late && 'font-medium text-error-700 dark:text-error-300')}> · finish by {prettyDate(move.due_date)}{late && ' (late)'}</span>}
          </p>
        </div>
        <Pill tone={STATUS[move.status].tone}>{move.status === 'done' ? <><CheckCircle2 className="mr-1 size-3" />Done</> : `${STATUS[move.status].label} · ${done}/${steps.length}`}</Pill>
        <Button size="iconSm" variant="ghost" onClick={onEdit} aria-label={`Edit ${move.title}`}><Pencil /></Button>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
        <div className="h-full rounded-full bg-success-500 transition-all duration-500" style={{ width: `${steps.length ? (done / steps.length) * 100 : 0}%` }} />
      </div>
      <ul className="mt-3 space-y-1">
        {steps.map((s, i) => (
          <li key={i}>
            <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-sm transition-colors hover:bg-raised/60">
              <input type="checkbox" className="mt-0.5 size-4 accent-success-600" checked={s.done} onChange={() => toggle(i)} disabled={save.isPending} />
              <span className={cn(s.done && 'text-subtle line-through')}>{s.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MigrationTracker() {
  const moves = useRecords<IdentityMigration>('cc_identity_migrations');
  const tools = useRecords<SaasTool>('cc_saas_tools');
  const [editing, setEditing] = useState<IdentityMigration | 'new' | null>(null);
  const rows = moves.data ?? [];
  const toolById = new Map((tools.data ?? []).map((t) => [t.id, t]));
  const open = rows.filter((r) => r.status !== 'done');
  const finished = rows.filter((r) => r.status === 'done');
  const addButton = <Button size="sm" variant="primary" onClick={() => setEditing('new')}><Plus /> Plan a move</Button>;

  return (
    <Panel
      title="Migration tracker"
      icon={<ArrowRightLeft />}
      subtitle={`${open.length} open · ${finished.length} done`}
      subtitleInline
      actions={addButton}
      loading={moves.isLoading}
      error={moves.error}
      empty={rows.length === 0}
      emptyState={<EmptyState icon={<ArrowRightLeft />} title="No moves planned" text="When a tool signs in with the wrong email address, plan a move here and tick off each step. The Identity review tab suggests moves for you." action={addButton} />}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {[...open, ...finished].map((m) => (
          <MoveCard key={m.id} move={m} tool={m.tool_id ? toolById.get(m.tool_id) : undefined} onEdit={() => setEditing(m)} />
        ))}
      </div>
      <MoveDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} record={editing && editing !== 'new' ? editing : null} />
    </Panel>
  );
}
