import { describe, expect, it } from "vitest";

import {
  classifyEvent,
  type CategoryRule,
  type ClassifiableCalendar,
  type ClassifiableEvent,
} from "./classify";
import {
  clipToWindow,
  formatMinutes,
  intervalMinutes,
  mergeIntervals,
  monthlyBreakdown,
  toHours,
  totalsFor,
  weekToDate,
  weeklyBreakdown,
  type HoursInterval,
} from "./aggregate";

const ZONE = "America/New_York";
/** Wednesday 12 August 2026, 10:00 New York. */
const NOW = new Date("2026-08-12T14:00:00.000Z");

const span = (
  source: HoursInterval["source"],
  startedAt: string,
  endedAt: string,
): HoursInterval => ({ source, startedAt, endedAt });

/* ── Intervals ────────────────────────────────────────────────────────── */

describe("intervalMinutes", () => {
  it("measures a span", () => {
    expect(
      intervalMinutes(
        span("focused", "2026-08-12T14:00:00Z", "2026-08-12T14:25:00Z"),
      ),
    ).toBe(25);
  });

  it("is never negative", () => {
    expect(
      intervalMinutes(
        span("manual", "2026-08-12T15:00:00Z", "2026-08-12T14:00:00Z"),
      ),
    ).toBe(0);
  });

  it("returns zero for an unparseable instant", () => {
    expect(intervalMinutes(span("manual", "not a date", "also not"))).toBe(0);
  });
});

describe("mergeIntervals", () => {
  it("leaves disjoint spans alone", () => {
    expect(
      mergeIntervals([
        { startedAt: "2026-08-12T09:00:00Z", endedAt: "2026-08-12T10:00:00Z" },
        { startedAt: "2026-08-12T11:00:00Z", endedAt: "2026-08-12T12:00:00Z" },
      ]),
    ).toHaveLength(2);
  });

  it("merges overlapping spans", () => {
    const merged = mergeIntervals([
      { startedAt: "2026-08-12T09:00:00Z", endedAt: "2026-08-12T10:30:00Z" },
      { startedAt: "2026-08-12T10:00:00Z", endedAt: "2026-08-12T11:00:00Z" },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].end - merged[0].start).toBe(2 * 3_600_000);
  });

  it("joins spans that merely touch", () => {
    // Two back-to-back Pomodoros are one continuous stretch of work.
    expect(
      mergeIntervals([
        { startedAt: "2026-08-12T09:00:00Z", endedAt: "2026-08-12T09:25:00Z" },
        { startedAt: "2026-08-12T09:25:00Z", endedAt: "2026-08-12T09:50:00Z" },
      ]),
    ).toHaveLength(1);
  });

  it("handles a span wholly inside another", () => {
    const merged = mergeIntervals([
      { startedAt: "2026-08-12T09:00:00Z", endedAt: "2026-08-12T12:00:00Z" },
      { startedAt: "2026-08-12T10:00:00Z", endedAt: "2026-08-12T10:30:00Z" },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].end - merged[0].start).toBe(3 * 3_600_000);
  });

  it("drops zero-length and invalid spans", () => {
    expect(
      mergeIntervals([
        { startedAt: "2026-08-12T09:00:00Z", endedAt: "2026-08-12T09:00:00Z" },
        { startedAt: "nonsense", endedAt: "2026-08-12T10:00:00Z" },
      ]),
    ).toEqual([]);
  });

  it("does not care what order it is given", () => {
    const a = mergeIntervals([
      { startedAt: "2026-08-12T11:00:00Z", endedAt: "2026-08-12T12:00:00Z" },
      { startedAt: "2026-08-12T09:00:00Z", endedAt: "2026-08-12T10:00:00Z" },
    ]);
    expect(a[0].start).toBeLessThan(a[1].start);
  });
});

/* ── Totals ───────────────────────────────────────────────────────────── */

