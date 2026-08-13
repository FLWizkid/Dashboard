import { describe, expect, it } from "vitest";

import {
  compareTasks,
  dueBucket,
  isOverdue,
  priorityRank,
  sortTasks,
  topPriorities,
} from "./sort";
import type { Task, TaskPriority } from "./types";

const BASE_CREATED = "2026-08-01T12:00:00.000Z";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    notes: null,
    priority: "normal",
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
    createdAt: BASE_CREATED,
    updatedAt: BASE_CREATED,
    links: [],
    ...overrides,
  };
}

const order = (tasks: Task[]) => sortTasks(tasks).map((item) => item.id);

describe("priorityRank", () => {
  it("ranks the four levels in order", () => {
    const ranks = (["critical", "high", "normal", "low"] as TaskPriority[]).map(
      priorityRank,
    );
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("places untriaged between normal and low", () => {
    // An untriaged capture must not outrank something explicitly called
    // Normal, and must not sink below something explicitly called Low.
    expect(priorityRank(null)).toBeGreaterThan(priorityRank("normal"));
    expect(priorityRank(null)).toBeLessThan(priorityRank("low"));
  });
});

describe("compareTasks", () => {
  it("puts pinned tasks first, whatever their priority", () => {
    expect(
      order([
        task("critical", { priority: "critical" }),
        task("pinned-low", { priority: "low", pinned: true }),
      ]),
    ).toEqual(["pinned-low", "critical"]);
  });

  it("orders by priority next", () => {
    expect(
      order([
        task("low", { priority: "low" }),
        task("normal", { priority: "normal" }),
        task("critical", { priority: "critical" }),
        task("untriaged", { priority: null }),
        task("high", { priority: "high" }),
      ]),
    ).toEqual(["critical", "high", "normal", "untriaged", "low"]);
  });

  it("orders by due date inside a priority band", () => {
    expect(
      order([
        task("later", { dueAt: "2026-08-10T12:00:00.000Z" }),
        task("sooner", { dueAt: "2026-08-06T12:00:00.000Z" }),
      ]),
    ).toEqual(["sooner", "later"]);
  });

  it("puts undated tasks after dated ones in the same band", () => {
    expect(
      order([
        task("undated", { dueAt: null }),
        task("dated", { dueAt: "2027-01-01T12:00:00.000Z" }),
      ]),
    ).toEqual(["dated", "undated"]);
  });

  it("falls through to creation order when both are undated", () => {
    // Regression guard: subtracting two infinities gives NaN, which used to
    // make this comparison return a bogus non-zero result.
    expect(
      order([
        task("newer", { createdAt: "2026-08-04T12:00:00.000Z" }),
        task("older", { createdAt: "2026-08-01T12:00:00.000Z" }),
      ]),
    ).toEqual(["older", "newer"]);
  });

  it("is a total order — id breaks the final tie", () => {
    expect(order([task("bbb"), task("aaa")])).toEqual(["aaa", "bbb"]);
  });

  it("is stable regardless of the starting arrangement", () => {
    const tasks = [
      task("a", { priority: "high", dueAt: "2026-08-06T12:00:00.000Z" }),
      task("b", { priority: "high", dueAt: "2026-08-07T12:00:00.000Z" }),
      task("c", { priority: "critical" }),
      task("d", { pinned: true, priority: "low" }),
    ];
    const forwards = order(tasks);
    const backwards = order([...tasks].reverse());
    expect(forwards).toEqual(backwards);
  });

  it("ignores status, so a just-completed row holds its place", () => {
    // The undo window depends on this: re-sorting a completed task to the
    // bottom would fight the exit animation.
    const done = task("done", {
      priority: "critical",
      status: "done",
      completedAt: "2026-08-05T12:00:00.000Z",
    });
    const open = task("open", { priority: "low" });
    expect(compareTasks(done, open)).toBeLessThan(0);
  });
});

describe("topPriorities", () => {
  it("excludes completed tasks", () => {
    const result = topPriorities([
      task("done", {
        priority: "critical",
        status: "done",
        completedAt: "2026-08-05T12:00:00.000Z",
      }),
      task("open", { priority: "low" }),
    ]);
    expect(result.map((item) => item.id)).toEqual(["open"]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      task(`t${index}`, { priority: "normal" }),
    );
    expect(topPriorities(many, 5)).toHaveLength(5);
  });

  it("does not mutate its input", () => {
    const tasks = [
      task("b", { priority: "low" }),
      task("a", { priority: "critical" }),
    ];
    const before = tasks.map((item) => item.id);
    topPriorities(tasks);
    expect(tasks.map((item) => item.id)).toEqual(before);
  });
});

describe("isOverdue", () => {
  const now = new Date("2026-08-05T14:00:00.000Z");

  it("is true for a past due date on an open task", () => {
    expect(
      isOverdue(task("a", { dueAt: "2026-08-04T12:00:00.000Z" }), now),
    ).toBe(true);
  });

  it("is false once completed", () => {
    expect(
      isOverdue(
        task("a", {
          dueAt: "2026-08-04T12:00:00.000Z",
          status: "done",
          completedAt: "2026-08-05T12:00:00.000Z",
        }),
        now,
      ),
    ).toBe(false);
  });

  it("is false without a due date", () => {
    expect(isOverdue(task("a"), now)).toBe(false);
  });
});

describe("dueBucket", () => {
  const now = new Date("2026-08-05T14:00:00.000Z");
  const bucket = (dueAt: string | null) =>
    dueBucket(task("a", { dueAt }), now, "UTC");

  it("classifies each band", () => {
    expect(bucket(null)).toBe("undated");
    expect(bucket("2026-08-04T12:00:00.000Z")).toBe("overdue");
    expect(bucket("2026-08-05T18:00:00.000Z")).toBe("today");
    expect(bucket("2026-08-07T12:00:00.000Z")).toBe("soon");
    expect(bucket("2026-08-20T12:00:00.000Z")).toBe("later");
  });

  it("resolves the day boundary in the given timezone", () => {
    // 02:00Z on 6 Aug is still the evening of 5 Aug in New York.
    const dueAt = "2026-08-06T02:00:00.000Z";
    expect(dueBucket(task("a", { dueAt }), now, "America/New_York")).toBe(
      "today",
    );
    expect(dueBucket(task("a", { dueAt }), now, "UTC")).toBe("soon");
  });
});
