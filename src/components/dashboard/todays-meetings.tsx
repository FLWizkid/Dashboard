"use client";

import { CalendarDays, Mail } from "lucide-react";
import { useMemo, useState } from "react";
import Link from "next/link";

import { useCalendarEvents, useThreads } from "@/lib/mail/client";
import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

/**
 * Today's meetings, and what is waiting on you.
 *
 * Two cards that used to be placeholders. Both are deliberately *short*: the
 * dashboard's job is to tell you whether you need to go somewhere else, not to
 * be the somewhere else. Three meetings and three senders is enough to answer
 * "is there anything I have to deal with", and the module pages hold the rest.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function TodaysMeetings({ className }: { className?: string }) {
  const window = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return {
      from: start.toISOString(),
      to: new Date(start.getTime() + DAY_MS).toISOString(),
    };
  }, []);

  const events = useCalendarEvents(window);
  const list = (events.data?.events ?? []).slice(0, 4);

  return (
    <Card className={cn("p-5", className)} data-testid="todays-meetings">
      <header className="flex items-center gap-2">
        <CalendarDays aria-hidden className="size-4 text-fg-muted" />
        <h2 className="text-sm font-semibold text-fg">
          Today&rsquo;s meetings
        </h2>
        <Link
          href="/dashboard/calendar"
          className="ml-auto text-xs text-fg-muted underline-offset-2 hover:underline"
        >
          Calendar
        </Link>
      </header>

      {events.isPending ? (
        <p className="mt-3 text-sm text-fg-muted" aria-busy>
          Loading…
        </p>
      ) : list.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">Nothing scheduled.</p>
      ) : (
        <ol role="list" className="mt-3 space-y-2">
          {list.map((event) => (
            <li key={event.id} className="flex items-baseline gap-3 text-sm">
              <time
                className="w-16 shrink-0 tabular-nums text-fg-muted"
                dateTime={event.startsAt}
              >
                {event.allDay
                  ? "All day"
                  : new Date(event.startsAt).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
              </time>
              <span className="min-w-0 flex-1 truncate text-fg">
                {event.title}
              </span>
              {event.isExternal && <Badge tone="accent">External</Badge>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/**
 * Mail that is actually waiting on you.
 *
 * **Unread from a sender you rated `critical` or `high`** — not "unread",
 * which on any real mailbox is a number in the hundreds and tells you nothing.
 * The rating is the owner's own judgement, so this card can only ever be as
 * noisy as they made it.
 *
 * Shows a **count** and the top three, expandable. The count is what makes it
 * a dashboard card rather than a short inbox: "four waiting" is something you
 * can act on without reading any of them.
 */

/** Shown before expanding. Three is the specified preview size. */
const ATTENTION_PREVIEW = 3;

export function NeedsAttention({ className }: { className?: string }) {
  const threads = useThreads({
    unreadOnly: true,
    minImportance: "high",
    limit: 25,
  });

  const [expanded, setExpanded] = useState(false);

  // Critical first, then High. The count is of everything waiting; the
  // preview is the top three. Showing five with no total was the worst of
  // both — too long to scan, and still silent about how much it was hiding.
  const all = useMemo(() => {
    const threadList = threads.data?.threads ?? [];
    return [...threadList].sort((a, b) => {
      const rank = (importance: string | null) =>
        importance === "critical" ? 0 : 1;
      return rank(a.senderImportance) - rank(b.senderImportance);
    });
  }, [threads.data?.threads]);

  const list = expanded ? all : all.slice(0, ATTENTION_PREVIEW);
  const hidden = all.length - list.length;

  return (
    <Card className={cn("p-5", className)} data-testid="needs-attention">
      <header className="flex items-center gap-2">
        <Mail aria-hidden className="size-4 text-fg-muted" />
        <h2 className="text-sm font-semibold text-fg">Needs attention</h2>
        {all.length > 0 && (
          // The count is the point of the card: "four things" is a decision
          // you can make from the dashboard, a list of names is not.
          <Badge
            tone={all[0].senderImportance === "critical" ? "critical" : "high"}
          >
            {all.length}
          </Badge>
        )}
        <Link
          href="/dashboard/email"
          className="ml-auto text-xs text-fg-muted underline-offset-2 hover:underline"
        >
          Email
        </Link>
      </header>

      {threads.isPending ? (
        <p className="mt-3 text-sm text-fg-muted" aria-busy>
          Loading…
        </p>
      ) : list.length === 0 ? (
        // Not "inbox zero" — this card is about important senders only, and
        // claiming an empty inbox when forty newsletters are unread would be
        // a lie the owner would catch within a day.
        <p className="mt-3 text-sm text-fg-muted">
          Nothing unread from anyone you rated important.
        </p>
      ) : (
        <ol role="list" className="mt-3 space-y-2">
          {list.map((thread) => (
            <li key={thread.id} className="text-sm">
              <Link
                href="/dashboard/email"
                className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium text-fg">
                    {thread.from.name ?? thread.from.address}
                  </span>
                  <Badge
                    tone={
                      thread.senderImportance === "critical"
                        ? "critical"
                        : "high"
                    }
                  >
                    {thread.senderImportance === "critical"
                      ? "Critical"
                      : "High"}
                  </Badge>
                </span>
                <span className="block truncate text-fg-muted">
                  {thread.subject ?? "(no subject)"}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}

      {(hidden > 0 || expanded) && (
        <button
          type="button"
          className="mt-3 rounded-sm text-xs text-fg-muted underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "Show less" : `Show ${hidden} more`}
        </button>
      )}
    </Card>
  );
}
