/**
 * Hours rollups.
 *
 * Three kinds of hours, kept apart and also added together:
 *
 *   **focused**    completed Pomodoro time
 *   **scheduled**  work-category calendar blocks, derived from the calendar
 *                  rather than copied into a ledger, so a moved or cancelled
 *                  meeting is never silently still counted
 *   **manual**     what the owner typed, always labelled as such
 *
 * ── The one genuinely contentious decision ───────────────────────────────
 * A Pomodoro run during a meeting is one hour of your life, not two. The
 * per-source totals are **plain sums** — that is what "shown separately"
 * means, and you want to see that you did 90 minutes of focused work even if
 * some of it overlapped a call. The **combined total is the union of the
 * intervals**, so the same wall-clock minute is counted once.
 *
 * The alternative — adding the three together — produces weeks with 63 hours
 * in them, and a number nobody believes is a number nobody uses.
 */

import {
  addZonedDays,
  addZonedMonths,
  endOfZonedMonth,
  startOfZonedDay,
  startOfZonedWeek,
} from "@/lib/time/zone";

export const HOURS_SOURCES = ["focused", "scheduled", "manual"] as const;
export type HoursSource = (typeof HOURS_SOURCES)[number];

export const HOURS_SOURCE_LABELS: Record<HoursSource, string> = {
  focused: "Focused",
  scheduled: "Scheduled",
  manual: "Manual",
};

export const HOURS_SOURCE_DESCRIPTIONS: Record<HoursSource, string> = {
  focused: "Pomodoro sessions you completed.",
  scheduled: "Work-category blocks from your calendar.",
  manual: "Time you entered by hand.",
};

/** One contiguous span of time from one source. */
export interface HoursInterval {
  source: HoursSource;
  startedAt: string;
  endedAt: string;
  categoryId?: string | null;
  taskId?: string | null;
  /** For scheduled spans, the event it came from. */
  eventId?: string | null;
  label?: string | null;
}

export interface SourceTotals {
  focused: number;
  scheduled: number;
  manual: number;
}

export interface HoursTotals extends SourceTotals {
  /**
   * The union of every interval, in minutes. Not the sum of the three above —
   * see the note at the top of this file.
   */
  combined: number;
  /** The sum of the three, for when you want to see the overlap. */
  summed: number;
  /** How many minutes were counted twice; `summed - combined`. */
  overlap: number;
}

export interface Bucket {
  /** ISO instant the bucket starts at. */
  start: string;
  /** Exclusive. */
  end: string;
  /** "Mon 11 Aug", "August 2026". */
  label: string;
  totals: HoursTotals;
}

/* ── Intervals ────────────────────────────────────────────────────────── */

/** Minutes in an interval, never negative. */
export function intervalMinutes(interval: HoursInterval): number {
  const start = Date.parse(interval.startedAt);
  const end = Date.parse(interval.endedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 60_000));
}

/**
 * Merges overlapping and touching spans.
 *
 * Exported because it is the interesting part of the combined total, and
 * worth testing on its own.
 */
export function mergeIntervals(
  intervals: { startedAt: string; endedAt: string }[],
): { start: number; end: number }[] {
  const spans = intervals
    .map((interval) => ({
      start: Date.parse(interval.startedAt),
      end: Date.parse(interval.endedAt),
    }))
    .filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];

  for (const span of spans) {
    const last = merged[merged.length - 1];
    // `>=` rather than `>`: two back-to-back Pomodoros are one continuous
    // stretch of work, not two spans with an instant between them.
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }

  return merged;
}

function unionMinutes(intervals: HoursInterval[]): number {
  return Math.round(
    mergeIntervals(intervals).reduce(
      (total, span) => total + (span.end - span.start),
      0,
    ) / 60_000,
  );
}

