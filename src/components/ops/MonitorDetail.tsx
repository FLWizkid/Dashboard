import { useState } from 'react';
import { format } from 'date-fns';
import { CheckCircle2, Pencil, RefreshCw } from 'lucide-react';
import { monitorKindLabel, type CheckStatus } from '@/lib/types';
import { cn, errorMessage, relativeTime } from '@/lib/utils';
import { useConfirmManual, useRunChecks, type MonitorHealth } from '@/data/ops';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { IdentityBadge, StatusPill } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { HistoryStrip } from './HealthLight';

const META_LABELS: Record<string, string> = {
  expires: 'Expires', registrar: 'Registrar', nameservers: 'Name servers', mx: 'Mail servers', spf: 'SPF record',
  dmarc: 'DMARC record', dkim: 'DKIM selectors found', final_url: 'Final address', response_ms: 'Response time (ms)',
};

const MANUAL_CHOICES: { status: Exclude<CheckStatus, 'unknown'>; label: string }[] = [
  { status: 'healthy', label: 'Confirmed OK' },
  { status: 'attention', label: 'Needs attention' },
  { status: 'action', label: 'Broken' },
];

export function MonitorDetail({ health, onClose, onEdit }: { health: MonitorHealth | null; onClose: () => void; onEdit: () => void }) {
  const run = useRunChecks();
  const confirm = useConfirmManual();
  const toast = useToast();
  const [note, setNote] = useState('');
  if (!health) return null;
  const { monitor, latest, history } = health;
  const checks = latest?.details?.checks ?? [];
  const meta = Object.entries(latest?.details?.meta ?? {}).filter(([k]) => META_LABELS[k]);

  const runNow = () =>
    run.mutate([monitor.id], {
      onSuccess: (r) => toast(r.checked ? 'Check finished' : 'Checked less than a minute ago. Showing that result.'),
      onError: (e) => toast(errorMessage(e), 'error'),
    });

  const record = (status: Exclude<CheckStatus, 'unknown'>) =>
    confirm.mutate(
      { monitorId: monitor.id, status, note: note.trim() },
      { onSuccess: () => { toast('Recorded'); setNote(''); }, onError: (e) => toast(errorMessage(e), 'error') },
    );

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      side="right"
      title={monitor.label}
      description={`${monitorKindLabel(monitor.kind)}${monitor.target ? ` · ${monitor.target}` : ''}`}
      footer={
        <>
          <Button variant="ghost" onClick={onEdit}><Pencil /> Edit</Button>
          {monitor.kind !== 'manual' && (
            <Button variant="primary" onClick={runNow} disabled={run.isPending || !monitor.enabled}>
              <RefreshCw className={cn(run.isPending && 'animate-spin')} /> {run.isPending ? 'Checking...' : 'Check now'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={health.status} label={health.label} />
          <IdentityBadge identity={monitor.identity} />
          <span className="text-xs text-subtle">{latest ? `Checked ${relativeTime(latest.checked_at)}` : 'No result yet'}</span>
        </div>
        <p className="text-sm text-muted">{health.summary}</p>

        {checks.length > 0 && (
          <section>
            <h3 className="label">Breakdown</h3>
            <ul className="divide-y divide-line rounded-md border border-line">
              {checks.map((c) => (
                <li key={c.name} className="flex items-start gap-3 px-3 py-2">
                  <span className="w-24 shrink-0 text-sm font-medium">{c.name}</span>
                  <span className="min-w-0 flex-1 text-sm text-muted">{c.message}</span>
                  <StatusPill status={c.status} label={c.status === 'unknown' ? 'Unknown' : undefined} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {meta.length > 0 && (
          <section>
            <h3 className="label">Details</h3>
            <dl className="space-y-2 text-sm">
              {meta.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-subtle">{META_LABELS[k]}</dt>
                  <dd className="break-all font-mono text-xs">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {monitor.kind === 'manual' && (
          <section className="rounded-md border border-line bg-raised/50 p-3">
            <h3 className="label">Record a check</h3>
            <p className="mb-2 text-xs text-subtle">Due every {monitor.check_every_days} days.{monitor.notes ? ` ${monitor.notes}` : ''}</p>
            <input className="input mb-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" maxLength={500} />
            <div className="flex flex-wrap gap-2">
              {MANUAL_CHOICES.map((c) => (
                <Button key={c.status} size="sm" variant={c.status === 'healthy' ? 'success' : c.status === 'action' ? 'danger' : 'secondary'} onClick={() => record(c.status)} disabled={confirm.isPending}>
                  {c.status === 'healthy' && <CheckCircle2 />} {c.label}
                </Button>
              ))}
            </div>
          </section>
        )}

        {monitor.notes && monitor.kind !== 'manual' && (
          <section>
            <h3 className="label">Notes</h3>
            <p className="whitespace-pre-wrap text-sm text-muted">{monitor.notes}</p>
          </section>
        )}

        <section>
          <h3 className="label">History</h3>
          {history.length === 0 ? (
            <p className="text-sm text-subtle">No history yet.</p>
          ) : (
            <>
              <HistoryStrip history={history} max={30} />
              <ul className="mt-3 space-y-1">
                {history.slice(0, 20).map((r) => (
                  <li key={r.id} className="flex items-center gap-2 text-sm">
                    <span className="w-32 shrink-0 text-xs text-subtle">{format(new Date(r.checked_at), 'MMM d, h:mm a')}</span>
                    <StatusPill status={r.status} label={r.status === 'unknown' ? 'Unknown' : undefined} />
                    <span className="min-w-0 flex-1 truncate text-xs text-muted" title={r.summary}>{r.source === 'manual' ? 'By you: ' : ''}{r.summary}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </Dialog>
  );
}
