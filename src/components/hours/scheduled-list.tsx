"use client";

import { CalendarDays } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatMinutes } from "@/lib/hours/aggregate";
import { CLASSIFICATION_SOURCE_LABELS } from "@/lib/hours/classify";
import { useOverrideEvent } from "@/lib/hours/client";
import type { ScheduledBlock } from "@/lib/hours/types";

/**
 * Scheduled time, and why each block is or isn't counted.
 *
 * The reason line is the point of this list. A meeting silently contributing
 * ninety minutes to your week — or silently not — is the thing that makes
 * people stop believing the total, so every row says what decided it and
 * offers the override right there.
 *
 * The toggle is tri-state, matching the column: inherit, always count, never
 * count. "Inherit" is not the same as "count" — it means whatever the rules
 * conclude next week is what applies, which is usually what you want.
 */
export function ScheduledList({
  blocks,
  loading,
}: {
  blocks: ScheduledBlock[];
  loading: boolean;
}) {
  const override = useOverrideEvent();

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <span className="text-fg-subtle [&_svg]:size-4">
              <CalendarDays />
            </span>
            Scheduled blocks
          </CardTitle>
          <CardDescription className="mt-1">
            Read from your calendar every time this page loads — never copied
            into a ledger, so a cancelled meeting stops counting the moment it
            is cancelled.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : blocks.length === 0 ? (
          <p className="text-sm text-fg-muted">
            Nothing scheduled in this week, or no calendar is connected yet.
          </p>
        ) : (
          <ul className="divide-y divide-line" data-testid="scheduled-list">
            {blocks.map((block) => (
              <li key={block.eventId} className="space-y-1.5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span
                      className={
                        block.countsTowardHours
                          ? "block truncate text-sm text-fg"
                          : "block truncate text-sm text-fg-subtle"
                      }
                    >
                      {block.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-fg-subtle">
                      {block.calendarName} ·{" "}
                      {CLASSIFICATION_SOURCE_LABELS[block.categorySource]}
                    </span>
                  </span>

                  <span className="shrink-0 text-right">
                    <span
                      className={
                        block.countsTowardHours
                          ? "block text-sm tabular-nums text-fg"
                          : "block text-sm tabular-nums text-fg-subtle line-through"
                      }
                    >
                      {formatMinutes(
                        Math.round(
                          (Date.parse(block.endsAt) -
                            Date.parse(block.startsAt)) /
                            60_000,
                        ),
                      )}
                    </span>
                  </span>
                </div>

                {block.categoryReason && (
                  <p className="text-xs text-fg-muted">
                    {block.categoryReason}
                  </p>
                )}

                <div
                  className="flex flex-wrap items-center gap-1"
                  role="group"
                  aria-label={`Count “${block.title}” toward hours`}
                >
                  {(
                    [
                      { value: null, label: "Follow the rules" },
                      { value: true, label: "Always count" },
                      { value: false, label: "Never count" },
                    ] as const
                  ).map((option) => (
                    <Button
                      key={String(option.value)}
                      size="sm"
                      variant={
                        block.hoursInclude === option.value
                          ? "primary"
                          : "ghost"
                      }
                      aria-pressed={block.hoursInclude === option.value}
                      disabled={override.isPending}
                      onClick={() =>
                        void override.mutateAsync({
                          eventId: block.eventId,
                          patch: { hoursInclude: option.value },
                        })
                      }
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
