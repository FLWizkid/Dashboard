import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { addDays, endOfDay, startOfDay } from 'date-fns';
import { CalendarDays } from 'lucide-react';
import { lastSynced, useAutoSyncMail, useCalendarEvents, useMailAccounts } from '@/data/mail';
import { Panel, EmptyState } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { EventList } from '@/components/mail/EventList';

export function MeetingsPanel() {
  const accounts = useMailAccounts();
  const events = useCalendarEvents();
  const sync = useAutoSyncMail();
  const list = accounts.data ?? [];
  const byId = useMemo(() => new Map(list.map((a) => [a.id, a])), [list]);
  const from = startOfDay(new Date()).getTime();
  const to = endOfDay(addDays(new Date(), 2)).getTime();
  const shown = (events.data ?? []).filter((e) => new Date(e.ends_at).getTime() > from && new Date(e.starts_at).getTime() <= to);
  const noAccounts = !accounts.isLoading && !accounts.error && list.length === 0;

  return (
    <Panel
      title="Today's meetings and next 2 days"
      icon={<CalendarDays />}
      updatedAt={noAccounts ? undefined : lastSynced(list)}
      onRefresh={noAccounts ? undefined : () => sync.mutate(undefined)}
      refreshing={sync.isPending || events.isFetching}
      loading={accounts.isLoading || events.isLoading}
      error={accounts.error ?? events.error}
      empty={noAccounts || shown.length === 0}
      emptyState={noAccounts ? (
        <EmptyState title="Calendars not connected yet" text="Paste your Outlook calendar link and connect Google in Setup before meetings appear. No Azure needed."
          action={<Button asChild size="sm"><Link to="/setup">Open setup steps</Link></Button>} />
      ) : (
        <EmptyState title="No meetings in the next 3 days" />
      )}
      actions={!noAccounts && <Link to="/calendar" className="text-xs text-primary-700 hover:underline dark:text-primary-400">Open calendar</Link>}
    >
      <EventList events={shown} accounts={byId} compact />
    </Panel>
  );
}
