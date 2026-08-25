"use client";

import { useMemo } from "react";

import { useCalendarEvents } from "@/lib/mail/client";
import { twoDayRollup } from "@/lib/reports/summary";
import { useTasks } from "@/lib/tasks/client";

import { useSettings } from "@/components/settings-provider";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Today and tomorrow, with due and overdue work interleaved.
 *
 * The specified rollup, and until now it existed only inside the reports
 * page — so the calendar, the one place you go to ask what is coming, was
 * the one place that could not tell you what was due. Reuses the report's
 * `twoDayRollup` rather than a second implementation of "what counts as
 * tomorrow".
 */
export function TwoDayAgendaView() {
  const { timeZone } = useSettings();

  const window = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return {
      from: start.toISOString(),
      to: new Date(start.getTime() + 2 * DAY_MS).toISOString(),
    };
  }, []);

  const events = useCalendarEvents(window);
  // The rollup discards completed work itself, so the open list is enough —
  // and it is the list the rest of the app already holds.
  const tasks = useTasks("open");

  const slots = useMemo(
    () =>
      twoDayRollup({
        tasks: tasks.data ?? [],
        events: (events.data?.events ?? []).map((event) => ({
          id: event.id,
          title: event.title,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          isCancelled: event.isCancelled,
        })),
        now: new Date(),
        timeZone,
      }),
    [tasks.data, events.data?.events, timeZone],
  );

  if (events.isPending || tasks.isPending) {
    return (
      <Card className="p-4 text-sm text-fg-muted" aria-busy>
        Loading…
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="two-day-agenda">
      {slots.map((slot) => (
        <Card key={slot.start} className="p-4">
          <h2 className="text-sm font-semibold text-fg">{slot.label}</h2>

          {slot.events.length === 0 && slot.tasks.length === 0 ? (
            <p className="mt-2 text-sm text-fg-muted">
              Nothing scheduled and nothing due.
            </p>
          ) : (
            <ol role="list" className="mt-2 space-y-2">
              {slot.events.map((event) => (
                <li
                  key={event.id}
                  className="flex items-baseline gap-3 text-sm"
                  data-testid="two-day-event"
                >
                  <time
                    className="w-20 shrink-0 tabular-nums text-fg-muted"
                    dateTime={event.startsAt}
                  >
                    {new Date(event.startsAt).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                  <span className="min-w-0 flex-1 text-fg">{event.title}</span>
                </li>
              ))}

              {slot.tasks.map((task) => {
                const overdue =
                  task.dueAt !== null &&
                  Date.parse(task.dueAt) < Date.parse(slot.start);

                return (
                  <li
                    key={task.id}
                    className="flex items-baseline gap-3 text-sm"
                    data-testid="two-day-task"
                  >
                    <span className="w-20 shrink-0 text-fg-muted">Due</span>
                    <span className="min-w-0 flex-1 text-fg">{task.title}</span>
                    {overdue && <Badge tone="critical">Overdue</Badge>}
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      ))}
    </div>
  );
}
