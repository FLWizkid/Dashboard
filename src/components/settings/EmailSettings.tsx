import { useEffect, useState } from 'react';
import { Mail, Plus, Send, X } from 'lucide-react';
import { z } from 'zod';
import { errorMessage, cn } from '@/lib/utils';
import { useSettings, useUpdateSettings } from '@/data/settings';
import { useEmailLog, useEmailStatus, useSendTestEmail } from '@/data/email';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

const email = z.string().trim().toLowerCase().email();

const LOG_TONE = {
  sent: 'text-success-700 dark:text-success-400',
  failed: 'text-error-700 dark:text-error-400',
  blocked: 'text-warning-800 dark:text-warning-400',
} as const;

export function EmailSettings() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const status = useEmailStatus();
  const log = useEmailLog();
  const sendTest = useSendTestEmail();
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [list, setList] = useState<string[]>([]);

  useEffect(() => {
    if (settings.data) setList(settings.data.approved_destinations ?? []);
  }, [settings.data]);

  const notify = settings.data?.notification_address.toLowerCase() ?? '';
  const notifyApproved = list.map((a) => a.toLowerCase()).includes(notify);

  async function save(next: string[]) {
    const prev = list;
    setList(next);
    try {
      await update.mutateAsync({ approved_destinations: next });
    } catch (e) {
      setList(prev);
      toast(errorMessage(e), 'error');
    }
  }

  function add() {
    const parsed = email.safeParse(draft);
    if (!parsed.success) return toast('Enter a valid email address.', 'error');
    if (list.map((a) => a.toLowerCase()).includes(parsed.data)) return toast('That address is already approved.', 'error');
    if (list.length >= 20) return toast('Up to 20 addresses can be approved.', 'error');
    setDraft('');
    save([...list, parsed.data]);
  }

  async function toggleAlerts() {
    if (!settings.data) return;
    try {
      await update.mutateAsync({ alert_emails: !settings.data.alert_emails });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  function test() {
    sendTest.mutate(undefined, {
      onSuccess: (r) => toast(`Test sent to ${r.to}`),
      onError: (e) => toast(errorMessage(e), 'error'),
    });
  }

  const configured = status.data?.configured ?? false;

  return (
    <Panel
      title="Console email"
      icon={<Mail />}
      subtitle={configured ? `Sends from ${status.data?.from ?? 'doug@encountive.com'}` : 'Not set up yet. See Setup > Your steps, step 2.'}
      actions={<StatusPill status={configured ? 'healthy' : 'unknown'} label={configured ? 'Ready' : 'Not set up'} />}
      loading={settings.isLoading}
      error={settings.error ?? status.error}
      onRefresh={() => { settings.refetch(); status.refetch(); log.refetch(); }}
      refreshing={settings.isFetching || status.isFetching || log.isFetching}
    >
      <div className="space-y-5">
        <Field label="Approved destinations" hint="The console can only send email to these addresses. Anything else is blocked and logged.">
          <ul className="mb-2 flex flex-wrap gap-2">
            {list.map((a) => (
              <li key={a} className="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-raised pl-3 pr-1 font-mono text-xs">
                {a}
                <button
                  type="button"
                  className="rounded-full p-1 text-subtle transition-colors hover:bg-error-500/10 hover:text-error-600"
                  aria-label={`Remove ${a}`}
                  onClick={() => save(list.filter((x) => x !== a))}
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="text-sm text-subtle">None yet. The console cannot send any email.</li>}
          </ul>
          <div className="flex gap-2 sm:max-w-md">
            <input
              className="input flex-1"
              type="email"
              placeholder="name@example.com"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            />
            <Button variant="secondary" onClick={add} disabled={!draft.trim() || update.isPending}><Plus /> Add</Button>
          </div>
        </Field>

        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" className="mt-1 size-4 accent-primary-600" checked={settings.data?.alert_emails ?? true} onChange={toggleAlerts} />
          <span className="text-sm">
            <span className="font-medium">Email me when a health check turns red</span>
            <span className="block text-muted">Checks run every 15 minutes. You get one email when something newly needs action, not a repeat every time.</span>
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line p-3">
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">Send a test to {settings.data?.notification_address}</p>
            <p className={cn('text-xs', notifyApproved ? 'text-subtle' : 'text-warning-800 dark:text-warning-400')}>
              {notifyApproved ? 'Your notification address is approved.' : 'Add your notification address to the approved list first.'}
            </p>
          </div>
          <Button variant="primary" onClick={test} disabled={!configured || !notifyApproved || sendTest.isPending}>
            <Send /> {sendTest.isPending ? 'Sending...' : 'Send test'}
          </Button>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">Recent sends</p>
          {log.error && <p className="text-sm text-error-600">Could not load recent sends.</p>}
          {log.data?.length === 0 && <p className="text-sm text-subtle">Nothing sent yet.</p>}
          <ul className="divide-y divide-line">
            {log.data?.map((m) => (
              <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm">
                <span className={cn('w-16 font-medium capitalize', LOG_TONE[m.status])}>{m.status}</span>
                <span className="min-w-0 flex-1 truncate">{m.subject} <span className="text-subtle">to {m.recipient}</span></span>
                <span className="font-mono text-xs text-subtle">{new Date(m.created_at).toLocaleString()}</span>
                {m.error && <span className="basis-full pl-[76px] text-xs text-muted">{m.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}
