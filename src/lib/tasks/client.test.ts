import { describe, expect, it } from "vitest";

import { provisionalTask } from "./client";

/**
 * The optimistic row.
 *
 * Capture is optimistic so that typing a task and seeing it are the same
 * moment. That only helps if the provisional row tells the truth — a Ready
 * badge that appears and then vanishes when the server answers is worse than
 * no badge at all.
 */
describe("provisionalTask", () => {
  const base = {
    title: "Sign the renewal",
    notes: null,
    priority: null,
    dueAt: null,
    categoryId: null,
    status: "inbox" as const,
    pinned: false,
    sourceLink: null,
    owner: null,
    isDraft: false,
    clientKey: null,
    links: [],
  };

  it("is never complete and never ranked", () => {
    const task = provisionalTask(base);

    expect(task.completedAt).toBeNull();
    expect(task.manualRank).toBeNull();
    expect(task.status).toBe("inbox");
  });

  it("is not Ready without a priority and a due date", () => {
    expect(provisionalTask(base).isReady).toBe(false);
    expect(provisionalTask({ ...base, priority: "high" }).isReady).toBe(false);
    expect(
      provisionalTask({ ...base, dueAt: "2026-09-01T12:00:00.000Z" }).isReady,
    ).toBe(false);
  });

  it("is Ready with a title, a priority and a due date", () => {
    const task = provisionalTask({
      ...base,
      priority: "high",
      dueAt: "2026-09-01T12:00:00.000Z",
    });

    expect(task.isReady).toBe(true);
  });

  it("can only activate once it also has an owner", () => {
    // The draft rule: owner, due date and priority. A higher bar than Ready,
    // and the extra field is the interesting one.
    const withoutOwner = provisionalTask({
      ...base,
      priority: "high",
      dueAt: "2026-09-01T12:00:00.000Z",
    });
    expect(withoutOwner.canActivate).toBe(false);

    const withOwner = provisionalTask({
      ...base,
      priority: "high",
      dueAt: "2026-09-01T12:00:00.000Z",
      owner: "Maya",
    });
    expect(withOwner.canActivate).toBe(true);
  });

  it("carries the draft flag through", () => {
    expect(provisionalTask({ ...base, isDraft: true }).isDraft).toBe(true);
  });

  it("marks its id as provisional", () => {
    // If one of these ever survives a refetch, the id says where it came from.
    expect(provisionalTask(base).id).toMatch(/^optimistic:/);
  });
});
