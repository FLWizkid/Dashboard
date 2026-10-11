import { describe, expect, it } from "vitest";

import type { HoursTotals } from "@/lib/hours/aggregate";
import type { Task } from "@/lib/tasks/types";

import {
  activitySplits,
  buildSummary,
  twoDayRollup,
  type TwoDayEvent,
} from "./summary";

/**
 * The executive summary and the two-day rollup.
 *
 * The rule these tests exist to protect: **a number that cannot be computed is
 * `null`, never `0`.** "0 unread" with no mail account connected is a lie, and
 * a report that lies once is a report nobody reads again.
 */

const NOW = new Date("2026-08-12T09:00:00.000Z"); // a Wednesday
const WEEK_START = new Date("2026-08-10T00:00:00.000Z"); // Monday

function task(partial: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "A task",
    notes: null,
    priority: null,
    dueAt: null,
    categoryId: null,
    status: "inbox",
    pinned: false,
    sourceLink: null,
    owner: null,
    isReady: false,
    isDraft: false,
    canActivate: false,
    manualRank: null,
    manualRankSetAt: null,
    completedAt: null,
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
    links: [],
    ...partial,
  };
}

const hours: HoursTotals = {
  focused: 120,
  scheduled: 300,
  manual: 30,
  combined: 400,
  summed: 450,
  overlap: 50,
};

const base = { now: NOW, timeZone: "UTC", weekStart: WEEK_START };

describe("the executive summary", () => {
  it("counts what is open, overdue and due soon", () => {
    const summary = buildSummary({
      ...base,
      tasks: [
        task({ id: "a", dueAt: "2026-08-11T09:00:00.000Z" }),
        task({ id: "b", dueAt: "2026-08-13T09:00:00.000Z" }),
        task({ id: "c" }),
        task({ id: "d", status: "done" }),
      ],
    });

    expect(summary.openTasks).toBe(3);
    expect(summary.overdue).toBe(1);
    expect(summary.dueSoon).toBe(1);
  });

  it("counts the untriaged, which is the queue that grows when you're busy", () => {
    const summary = buildSummary({
      ...base,
      tasks: [
        task({ id: "a", priority: "high" }),
        task({ id: "b", priority: null }),
        task({ id: "c", priority: null }),
      ],
    });

    expect(summary.untriaged).toBe(2);
  });

  it("counts only work completed inside the week", () => {
    const summary = buildSummary({
      ...base,
      tasks: [
        task({
          id: "in",
          status: "done",
          completedAt: "2026-08-11T09:00:00.000Z",
        }),
        task({
          id: "before",
          status: "done",
          completedAt: "2026-08-03T09:00:00.000Z",
        }),
      ],
    });

    expect(summary.completedThisWeek).toBe(1);
  });

  it("reports hours as null when there are none, not as zero", () => {
    const summary = buildSummary({ ...base, tasks: [] });
    expect(summary.hoursThisWeek).toBeNull();
  });

  it("reports critical unread as null when no mail account is connected", () => {
    // The whole reason this field is nullable. "0 unread" would be a
    // confident, wrong answer.
    const summary = buildSummary({ ...base, tasks: [] });
    expect(summary.criticalUnread).toBeNull();
  });

  it("passes through the figures it is given", () => {
    const summary = buildSummary({
      ...base,
      tasks: [],
      hours,
      criticalUnread: 4,
    });

    expect(summary.hoursThisWeek?.combined).toBe(400);
    expect(summary.criticalUnread).toBe(4);
  });

  it("distinguishes zero unread from unknown", () => {
    const summary = buildSummary({ ...base, tasks: [], criticalUnread: 0 });
    expect(summary.criticalUnread).toBe(0);
  });

  it("takes the priority engine's order when it has one", () => {
    const summary = buildSummary({
      ...base,
      tasks: [task({ id: "a" }), task({ id: "b" }), task({ id: "c" })],
      rankedIds: ["c", "a", "b"],
      topCount: 2,
    });

    expect(summary.topPriorities.map((t) => t.id)).toEqual(["c", "a"]);
  });

  it("still produces a top section without a ranking", () => {
    // A summary that omits its most important section because a score wasn't
    // available is worse than one ordered slightly differently.
    const summary = buildSummary({
      ...base,
      tasks: [
        task({ id: "late", dueAt: "2026-08-01T09:00:00.000Z" }),
        task({ id: "soon", dueAt: "2026-08-13T09:00:00.000Z" }),
      ],
    });

    expect(summary.topPriorities.map((t) => t.id)).toEqual(["late", "soon"]);
  });
});

