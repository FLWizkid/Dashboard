import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Database, Download, FlaskConical, History, RotateCcw, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { cn, errorMessage } from '@/lib/utils';
import { useSettings, useUpdateSettings } from '@/data/settings';
import { reseedDemo, removeDemo } from '@/data/demo';
import { EXPORT_TABLES, exportCsv, exportJson, useAuditLog, type ExportTable } from '@/data/export';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50', checked ? 'border-primary-600 bg-primary-600' : 'border-line bg-raised')}
    >
      <span className={cn('inline-block size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  );
}

export function DemoDataSettings() {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<'remove' | 'reseed' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function run(kind: 'remove' | 'reseed') {
    setBusy(kind);
    try {
      await (kind === 'remove' ? removeDemo() : reseedDemo());
      await qc.invalidateQueries();
      toast(kind === 'remove' ? 'Demo tasks and time removed. Your own data is untouched.' : 'Demo data restored');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
    setBusy(null);
    setConfirmRemove(false);
  }

  return (
    <Panel title="Demo data" icon={<FlaskConical />} subtitle="Sample tasks and time so every screen has something to show">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <p className="text-sm font-medium">Show demo data</p>
          <p className="text-sm text-muted">When on, panels with sample records carry a DEMO DATA badge. Turning it off hides them everywhere.</p>
        </div>
        <Toggle
          label="Show demo data"
          checked={settings?.show_demo ?? true}
          disabled={!settings || update.isPending}
          onChange={(v) => update.mutate({ show_demo: v }, { onSuccess: () => toast(v ? 'Demo data shown' : 'Demo data hidden'), onError: (e) => toast(errorMessage(e), 'error') })}
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        {confirmRemove ? (
          <>
            <span className="self-center text-sm text-muted">Permanently delete all demo tasks and time entries?</span>
            <Button size="sm" variant="danger" disabled={!!busy} onClick={() => run('remove')}>Delete demo data</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>Cancel</Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setConfirmRemove(true)}><Trash2 /> Remove demo data</Button>
        )}
        <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => run('reseed')}><RotateCcw /> {busy === 'reseed' ? 'Restoring' : 'Reset demo data'}</Button>
      </div>
    </Panel>
  );
}

export function ExportSettings() {
  const toast = useToast();
  const [table, setTable] = useState<ExportTable>('cc_tasks');
  const [busy, setBusy] = useState(false);

  async function go(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      toast('Export downloaded');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
    setBusy(false);
  }

  return (
    <Panel title="Export your data" icon={<Database />} subtitle="Everything you own, including demo rows">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => go(exportJson)}><Download /> Everything as JSON</Button>
        <span className="text-sm text-subtle">or</span>
        <Select className="w-auto" value={table} onChange={(e) => setTable(e.target.value as ExportTable)} aria-label="Table to export">
          {EXPORT_TABLES.map((t) => <option key={t.table} value={t.table}>{t.label}</option>)}
        </Select>
        <Button variant="secondary" disabled={busy} onClick={() => go(() => exportCsv(table))}><Download /> CSV</Button>
      </div>
    </Panel>
  );
}

export function AuditLogPanel() {
  const log = useAuditLog();
  const rows = log.data ?? [];
  return (
    <Panel
      title="Activity log"
      icon={<History />}
      subtitle="Last 50 changes. Records what happened, never the content."
      updatedAt={log.dataUpdatedAt}
      onRefresh={() => log.refetch()}
      refreshing={log.isFetching}
      loading={log.isLoading}
      error={log.error}
      empty={rows.length === 0}
      emptyState={<EmptyState title="No activity yet" />}
    >
      <ul className="max-h-72 divide-y divide-line overflow-y-auto">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-1.5 text-sm">
            <span className="w-28 shrink-0 text-xs text-subtle">{format(new Date(r.created_at), 'MMM d, HH:mm')}</span>
            <span className="flex-1 truncate font-mono text-xs">{r.action}</span>
            <span className="text-xs text-muted">{r.entity}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
