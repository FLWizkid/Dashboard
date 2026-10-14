import { useMemo, useRef, useState } from 'react';
import { addWeeks } from 'date-fns';
import { Check, ChevronLeft, ChevronRight, Copy, FileBarChart, FileDown } from 'lucide-react';
import { useTasks } from '@/data/tasks';
import { useCompanies } from '@/data/organization';
import { useTimeEntries, weekRange } from '@/data/time';
import { useReports } from '@/data/reports';
import { useOpsHealth } from '@/data/ops';
import { useRecords } from '@/data/records';
import { buildWeeklyReport } from '@/lib/weekly';
import type { ChangeRecord, Incident, PartnerRequest, SaasTool } from '@/lib/types';
import { PageHeader } from '@/components/ui/page-header';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Markdown } from '@/components/reports/Markdown';

export function WeeklyPage() {
  const [offset, setOffset] = useState(-1);
  const { start, end } = useMemo(() => weekRange(addWeeks(new Date(), offset)), [offset]);
  const tasks = useTasks();
  const companies = useCompanies();
  const time = useTimeEntries(start, end);
  const reports = useReports('');
  const ops = useOpsHealth();
  const incidents = useRecords<Incident>('cc_incidents');
  const changes = useRecords<ChangeRecord>('cc_changes');
  const requests = useRecords<PartnerRequest>('cc_requests');
  const tools = useRecords<SaasTool>('cc_saas_tools');
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const rendered = useRef<HTMLDivElement>(null);

  const queries = [tasks, companies, time, reports, incidents, changes, requests, tools];
  const loading = queries.some((q) => q.isLoading) || ops.loading;
  const error = queries.find((q) => q.error)?.error ?? ops.error;

  const markdown = useMemo(
    () =>
      loading || error
        ? ''
        : buildWeeklyReport({
            start, end,
            companies: companies.data ?? [], tasks: tasks.data ?? [], time: time.data ?? [], reports: reports.data ?? [],
            health: ops.health, incidents: incidents.data ?? [], changes: changes.data ?? [], requests: requests.data ?? [], tools: tools.data ?? [],
          }),
    [loading, error, start, end, companies.data, tasks.data, time.data, reports.data, ops.health, incidents.data, changes.data, requests.data, tools.data],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('Your browser blocked copying. Select the text and copy it instead.', 'error');
    }
  };

  const downloadWord = () => {
    const body = rendered.current?.innerHTML ?? '';
    const html = `<html><head><meta charset="utf-8"><title>Weekly CIO Report</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.5}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}</style></head><body>${body}</body></html>`;
    const url = URL.createObjectURL(new Blob(['\ufeff', html], { type: 'application/msword' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `weekly-cio-report-${start.toISOString().slice(0, 10)}.doc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const label = offset === 0 ? 'This week so far' : offset === -1 ? 'Last week' : `${-offset} weeks ago`;

  return (
    <div className="mx-auto max-w-[1100px] space-y-3">
      <PageHeader
        title="Weekly CIO Report"
        description="A ready-to-send summary of the week: work finished, time, agents, systems, security and what is coming up."
        actions={
          <>
            <Button onClick={downloadWord} disabled={!markdown}><FileDown /> Word</Button>
            <Button variant="primary" onClick={copy} disabled={!markdown}>{copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy as Markdown'}</Button>
          </>
        }
      />
      <div className="flex items-center gap-2">
        <Button size="iconSm" variant="ghost" onClick={() => setOffset((o) => o - 1)} aria-label="Previous week"><ChevronLeft /></Button>
        <span className="min-w-[140px] text-center text-sm font-medium">{label}</span>
        <Button size="iconSm" variant="ghost" onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset >= 0} aria-label="Next week"><ChevronRight /></Button>
      </div>
      <Panel title="Report" icon={<FileBarChart />} loading={loading} error={error}>
        <div ref={rendered}>{markdown && <Markdown text={markdown} />}</div>
      </Panel>
    </div>
  );
}
