import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Trash2 } from 'lucide-react';
import { IDENTITIES, MONITOR_KINDS, type Identity, type Monitor, type MonitorKind } from '@/lib/types';
import { errorMessage } from '@/lib/utils';
import { useSaveMonitor, useDeleteMonitor, useRunChecks, type MonitorInput } from '@/data/ops';
import { useCompanies } from '@/data/organization';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, focusFirstError } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const schema = z
  .object({
    kind: z.enum(['domain', 'email_auth', 'website', 'database', 'manual']),
    label: z.string().trim().min(1, 'Give this check a name.').max(120, 'Keep the name under 120 characters.'),
    target: z.string().trim(),
    warn_days: z.number().int().min(1, 'Warning must be at least 1 day.').max(365),
    critical_days: z.number().int().min(0).max(365),
    slow_ms: z.number().int().min(200, 'Slow threshold must be at least 200 ms.').max(30000),
    check_every_days: z.number().int().min(1).max(365),
  })
  .superRefine((v, ctx) => {
    if ((v.kind === 'domain' || v.kind === 'email_auth') && !DOMAIN_RE.test(v.target)) {
      ctx.addIssue({ code: 'custom', path: ['target'], message: v.target ? 'That does not look like a domain. Try something like encountive.com' : 'Enter a domain, for example encountive.com' });
    }
    if (v.kind === 'website') {
      try {
        const u = new URL(v.target);
        if (!/^https?:$/.test(u.protocol) || v.target.length > 500 || !DOMAIN_RE.test(u.hostname)) throw new Error();
      } catch {
        ctx.addIssue({ code: 'custom', path: ['target'], message: v.target ? 'That does not look like a web address. Try something like encountive.com' : 'Enter a web address, for example encountive.com' });
      }
    }
    if (v.critical_days > v.warn_days) ctx.addIssue({ code: 'custom', path: ['critical_days'], message: 'Must be fewer days than the warning threshold.' });
  });

type Draft = Omit<MonitorInput, 'dkim_selectors'> & { dkim: string };
type Errors = Partial<Record<keyof Draft | 'form', string>>;

