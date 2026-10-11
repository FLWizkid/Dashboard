import { describe, expect, it } from "vitest";

import type { Task } from "@/lib/tasks/types";

import {
  applyFilters,
  byDueThenAge,
  groupForReport,
  hasActiveFilters,
  reportGroup,
  REPORT_GROUPS,
} from "./group";

/**
 * Report grouping and filters.
 *
 * Two things here are easy to get subtly wrong and expensive when you do:
 * **empty groups must still be returned** (an absent "Overdue" heading and an
 * empty one say opposite things), and **an empty filter means everything**,
 * never nothing.
 */

const NOW = new Date("2026-08-10T09:00:00.000Z");

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

describe("bucketing", () => {
  it("puts a past-due task in Overdue", () => {
    expect(reportGroup(task({ dueAt: "2026-08-09T09:00:00.000Z" }), NOW)).toBe(
      "overdue",
    );
  });

  it("puts today and the next two days in Due soon", () => {
    expect(reportGroup(task({ dueAt: "2026-08-10T18:00:00.000Z" }), NOW)).toBe(
      "dueSoon",
    );
    expect(reportGroup(task({ dueAt: "2026-08-12T09:00:00.000Z" }), NOW)).toBe(
      "dueSoon",
    );
  });

  it("puts anything further out in Upcoming", () => {
    expect(reportGroup(task({ dueAt: "2026-08-20T09:00:00.000Z" }), NOW)).toBe(
      "upcoming",
    );
  });

  it("puts undated work in Current, not in a section of its own", () => {
    // The one judgement call: undated work is what you are doing now, and
    // burying it at the bottom is how it stops getting done.
    expect(reportGroup(task({ dueAt: null }), NOW)).toBe("current");
  });
});

describe("grouping", () => {
  it("returns every group, including the empty ones", () => {
    // An absent "Overdue" heading and an empty one are opposite messages, and
    // only one of them is good news.
    const groups = groupForReport([task()], { now: NOW });

    expect(groups.map((g) => g.group)).toEqual([...REPORT_GROUPS]);
    expect(groups.find((g) => g.group === "overdue")!.tasks).toEqual([]);
  });

  it("excludes completed work by default", () => {
    const groups = groupForReport(
      [task({ id: "a" }), task({ id: "b", status: "done" })],
      { now: NOW },
    );

    const all = groups.flatMap((g) => g.tasks);
    expect(all.map((t) => t.id)).toEqual(["a"]);
  });

  it("includes it when asked", () => {
    const groups = groupForReport(
      [task({ id: "a" }), task({ id: "b", status: "done" })],
      { now: NOW, includeDone: true },
    );

    expect(groups.flatMap((g) => g.tasks)).toHaveLength(2);
  });

  it("orders within a group by due date, soonest first", () => {
    const groups = groupForReport(
      [
        task({ id: "later", dueAt: "2026-08-12T09:00:00.000Z" }),
        task({ id: "sooner", dueAt: "2026-08-10T12:00:00.000Z" }),
      ],
      { now: NOW },
    );

    const dueSoon = groups.find((g) => g.group === "dueSoon")!;
    expect(dueSoon.tasks.map((t) => t.id)).toEqual(["sooner", "later"]);
  });

  it("is stable regardless of input order", () => {
    const tasks = [
      task({ id: "a", dueAt: "2026-08-09T09:00:00.000Z" }),
      task({ id: "b" }),
      task({ id: "c", dueAt: "2026-08-20T09:00:00.000Z" }),
    ];

    const forward = groupForReport(tasks, { now: NOW }).flatMap((g) =>
      g.tasks.map((t) => t.id),
    );
    const reversed = groupForReport([...tasks].reverse(), {
      now: NOW,
    }).flatMap((g) => g.tasks.map((t) => t.id));

    expect(forward).toEqual(reversed);
  });

  it("does not mutate the array it was handed", () => {
    const tasks = [
      task({ id: "b", dueAt: "2026-08-12T09:00:00.000Z" }),
      task({ id: "a", dueAt: "2026-08-11T09:00:00.000Z" }),
    ];
    const before = tasks.map((t) => t.id);

    groupForReport(tasks, { now: NOW });
    expect(tasks.map((t) => t.id)).toEqual(before);
  });
});

