import { describe, expect, it } from "vitest";

import {
  contributesToHours,
  DEFAULT_POMODORO,
  elapsedMs,
  formatRemaining,
  IDLE,
  isComplete,
  isRunning,
  nextKind,
  pause,
  plannedMinutes,
  remainingSeconds,
  resume,
  skip,
  start,
  stop,
  toTimeEntry,
  type PomodoroState,
} from "./pomodoro";
import {
  draftEntry,
  dueForFlush,
  flushBackOffMs,
  newClientKey,
  pendingMinutes,
  reconcileOutbox,
  type OutboxEntry,
} from "./outbox";

const T0 = new Date("2026-08-12T14:00:00.000Z");
const at = (minutes: number, seconds = 0) =>
  new Date(T0.getTime() + minutes * 60_000 + seconds * 1000);

/* ── Defaults ─────────────────────────────────────────────────────────── */

describe("defaults", () => {
  it("are 25 / 5 / 15, long break every fourth focus", () => {
    expect(DEFAULT_POMODORO).toEqual({
      focusMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
    });
  });

  it("map each kind to its length", () => {
    expect(plannedMinutes("focus")).toBe(25);
    expect(plannedMinutes("short_break")).toBe(5);
    expect(plannedMinutes("long_break")).toBe(15);
  });
});

/* ── Running ──────────────────────────────────────────────────────────── */

describe("running", () => {
  it("starts at the full length", () => {
    const state = start(IDLE, T0);
    expect(remainingSeconds(state, T0)).toBe(25 * 60);
    expect(isRunning(state)).toBe(true);
  });

  it("counts down from instants, not from a ticking counter", () => {
    // The whole point: nothing decrements. A backgrounded tab, a locked phone
    // and a sleeping laptop all resolve correctly because the state holds
    // when it started, not how much is left.
    const state = start(IDLE, T0);
    expect(remainingSeconds(state, at(10))).toBe(15 * 60);
  });

  it("survives the laptop sleeping through the whole interval", () => {
    const state = start(IDLE, T0);

    expect(isComplete(state, at(40))).toBe(true);
    expect(remainingSeconds(state, at(40))).toBe(0);
  });

  it("never reports negative time left", () => {
    expect(remainingSeconds(start(IDLE, T0), at(600))).toBe(0);
  });

  it("is not complete before the time is up", () => {
    expect(isComplete(start(IDLE, T0), at(24, 59))).toBe(false);
    expect(isComplete(start(IDLE, T0), at(25))).toBe(true);
  });

  it("is not running when idle", () => {
    expect(isRunning(IDLE)).toBe(false);
    expect(isComplete(IDLE, at(60))).toBe(false);
  });
});

/* ── Pause and resume ─────────────────────────────────────────────────── */

describe("pause and resume", () => {
  it("banks the elapsed time", () => {
    const running = start(IDLE, T0);
    const paused = pause(running, at(10));

    expect(paused.paused).toBe(true);
    expect(paused.startedAt).toBeNull();
    expect(elapsedMs(paused, at(30))).toBe(10 * 60_000);
  });

  it("does not let a long pause eat the interval", () => {
    // Paused for an hour, then resumed: there are still fifteen minutes left.
    const paused = pause(start(IDLE, T0), at(10));
    const resumed = resume(paused, at(70));

    expect(remainingSeconds(resumed, at(70))).toBe(15 * 60);
  });

  it("carries on from where it stopped", () => {
    const resumed = resume(pause(start(IDLE, T0), at(10)), at(70));
    expect(remainingSeconds(resumed, at(75))).toBe(10 * 60);
  });

  it("ignores pausing something that is not running", () => {
    expect(pause(IDLE, T0)).toBe(IDLE);
    expect(resume(IDLE, T0)).toBe(IDLE);
  });
});

/* ── Stopping ─────────────────────────────────────────────────────────── */

