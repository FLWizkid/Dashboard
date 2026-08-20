"use client";

import { m, useReducedMotion } from "framer-motion";
import { CalendarDays, Info, PencilLine, Timer } from "lucide-react";
import * as React from "react";

import { ManualEntryForm } from "@/components/hours/manual-entry-form";
import { OutboxBanner } from "@/components/hours/outbox-banner";
import { RuleEditor } from "@/components/hours/rule-editor";
import { ScheduledList } from "@/components/hours/scheduled-list";
import { useSettings } from "@/components/settings-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatMinutes,
  HOURS_SOURCE_DESCRIPTIONS,
  HOURS_SOURCE_LABELS,
  type Bucket,
  type HoursSource,
  type HoursTotals,
} from "@/lib/hours/aggregate";
import { useHours } from "@/lib/hours/client";
import { pick } from "@/lib/motion";
import { addZonedDays, startOfZonedWeek } from "@/lib/time/zone";

/**
 * The hours module.
 *
 * The layout follows the one decision this module actually had to make: the
 * three sources are shown **separately** and the combined total is shown
 * **once**, with the overlap stated rather than hidden. See `docs/hours.md`.
 */
export function HoursView() {
  const { timeZone, ready } = useSettings();
  const [weekOffset, setWeekOffset] = React.useState(0);
  const reduced = useReducedMotion();

  const window_ = React.useMemo(() => {
    if (!ready) return null;
    const base = startOfZonedWeek(new Date(), timeZone);
    const from = addZonedDays(base, timeZone, weekOffset * 7);
    const to = addZonedDays(from, timeZone, 7);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [ready, timeZone, weekOffset]);

  const hours = useHours({
    from: window_?.from,
    to: window_?.to,
    timeZone,
    enabled: ready && window_ !== null,
  });

  const totals = hours.data?.totals;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-fg">
            Hours
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            Focused, scheduled and manual time — kept apart, and added together
            without counting the same minute twice.
          </p>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setWeekOffset((value) => value - 1)}
          >
            Previous
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setWeekOffset(0)}
            disabled={weekOffset === 0}
          >
            This week
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setWeekOffset((value) => value + 1)}
            disabled={weekOffset >= 0}
          >
            Next
          </Button>
        </div>
      </header>

      <OutboxBanner />

      {hours.isError && (
        <p
          role="alert"
          className="rounded-md bg-priority-critical-soft px-3 py-2 text-sm text-priority-critical"
        >
          {hours.error instanceof Error
            ? hours.error.message
            : "Couldn't load your hours."}
        </p>
      )}

      <Totals totals={totals} loading={hours.isLoading} reduced={reduced} />

      <DayBars days={hours.data?.days ?? []} loading={hours.isLoading} />

      <div className="grid gap-4 lg:grid-cols-2">
        <ManualEntryForm />
        <ScheduledList
          blocks={hours.data?.blocks ?? []}
          loading={hours.isLoading}
        />
      </div>

      <RuleEditor />
    </div>
  );
}

/* ── Totals ───────────────────────────────────────────────────────────── */

const SOURCE_ICONS: Record<HoursSource, React.ReactNode> = {
  focused: <Timer />,
  scheduled: <CalendarDays />,
  manual: <PencilLine />,
};

function Totals({
  totals,
  loading,
  reduced,
}: {
  totals: HoursTotals | undefined;
  loading: boolean;
  reduced: boolean | null;
}) {
  return (
    <section aria-labelledby="hours-totals">
      <h2 id="hours-totals" className="sr-only">
        Totals for the week
      </h2>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(["focused", "scheduled", "manual"] as const).map((source) => (
          <Card key={source}>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2">
                  <span className="text-fg-subtle [&_svg]:size-4">
                    {SOURCE_ICONS[source]}
                  </span>
                  {HOURS_SOURCE_LABELS[source]}
                </CardTitle>
                <CardDescription className="mt-1">
                  {HOURS_SOURCE_DESCRIPTIONS[source]}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <p
                className="text-2xl font-semibold tabular-nums tracking-tight text-fg"
                data-testid={`hours-${source}`}
              >
                {loading ? "—" : formatMinutes(totals?.[source] ?? 0)}
              </p>
            </CardContent>
          </Card>
        ))}

        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={pick(reduced)}
        >
          <Card className="border-primary/40 bg-primary-soft">
            <CardHeader>
              <div className="min-w-0">
                <CardTitle className="text-primary-soft-fg">Combined</CardTitle>
                {/*
                  Full opacity, not /80. At 80% over `bg-primary-soft` this
                  sits under the AA threshold — and because the card fades in,
                  axe could catch it part-way through the transition and fail
                  intermittently. Hierarchy comes from size and weight here.
                */}
                <CardDescription className="mt-1 text-primary-soft-fg">
                  Every minute counted once.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <p
                className="text-2xl font-semibold tabular-nums tracking-tight text-primary-soft-fg"
                data-testid="hours-combined"
              >
                {loading ? "—" : formatMinutes(totals?.combined ?? 0)}
              </p>

              {/* The overlap is stated, never hidden. Without it the combined
                  total looks like an arithmetic bug to anyone who adds the
                  three cards above it. */}
              {!loading && (totals?.overlap ?? 0) > 0 && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-primary-soft-fg/90">
                  <span className="mt-0.5 shrink-0 [&_svg]:size-3" aria-hidden>
                    <Info />
                  </span>
                  <span>
                    {formatMinutes(totals?.overlap ?? 0)} overlapped — focused
                    time during a meeting counts once, not twice.
                  </span>
                </p>
              )}
            </CardContent>
          </Card>
        </m.div>
      </div>
    </section>
  );
}

/* ── Daily breakdown ──────────────────────────────────────────────────── */

function DayBars({ days, loading }: { days: Bucket[]; loading: boolean }) {
  const peak = Math.max(1, ...days.map((day) => day.totals.combined));

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Across the week</CardTitle>
          <CardDescription className="mt-1">
            Combined hours per day. A block that crosses midnight is split
            between the two days it actually occupied.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : (
          <ul className="space-y-2">
            {days.map((day) => (
              <li key={day.start} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-xs text-fg-muted">
                  {day.label}
                </span>
                <span
                  className="h-3 min-w-px flex-1 overflow-hidden rounded-full bg-surface-muted"
                  aria-hidden="true"
                >
                  <span
                    className="block h-full rounded-full bg-primary transition-[width] duration-base ease-standard"
                    style={{
                      width: `${(day.totals.combined / peak) * 100}%`,
                    }}
                  />
                </span>
                <span className="w-16 shrink-0 text-right tabular-nums text-fg-muted">
                  {formatMinutes(day.totals.combined)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
