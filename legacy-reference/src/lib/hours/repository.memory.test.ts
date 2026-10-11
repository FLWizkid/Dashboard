import { beforeEach, describe, expect, it } from "vitest";

import {
  DuplicateClientKeyError,
  SessionAlreadyRunningError,
} from "./repository";
import {
  memoryHoursRepository as repo,
  resetMemoryHoursStore,
  seedMemoryEvents,
} from "./repository.memory";

/**
 * The in-memory repository is what the end-to-end suite runs against, so it
 * has to enforce the same invariants the database does. A permissive fake
 * turns every E2E pass into a statement about nothing.
 *
 * These tests are the check on that: each one names the database constraint it
 * is standing in for.
 */

const WINDOW = {
  from: new Date("2026-08-10T00:00:00.000Z"),
  to: new Date("2026-08-17T00:00:00.000Z"),
};

beforeEach(() => {
  resetMemoryHoursStore();
});

describe("pomodoro sessions", () => {
  it("refuses a second running session — pomodoro_sessions_one_running_idx", async () => {
    await repo.startSession({
      kind: "focus",
      taskId: null,
      categoryId: null,
      plannedMinutes: 25,
      startedAt: "2026-08-10T09:00:00.000Z",
    });

    await expect(
      repo.startSession({
        kind: "focus",
        taskId: null,
        categoryId: null,
        plannedMinutes: 25,
      }),
    ).rejects.toBeInstanceOf(SessionAlreadyRunningError);
  });

  it("allows a new session once the previous one has ended", async () => {
    const first = await repo.startSession({
      kind: "focus",
      taskId: null,
      categoryId: null,
      plannedMinutes: 25,
      startedAt: "2026-08-10T09:00:00.000Z",
    });

    await repo.endSession(first.id, {
      endedAt: "2026-08-10T09:25:00.000Z",
      completed: true,
      note: null,
      logHours: false,
    });

    await expect(
      repo.startSession({
        kind: "focus",
        taskId: null,
        categoryId: null,
        plannedMinutes: 25,
      }),
    ).resolves.toMatchObject({ endedAt: null });
  });

  it("writes a focused entry that mirrors the session's own instants", async () => {
    const session = await repo.startSession({
      kind: "focus",
      taskId: null,
      categoryId: null,
      plannedMinutes: 25,
      startedAt: "2026-08-10T09:00:00.000Z",
    });

    const { entry } = await repo.endSession(session.id, {
      endedAt: "2026-08-10T09:25:00.000Z",
      completed: true,
      note: null,
      logHours: true,
    });

    expect(entry).toMatchObject({
      source: "focused",
      sessionId: session.id,
      startedAt: "2026-08-10T09:00:00.000Z",
      endedAt: "2026-08-10T09:25:00.000Z",
      minutes: 25,
    });
  });

  it("writes no entry for a break, however long it ran", async () => {
    const session = await repo.startSession({
      kind: "long_break",
      taskId: null,
      categoryId: null,
      plannedMinutes: 15,
      startedAt: "2026-08-10T09:00:00.000Z",
    });

    // `logHours: false` is what the machine decides for a break; the
    // repository is not asked to re-derive it.
    const { entry } = await repo.endSession(session.id, {
      endedAt: "2026-08-10T09:15:00.000Z",
      completed: true,
      note: null,
      logHours: false,
    });

    expect(entry).toBeNull();
  });
});

describe("the ledger", () => {
  it("rejects a reused client key with the row that already exists", async () => {
    const first = await repo.createTimeEntry({
      source: "manual",
      taskId: null,
      categoryId: null,
      startedAt: "2026-08-10T09:00:00.000Z",
      endedAt: "2026-08-10T09:30:00.000Z",
      note: null,
      clientKey: "ob-deadbeef",
    });

    const retry = repo.createTimeEntry({
      source: "manual",
      taskId: null,
      categoryId: null,
      startedAt: "2026-08-10T09:00:00.000Z",
      endedAt: "2026-08-10T09:30:00.000Z",
      note: null,
      clientKey: "ob-deadbeef",
    });

    await expect(retry).rejects.toBeInstanceOf(DuplicateClientKeyError);
    await retry.catch((error: DuplicateClientKeyError) => {
      // Carrying the existing row is what lets the route answer 200 rather
      // than leaving the outbox to retry an hour that is already stored.
      expect(error.existing.id).toBe(first.id);
    });

    expect(await repo.listTimeEntries(WINDOW)).toHaveLength(1);
  });

  it("lets two entries share instants when neither carries a client key", async () => {
    // Two genuinely separate half-hours logged for the same slot is the
    // owner's business; only the idempotency key implies "these are the same".
    for (const id of ["a", "b"]) {
      await repo.createTimeEntry({
        source: "manual",
        taskId: null,
        categoryId: null,
        startedAt: "2026-08-10T09:00:00.000Z",
        endedAt: "2026-08-10T09:30:00.000Z",
        note: id,
        clientKey: undefined,
      });
    }

    expect(await repo.listTimeEntries(WINDOW)).toHaveLength(2);
  });

  it("returns entries that merely overlap the window, not only contained ones", async () => {
    await repo.createTimeEntry({
      source: "manual",
      taskId: null,
      categoryId: null,
      // Starts the evening before the window opens and runs into it.
      startedAt: "2026-08-09T23:30:00.000Z",
      endedAt: "2026-08-10T00:30:00.000Z",
      note: null,
    });

    expect(await repo.listTimeEntries(WINDOW)).toHaveLength(1);
  });
});

