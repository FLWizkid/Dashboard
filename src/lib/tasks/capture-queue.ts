/**
 * The capture queue.
 *
 * Phase 4 made logged time survive a dead network. Capture did not have the
 * same protection, which is the wrong way round: **a task typed into a box
 * and then lost is the single worst thing this product can do.** Losing an
 * hour of time-tracking is an annoyance you can reconstruct; losing the
 * thought you had in a lift is losing the thought.
 *
 * The mechanism is deliberately identical to the hours outbox rather than a
 * second design:
 *
 *   1. **Write locally first.** The capture is durable in IndexedDB before any
 *      request is attempted. The network is never between pressing Enter and
 *      the task being safe.
 *
 *   2. **Carry a device-generated key.** `tasks (user_id, client_key)` is
 *      unique, so replaying a flush — the normal outcome of a connection that
 *      died after the write but before the response — cannot create a second
 *      task. A duplicate is a **success**.
 *
 *   3. **Delete nothing until the server confirms.** A failed flush leaves the
 *      capture where it is, with an attempt count, and the next reconnection
 *      tries again.
 *
 * The storage and the merge are separate so the interesting half is testable
 * without a browser.
 */

import {
  offlineStorageAvailable,
  STORES,
  transact,
} from "@/lib/offline/database";

import type { CreateTaskPayload } from "./schema";

/** A capture waiting to reach the server. */
export interface PendingCapture {
  /** Generated on the device. The server's idempotency key. */
  clientKey: string;
  /** Exactly what would have been POSTed. */
  payload: CreateTaskPayload;
  /** When it was queued, for ordering and for the UI. */
  queuedAt: string;
  attempts: number;
  lastAttemptAt?: string | null;
  lastError?: string | null;
}

/** What the server said about one capture. */
export type CaptureOutcome =
  /** Created. Remove it locally. */
  | { clientKey: string; status: "accepted" }
  /** Already present — a previous flush got through. Also remove it. */
  | { clientKey: string; status: "duplicate" }
  /** Permanently refused: malformed, or referencing something deleted. */
  | { clientKey: string; status: "rejected"; error: string }
  /** Transient. Keep it and try again. */
  | { clientKey: string; status: "failed"; error: string };

export interface ReconcileResult {
  /** Client keys to delete from the local queue. */
  settled: string[];
  /** Captures to keep, with their attempt counts updated. */
  retained: PendingCapture[];
  /** Permanently refused, so the interface can say so rather than retry. */
  rejected: { capture: PendingCapture; error: string }[];
}

/**
 * Folds a flush's outcomes back into the queue.
 *
 * Pure, and the only place that decides what survives. An outcome for a key
 * that is not queued is ignored rather than treated as an error: a flush that
 * raced with a reset should not be able to resurrect anything.
 */
export function reconcileCaptures(
  queue: readonly PendingCapture[],
  outcomes: readonly CaptureOutcome[],
  now: Date = new Date(),
): ReconcileResult {
  const byKey = new Map(
    outcomes.map((outcome) => [outcome.clientKey, outcome]),
  );

  const settled: string[] = [];
  const retained: PendingCapture[] = [];
  const rejected: { capture: PendingCapture; error: string }[] = [];

  for (const capture of queue) {
    const outcome = byKey.get(capture.clientKey);

    // No word either way — the flush never got to it. Untouched, including
    // its attempt count: it was not attempted.
    if (!outcome) {
      retained.push(capture);
      continue;
    }

    if (outcome.status === "accepted" || outcome.status === "duplicate") {
      settled.push(capture.clientKey);
      continue;
    }

    if (outcome.status === "rejected") {
      // Retrying will never help. Surfaced instead, so the owner can see the
      // text they typed and decide — dropping it silently would be the same
      // data loss this queue exists to prevent.
      rejected.push({ capture, error: outcome.error });
      continue;
    }

    retained.push({
      ...capture,
      attempts: capture.attempts + 1,
      lastAttemptAt: now.toISOString(),
      lastError: outcome.error,
    });
  }

  return { settled, retained, rejected };
}

/**
 * How long to wait before trying a capture again.
 *
 * Exponential, capped at five minutes. The cap matters more than the curve: a
 * queue that backs off to an hour is a queue that looks broken when the
 * network comes back, and the owner is standing there watching it.
 */
export function retryDelayMs(attempts: number): number {
  // The clamp is only there to keep the exponent finite. The *ceiling* is the
  // `Math.min` below — clamping attempts too low would silently make the
  // five-minute cap unreachable and quietly change the policy to "64 seconds
  // forever", which is what an earlier version of this line did.
  const exponent = Math.min(Math.max(attempts, 0), 20);
  return Math.min(5 * 60_000, 1_000 * 2 ** exponent);
}

/** Captures that are due for another attempt right now. */
export function dueForFlush(
  queue: readonly PendingCapture[],
  now: Date = new Date(),
): PendingCapture[] {
  return queue.filter((capture) => {
    if (capture.attempts === 0 || !capture.lastAttemptAt) return true;

    const last = Date.parse(capture.lastAttemptAt);
    if (!Number.isFinite(last)) return true;

    return now.getTime() - last >= retryDelayMs(capture.attempts);
  });
}

/**
 * A key for one capture.
 *
 * `crypto.randomUUID` where it exists, which is everywhere this app runs. The
 * fallback is not a security control — the key only has to be unique to this
 * device's queue — but it must never collide, because two captures sharing a
 * key means the second one is silently discarded as a duplicate.
 */
export function newClientKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `capture-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/* ── Storage ──────────────────────────────────────────────────────────── */

/** The storage surface, so the pure logic can be driven by a fake in tests. */
export interface CaptureStore {
  all(): Promise<PendingCapture[]>;
  put(capture: PendingCapture): Promise<void>;
  remove(clientKey: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * IndexedDB-backed storage, in the store next to the hours outbox.
 *
 * The database and its version are owned by `@/lib/offline/database` rather
 * than by either queue. That is not tidiness: this queue originally opened the
 * shared database at its own version, which made every open from the hours
 * outbox fail with a `VersionError` — adding offline capture silently broke
 * offline time logging in a module nobody had touched.
 */
export const indexedDbCaptureStore: CaptureStore = {
  async all() {
    const all = await transact<PendingCapture[]>(
      STORES.captures,
      "readonly",
      (store) => store.getAll(),
    );
    // Oldest first: the order they were typed is the order they should appear.
    return all.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  },
  async put(capture) {
    await transact(STORES.captures, "readwrite", (store) => store.put(capture));
  },
  async remove(clientKey) {
    await transact(STORES.captures, "readwrite", (store) =>
      store.delete(clientKey),
    );
  },
  async clear() {
    await transact(STORES.captures, "readwrite", (store) => store.clear());
  },
};

/** True when this environment can queue a capture at all. */
export function captureQueueAvailable(): boolean {
  return offlineStorageAvailable();
}
