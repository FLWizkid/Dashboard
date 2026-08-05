"use client";

import { AlertCircle, CalendarClock, CircleDashed, Pin } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { useSettings } from "@/components/settings-provider";
import { describeMissingReadyFields } from "@/lib/tasks/ready";
import {
  PRIORITY_LABELS,
  type Task,
  type TaskPriority,
} from "@/lib/tasks/types";
import { formatDueDate, toDateTimeAttribute } from "@/lib/time/format";
import { cn } from "@/lib/utils";

const PRIORITY_TONE: Record<
  TaskPriority,
  "critical" | "high" | "normal" | "low"
> = {
  critical: "critical",
  high: "high",
  normal: "normal",
  low: "low",
};

export function PriorityBadge({ priority }: { priority: TaskPriority | null }) {
  if (!priority) {
    return (
      <Badge tone="outline">
        <CircleDashed aria-hidden="true" />
        Untriaged
      </Badge>
    );
  }

  return (
    <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABELS[priority]}</Badge>
  );
}

/**
 * The "not Ready yet" badge. It names what is missing rather than just
 * flagging a state, because the fix is one click away either way.
 */
export function ReadyBadge({ task }: { task: Task }) {
  const missing = describeMissingReadyFields(task);
  if (!missing) return null;

  return (
    <Badge tone="outline" className="border-dashed">
      <AlertCircle aria-hidden="true" />
      {missing}
    </Badge>
  );
}

/**
 * Due date, rendered client-side only.
 *
 * The owner's timezone isn't known until the browser resolves it, so a
 * server-rendered date would be wrong for one paint and then correct — a
 * visible flicker on every row. Rendering `null` until settings are ready
 * avoids it; the `<time>` element still carries the machine-readable instant.
 */
export function DueDate({
  dueAt,
  overdue,
  className,
}: {
  dueAt: string;
  overdue: boolean;
  className?: string;
}) {
  const { timeZone, ready } = useSettings();
  const [now, setNow] = React.useState<Date | null>(null);

  React.useEffect(() => {
    setNow(new Date());
    // Re-read on the minute so "Today, 4:59 PM" doesn't sit there once it's
    // gone past. A minute is plenty for a due-date label.
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (!ready || !now) {
    return (
      <time
        dateTime={toDateTimeAttribute(dueAt)}
        className={cn("text-xs text-fg-subtle", className)}
        suppressHydrationWarning
      />
    );
  }

  return (
    <time
      dateTime={toDateTimeAttribute(dueAt)}
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        overdue ? "font-medium text-priority-critical" : "text-fg-muted",
        className,
      )}
    >
      <CalendarClock aria-hidden="true" className="size-3" />
      {overdue ? <span className="sr-only">Overdue: </span> : null}
      {formatDueDate(dueAt, now, timeZone)}
    </time>
  );
}

export function PinIndicator({ pinned }: { pinned: boolean }) {
  if (!pinned) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-accent">
      <Pin aria-hidden="true" className="size-3" />
      <span className="sr-only">Pinned</span>
    </span>
  );
}
