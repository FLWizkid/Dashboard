import { format, isSameDay, isToday, isTomorrow } from 'date-fns';
import { ExternalLink, MapPin } from 'lucide-react';
import { type CalendarEvent, type MailAccount } from '@/lib/types';
import { cn, safeHref } from '@/lib/utils';
import { StatusPill } from '@/components/ui/badge';
import { SourceBadge } from './SourceBadge';

function dayLabel(d: Date) {
  if (isToday(d)) return `Today · ${format(d, 'EEE MMM d')}`;
  if (isTomorrow(d)) return `Tomorrow · ${format(d, 'EEE MMM d')}`;
  return format(d, 'EEEE, MMM d');
}

function overlapping(events: CalendarEvent[]) {
  const ids = new Set<string>();
  const timed = events.filter((e) => !e.all_day);
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i], b = timed[j];
      const [s1, e1, s2, e2] = [a.starts_at, a.ends_at, b.starts_at, b.ends_at].map((t) => new Date(t).getTime());
      if (s1 < e2 && s2 < e1) { ids.add(a.id); ids.add(b.id); }
    }
  }
  return ids;
}

export function groupByDay(events: CalendarEvent[]) {
  const days: { day: Date; events: CalendarEvent[] }[] = [];
  for (const e of events) {
    const d = e.all_day ? new Date(`${e.starts_at.slice(0, 10)}T00:00:00`) : new Date(e.starts_at);
    const last = days[days.length - 1];
    if (last && isSameDay(last.day, d)) last.events.push(e);
    else days.push({ day: d, events: [e] });
  }
  return days;
}

export function EventList({ events, accounts, compact }: { events: CalendarEvent[]; accounts: Map<string, MailAccount>; compact?: boolean }) {
  const days = groupByDay(events);
  return (
    <div className="space-y-4">
      {days.map(({ day, events: list }) => {
        const clash = overlapping(list);
        return (
          <section key={day.toDateString()}>
            <h3 className="label">{dayLabel(day)}</h3>
            <ul className="space-y-1">
              {list.map((e) => {
                const account = accounts.get(e.account_id);
                const href = safeHref(e.web_link);
                const past = new Date(e.ends_at).getTime() < Date.now();
                return (
                  <li key={e.id} className={cn('flex gap-3 rounded-md px-2 py-2 transition-colors hover:bg-raised', past && 'opacity-60')}>
                    <span className="w-24 shrink-0 text-sm tabular-nums text-muted">
                      {e.all_day ? 'All day' : `${format(new Date(e.starts_at), 'h:mm a')}`}
                      {!e.all_day && !compact && <span className="block text-xs text-subtle">to {format(new Date(e.ends_at), 'h:mm a')}</span>}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer" title="Open meeting"
                            className="min-w-0 truncate text-sm font-medium text-primary-700 underline-offset-2 transition-colors hover:underline dark:text-primary-400">
                            {e.title || '(no title)'}
                          </a>
                        ) : (
                          <p className="min-w-0 truncate text-sm font-medium">{e.title || '(no title)'}</p>
                        )}
                        {clash.has(e.id) && <StatusPill status="attention" label="Overlaps" />}
                      </div>
                      {!compact && (e.location || e.organizer) && (
                        <p className="flex items-center gap-1 truncate text-xs text-subtle">
                          {e.location && <><MapPin className="size-3" /> {e.location}</>}
                          {e.location && e.organizer && ' · '}
                          {e.organizer && `Organizer: ${e.organizer}`}
                        </p>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <SourceBadge account={account} compact={compact} />
                        {href && account && !compact && (
                          <a href={href} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary-700 hover:underline dark:text-primary-400">
                            <ExternalLink className="size-3" /> {account.provider === 'google' ? 'Open in Google Calendar' : account.provider === 'microsoft' ? 'Open in Outlook' : 'Open meeting link'}
                          </a>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