describe("stopping", () => {
  it("records a completed focus session", () => {
    const { session, next } = stop(start(IDLE, T0), at(25));

    expect(session).toMatchObject({
      kind: "focus",
      completed: true,
      seconds: 25 * 60,
      plannedMinutes: 25,
    });
    expect(next.completedFocus).toBe(1);
  });

  it("counts the time actually spent when stopped early", () => {
    // A product that discards twenty minutes because you were interrupted at
    // minute twenty-one teaches you not to use the timer.
    const { session, next } = stop(start(IDLE, T0), at(20));

    expect(session?.completed).toBe(false);
    expect(session?.seconds).toBe(20 * 60);
    // An abandoned focus does not advance the long-break cadence.
    expect(next.completedFocus).toBe(0);
  });

  it("caps an overrun at the planned length", () => {
    // A laptop asleep for eight hours must not log an eight-hour Pomodoro.
    const { session } = stop(start(IDLE, T0), at(480));
    expect(session?.seconds).toBe(25 * 60);
  });

  it("keeps the task linkage", () => {
    const { session } = stop(start(IDLE, T0, { taskId: "task-1" }), at(25));
    expect(session?.taskId).toBe("task-1");
  });

  it("records a paused session's banked time", () => {
    const { session } = stop(pause(start(IDLE, T0), at(10)), at(60));
    expect(session?.seconds).toBe(10 * 60);
  });

  it("does nothing when there is nothing running", () => {
    expect(stop(IDLE, T0).session).toBeNull();
  });
});

/* ── The cadence ──────────────────────────────────────────────────────── */

describe("long break cadence", () => {
  it("gives a short break after the first three focus intervals", () => {
    for (const completed of [1, 2, 3]) {
      expect(
        nextKind({ ...IDLE, kind: "focus", completedFocus: completed }),
      ).toBe("short_break");
    }
  });

  it("gives a long break after the fourth", () => {
    expect(nextKind({ ...IDLE, kind: "focus", completedFocus: 4 })).toBe(
      "long_break",
    );
    expect(nextKind({ ...IDLE, kind: "focus", completedFocus: 8 })).toBe(
      "long_break",
    );
  });

  it("returns to focus after any break", () => {
    expect(nextKind({ ...IDLE, kind: "short_break", completedFocus: 2 })).toBe(
      "focus",
    );
    expect(nextKind({ ...IDLE, kind: "long_break", completedFocus: 4 })).toBe(
      "focus",
    );
  });

  it("honours a different cadence", () => {
    expect(
      nextKind(
        { ...IDLE, kind: "focus", completedFocus: 2 },
        { ...DEFAULT_POMODORO, longBreakEvery: 2 },
      ),
    ).toBe("long_break");
  });

  it("walks a full cycle", () => {
    let state: PomodoroState = IDLE;
    const sequence: string[] = [];

    for (let round = 0; round < 4; round += 1) {
      sequence.push(state.kind);
      state = stop(start(state, T0), at(25)).next;
      sequence.push(state.kind);
      state = stop(start(state, T0), at(60)).next;
    }

    expect(sequence).toEqual([
      "focus",
      "short_break",
      "focus",
      "short_break",
      "focus",
      "short_break",
      "focus",
      "long_break",
    ]);
  });
});

describe("skip", () => {
  it("moves on without recording anything", () => {
    const skipped = skip(start(IDLE, T0));
    expect(skipped.kind).toBe("short_break");
    expect(skipped.startedAt).toBeNull();
  });

  it("keeps the task and the cadence", () => {
    const skipped = skip({ ...IDLE, taskId: "t1", completedFocus: 3 });
    expect(skipped.taskId).toBe("t1");
    expect(skipped.completedFocus).toBe(3);
  });
});

/* ── Contribution to hours ────────────────────────────────────────────── */