describe("scheduled blocks", () => {
  const event = {
    id: "11111111-1111-4111-8111-111111111111",
    calendarId: "00000000-0000-4000-a000-000000000001",
    title: "Board review",
    location: null,
    organizerAddress: null,
    attendeeAddresses: [],
    attendeeCount: 5,
    isExternal: false,
    isCancelled: false,
    startsAt: "2026-08-11T09:00:00.000Z",
    endsAt: "2026-08-11T10:00:00.000Z",
    categoryId: null,
    categorySource: "unclassified" as const,
    categoryReason: null,
    hoursInclude: null,
  };

  it("does not count an unclassified event", async () => {
    seedMemoryEvents([event]);

    const [block] = await repo.listScheduledBlocks(WINDOW);
    expect(block.countsTowardHours).toBe(false);
    expect(block.categorySource).toBe("unclassified");
  });

  it("counts it once a rule matches, and says which rule", async () => {
    seedMemoryEvents([event]);
    await repo.createRule({
      pattern: "board",
      field: "title",
      categoryId: null,
      countsTowardHours: true,
      isEnabled: true,
    });

    const [block] = await repo.listScheduledBlocks(WINDOW);
    expect(block.countsTowardHours).toBe(true);
    expect(block.categoryReason).toContain("board");
  });

  it("honours the event-level exclusion over a matching rule", async () => {
    seedMemoryEvents([event]);
    await repo.createRule({
      pattern: "board",
      field: "title",
      categoryId: null,
      countsTowardHours: true,
      isEnabled: true,
    });

    await repo.overrideEvent(event.id, { hoursInclude: false });

    const [block] = await repo.listScheduledBlocks(WINDOW);
    expect(block.countsTowardHours).toBe(false);
  });

  it("marks an event manual once a category is set by hand", async () => {
    seedMemoryEvents([event]);

    const block = await repo.overrideEvent(event.id, {
      categoryId: "22222222-2222-4222-8222-222222222222",
    });

    expect(block.categorySource).toBe("manual");
    expect(block.categoryReason).toBe("You set this category yourself.");
  });

  it("keeps a manual category even when a rule would say otherwise", async () => {
    seedMemoryEvents([event]);
    await repo.overrideEvent(event.id, {
      categoryId: "22222222-2222-4222-8222-222222222222",
    });

    await repo.createRule({
      pattern: "board",
      field: "title",
      categoryId: "33333333-3333-4333-8333-333333333333",
      countsTowardHours: true,
      isEnabled: true,
    });

    const [block] = await repo.listScheduledBlocks(WINDOW);
    expect(block.categoryId).toBe("22222222-2222-4222-8222-222222222222");
    expect(block.categorySource).toBe("manual");
  });
});

describe("rules", () => {
  it("appends new rules rather than inserting them at the front", async () => {
    // A new rule jumping the queue would change what already-classified
    // meetings resolve to, silently.
    const first = await repo.createRule({
      pattern: "board",
      field: "title",
      categoryId: null,
      countsTowardHours: true,
      isEnabled: true,
    });
    const second = await repo.createRule({
      pattern: "lunch",
      field: "title",
      categoryId: null,
      countsTowardHours: false,
      isEnabled: true,
    });

    expect(second.position).toBeGreaterThan(first.position);
    expect((await repo.listRules()).map((r) => r.pattern)).toEqual([
      "board",
      "lunch",
    ]);
  });

  it("ignores a disabled rule", async () => {
    seedMemoryEvents([
      {
        id: "11111111-1111-4111-8111-111111111111",
        calendarId: "00000000-0000-4000-a000-000000000001",
        title: "Board review",
        location: null,
        organizerAddress: null,
        attendeeAddresses: [],
        attendeeCount: 5,
        isExternal: false,
        isCancelled: false,
        startsAt: "2026-08-11T09:00:00.000Z",
        endsAt: "2026-08-11T10:00:00.000Z",
        categoryId: null,
        categorySource: "unclassified",
        categoryReason: null,
        hoursInclude: null,
      },
    ]);

    const rule = await repo.createRule({
      pattern: "board",
      field: "title",
      categoryId: null,
      countsTowardHours: true,
      isEnabled: true,
    });
    await repo.updateRule(rule.id, { isEnabled: false });

    const [block] = await repo.listScheduledBlocks(WINDOW);
    expect(block.countsTowardHours).toBe(false);
  });
});