describe("totalsFor", () => {
  it("keeps the three sources apart", () => {
    const totals = totalsFor([
      span("focused", "2026-08-12T09:00:00Z", "2026-08-12T09:25:00Z"),
      span("scheduled", "2026-08-12T11:00:00Z", "2026-08-12T12:00:00Z"),
      span("manual", "2026-08-12T13:00:00Z", "2026-08-12T13:30:00Z"),
    ]);

    expect(totals.focused).toBe(25);
    expect(totals.scheduled).toBe(60);
    expect(totals.manual).toBe(30);
  });

  it("adds them up when they do not overlap", () => {
    const totals = totalsFor([
      span("focused", "2026-08-12T09:00:00Z", "2026-08-12T10:00:00Z"),
      span("scheduled", "2026-08-12T11:00:00Z", "2026-08-12T12:00:00Z"),
    ]);

    expect(totals.summed).toBe(120);
    expect(totals.combined).toBe(120);
    expect(totals.overlap).toBe(0);
  });

  it("counts an overlapping hour once in the combined total", () => {
    // A Pomodoro run during a meeting is one hour of your life, not two.
    const totals = totalsFor([
      span("scheduled", "2026-08-12T09:00:00Z", "2026-08-12T10:00:00Z"),
      span("focused", "2026-08-12T09:00:00Z", "2026-08-12T09:25:00Z"),
    ]);

    // Separately, you still see the focused work you did.
    expect(totals.scheduled).toBe(60);
    expect(totals.focused).toBe(25);
    // Combined, the same wall-clock minute is counted once.
    expect(totals.combined).toBe(60);
    expect(totals.summed).toBe(85);
    expect(totals.overlap).toBe(25);
  });

  it("reports partial overlap correctly", () => {
    const totals = totalsFor([
      span("scheduled", "2026-08-12T09:00:00Z", "2026-08-12T10:00:00Z"),
      span("manual", "2026-08-12T09:30:00Z", "2026-08-12T10:30:00Z"),
    ]);

    expect(totals.combined).toBe(90);
    expect(totals.overlap).toBe(30);
  });

  it("is zero for nothing", () => {
    expect(totalsFor([])).toEqual({
      focused: 0,
      scheduled: 0,
      manual: 0,
      combined: 0,
      summed: 0,
      overlap: 0,
    });
  });

  it("never reports negative overlap", () => {
    expect(
      totalsFor([
        span("focused", "2026-08-12T09:00:00Z", "2026-08-12T09:25:00Z"),
      ]).overlap,
    ).toBe(0);
  });
});

/* ── Windows ──────────────────────────────────────────────────────────── */

describe("clipToWindow", () => {
  const start = new Date("2026-08-12T00:00:00Z");
  const end = new Date("2026-08-13T00:00:00Z");

  it("keeps a span inside the window", () => {
    const kept = clipToWindow(
      [span("focused", "2026-08-12T09:00:00Z", "2026-08-12T10:00:00Z")],
      start,
      end,
    );
    expect(kept).toHaveLength(1);
  });

  it("drops a span outside it", () => {
    expect(
      clipToWindow(
        [span("focused", "2026-08-14T09:00:00Z", "2026-08-14T10:00:00Z")],
        start,
        end,
      ),
    ).toEqual([]);
  });

  it("clips a span that straddles the edge", () => {
    // A meeting across midnight belongs partly to each day, which is what
    // makes the daily totals add up to the weekly one.
    const clipped = clipToWindow(
      [span("scheduled", "2026-08-11T23:00:00Z", "2026-08-12T01:00:00Z")],
      start,
      end,
    );

    expect(clipped).toHaveLength(1);
    expect(intervalMinutes(clipped[0])).toBe(60);
    expect(clipped[0].startedAt).toBe("2026-08-12T00:00:00.000Z");
  });

  it("drops a span that only touches the boundary", () => {
    expect(
      clipToWindow(
        [span("focused", "2026-08-11T23:00:00Z", "2026-08-12T00:00:00Z")],
        start,
        end,
      ),
    ).toEqual([]);
  });
});

/* ── Rollups ──────────────────────────────────────────────────────────── */

