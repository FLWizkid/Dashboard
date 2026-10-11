"use client";

import { CalendarRange } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { useCalendarEvents } from "@/lib/mail/client";
import { twoDayRollup } from "@/lib/reports/summary";
import { useTasks } from "@/lib/tasks/client";
import { cn } from "@/lib/utils";

import { useSettings } from "@/components/settings-provider";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

/**
 * The next two days, meetings and deadlines together.
 *
 * The dashboard's own copy has promised this since P1 and nothing rendered
 * it — the rollup existed, but only inside the reports page, which is the one
 * place you go deliberately rather than the place you land.
 *
 * `twoDayRollup` is reused rather than reimplemented. A second copy of "what
 * counts as tomorrow" would drift from the report's copy, and the two would
 * disagree in front of the person who trusts both.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function NextTwoDays({ className }: { className?: string }) {
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
  // "open" rather than "all": the rollup discards completed work anyway, and
  // this shares a query key with Top Priorities, so the dashboard asks for the
  // task list once instead of twice.
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

  const pending = events.isPending || tasks.isPending;
  const empty = slots.every(
    (slot) => slot.events.length === 0 && slot.tasks.length === 0,
  );

  return (
    <Card className={cn("p-5", className)} data-testid="next-two-days">
      <header className="flex items-center gap-2">
        <CalendarRange aria-hidden className="size-4 text-fg-muted" />
        <h2 className="text-sm font-semibold text-fg">Next two days</h2>
        <Link
          href="/dashboard/calendar"
          className="ml-auto text-xs text-fg-muted underline-offset-2 hover:underline"
        >
          Calendar
        </Link>
      </header>

      {pending ? (
        <p className="mt-3 text-sm text-fg-muted" aria-busy>
          Loading…
        </p>
      ) : empty ? (
        <p className="mt-3 text-sm text-fg-muted">
          Nothing scheduled and nothing due.
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {slots.map((slot) => (
            <section key={slot.start} className="space-y-1">
              <h3 className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                {slot.label}
              </h3>

              {slot.events.length === 0 && slot.tasks.length === 0 ? (
                <p className="text-sm text-fg-muted">Clear.</p>
              ) : (
                <ol role="list" className="space-y-1">
                  {slot.events.map((event) => (
                    <li
                      key={event.id}
                      className="flex items-baseline gap-3 text-sm"
                    >
                      <time
                        className="w-16 shrink-0 tabular-nums text-fg-muted"
                        dateTime={event.startsAt}
                      >
                        {new Date(event.startsAt).toLocaleTimeString(
                          undefined,
                          { hour: "numeric", minute: "2-digit" },
                        )}
                      </time>
                      <span className="min-w-0 flex-1 truncate text-fg">
                        {event.title}
                      </span>
                    </li>
                  ))}

                  {slot.tasks.map((task) => {
                    // Overdue work is folded into the first day by the rollup
                    // itself. Marking it is what stops it reading as simply
                    // "due today", which would quietly excuse being late.
                    const overdue =
                      task.dueAt !== null &&
                      Date.parse(task.dueAt) < Date.parse(slot.start);

                    return (
                      <li
                        key={task.id}
                        className="flex items-baseline gap-3 text-sm"
                      >
                        <span className="w-16 shrink-0 text-fg-muted">Due</span>
                        <span className="min-w-0 flex-1 truncate text-fg">
                          {task.title}
                        </span>
                        {overdue && <Badge tone="critical">Overdue</Badge>}
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
