import { describe, expect, it } from "vitest";

import {
  ARCHIVE_AFTER_DAYS,
  countArchived,
  isArchived,
  withoutArchived,
} from "./archive";
import type { Task, TaskStatus } from "./types";

const NOW = new Date("2026-08-27T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "A task",
    notes: null,
    status: "done" as TaskStatus,
    priority: null,
    dueAt: null,
    categoryId: null,
    pinned: false,
    sourceLink: null,
    owner: null,
    isReady: true,
    isDraft: false,
    canActivate: true,
    manualRank: null,
    manualRankSetAt: null,
    completedAt: daysAgo(1),
    createdAt: daysAgo(2),
    updatedAt: daysAgo(1),
    links: [],
    ...overrides,
  } as Task;
}

describe("archiving finished tasks", () => {
  it("keeps something finished yesterday", () => {
    expect(isArchived(task({ completedAt: daysAgo(1) }), NOW)).toBe(false);
  });

  it("keeps something finished exactly on the boundary", () => {
    // Strictly older than the window, so day 30 is still shown. An off-by-one
    // here silently loses a day of history every time the window is read.
    expect(
      isArchived(task({ completedAt: daysAgo(ARCHIVE_AFTER_DAYS) }), NOW),
    ).toBe(false);
  });

  it("archives something finished beyond the window", () => {
    expect(
      isArchived(task({ completedAt: daysAgo(ARCHIVE_AFTER_DAYS + 1) }), NOW),
    ).toBe(true);
  });

  it("never archives a task that is not done", () => {
    // A reopened task carries the completion timestamp from last time. If the
    // rule looked only at the date, reopening old work would put it straight
    // back out of sight — the exact opposite of what reopening means.
    for (const status of ["inbox", "ready", "doing"] as TaskStatus[]) {
      expect(isArchived(task({ status, completedAt: daysAgo(400) }), NOW)).toBe(
        false,
      );
    }
  });

  it("keeps a done task with no completion date", () => {
    // "I do not know when this finished" is not "it finished long ago".
    expect(isArchived(task({ completedAt: null }), NOW)).toBe(false);
  });

  it("keeps a done task whose completion date is unparseable", () => {
    expect(isArchived(task({ completedAt: "not a date" }), NOW)).toBe(false);
  });

  it("filters a list and counts what it hid", () => {
    const tasks = [
      task({ id: "recent", completedAt: daysAgo(3) }),
      task({ id: "old", completedAt: daysAgo(90) }),
      task({ id: "ancient", completedAt: daysAgo(400) }),
      task({ id: "open", status: "ready", completedAt: null }),
    ];

    expect(withoutArchived(tasks, NOW).map((t) => t.id)).toEqual([
      "recent",
      "open",
    ]);
    expect(countArchived(tasks, NOW)).toBe(2);
  });

  it("does not mutate the list it is given", () => {
    const tasks = [task({ id: "old", completedAt: daysAgo(90) })];
    withoutArchived(tasks, NOW);

    expect(tasks).toHaveLength(1);
  });
});