describe("ordering", () => {
  it("sorts undated last", () => {
    const dated = task({ id: "dated", dueAt: "2026-08-11T09:00:00.000Z" });
    const undated = task({ id: "undated" });

    expect(byDueThenAge(dated, undated)).toBeLessThan(0);
  });

  it("breaks a tie by age, then by id", () => {
    const older = task({ id: "z", createdAt: "2026-01-01T00:00:00.000Z" });
    const newer = task({ id: "a", createdAt: "2026-06-01T00:00:00.000Z" });

    expect(byDueThenAge(older, newer)).toBeLessThan(0);

    const same = task({ id: "b", createdAt: "2026-01-01T00:00:00.000Z" });
    expect(byDueThenAge(same, older)).toBeLessThan(0);
  });
});

describe("filters", () => {
  const tasks = [
    task({
      id: "a",
      priority: "high",
      categoryId: "cat-1",
      title: "Board pack",
    }),
    task({ id: "b", priority: "low", categoryId: "cat-2", title: "Expenses" }),
    task({ id: "c", priority: null, categoryId: null, title: "Untriaged" }),
    task({ id: "d", status: "done", title: "Finished" }),
  ];

  it("returns everything when no filter is set", () => {
    // The classic bug is the reverse: the page loads with no boxes ticked and
    // shows nothing, which reads as "you have no work".
    expect(applyFilters(tasks)).toHaveLength(4);
    expect(applyFilters(tasks, {})).toHaveLength(4);
  });

  it("treats an empty array as 'everything', not 'nothing'", () => {
    expect(
      applyFilters(tasks, { categoryIds: [], priorities: [] }),
    ).toHaveLength(4);
  });

  it("filters by category", () => {
    expect(
      applyFilters(tasks, { categoryIds: ["cat-1"] }).map((t) => t.id),
    ).toEqual(["a"]);
  });

  it("excludes uncategorised work when a category filter is set", () => {
    const result = applyFilters(tasks, { categoryIds: ["cat-1", "cat-2"] });
    expect(result.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("filters by priority, excluding untriaged", () => {
    expect(
      applyFilters(tasks, { priorities: ["high"] }).map((t) => t.id),
    ).toEqual(["a"]);
  });

  it("finds the untriaged with the uncategorised filter", () => {
    expect(
      applyFilters(tasks, { uncategorisedOnly: true }).map((t) => t.id),
    ).toEqual(["c", "d"]);
  });

  it("drops completed work when asked for incomplete only", () => {
    expect(
      applyFilters(tasks, { incompleteOnly: true }).map((t) => t.id),
    ).toEqual(["a", "b", "c"]);
  });

  it("searches the title, case-insensitively", () => {
    expect(applyFilters(tasks, { query: "board" }).map((t) => t.id)).toEqual([
      "a",
    ]);
  });

  it("ignores a whitespace-only query", () => {
    expect(applyFilters(tasks, { query: "   " })).toHaveLength(4);
  });

  it("combines filters with AND", () => {
    expect(
      applyFilters(tasks, { priorities: ["high"], query: "expenses" }),
    ).toEqual([]);
  });

  it("knows when it is narrowing anything", () => {
    expect(hasActiveFilters()).toBe(false);
    expect(hasActiveFilters({ query: "  " })).toBe(false);
    expect(hasActiveFilters({ categoryIds: [] })).toBe(false);
    expect(hasActiveFilters({ categoryIds: ["cat-1"] })).toBe(true);
    expect(hasActiveFilters({ incompleteOnly: true })).toBe(true);
  });
});