describe("weekToDate", () => {
  it("counts the current week, starting Monday", () => {
    // NOW is Wednesday 12 August 2026. Monday of that week is the 10th.
    const totals = weekToDate({
      intervals: [
        span("focused", "2026-08-10T13:00:00Z", "2026-08-10T14:00:00Z"),
        span("scheduled", "2026-08-12T13:00:00Z", "2026-08-12T14:00:00Z"),
      ],
      timeZone: ZONE,
      now: NOW,
    });

    expect(totals.combined).toBe(120);
  });

  it("excludes last week", () => {
    const totals = weekToDate({
      intervals: [
        span("focused", "2026-08-07T13:00:00Z", "2026-08-07T14:00:00Z"),
      ],
      timeZone: ZONE,
      now: NOW,
    });

    expect(totals.combined).toBe(0);
  });

  it("excludes next week", () => {
    const totals = weekToDate({
      intervals: [
        span("focused", "2026-08-18T13:00:00Z", "2026-08-18T14:00:00Z"),
      ],
      timeZone: ZONE,
      now: NOW,
    });

    expect(totals.combined).toBe(0);
  });

  it("includes Sunday, which belongs to the week that started Monday", () => {
    const totals = weekToDate({
      intervals: [
        span("manual", "2026-08-16T14:00:00Z", "2026-08-16T15:00:00Z"),
      ],
      timeZone: ZONE,
      now: NOW,
    });

    expect(totals.combined).toBe(60);
  });
});

describe("weeklyBreakdown", () => {
  const intervals = [
    span("focused", "2026-08-10T13:00:00Z", "2026-08-10T14:00:00Z"),
    span("scheduled", "2026-08-12T13:00:00Z", "2026-08-12T15:00:00Z"),
  ];

  it("returns seven days, Monday first", () => {
    const buckets = weeklyBreakdown({ intervals, timeZone: ZONE, now: NOW });

    expect(buckets).toHaveLength(7);
    expect(buckets[0].label).toContain("Mon");
    expect(buckets[6].label).toContain("Sun");
  });

  it("puts each span in its own day", () => {
    const buckets = weeklyBreakdown({ intervals, timeZone: ZONE, now: NOW });

    expect(buckets[0].totals.focused).toBe(60);
    expect(buckets[2].totals.scheduled).toBe(120);
    expect(buckets[1].totals.combined).toBe(0);
  });

  it("adds up to the week's total", () => {
    // The property that makes the breakdown trustworthy.
    const buckets = weeklyBreakdown({ intervals, timeZone: ZONE, now: NOW });
    const summed = buckets.reduce(
      (total, bucket) => total + bucket.totals.combined,
      0,
    );

    expect(summed).toBe(
      weekToDate({ intervals, timeZone: ZONE, now: NOW }).combined,
    );
  });

  it("splits a span that crosses midnight across two days", () => {
    const crossing = [
      span("scheduled", "2026-08-12T03:00:00Z", "2026-08-12T05:00:00Z"),
    ];
    const buckets = weeklyBreakdown({
      intervals: crossing,
      timeZone: ZONE,
      now: NOW,
    });

    // 03:00Z is 23:00 Tuesday in New York; 05:00Z is 01:00 Wednesday.
    expect(buckets[1].totals.scheduled).toBe(60);
    expect(buckets[2].totals.scheduled).toBe(60);
  });
});

describe("monthlyBreakdown", () => {
  it("returns the requested number of months, oldest first", () => {
    const buckets = monthlyBreakdown({
      intervals: [],
      timeZone: ZONE,
      now: NOW,
      months: 3,
    });

    expect(buckets).toHaveLength(3);
    expect(buckets[0].label).toContain("June");
    expect(buckets[2].label).toContain("August");
  });

  it("counts a span into its month", () => {
    const buckets = monthlyBreakdown({
      intervals: [
        span("focused", "2026-07-15T13:00:00Z", "2026-07-15T15:00:00Z"),
      ],
      timeZone: ZONE,
      now: NOW,
      months: 3,
    });

    expect(buckets[1].totals.focused).toBe(120);
    expect(buckets[2].totals.focused).toBe(0);
  });
});

/* ── Formatting ───────────────────────────────────────────────────────── */

