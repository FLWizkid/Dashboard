import { describe, expect, it } from "vitest";

import {
  dueForFlush,
  newClientKey,
  reconcileCaptures,
  retryDelayMs,
  type CaptureOutcome,
  type PendingCapture,
} from "./capture-queue";
import type { CreateTaskPayload } from "./schema";

/**
 * The capture queue's merge.
 *
 * The property under test is the one the whole feature rests on: **a capture
 * leaves the queue only when the server has confirmed it, and never leaves it
 * twice.** Everything else here is a way of poking at that.
 */

function payload(title: string): CreateTaskPayload {
  return {
    title,
    notes: null,
    priority: null,
    dueAt: null,
    categoryId: null,
    status: "inbox",
    pinned: false,
    sourceLink: null,
    owner: null,
    links: [],
    clientKey: null,
  };
}

function capture(
  clientKey: string,
  over: Partial<PendingCapture> = {},
): PendingCapture {
  return {
    clientKey,
    payload: payload(`Task ${clientKey}`),
    queuedAt: "2026-08-10T09:00:00.000Z",
    attempts: 0,
    ...over,
  };
}

const NOW = new Date("2026-08-10T10:00:00.000Z");

describe("reconciling a flush", () => {
  it("settles what the server accepted", () => {
    const result = reconcileCaptures(
      [capture("a"), capture("b")],
      [
        { clientKey: "a", status: "accepted" },
        { clientKey: "b", status: "accepted" },
      ],
      NOW,
    );

    expect(result.settled).toEqual(["a", "b"]);
    expect(result.retained).toEqual([]);
  });

  it("treats a duplicate as a success, not an error", () => {
    // This is the single most important line in the file. A connection that
    // dies after the write but before the response is the *normal* failure,
    // and the retry that follows must settle rather than retry forever.
    const result = reconcileCaptures(
      [capture("a")],
      [{ clientKey: "a", status: "duplicate" }],
      NOW,
    );

    expect(result.settled).toEqual(["a"]);
    expect(result.rejected).toEqual([]);
  });

  it("keeps a transient failure and counts the attempt", () => {
    const result = reconcileCaptures(
      [capture("a")],
      [{ clientKey: "a", status: "failed", error: "offline" }],
      NOW,
    );

    expect(result.settled).toEqual([]);
    expect(result.retained).toEqual([
      expect.objectContaining({
        clientKey: "a",
        attempts: 1,
        lastError: "offline",
        lastAttemptAt: NOW.toISOString(),
      }),
    ]);
  });

  it("surfaces a permanent refusal instead of dropping it", () => {
    // Silently discarding a rejected capture would be exactly the data loss
    // this queue exists to prevent — the owner typed something and it
    // vanished. It comes back so they can see it and decide.
    const result = reconcileCaptures(
      [capture("a")],
      [{ clientKey: "a", status: "rejected", error: "title too long" }],
      NOW,
    );

    expect(result.settled).toEqual([]);
    expect(result.retained).toEqual([]);
    expect(result.rejected).toEqual([
      {
        capture: expect.objectContaining({ clientKey: "a" }),
        error: "title too long",
      },
    ]);
  });

  it("leaves a capture the flush never reached completely alone", () => {
    // Not attempted, so not counted as an attempt. Incrementing here would
    // back a capture off for a failure that never happened.
    const untouched = capture("b", { attempts: 2 });

    const result = reconcileCaptures(
      [capture("a"), untouched],
      [{ clientKey: "a", status: "accepted" }],
      NOW,
    );

    expect(result.settled).toEqual(["a"]);
    expect(result.retained).toEqual([untouched]);
  });

  it("ignores an outcome for something no longer queued", () => {
    // A flush that raced with a reset must not resurrect anything.
    const result = reconcileCaptures(
      [capture("a")],
      [
        { clientKey: "a", status: "accepted" },
        { clientKey: "gone", status: "accepted" },
      ],
      NOW,
    );

    expect(result.settled).toEqual(["a"]);
  });

  it("never settles the same capture twice", () => {
    const result = reconcileCaptures(
      [capture("a")],
      [
        { clientKey: "a", status: "accepted" },
        { clientKey: "a", status: "duplicate" },
      ] as CaptureOutcome[],
      NOW,
    );

    expect(result.settled).toEqual(["a"]);
  });

  it("is a no-op on an empty queue", () => {
    expect(reconcileCaptures([], [], NOW)).toEqual({
      settled: [],
      retained: [],
      rejected: [],
    });
  });
});

describe("back-off", () => {
  it("grows with each failure", () => {
    expect(retryDelayMs(1)).toBeLessThan(retryDelayMs(3));
  });

  it("stops growing, so a reconnection is not spent waiting", () => {
    // A queue that has backed off to an hour looks broken when the network
    // returns and the owner is standing there watching it.
    expect(retryDelayMs(50)).toBe(5 * 60_000);
  });

  it("flushes a never-attempted capture immediately", () => {
    expect(dueForFlush([capture("a")], NOW)).toHaveLength(1);
  });

  it("holds one that failed a moment ago", () => {
    const recent = capture("a", {
      attempts: 3,
      lastAttemptAt: new Date(NOW.getTime() - 1_000).toISOString(),
    });

    expect(dueForFlush([recent], NOW)).toEqual([]);
  });

  it("releases it once the delay has passed", () => {
    const old = capture("a", {
      attempts: 3,
      lastAttemptAt: new Date(NOW.getTime() - 60_000).toISOString(),
    });

    expect(dueForFlush([old], NOW)).toHaveLength(1);
  });

  it("flushes rather than stalls when the timestamp is unreadable", () => {
    // Corrupt local state must not be able to strand a capture forever.
    const broken = capture("a", { attempts: 2, lastAttemptAt: "not a date" });
    expect(dueForFlush([broken], NOW)).toHaveLength(1);
  });
});

describe("client keys", () => {
  it("never collide", () => {
    // Two captures sharing a key means the second is discarded as a
    // duplicate — silent data loss, from the code meant to prevent it.
    const keys = new Set(Array.from({ length: 5_000 }, () => newClientKey()));
    expect(keys.size).toBe(5_000);
  });

  it("are long enough for the server's constraint", () => {
    // `client_key` is checked to be 8–128 characters.
    const key = newClientKey();
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(128);
  });
});
