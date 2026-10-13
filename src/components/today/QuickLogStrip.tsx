import { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { formatMinutes } from '@/lib/utils';
import { useCompanies } from '@/data/organization';
import { useTimeEntries, weekRange } from '@/data/time';
import { Panel, EmptyState } from '@/components/ui/panel';
import { LogTimeForm } from '@/components/time/LogTimeForm';

export function QuickLogStrip() {
  const { start, end } = useMemo(() => weekRange(new Date()), []);
  const entries = useTimeEntries(start, end);
  const { data: companies = [] } = useCompanies();
  const rows = entries.data ?? [];
  const total = rows.reduce((s, e) => s + e.minutes, 0);

  const byCompany = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of rows) map.set(e.company_id ?? 'none', (map.get(e.company_id ?? 'none') ?? 0) + e.minutes);
    return [...map.entries()]
      .map(([id, minutes]) => ({ id, minutes, name: companies.find((c) => c.id === id)?.name ?? 'No company' }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [rows, companies]);

  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_320px]">
      <Panel title="Quick time log" subtitle="Press T anywhere to log time" bodyClassName="py-2">
        <LogTimeForm layout="strip" />
      </Panel>
      <Panel
        title="Hours this week"
        icon={<BarChart3 />}
        demo={rows.some((r) => r.is_demo)}
        updatedAt={entries.dataUpdatedAt}
        onRefresh={() => entries.refetch()}
        refreshing={entries.isFetching}
        loading={entries.isLoading}
        error={entries.error}
        empty={rows.length === 0}
        emptyState={<EmptyState title="No hours logged this week" text="Log time on the left or finish a focus session." />}
        actions={<span className="font-mono text-base font-semibold tabular-nums">{formatMinutes(total)}</span>}
        bodyClassName="py-2"
      >
        <ul className="space-y-1.5">
          {byCompany.map((c) => (
            <li key={c.id} className="text-sm">
              <div className="mb-0.5 flex justify-between">
                <span className="text-muted">{c.name}</span>
                <span className="font-mono tabular-nums">{formatMinutes(c.minutes)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-raised">
                <div className="h-full rounded-full bg-primary-500 transition-all duration-500" style={{ width: `${(c.minutes / total) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