describe("formatMinutes", () => {
  it("reads like a day, not a timesheet", () => {
    expect(formatMinutes(390)).toBe("6h 30m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(0)).toBe("0m");
  });

  it("never shows a negative", () => {
    expect(formatMinutes(-30)).toBe("0m");
  });
});

describe("toHours", () => {
  it("gives two decimal places", () => {
    expect(toHours(90)).toBe(1.5);
    expect(toHours(100)).toBe(1.67);
  });
});

/* ── End to end across classification and aggregation ─────────────────── */

describe("classified events become scheduled hours", () => {
  const calendar: ClassifiableCalendar = {
    id: "cal-1",
    name: "Work",
    countsTowardHours: true,
    defaultCategoryId: "cat-operational",
  };

  const event = (over: Partial<ClassifiableEvent> = {}): ClassifiableEvent => ({
    id: "evt-1",
    title: "Board review",
    location: null,
    organizerAddress: null,
    attendeeAddresses: [],
    attendeeCount: 4,
    isExternal: false,
    isCancelled: false,
    categoryId: null,
    categorySource: "unclassified",
    hoursInclude: null,
    ...over,
  });

  /** The path the hours view takes: classify, then keep what counts. */
  function scheduledIntervals(
    events: { event: ClassifiableEvent; startedAt: string; endedAt: string }[],
    rules: CategoryRule[] = [],
  ): HoursInterval[] {
    return events
      .map((entry) => ({
        entry,
        classification: classifyEvent({ event: entry.event, calendar, rules }),
      }))
      .filter(({ classification }) => classification.countsTowardHours)
      .map(({ entry, classification }) => ({
        source: "scheduled" as const,
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        categoryId: classification.categoryId,
        eventId: entry.event.id,
      }));
  }

  it("counts a work-category meeting", () => {
    const intervals = scheduledIntervals([
      {
        event: event(),
        startedAt: "2026-08-12T13:00:00Z",
        endedAt: "2026-08-12T14:00:00Z",
      },
    ]);

    expect(totalsFor(intervals).scheduled).toBe(60);
  });

  it("does not count an excluded meeting", () => {
    const intervals = scheduledIntervals([
      {
        event: event({ hoursInclude: false }),
        startedAt: "2026-08-12T13:00:00Z",
        endedAt: "2026-08-12T14:00:00Z",
      },
    ]);

    expect(intervals).toEqual([]);
  });

  it("does not count a cancelled meeting", () => {
    const intervals = scheduledIntervals([
      {
        event: event({ isCancelled: true }),
        startedAt: "2026-08-12T13:00:00Z",
        endedAt: "2026-08-12T14:00:00Z",
      },
    ]);

    expect(intervals).toEqual([]);
  });

  it("does not count what an exclusion rule caught", () => {
    const intervals = scheduledIntervals(
      [
        {
          event: event({ title: "Lunch" }),
          startedAt: "2026-08-12T16:00:00Z",
          endedAt: "2026-08-12T17:00:00Z",
        },
      ],
      [
        {
          id: "r1",
          pattern: "lunch",
          field: "title",
          categoryId: null,
          countsTowardHours: false,
          position: 0,
          isEnabled: true,
        },
      ],
    );

    expect(intervals).toEqual([]);
  });

  it("combines scheduled meetings with focused work, counting overlap once", () => {
    const scheduled = scheduledIntervals([
      {
        event: event(),
        startedAt: "2026-08-12T13:00:00Z",
        endedAt: "2026-08-12T14:00:00Z",
      },
    ]);

    const totals = totalsFor([
      ...scheduled,
      span("focused", "2026-08-12T13:30:00Z", "2026-08-12T14:30:00Z"),
      span("manual", "2026-08-12T16:00:00Z", "2026-08-12T16:30:00Z"),
    ]);

    expect(totals.scheduled).toBe(60);
    expect(totals.focused).toBe(60);
    expect(totals.manual).toBe(30);
    // 13:00–14:30 plus 16:00–16:30 = 90 + 30.
    expect(totals.combined).toBe(120);
    expect(totals.overlap).toBe(30);
  });
});
