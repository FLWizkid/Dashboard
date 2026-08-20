"use client";

import { CalendarDays, ExternalLink, MapPin, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { useCalendarEvents, useMailAccounts } from "@/lib/mail/client";
import { twoDayRollup } from "@/lib/reports/summary";
import { useTasks } from "@/lib/tasks/client";
import type { CalendarEvent } from "@/lib/mail/types";
import { cn } from "@/lib/utils";

import { useSettings } from "@/components/settings-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * The agenda.
 *
 * ── A list, not a grid ───────────────────────────────────────────────────
 * A week grid is what a calendar application owes you. This is a dashboard,
 * and the question it answers is "what is my day", so it renders the day as a
 * column you read top to bottom. The grid is the thing you already have in
 * Google Calendar and Outlook, and reproducing it worse helps nobody.
 *
 * ── Declined meetings are absent ─────────────────────────────────────────
 * A meeting you declined is not on your day. Showing it makes the agenda a
 * record of invitations rather than of what you are actually doing — and the
 * hours module derives scheduled time from exactly this list, so a declined
 * meeting left in would inflate the week.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function CalendarView() {
  const [offset, setOffset] = useState(0);
  const [mode, setMode] = useState<"day" | "two-day">("day");

  const { from, to, label } = useMemo(() => dayWindow(offset), [offset]);

  const accounts = useMailAccounts();
  const events = useCalendarEvents({ from, to });

  const connected = (accounts.data?.accounts ?? []).filter(
    (account) => account.syncCalendarEnabled,
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg">Calendar</h1>
          <p className="text-sm text-fg-muted">
            {mode === "day" ? label : "Today and tomorrow, with what is due"}
          </p>
        </div>

        <div className="flex items-center gap-1">
          {/* Labelled "Two days" rather than "Next two days" because this
              toolbar also carries a "Next" button: two controls both starting
              with the same word is ambiguous to read and worse to hear
              announced.

              Two views rather than one replacing the other. The single day is
              what you want when working *in* a day; the two-day rollup is
              what you want when deciding whether the next two are survivable,
              and it is the only view that shows deadlines beside meetings. */}
          <Button
            type="button"
            variant={mode === "day" ? "primary" : "ghost"}
            size="sm"
            aria-pressed={mode === "day"}
            onClick={() => setMode("day")}
          >
            Day
          </Button>
          <Button
            type="button"
            variant={mode === "two-day" ? "primary" : "ghost"}
            size="sm"
            aria-pressed={mode === "two-day"}
            onClick={() => setMode("two-day")}
          >
            Two days
          </Button>

          {mode === "day" && (
            <>
              <span aria-hidden className="mx-1 h-4 w-px bg-line" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOffset((n) => n - 1)}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant={offset === 0 ? "primary" : "ghost"}
                size="sm"
                onClick={() => setOffset(0)}
              >
                Today
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOffset((n) => n + 1)}
              >
                Next
              </Button>
            </>
          )}
        </div>
      </header>

      {accounts.isSuccess && connected.length === 0 && (
        <Card
          className="p-4 text-sm text-fg-muted"
          data-testid="calendar-not-connected"
        >
          No calendar is connected. Connect an account from{" "}
          <a className="underline" href="/dashboard/email">
            Email
          </a>
          .
        </Card>
      )}

      {mode === "two-day" ? (
        <TwoDayAgenda />
      ) : events.isPending ? (
        <Card className="p-4 text-sm text-fg-muted" aria-busy>
          Loading…
        </Card>
      ) : (events.data?.events.length ?? 0) === 0 ? (
        <Card
          className="p-6 text-sm text-fg-muted"
          data-testid="calendar-empty"
        >
          <span className="flex items-center gap-2">
            <CalendarDays aria-hidden className="size-4" />
            Nothing scheduled.
          </span>
        </Card>
      ) : (
        <ol role="list" className="space-y-2" data-testid="agenda">
          {events.data!.events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Today and tomorrow, with due and overdue work interleaved.
 *
 * The specified rollup, and until now it existed only inside the reports
 * page — so the calendar, the one place you go to ask what is coming, was
 * the one place that could not tell you what was due. Reuses the report's
 * `twoDayRollup` rather than a second implementation of "what counts as
 * tomorrow".
 */
function TwoDayAgenda() {
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
  const tasks = useTasks("all");

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

function EventRow({ event }: { event: CalendarEvent }) {
  return (
    <li>
      <Card
        className={cn(
          "flex flex-wrap items-start gap-4 p-4",
          event.isCancelled && "opacity-60",
        )}
        data-testid="agenda-event"
      >
        <div className="w-24 shrink-0 text-sm tabular-nums text-fg-muted">
          {event.allDay ? (
            "All day"
          ) : (
            <>
              <time dateTime={event.startsAt}>{clock(event.startsAt)}</time>
              <span className="block text-xs text-fg-subtle">
                {duration(event.startsAt, event.endsAt)}
              </span>
            </>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "text-sm font-medium text-fg",
                event.isCancelled && "line-through",
              )}
            >
              {event.title}
            </span>

            {event.isExternal && <Badge tone="accent">External</Badge>}
            {event.response === "tentative" && (
              <Badge tone="outline">Tentative</Badge>
            )}
            {event.isCancelled && <Badge tone="critical">Cancelled</Badge>}
          </p>

          <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-fg-subtle">
            {event.location && (
              <span className="flex items-center gap-1">
                <MapPin aria-hidden className="size-3" />
                {event.location}
              </span>
            )}
            {event.attendeeCount > 0 && (
              <span className="flex items-center gap-1">
                <Users aria-hidden className="size-3" />
                {event.attendeeCount}
              </span>
            )}
            {event.organizer && (
              <span>{event.organizer.name ?? event.organizer.address}</span>
            )}
          </p>
        </div>

        {event.meetingUrl && (
          <Button asChild size="sm" variant="ghost">
            <a
              href={event.meetingUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Join
              <ExternalLink aria-hidden className="size-3" />
            </a>
          </Button>
        )}
      </Card>
    </li>
  );
}

/**
 * The window for a day, as an absolute range.
 *
 * Computed from local midnight rather than "now minus twelve hours", so the
 * list does not silently shift as the day passes and a meeting at 08:00 is
 * still on today's agenda at 17:00.
 */
function dayWindow(offset: number): {
  from: string;
  to: string;
  label: string;
} {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setTime(start.getTime() + offset * DAY_MS);

  const end = new Date(start.getTime() + DAY_MS);

  return {
    from: start.toISOString(),
    to: end.toISOString(),
    label:
      offset === 0
        ? `Today, ${start.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`
        : start.toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          }),
  };
}

function clock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function duration(startIso: string, endIso: string): string {
  const minutes = Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000,
  );
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} m`;
}