describe("contribution to hours", () => {
  it("counts a completed focus session", () => {
    const { session } = stop(start(IDLE, T0), at(25));
    expect(contributesToHours(session!)).toBe(true);
  });

  it("counts an abandoned focus session for the time spent", () => {
    const { session } = stop(start(IDLE, T0), at(12));
    expect(contributesToHours(session!)).toBe(true);
    expect(toTimeEntry(session!)).toEqual({
      startedAt: "2026-08-12T14:00:00.000Z",
      endedAt: at(12).toISOString(),
      taskId: null,
    });
  });

  it("does not count a break", () => {
    // Breaks are not work.
    const { session } = stop(
      start({ ...IDLE, kind: "short_break" }, T0),
      at(5),
    );
    expect(contributesToHours(session!)).toBe(false);
    expect(toTimeEntry(session!)).toBeNull();
  });

  it("does not count a zero-length session", () => {
    const { session } = stop(start(IDLE, T0), T0);
    expect(contributesToHours(session!)).toBe(false);
  });
});

describe("formatRemaining", () => {
  it("is always two digits each side", () => {
    expect(formatRemaining(1500)).toBe("25:00");
    expect(formatRemaining(59)).toBe("00:59");
    expect(formatRemaining(0)).toBe("00:00");
    expect(formatRemaining(-5)).toBe("00:00");
  });
});

/* ── The offline outbox ───────────────────────────────────────────────── */

const queued = (over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  clientKey: "ob-1",
  startedAt: "2026-08-12T14:00:00.000Z",
  endedAt: "2026-08-12T14:25:00.000Z",
  source: "focused",
  queuedAt: "2026-08-12T14:25:00.000Z",
  attempts: 0,
  ...over,
});

describe("outbox reconciliation", () => {
  it("clears an accepted entry", () => {
    const result = reconcileOutbox(
      [queued()],
      [{ clientKey: "ob-1", status: "accepted" }],
    );

    expect(result.settled).toEqual(["ob-1"]);
    expect(result.retained).toEqual([]);
  });

  it("treats a duplicate as a success", () => {
    // The normal outcome of a connection that dies after the write but before
    // the response. Retrying is correct; double-counting is not.
    const result = reconcileOutbox(
      [queued()],
      [{ clientKey: "ob-1", status: "duplicate" }],
    );

    expect(result.settled).toEqual(["ob-1"]);
    expect(result.rejected).toEqual([]);
  });

  it("keeps a transient failure and counts the attempt", () => {
    const result = reconcileOutbox(
      [queued()],
      [{ clientKey: "ob-1", status: "failed", error: "network" }],
    );

    expect(result.settled).toEqual([]);
    expect(result.retained[0].attempts).toBe(1);
    expect(result.retained[0].lastError).toBe("network");
  });

  it("keeps an entry the server said nothing about", () => {
    // The request may never have been sent. Assuming success would lose the
    // time, which is the one thing this must never do.
    const result = reconcileOutbox([queued()], []);

    expect(result.retained).toHaveLength(1);
    expect(result.settled).toEqual([]);
  });

  it("surfaces a permanent rejection rather than silently dropping it", () => {
    const result = reconcileOutbox(
      [queued()],
      [{ clientKey: "ob-1", status: "rejected", error: "task was deleted" }],
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].error).toBe("task was deleted");
    // Removed from the queue, but the caller has it to tell the owner about.
    expect(result.settled).toEqual(["ob-1"]);
  });

  it("handles a mixed flush", () => {
    const result = reconcileOutbox(
      [
        queued({ clientKey: "a" }),
        queued({ clientKey: "b" }),
        queued({ clientKey: "c" }),
      ],
      [
        { clientKey: "a", status: "accepted" },
        { clientKey: "b", status: "failed", error: "timeout" },
      ],
    );

    expect(result.settled).toEqual(["a"]);
    expect(result.retained.map((entry) => entry.clientKey)).toEqual(["b", "c"]);
  });

  it("never loses an entry — every one is settled or retained", () => {
    const queue = [
      queued({ clientKey: "a" }),
      queued({ clientKey: "b" }),
      queued({ clientKey: "c" }),
      queued({ clientKey: "d" }),
    ];

    const result = reconcileOutbox(queue, [
      { clientKey: "a", status: "accepted" },
      { clientKey: "b", status: "duplicate" },
      { clientKey: "c", status: "failed", error: "x" },
      { clientKey: "d", status: "rejected", error: "y" },
    ]);

    const accounted = new Set([
      ...result.settled,
      ...result.retained.map((entry) => entry.clientKey),
    ]);

    expect(accounted.size).toBe(queue.length);
  });

  it("is idempotent when the same flush is reconciled twice", () => {
    const once = reconcileOutbox(
      [queued()],
      [{ clientKey: "ob-1", status: "failed", error: "x" }],
    );
    const twice = reconcileOutbox(once.retained, [
      { clientKey: "ob-1", status: "duplicate" },
    ]);

    expect(twice.settled).toEqual(["ob-1"]);
    expect(twice.retained).toEqual([]);
  });
});

