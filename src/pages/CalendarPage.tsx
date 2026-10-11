import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addDays, endOfDay, endOfWeek, startOfDay } from 'date-fns';
import { CalendarDays, RefreshCw } from 'lucide-react';
import { cn, errorMessage } from '@/lib/utils';
import { lastSynced, useAutoSyncMail, useCalendarEvents, useMailAccounts } from '@/data/mail';
import { PageHeader, type PageTab } from '@/components/ui/page-header';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { EventList } from '@/components/mail/EventList';

const RANGES = {
  today: { label: 'Today', end: () => endOfDay(new Date()) },
  week: { label: 'This week', end: () => endOfWeek(new Date(), { weekStartsOn: 1 }) },
  next14: { label: 'Next 14 days', end: () => endOfDay(addDays(new Date(), 14)) },
} as const;
type RangeKey = keyof typeof RANGES;

export function CalendarPage() {
  const [params] = useSearchParams();
  const raw = params.get('tab');
  const tab: RangeKey = raw === 'week' || raw === 'next14' ? raw : 'today';
  const accounts = useMailAccounts();
  const events = useCalendarEvents();
  const sync = useAutoSyncMail();
  const toast = useToast();
  const list = accounts.data ?? [];
  const byId = useMemo(() => new Map(list.map((a) => [a.id, a])), [list]);
  const start = startOfDay(new Date()).getTime();
  const inRange = (key: RangeKey) =>
    (events.data ?? []).filter((e) => new Date(e.ends_at).getTime() > start && new Date(e.starts_at).getTime() <= RANGES[key].end().getTime());
  const shown = inRange(tab);
  const tabs: PageTab[] = (Object.keys(RANGES) as RangeKey[]).map((k) => ({
    key: k, label: RANGES[k].label, to: k === 'today' ? '/calendar' : `/calendar?tab=${k}`, count: inRange(k).length,
  }));
  const refresh = () => sync.mutate(undefined, { onError: (e) => toast(errorMessage(e), 'error') });
  const noAccounts = !accounts.isLoading && !accounts.error && list.length === 0;

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <PageHeader
        title="Calendar"
        description="Read-only merge of your Outlook and Google calendars. Each event shows its calendar and identity."
        tabs={noAccounts ? undefined : tabs}
        activeTab={tab}
        actions={!noAccounts && (
          <Button onClick={refresh} disabled={sync.isPending}><RefreshCw className={cn(sync.isPending && 'animate-spin')} /> Sync</Button>
        )}
      />
      <Panel
        title={RANGES[tab].label}
        icon={<CalendarDays />}
        updatedAt={noAccounts ? undefined : lastSynced(list)}
        onRefresh={noAccounts ? undefined : refresh}
        refreshing={sync.isPending || events.isFetching}
        loading={accounts.isLoading || events.isLoading}
        error={accounts.error ?? events.error}
        empty={noAccounts || shown.length === 0}
        emptyState={noAccounts ? (
          <EmptyState icon={<CalendarDays />} title="No calendars connected" text="Connect Outlook (doug@theonefor.ai) and Google Workspace to see your meetings here."
            action={<Button asChild variant="primary"><Link to="/settings/connections">Set up connections</Link></Button>} />
        ) : (
          <EmptyState icon={<CalendarDays />} title="No meetings" text="Nothing on your connected calendars for this period." />
        )}
      >
        <EventList events={shown} accounts={byId} />
      </Panel>
    </div>
  );
}
