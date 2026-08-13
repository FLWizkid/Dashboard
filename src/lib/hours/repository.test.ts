import { describe, expect, it } from "vitest";

import { totalsFor } from "./aggregate";
import { toIntervals } from "./repository";
import type { ScheduledBlock, TimeEntry } from "./types";

/**
 * `toIntervals` is the join between the two halves of the hours model — the
 * stored ledger and the derived calendar — and it is the last place a block
 * that shouldn't count can be filtered out. Worth its own tests: everything
 * downstream trusts that what arrives here already counts.
 */

function entry(partial: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: "entry-1",
    source: "manual",
    taskId: null,
    categoryId: null,
    sessionId: null,
    startedAt: "2026-08-10T09:00:00.000Z",
    endedAt: "2026-08-10T10:00:00.000Z",
    minutes: 60,
    note: null,
    clientKey: null,
    createdAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "2026-08-10T10:00:00.000Z",
    ...partial,
  };
}

function block(partial: Partial<ScheduledBlock> = {}): ScheduledBlock {
  return {
    eventId: "event-1",
    calendarId: "cal-1",
    calendarName: "Work",
    title: "Leadership sync",
    startsAt: "2026-08-10T11:00:00.000Z",
    endsAt: "2026-08-10T12:00:00.000Z",
    categoryId: null,
    categorySource: "rule",
    categoryReason: "Matched a rule.",
    hoursInclude: null,
    countsTowardHours: true,
    isCancelled: false,
    ...partial,
  };
}

describe("toIntervals", () => {
  it("keeps the source on each interval so the totals stay separable", () => {
    const intervals = toIntervals(
      [entry({ source: "focused" }), entry({ id: "e2", source: "manual" })],
      [block()],
    );

    expect(intervals.map((i) => i.source).sort()).toEqual([
      "focused",
      "manual",
      "scheduled",
    ]);
  });

  it("drops blocks that don't count toward hours", () => {
    const intervals = toIntervals(
      [],
      [
        block({ eventId: "a", countsTowardHours: true }),
        block({ eventId: "b", countsTowardHours: false }),
      ],
    );

    expect(intervals).toHaveLength(1);
    expect(intervals[0].eventId).toBe("a");
  });

  it("drops cancelled blocks even when they are still categorised", () => {
    // A cancelled meeting that kept its category is exactly the row that would
    // otherwise keep contributing an hour a week to the total forever.
    const intervals = toIntervals(
      [],
      [block({ isCancelled: true, countsTowardHours: true })],
    );

    expect(intervals).toEqual([]);
  });

  it("carries the event id so a scheduled interval can be traced back", () => {
    const [interval] = toIntervals([], [block({ eventId: "evt-9" })]);
    expect(interval.eventId).toBe("evt-9");
  });

  it("produces totals where combined counts an overlap once", () => {
    // The decision from docs/hours.md, exercised through the real join rather
    // than through hand-built intervals.
    const intervals = toIntervals(
      [
        entry({
          source: "focused",
          startedAt: "2026-08-10T11:20:00.000Z",
          endedAt: "2026-08-10T11:45:00.000Z",
        }),
      ],
      [block()],
    );

    const totals = totalsFor(intervals);

    expect(totals.focused).toBe(25);
    expect(totals.scheduled).toBe(60);
    expect(totals.summed).toBe(85);
    expect(totals.combined).toBe(60);
    expect(totals.overlap).toBe(25);
  });

  it("never produces a scheduled entry from the ledger", () => {
    // The ledger cannot hold scheduled time — the check constraint refuses it
    // — and this asserts the join can't invent one either.
    const intervals = toIntervals([entry(), entry({ id: "e2" })], []);
    expect(intervals.every((i) => i.source !== "scheduled")).toBe(true);
  });
});