describe("flush scheduling", () => {
  it("tries a fresh entry immediately", () => {
    expect(flushBackOffMs(0)).toBe(0);
    expect(dueForFlush([queued()], T0)).toHaveLength(1);
  });

  it("backs off after failures, capped at five minutes", () => {
    expect(flushBackOffMs(1)).toBe(1000);
    expect(flushBackOffMs(4)).toBe(8000);
    expect(flushBackOffMs(50)).toBe(300_000);
  });

  it("waits out the back-off", () => {
    const entry = queued({
      attempts: 3,
      lastAttemptAt: T0.toISOString(),
    });

    expect(dueForFlush([entry], new Date(T0.getTime() + 1000))).toEqual([]);
    expect(dueForFlush([entry], new Date(T0.getTime() + 10_000))).toHaveLength(
      1,
    );
  });
});

describe("queue helpers", () => {
  it("generates a distinct client key each time", () => {
    const keys = new Set(Array.from({ length: 200 }, () => newClientKey()));
    expect(keys.size).toBe(200);
  });

  it("drafts an entry ready to queue", () => {
    const entry = draftEntry(
      {
        startedAt: T0.toISOString(),
        endedAt: at(25).toISOString(),
        source: "focused",
      },
      T0,
    );

    expect(entry.attempts).toBe(0);
    expect(entry.clientKey).toMatch(/^ob-/);
    expect(entry.queuedAt).toBe(T0.toISOString());
  });

  it("totals the time waiting to sync", () => {
    // Shown as "3 entries waiting — 1h 45m", so the owner is not left
    // wondering whether their afternoon was recorded.
    expect(
      pendingMinutes([
        queued({ startedAt: T0.toISOString(), endedAt: at(60).toISOString() }),
        queued({ startedAt: T0.toISOString(), endedAt: at(45).toISOString() }),
      ]),
    ).toBe(105);
  });

  it("ignores an unparseable entry rather than throwing", () => {
    expect(
      pendingMinutes([queued({ startedAt: "nope", endedAt: "also nope" })]),
    ).toBe(0);
  });
});

/* ── The whole path ───────────────────────────────────────────────────── */

describe("a Pomodoro logged offline", () => {
  it("becomes a queued entry that survives a failed flush and syncs later", () => {
    // The gate: offline logging survives a disconnect.
    const { session } = stop(start(IDLE, T0, { taskId: "task-1" }), at(25));
    const entry = toTimeEntry(session!);

    expect(entry).not.toBeNull();

    const queuedEntry = draftEntry(
      { ...entry!, source: "focused", sessionId: null },
      at(25),
    );

    // Offline: the flush fails, and the entry stays put.
    const offline = reconcileOutbox(
      [queuedEntry],
      [
        {
          clientKey: queuedEntry.clientKey,
          status: "failed",
          error: "offline",
        },
      ],
    );
    expect(offline.retained).toHaveLength(1);
    expect(pendingMinutes(offline.retained)).toBe(25);

    // Reconnected: it lands, once.
    const online = reconcileOutbox(offline.retained, [
      { clientKey: queuedEntry.clientKey, status: "accepted" },
    ]);
    expect(online.settled).toEqual([queuedEntry.clientKey]);
    expect(online.retained).toEqual([]);
  });
});
