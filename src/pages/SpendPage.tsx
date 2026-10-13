import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { addMonths, addYears, format } from 'date-fns';
import { AlarmClock, Building2, CalendarClock, CircleDollarSign, Plus, Receipt, ZapOff } from 'lucide-react';
import type { SaasTool } from '@/lib/types';
import { cn, errorMessage, fromDateKey, toDateKey } from '@/lib/utils';
import { UNUSED_AFTER_DAYS, annualCost, daysSince, daysUntil, isUnused, money, monthlyCost, prettyDate, renewalTier } from '@/lib/spend';
import { useRecords, useSaveRecord } from '@/data/records';
import { useCompanies } from '@/data/organization';
import { PageHeader } from '@/components/ui/page-header';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { RecordDialog } from '@/components/records/RecordDialog';
import { Pill } from '@/components/records/RecordTable';
import { TOOL_DEFAULTS, TOOL_FIELDS } from '@/components/assets/fields';

const TIMELINE_DAYS = 90;

function Stat({ icon, label, value, note, tone }: { icon: ReactNode; label: string; value: string; note?: string; tone?: 'warning' }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3 transition-shadow hover:shadow-sm">
      <p className="flex items-center gap-2 text-xs text-subtle [&_svg]:size-4">{icon}{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', tone === 'warning' && 'text-warning-700 dark:text-warning-300')}>{value}</p>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}

function TierPill({ tool }: { tool: SaasTool }) {
  const tier = renewalTier(tool);
  if (!tool.renewal_date) return null;
  const d = daysUntil(tool.renewal_date);
  if (tier === 'overdue') return <Pill tone="error">Passed {Math.abs(d)}d ago</Pill>;
  if (tier === 7) return <Pill tone="error">{d === 0 ? 'Today' : `${d}d`} · 7-day alert</Pill>;
  if (tier === 14) return <Pill tone="warning">{d}d · 14-day alert</Pill>;
  if (tier === 30) return <Pill tone="primary">{d}d · 30-day alert</Pill>;
  return <Pill>{d}d</Pill>;
}

export function SpendPage() {
  const tools = useRecords<SaasTool>('cc_saas_tools');
  const companies = useCompanies();
  const save = useSaveRecord('cc_saas_tools');
  const toast = useToast();
  const [editing, setEditing] = useState<SaasTool | 'new' | null>(null);

  const all = tools.data ?? [];
  const live = all.filter((t) => t.status !== 'cancelled');
  const monthly = live.reduce((s, t) => s + monthlyCost(t), 0);
  const companyName = new Map((companies.data ?? []).map((c) => [c.id, c.name]));

  const byCompany = [...live.reduce((m, t) => {
    const key = t.company_id ? companyName.get(t.company_id) ?? 'Unknown company' : 'No company';
    m.set(key, (m.get(key) ?? 0) + monthlyCost(t));
    return m;
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const maxCompany = Math.max(1, ...byCompany.map(([, v]) => v));

  const timeline = live
    .filter((t) => t.renewal_date && daysUntil(t.renewal_date) <= TIMELINE_DAYS)
    .sort((a, b) => (a.renewal_date ?? '').localeCompare(b.renewal_date ?? ''));
  const within30 = timeline.filter((t) => renewalTier(t) !== null);
  const unused = live.filter(isUnused);
  const unusedMonthly = unused.reduce((s, t) => s + monthlyCost(t), 0);

  const act = (values: Record<string, unknown> & { id: string }, msg: string) =>
    save.mutate(values, { onSuccess: () => toast(msg), onError: (e) => toast(errorMessage(e), 'error') });

  const markRenewed = (t: SaasTool) => {
    if (!t.renewal_date) return;
    const from = fromDateKey(t.renewal_date);
    const next = t.billing_cycle === 'annual' ? addYears(from, 1) : addMonths(from, 1);
    act({ id: t.id, renewal_date: toDateKey(next) }, `${t.name} next renews ${format(next, 'MMM d, yyyy')}`);
  };

  const addButton = <Button variant="primary" onClick={() => setEditing('new')}><Plus /> Add tool</Button>;

  return (
    <div className="mx-auto max-w-[1600px] space-y-3">
      <PageHeader
        title="Renewals & Spend"
        description="What your software costs each month and year, what renews soon, and what may be going unused."
        actions={<>
          <Button asChild><Link to="/assets/software">Manage tools</Link></Button>
          {addButton}
        </>}
      />

      {tools.isLoading ? <Panel title="Renewals & Spend" icon={<Receipt />} loading /> : tools.error ? <Panel title="Renewals & Spend" icon={<Receipt />} error={tools.error} /> : all.length === 0 ? (
        <Panel title="Nothing to show yet" icon={<Receipt />}>
          <EmptyState icon={<Receipt />} title="No tools recorded" text="Add the apps you pay for with their cost and next renewal date. Totals, alerts and unused-tool flags appear here automatically." action={addButton} />
        </Panel>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat icon={<CircleDollarSign />} label="Per month" value={money(monthly)} note={`${live.length} active tools`} />
            <Stat icon={<Receipt />} label="Per year" value={money(monthly * 12)} note="Yearly plans spread evenly" />
            <Stat icon={<AlarmClock />} label="Renewing within 30 days" value={String(within30.length)} note={within30.length ? money(within30.reduce((s, t) => s + Number(t.cost_amount), 0)) + ' due' : 'Nothing due'} tone={within30.length ? 'warning' : undefined} />
            <Stat icon={<ZapOff />} label="Possibly unused" value={String(unused.length)} note={unused.length ? `${money(unusedMonthly)}/mo could be saved` : `All used in the last ${UNUSED_AFTER_DAYS} days`} tone={unused.length ? 'warning' : undefined} />
          </div>

          <div className="grid gap-3 lg:grid-cols-12">
            <Panel title="Renewal timeline" icon={<CalendarClock />} subtitle={`Next ${TIMELINE_DAYS} days · alerts at 30, 14 and 7 days`} subtitleInline className="lg:col-span-7" empty={timeline.length === 0} emptyState={<EmptyState icon={<CalendarClock />} title={`No renewals in the next ${TIMELINE_DAYS} days`} />} bodyClassName="p-0">
              <ol>
                {timeline.map((t) => (
                  <li key={t.id} className="group flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 last:border-0 transition-colors hover:bg-raised/60">
                    <span className="w-24 shrink-0 text-sm tabular-nums text-muted">{prettyDate(t.renewal_date)}</span>
                    <button type="button" onClick={() => setEditing(t)} className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-primary-600">{t.name}</button>
                    <span className="text-sm tabular-nums">{money(Number(t.cost_amount))}</span>
                    <TierPill tool={t} />
                    {!t.auto_renews && <Pill tone="warning">Manual renewal</Pill>}
                    <Button size="sm" variant="ghost" onClick={() => markRenewed(t)} disabled={save.isPending}>Mark renewed</Button>
                  </li>
                ))}
              </ol>
            </Panel>

            <Panel title="Spend by company" icon={<Building2 />} subtitle="Per month" subtitleInline className="lg:col-span-5">
              <ul className="space-y-3">
                {byCompany.map(([name, value]) => (
                  <li key={name}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate">{name}</span>
                      <span className="tabular-nums text-muted">{money(value)}<span className="text-subtle"> · {money(value * 12)}/yr</span></span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-raised">
                      <div className="h-full rounded-full bg-primary-500 transition-all duration-700" style={{ width: `${(value / maxCompany) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <Panel title="Possibly unused" icon={<ZapOff />} subtitle={`Not marked as used in ${UNUSED_AFTER_DAYS} days`} subtitleInline empty={unused.length === 0} emptyState={<EmptyState icon={<ZapOff />} title="Every active tool has been used recently" />} bodyClassName="p-0">
            <ul>
              {unused.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 last:border-0 transition-colors hover:bg-raised/60">
                  <button type="button" onClick={() => setEditing(t)} className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-primary-600">{t.name}</button>
                  <span className="text-xs text-subtle">{t.last_used_on ? `Last used ${daysSince(t.last_used_on)} days ago` : 'Never marked as used'}</span>
                  <span className="text-sm tabular-nums">{money(annualCost(t))}/yr</span>
                  <Button size="sm" variant="ghost" onClick={() => act({ id: t.id, last_used_on: toDateKey(new Date()) }, `${t.name} marked as in use`)} disabled={save.isPending}>Still using</Button>
                  <Button size="sm" variant="ghost" className="text-error-700 dark:text-error-300" onClick={() => act({ id: t.id, status: 'cancelled' }, `${t.name} marked cancelled`)} disabled={save.isPending}>Mark cancelled</Button>
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}

      <RecordDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === 'new' ? 'Add tool' : 'Edit tool'}
        table="cc_saas_tools"
        fields={TOOL_FIELDS}
        record={editing && editing !== 'new' ? editing : null}
        defaults={TOOL_DEFAULTS}
      />
    </div>
  );
}
