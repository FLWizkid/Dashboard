"use client";

import Link from "next/link";
import { Timer } from "lucide-react";

import { useSettings } from "@/components/settings-provider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatMinutes,
  HOURS_SOURCE_LABELS,
  type HoursSource,
} from "@/lib/hours/aggregate";
import { useHours } from "@/lib/hours/client";
import { cn } from "@/lib/utils";

/**
 * "Hours this week" on the dashboard.
 *
 * One number, and the three it is made of. The combined figure leads because
 * it is the one that answers "how much have I worked" — the split is there so
 * the answer is inspectable rather than asserted.
 *
 * It reads the same endpoint the hours view does, so the two cannot disagree.
 */
export function HoursThisWeek({ className }: { className?: string }) {
  const { timeZone, ready } = useSettings();
  const hours = useHours({ timeZone, enabled: ready });

  const totals = hours.data?.totals;

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <span className="text-fg-subtle [&_svg]:size-4">
              <Timer />
            </span>
            Hours this week
          </CardTitle>
          <CardDescription className="mt-1">
            Focused, scheduled and manual — the same minute never counted twice.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col justify-between gap-4">
        <div>
          <p
            className="text-3xl font-semibold tabular-nums tracking-tight text-fg"
            data-testid="dashboard-hours-combined"
          >
            {hours.isLoading || !ready
              ? "—"
              : formatMinutes(totals?.combined ?? 0)}
          </p>
          {!hours.isLoading && (totals?.overlap ?? 0) > 0 && (
            <p className="mt-1 text-xs text-fg-subtle">
              {formatMinutes(totals?.overlap ?? 0)} of it overlapped.
            </p>
          )}
        </div>

        <dl className="grid grid-cols-3 gap-2 border-t border-line pt-3">
          {(["focused", "scheduled", "manual"] as HoursSource[]).map(
            (source) => (
              <div key={source}>
                <dt className="text-[0.6875rem] uppercase tracking-wide text-fg-subtle">
                  {HOURS_SOURCE_LABELS[source]}
                </dt>
                <dd className="mt-0.5 text-sm tabular-nums text-fg-muted">
                  {hours.isLoading || !ready
                    ? "—"
                    : formatMinutes(totals?.[source] ?? 0)}
                </dd>
              </div>
            ),
          )}
        </dl>

        <Link
          href="/dashboard/hours"
          className="text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          See the week in full
        </Link>
      </CardContent>
    </Card>
  );
}
