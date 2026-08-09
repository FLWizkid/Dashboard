import { describe, expect, it } from "vitest";

import {
  canPromoteToReady,
  describeMissingReadyFields,
  isReady,
  missingReadyFields,
  READY_FIELDS,
} from "./ready";
import type { Task } from "./types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Draft the board deck",
    notes: null,
    priority: "high",
    dueAt: "2026-08-07T21:00:00.000Z",
    categoryId: null,
    status: "inbox",
    pinned: false,
    sourceLink: null,
    owner: null,
    isReady: true,
    isDraft: false,
    canActivate: false,
    completedAt: null,
    createdAt: "2026-08-05T14:00:00.000Z",
    updatedAt: "2026-08-05T14:00:00.000Z",
    links: [],
    ...overrides,
  };
}

describe("the Ready contract", () => {
  it("is exactly title, priority and due date", () => {
    // This assertion is the guard rail. The same three fields are computed in
    // the database's generated `is_ready` column; if this list changes, that
    // migration has to change with it.
    expect(READY_FIELDS).toEqual(["title", "priority", "dueAt"]);
  });

  it("does not include owner — optional in personal mode", () => {
    expect(READY_FIELDS).not.toContain("owner");
    expect(isReady(task({ owner: null }))).toBe(true);
  });
});

describe("isReady", () => {
  it("is true with all three fields", () => {
    expect(isReady(task())).toBe(true);
  });

  it("is false without a priority", () => {
    expect(isReady(task({ priority: null }))).toBe(false);
  });

  it("is false without a due date", () => {
    expect(isReady(task({ dueAt: null }))).toBe(false);
  });

  it("is false for a whitespace-only title", () => {
    expect(isReady(task({ title: "   " }))).toBe(false);
  });

  it("accepts a Date as well as an ISO string", () => {
    expect(isReady({ title: "x", priority: "low", dueAt: new Date() })).toBe(
      true,
    );
  });
});

describe("missingReadyFields", () => {
  it("is empty for a ready task", () => {
    expect(missingReadyFields(task())).toEqual([]);
  });

  it("lists fields in a stable order", () => {
    expect(
      missingReadyFields(task({ title: "", priority: null, dueAt: null })),
    ).toEqual(["title", "priority", "dueAt"]);
  });
});

describe("describeMissingReadyFields", () => {
  it("is null when nothing is missing", () => {
    expect(describeMissingReadyFields(task())).toBeNull();
  });

  it("names a single missing field", () => {
    expect(describeMissingReadyFields(task({ dueAt: null }))).toBe(
      "Needs due date",
    );
  });

  it("joins two missing fields with 'and'", () => {
    expect(
      describeMissingReadyFields(task({ priority: null, dueAt: null })),
    ).toBe("Needs priority and due date");
  });

  it("uses a comma list for three", () => {
    expect(
      describeMissingReadyFields(
        task({ title: "", priority: null, dueAt: null }),
      ),
    ).toBe("Needs title, priority and due date");
  });
});

describe("canPromoteToReady", () => {
  it("allows a complete, open task", () => {
    expect(canPromoteToReady(task({ status: "inbox" }))).toBe(true);
  });

  it("refuses an incomplete task", () => {
    expect(canPromoteToReady(task({ priority: null }))).toBe(false);
  });

  it("refuses a task that is already done", () => {
    expect(
      canPromoteToReady(
        task({ status: "done", completedAt: "2026-08-05T15:00:00.000Z" }),
      ),
    ).toBe(false);
  });
});