/** Totals for a set of intervals, by source and combined. */
export function totalsFor(intervals: HoursInterval[]): HoursTotals {
  const bySource: SourceTotals = { focused: 0, scheduled: 0, manual: 0 };

  for (const interval of intervals) {
    bySource[interval.source] += intervalMinutes(interval);
  }

  const summed = bySource.focused + bySource.scheduled + bySource.manual;
  const combined = unionMinutes(intervals);

  return {
    ...bySource,
    combined,
    summed,
    // Can't be negative; guard against rounding making it look so.
    overlap: Math.max(0, summed - combined),
  };
}

/* ── Windows ──────────────────────────────────────────────────────────── */

/** Intervals overlapping `[start, end)`, clipped to it. */
export function clipToWindow(
  intervals: HoursInterval[],
  start: Date,
  end: Date,
): HoursInterval[] {
  const from = start.getTime();
  const to = end.getTime();

  const clipped: HoursInterval[] = [];

  for (const interval of intervals) {
    const s = Date.parse(interval.startedAt);
    const e = Date.parse(interval.endedAt);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;

    // A meeting that straddles midnight on Sunday belongs partly to each
    // week. Clipping rather than assigning it whole to one side is what makes
    // the weekly totals add up to the monthly one.
    const overlapStart = Math.max(s, from);
    const overlapEnd = Math.min(e, to);
    if (overlapEnd <= overlapStart) continue;

    clipped.push({
      ...interval,
      startedAt: new Date(overlapStart).toISOString(),
      endedAt: new Date(overlapEnd).toISOString(),
    });
  }

  return clipped;
}

export interface RollupOptions {
  intervals: HoursInterval[];
  timeZone: string;
  /** "Now", for deciding which week or month is the current one. */
  now: Date;
}

/** The current week's totals, Monday to Monday in the owner's zone. */
export function weekToDate(options: RollupOptions): HoursTotals {
  const start = startOfZonedWeek(options.now, options.timeZone);
  const end = addZonedDays(start, options.timeZone, 7);
  return totalsFor(clipToWindow(options.intervals, start, end));
}

/** Daily buckets across the current week. */
export function weeklyBreakdown(options: RollupOptions): Bucket[] {
  const weekStart = startOfZonedWeek(options.now, options.timeZone);
  const buckets: Bucket[] = [];

  for (let day = 0; day < 7; day += 1) {
    const start = addZonedDays(weekStart, options.timeZone, day);
    const end = addZonedDays(weekStart, options.timeZone, day + 1);

    buckets.push({
      start: start.toISOString(),
      end: end.toISOString(),
      label: dayLabel(start, options.timeZone),
      totals: totalsFor(clipToWindow(options.intervals, start, end)),
    });
  }

  return buckets;
}

/** Weekly buckets across the last `months` months, newest last. */
export function monthlyBreakdown(
  options: RollupOptions & { months?: number },
): Bucket[] {
  const months = options.months ?? 6;
  const buckets: Bucket[] = [];

  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const anchor = addZonedMonths(options.now, options.timeZone, -offset);
    const start = startOfZonedDay(
      addZonedDays(
        anchor,
        options.timeZone,
        -(monthDay(anchor, options.timeZone) - 1),
      ),
      options.timeZone,
    );
    const end = endOfZonedMonth(anchor, options.timeZone);

    buckets.push({
      start: start.toISOString(),
      end: end.toISOString(),
      label: monthLabel(anchor, options.timeZone),
      totals: totalsFor(clipToWindow(options.intervals, start, end)),
    });
  }

  return buckets;
}

function monthDay(instant: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone, day: "numeric" }).format(
      instant,
    ),
  );
}

function dayLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(instant);
}

function monthLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    month: "long",
    year: "numeric",
  }).format(instant);
}

/* ── Formatting ───────────────────────────────────────────────────────── */

/**
 * "6h 30m". Hours and minutes rather than a decimal, because "6.5 hours" is a
 * timesheet and "6h 30m" is a day.
 */
export function formatMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;

  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** Decimal hours, for anywhere a number is genuinely wanted. */
export function toHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}