describe("activity splits", () => {
  const categories = [
    { id: "cat-1", name: "Strategic" },
    { id: "cat-2", name: "People" },
  ];

  it("always includes uncategorised", () => {
    // The most useful row in the table: a large uncategorised share means the
    // taxonomy isn't being used, which makes every other row less meaningful.
    const splits = activitySplits({
      ...base,
      categories,
      tasks: [task({ id: "a", categoryId: null })],
    });

    expect(splits.some((s) => s.categoryId === null)).toBe(true);
  });

  it("keeps a category with no activity, showing zero", () => {
    const splits = activitySplits({ ...base, categories, tasks: [] });
    expect(splits).toHaveLength(3);
    expect(splits.every((s) => s.openTasks === 0)).toBe(true);
  });

  it("counts open and completed separately", () => {
    const splits = activitySplits({
      ...base,
      categories,
      tasks: [
        task({ id: "a", categoryId: "cat-1" }),
        task({
          id: "b",
          categoryId: "cat-1",
          status: "done",
          completedAt: "2026-08-11T09:00:00.000Z",
        }),
      ],
    });

    const strategic = splits.find((s) => s.categoryId === "cat-1")!;
    expect(strategic.openTasks).toBe(1);
    expect(strategic.completed).toBe(1);
  });

  it("shares by time when time is known", () => {
    const splits = activitySplits({
      ...base,
      categories,
      tasks: [],
      minutesByCategory: new Map([
        ["cat-1", 300],
        ["cat-2", 100],
      ]),
    });

    expect(splits.find((s) => s.categoryId === "cat-1")!.share).toBe(75);
    expect(splits.find((s) => s.categoryId === "cat-2")!.share).toBe(25);
  });

  it("falls back to task count when no time is known", () => {
    const splits = activitySplits({
      ...base,
      categories,
      tasks: [
        task({ id: "a", categoryId: "cat-1" }),
        task({ id: "b", categoryId: "cat-1" }),
        task({ id: "c", categoryId: "cat-2" }),
      ],
    });

    expect(splits.find((s) => s.categoryId === "cat-1")!.share).toBeCloseTo(
      66.7,
      1,
    );
  });

  it("survives having nothing at all without dividing by zero", () => {
    const splits = activitySplits({ ...base, categories: [], tasks: [] });
    expect(splits.every((s) => Number.isFinite(s.share))).toBe(true);
  });
});

describe("the two-day rollup", () => {
  const event = (partial: Partial<TwoDayEvent> = {}): TwoDayEvent => ({
    id: "event-1",
    title: "Standup",
    startsAt: "2026-08-12T10:00:00.000Z",
    endsAt: "2026-08-12T10:30:00.000Z",
    isCancelled: false,
    ...partial,
  });

  it("produces one slot per day, labelled", () => {
    const slots = twoDayRollup({ ...base, tasks: [], events: [] });

    expect(slots).toHaveLength(2);
    expect(slots[0].label).toBe("Today");
    expect(slots[1].label).toBe("Tomorrow");
  });

  it("puts each meeting on its own day, in time order", () => {
    const slots = twoDayRollup({
      ...base,
      tasks: [],
      events: [
        event({ id: "late", startsAt: "2026-08-12T16:00:00.000Z" }),
        event({ id: "early", startsAt: "2026-08-12T08:00:00.000Z" }),
        event({ id: "tomorrow", startsAt: "2026-08-13T09:00:00.000Z" }),
      ],
    });

    expect(slots[0].events.map((e) => e.id)).toEqual(["early", "late"]);
    expect(slots[1].events.map((e) => e.id)).toEqual(["tomorrow"]);
  });

  it("leaves cancelled meetings out", () => {
    const slots = twoDayRollup({
      ...base,
      tasks: [],
      events: [event({ isCancelled: true })],
    });

    expect(slots[0].events).toEqual([]);
  });

  it("puts overdue work on today, not in a section you might not read", () => {
    // A two-day preview that omits what is already late is describing a day
    // you are not going to have.
    const slots = twoDayRollup({
      ...base,
      events: [],
      tasks: [task({ id: "late", dueAt: "2026-07-01T09:00:00.000Z" })],
    });

    expect(slots[0].tasks.map((t) => t.id)).toEqual(["late"]);
  });

  it("does not repeat overdue work on tomorrow", () => {
    const slots = twoDayRollup({
      ...base,
      events: [],
      tasks: [task({ id: "late", dueAt: "2026-07-01T09:00:00.000Z" })],
    });

    expect(slots[1].tasks).toEqual([]);
  });

  it("leaves completed and undated work out entirely", () => {
    const slots = twoDayRollup({
      ...base,
      events: [],
      tasks: [
        task({ id: "done", status: "done", dueAt: "2026-08-12T12:00:00.000Z" }),
        task({ id: "undated" }),
      ],
    });

    expect(slots.flatMap((s) => s.tasks)).toEqual([]);
  });

  it("respects the owner's timezone when deciding which day is which", () => {
    // 23:00 UTC on the 12th is already the 13th in Sydney.
    const slots = twoDayRollup({
      tasks: [],
      events: [
        event({ id: "late-night", startsAt: "2026-08-12T23:00:00.000Z" }),
      ],
      now: NOW,
      timeZone: "Australia/Sydney",
    });

    expect(slots[0].events).toEqual([]);
    expect(slots[1].events.map((e) => e.id)).toEqual(["late-night"]);
  });

  it("can be asked for more than two days", () => {
    const slots = twoDayRollup({ ...base, tasks: [], events: [], days: 3 });
    expect(slots).toHaveLength(3);
  });
});
