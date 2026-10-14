import { format } from 'date-fns';
import type { MonitorHealth } from '@/data/ops';
import type { ReportSummary } from '@/data/reports';
import type { ChangeRecord, Company, Incident, PartnerRequest, SaasTool, Task, TimeEntry } from './types';
import { daysUntil, monthlyCost } from './spend';
import { formatMinutes, toDateKey } from './utils';

export interface WeeklyInput {
  start: Date;
  end: Date;
  companies: Company[];
  tasks: Task[];
  time: TimeEntry[];
  reports: ReportSummary[];
  health: MonitorHealth[];
  incidents: Incident[];
  changes: ChangeRecord[];
  requests: PartnerRequest[];
  tools: SaasTool[];
}

const within = (ts: string | null, s: Date, e: Date) => !!ts && new Date(ts) >= s && new Date(ts) <= e;
const money = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function buildWeeklyReport(d: WeeklyInput) {
  const name = new Map(d.companies.map((c) => [c.id, c.name]));
  const co = (id: string | null) => (id && name.get(id)) || 'No company';
  const lines: string[] = [];
  const push = (...l: string[]) => lines.push(...l);
  const list = <T,>(items: T[], fmt: (t: T) => string, max = 10) => {
    items.slice(0, max).forEach((t) => push(`- ${fmt(t)}`));
    if (items.length > max) push(`- ...and ${items.length - max} more`);
  };

  const done = d.tasks.filter((t) => t.status === 'done' && within(t.completed_at, d.start, d.end));
  const today = toDateKey(new Date());
  const overdue = d.tasks.filter((t) => t.status !== 'done' && t.due_date && t.due_date < today);
  const minutes = d.time.reduce((s, t) => s + t.minutes, 0);
  const byCompany = new Map<string, number>();
  for (const t of d.time) byCompany.set(co(t.company_id), (byCompany.get(co(t.company_id)) ?? 0) + t.minutes);
  const runs = d.reports.filter((r) => within(r.received_at, d.start, d.end));
  const failed = runs.filter((r) => r.status === 'failed');
  const problems = d.health.filter((h) => h.status === 'action' || h.status === 'attention');
  const incidentsOpened = d.incidents.filter((i) => within(i.occurred_at, d.start, d.end));
  const stillOpen = d.incidents.filter((i) => i.status === 'open');
  const changes = d.changes.filter((c) => within(c.changed_at, d.start, d.end));
  const requestsDone = d.requests.filter((r) => r.status === 'done' && within(r.completed_at, d.start, d.end));
  const requestsOpen = d.requests.filter((r) => r.status !== 'done');
  const renewals = d.tools
    .filter((t) => t.status !== 'cancelled' && t.renewal_date && daysUntil(t.renewal_date) >= 0 && daysUntil(t.renewal_date) <= 30)
    .sort((a, b) => (a.renewal_date as string).localeCompare(b.renewal_date as string));
  const monthly = d.tools.reduce((s, t) => s + monthlyCost(t), 0);

  push(`# Weekly CIO Report`, `**${format(d.start, 'MMM d')} to ${format(d.end, 'MMM d, yyyy')}**`, '');
  push('## At a glance');
  push(`- ${done.length} task${done.length === 1 ? '' : 's'} finished, ${overdue.length} overdue`);
  push(`- ${formatMinutes(minutes)} of time logged`);
  push(`- ${runs.length} agent report${runs.length === 1 ? '' : 's'}${failed.length ? `, ${failed.length} failed` : ', none failed'}`);
  push(`- ${problems.length ? `${problems.length} system${problems.length === 1 ? '' : 's'} need attention` : 'All monitored systems healthy'}`);
  push(`- ${renewals.length} renewal${renewals.length === 1 ? '' : 's'} in the next 30 days; ${money(monthly)} per month in tools`, '');

  push('## Finished this week');
  if (done.length) list(done, (t) => `${t.title} (${co(t.company_id)})`, 15);
  else push('- Nothing marked done.');
  push('');

  if (byCompany.size) {
    push('## Time by company', '| Company | Time |', '| --- | --- |');
    [...byCompany.entries()].sort((a, b) => b[1] - a[1]).forEach(([c, m]) => push(`| ${c} | ${formatMinutes(m)} |`));
    push('');
  }

  push('## Agents');
  if (runs.length) {
    if (failed.length) list(failed, (r) => `Failed: ${r.agent_name}, ${format(new Date(r.received_at), 'EEE MMM d')}${r.summary ? `: ${r.summary}` : ''}`);
    const ok = new Map<string, number>();
    for (const r of runs) if (r.status === 'succeeded') ok.set(r.agent_name, (ok.get(r.agent_name) ?? 0) + 1);
    [...ok.entries()].forEach(([a, n]) => push(`- ${a}: ${n} successful run${n === 1 ? '' : 's'}`));
  } else push('- No agent reports received.');
  push('');

  push('## Systems');
  if (problems.length) list(problems, (h) => `${h.monitor.label}: ${h.label}${h.summary ? `, ${h.summary}` : ''}`);
  else push(d.health.length ? '- All monitored systems healthy.' : '- No systems monitored yet.');
  push('');

  if (incidentsOpened.length || stillOpen.length || changes.length) {
    push('## Security and changes');
    list(incidentsOpened, (i) => `Incident (${i.severity}): ${i.title}${i.status === 'resolved' ? ', resolved' : ', still open'}`);
    const older = stillOpen.filter((i) => !incidentsOpened.includes(i));
    list(older, (i) => `Still open (${i.severity}): ${i.title}`);
    list(changes, (c) => `Change: ${c.title}${c.system ? ` on ${c.system}` : ''} (${c.outcome.replace('_', ' ')})`);
    push('');
  }

  if (requestsDone.length || requestsOpen.length) {
    push('## Partner requests');
    push(`- ${requestsDone.length} completed this week, ${requestsOpen.length} open`);
    list(requestsOpen, (r) => `Open: ${r.title} (from ${r.requested_by}${r.due_date ? `, due ${r.due_date}` : ''})`, 5);
    push('');
  }

  push('## Coming up');
  if (renewals.length) list(renewals, (t) => `${t.name} renews ${t.renewal_date} (${money(Number(t.cost_amount))}${t.billing_cycle === 'annual' ? '/yr' : t.billing_cycle === 'monthly' ? '/mo' : ''})`);
  if (overdue.length) list(overdue, (t) => `Overdue: ${t.title}, due ${t.due_date}`, 5);
  if (!renewals.length && !overdue.length) push('- Nothing urgent.');

  return lines.join('\n');
}