function stripScheme(url: string) {
  return url.trim().replace(/^https:\/\//i, '');
}

function toWebsiteUrl(input: string) {
  const v = input.trim();
  if (!v) return '';
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

function blank(kind: MonitorKind): Draft {
  return {
    kind, label: '', target: '', identity: null, company_id: null, warn_days: kind === 'website' ? 14 : 30, critical_days: 7,
    slow_ms: 2000, dkim: '', check_every_days: 7, enabled: true, notes: null,
  };
}

function toDraft(m: Monitor): Draft {
  const { created_at: _c, updated_at: _u, dkim_selectors, ...rest } = m;
  return { ...rest, target: rest.kind === 'website' && rest.target ? stripScheme(rest.target) : rest.target, dkim: dkim_selectors.join(', ') };
}

export function MonitorForm({ open, onOpenChange, monitor }: { open: boolean; onOpenChange: (o: boolean) => void; monitor: Monitor | null }) {
  const [draft, setDraft] = useState<Draft>(blank('website'));
  const [errors, setErrors] = useState<Errors>({});
  const bodyRef = useRef<HTMLDivElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useSaveMonitor();
  const remove = useDeleteMonitor();
  const run = useRunChecks();
  const { data: companies = [] } = useCompanies();
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    setDraft(monitor ? toDraft(monitor) : blank('website'));
    setErrors({});
    setConfirmDelete(false);
  }, [open, monitor]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setErrors((e) => (e[k] || e.form ? { ...e, [k]: undefined, form: undefined } : e));
  };

  function showErrors(next: Errors) {
    setErrors(next);
    requestAnimationFrame(() => focusFirstError(bodyRef.current));
  }
  const kind = draft.kind;
  const usesTarget = kind === 'domain' || kind === 'email_auth' || kind === 'website';
  const usesExpiry = kind === 'domain' || kind === 'website';

  async function submit() {
    const raw = draft.target ?? '';
    const target = kind === 'domain' || kind === 'email_auth' ? raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') : kind === 'website' ? toWebsiteUrl(raw) : raw.trim();
    const parsed = schema.safeParse({ ...draft, target });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = (issue.path[0] as keyof Draft | undefined) ?? 'form';
        next[key] ??= issue.message;
      }
      return showErrors(next);
    }
    const dkim = draft.dkim.split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z0-9._-]{1,63}$/.test(s));
    const { dkim: _d, ...rest } = draft;
    try {
      const id = await save.mutateAsync({ ...rest, label: parsed.data.label, target: usesTarget ? target : null, dkim_selectors: dkim });
      toast(monitor ? 'Check updated' : 'Check added');
      onOpenChange(false);
      if (draft.enabled && kind !== 'manual') run.mutate([id], { onError: (e) => toast(errorMessage(e), 'error') });
    } catch (e) {
      const msg = errorMessage(e);
      showErrors(/address|domain|url|private/i.test(msg) && usesTarget ? { target: msg } : { form: msg });
    }
  }

  async function doDelete() {
    if (!monitor) return;
    try {
      await remove.mutateAsync(monitor.id);
      toast('Check deleted');
      onOpenChange(false);
    } catch (e) {
      showErrors({ form: errorMessage(e) });
    }
  }

  const kindDef = MONITOR_KINDS.find((k) => k.value === kind);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={monitor ? 'Edit check' : 'Add a check'}
      description={kindDef?.hint}
      footer={
        <>
          {monitor && (
            <Button variant="danger" className="mr-auto" onClick={() => (confirmDelete ? doDelete() : setConfirmDelete(true))} disabled={remove.isPending}>
              <Trash2 /> {confirmDelete ? 'Confirm delete' : 'Delete'}
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={save.isPending}>{save.isPending ? 'Saving...' : 'Save check'}</Button>
        </>
      }
    >
      <div ref={bodyRef} className="space-y-4">
        {!monitor && (
          <Field label="What to watch">
            <Select value={kind} onChange={(e) => setDraft({ ...blank(e.target.value as MonitorKind), label: draft.label, identity: draft.identity })}>
              {MONITOR_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Name" error={errors.label}>
          <input className="input" value={draft.label} onChange={(e) => set('label', e.target.value)} placeholder={kind === 'website' ? 'Krewe & Kin client site' : 'What is this?'} maxLength={120} />
        </Field>
        {usesTarget && (
          <Field label={kind === 'website' ? 'Web address' : 'Domain'} error={errors.target} hint={kind === 'website' ? 'Just type the address, for example encountive.com. Must be a public site.' : 'Just the domain, for example encountive.com'}>
            {kind === 'website' ? (
              <span className="field-shell flex h-9 items-center overflow-hidden rounded-md border border-line bg-surface transition-colors focus-within:border-primary-500">
                <span className="flex h-full select-none items-center border-r border-line bg-raised px-2 text-sm text-subtle">https://</span>
                <input
                  className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm placeholder:text-subtle focus:outline-none"
                  value={draft.target ?? ''}
                  onChange={(e) => set('target', e.target.value)}
                  onBlur={(e) => set('target', stripScheme(e.target.value))}
                  placeholder="encountive.com"
                  inputMode="url"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={!!errors.target}
                />
              </span>
            ) : (
              <input className="input" value={draft.target ?? ''} onChange={(e) => set('target', e.target.value)} placeholder="encountive.com" inputMode="url" autoCapitalize="none" spellCheck={false} aria-invalid={!!errors.target} />
            )}
          </Field>
        )}
        {usesExpiry && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={kind === 'website' ? 'Warn: certificate days left' : 'Warn: days before expiry'} error={errors.warn_days}>
              <input type="number" className="input" min={1} max={365} value={draft.warn_days} onChange={(e) => set('warn_days', Number(e.target.value))} />
            </Field>
            <Field label="Critical: days left" error={errors.critical_days}>
              <input type="number" className="input" min={0} max={365} value={draft.critical_days} onChange={(e) => set('critical_days', Number(e.target.value))} />
            </Field>
          </div>
        )}
        {kind === 'website' && (
          <Field label="Slow if slower than (ms)" error={errors.slow_ms} hint="Shows Attention when the site takes longer than this to answer.">
            <input type="number" className="input" min={200} max={30000} step={100} value={draft.slow_ms} onChange={(e) => set('slow_ms', Number(e.target.value))} />
          </Field>
        )}
        {kind === 'email_auth' && (
          <Field label="DKIM selectors (optional)" hint="Comma separated, for example google, resend. Leave blank to try common ones. Google Workspace uses google.">
            <input className="input" value={draft.dkim} onChange={(e) => set('dkim', e.target.value)} placeholder="google, resend" spellCheck={false} />
          </Field>
        )}
        {kind === 'manual' && (
          <Field label="Confirm every (days)" error={errors.check_every_days}>
            <input type="number" className="input" min={1} max={365} value={draft.check_every_days} onChange={(e) => set('check_every_days', Number(e.target.value))} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Identity" hint={!draft.identity ? 'Choose one. Unset checks are flagged.' : undefined}>
            <Select value={draft.identity ?? ''} onChange={(e) => set('identity', (e.target.value || null) as Identity | null)}>
              <option value="">Unset</option>
              {IDENTITIES.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
            </Select>
          </Field>
          <Field label="Company">
            <Select value={draft.company_id ?? ''} onChange={(e) => set('company_id', e.target.value || null)}>
              <option value="">None</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Notes">
          <textarea className="input min-h-[64px] py-2" value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} maxLength={2000} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary-600" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          Check is active
        </label>
        {errors.form && <p role="alert" className="rounded-md border border-error-500/40 bg-error-500/10 px-3 py-2 text-sm text-error-700 dark:text-error-300">{errors.form}</p>}
      </div>
    </Dialog>
  );
}
