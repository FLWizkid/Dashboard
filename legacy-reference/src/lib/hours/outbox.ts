/**
 * The offline outbox.
 *
 * The specification's requirement is blunt and correct: **never lose logged
 * time**. Someone logs an hour on a phone in a basement, the network is gone,
 * and that hour has to survive — the app closing, the tab being killed, the
 * phone restarting, and a flush that fails halfway.
 *
 * ── How that is achieved ─────────────────────────────────────────────────
 *
 * 1. **Write locally first, always.** A logged entry is durable in IndexedDB
 *    before any request is attempted. The network is never on the path
 *    between the owner pressing stop and the time being safe.
 *
 * 2. **Every entry carries a client key**, generated on the device. The
 *    server has a unique index on it, so replaying a flush — which is the
 *    normal outcome of a connection that dies after the write but before the
 *    response — cannot double-count. An entry that comes back as a duplicate
 *    is a *success*, not an error.
 *
 * 3. **Nothing is deleted until the server has confirmed it.** A failed flush
 *    leaves the entry exactly where it was, with an attempt count, and the
 *    next reconnection tries again.
 *
 * The merge logic and the storage are separated so the interesting half can
 * be tested without a browser: `reconcileOutbox` is pure.
 */

import {
  offlineStorageAvailable,
  STORES,
  transact,
} from "@/lib/offline/database";

export interface OutboxEntry {
  /** Generated on the device. The server's idempotency key. */
  clientKey: string;
  startedAt: string;
  endedAt: string;
  source: "focused" | "manual";
  taskId?: string | null;
  categoryId?: string | null;
  sessionId?: string | null;
  note?: string | null;
  /** When it was queued locally, for ordering and for the UI. */
  queuedAt: string;
  /** How many flushes have failed. Drives back-off and the warning badge. */
  attempts: number;
  /** When the last flush was attempted, for the back-off. */
  lastAttemptAt?: string | null;
  /** The last failure, shown if it keeps failing. */
  lastError?: string | null;
}

/** What the server said about one entry. */
export type FlushOutcome =
  /** Stored. Remove it locally. */
  | { clientKey: string; status: "accepted" }
  /**
   * Already present — a previous flush got through and the response did not.
   * Also a success; remove it locally.
   */
  | { clientKey: string; status: "duplicate" }
  /**
   * The server refused it permanently: malformed, or referencing something
   * deleted. Retrying will never help.
   */
  | { clientKey: string; status: "rejected"; error: string }
  /** Transient. Keep it and try again. */
  | { clientKey: string; status: "failed"; error: string };

export interface ReconcileResult {
  /** Entries to delete from the local queue. */
  settled: string[];
  /** Entries to keep, with their attempt counts updated. */
  retained: OutboxEntry[];
  /** Permanently refused, kept aside so the owner can be told rather than
   *  having the time vanish. */
  rejected: { entry: OutboxEntry; error: string }[];
}

/** Entries the server never answered about are kept, not assumed lost. */
export function reconcileOutbox(
  queue: OutboxEntry[],
  outcomes: FlushOutcome[],
): ReconcileResult {
  const byKey = new Map(
    outcomes.map((outcome) => [outcome.clientKey, outcome]),
  );

  const settled: string[] = [];
  const retained: OutboxEntry[] = [];
  const rejected: { entry: OutboxEntry; error: string }[] = [];

  for (const entry of queue) {
    const outcome = byKey.get(entry.clientKey);

    // No word from the server about this one. The request may not have been
    // sent at all. Keeping it is the only safe answer.
    if (!outcome) {
      retained.push(entry);
      continue;
    }

    switch (outcome.status) {
      case "accepted":
      case "duplicate":
        // A duplicate means a previous flush got through and we never heard.
        // That is exactly what the client key is for.
        settled.push(entry.clientKey);
        break;

      case "rejected":
        // Not retryable, but not discardable either: the owner logged this
        // time and is entitled to know it did not stick.
        rejected.push({ entry, error: outcome.error });
        settled.push(entry.clientKey);
        break;

      case "failed":
        retained.push({
          ...entry,
          attempts: entry.attempts + 1,
          lastAttemptAt: new Date().toISOString(),
          lastError: outcome.error,
        });
        break;
    }
  }

  return { settled, retained, rejected };
}

/**
 * Back-off before the next flush attempt, in milliseconds.
 *
 * Capped at five minutes: a phone that has been offline all afternoon should
 * still notice reconnection promptly, and the flush is a handful of small
 * rows, not something worth protecting the server from.
 */
export function flushBackOffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(2 ** (attempts - 1) * 1000, 5 * 60_000);
}

/** Entries due for another attempt. */
export function dueForFlush(
  queue: OutboxEntry[],
  now: Date = new Date(),
): OutboxEntry[] {
  return queue.filter((entry) => {
    if (entry.attempts === 0) return true;
    const last = Date.parse(entry.lastAttemptAt ?? entry.queuedAt);
    if (!Number.isFinite(last)) return true;
    return now.getTime() - last >= flushBackOffMs(entry.attempts);
  });
}

/**
 * A client key.
 *
 * `crypto.randomUUID` where it exists — every browser this product supports —
 * with a fallback that is still collision-resistant enough for one device's
 * queue, because a key that is merely unlikely to repeat is fine when the
 * uniqueness constraint is per-user.
 */
export function newClientKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `ob-${crypto.randomUUID()}`;
  }

  const random = Math.random().toString(36).slice(2, 12);
  return `ob-${Date.now().toString(36)}-${random}`;
}

/** Builds an entry ready to queue. */
export function draftEntry(
  input: Omit<OutboxEntry, "clientKey" | "queuedAt" | "attempts">,
  now: Date = new Date(),
): OutboxEntry {
  return {
    ...input,
    clientKey: newClientKey(),
    queuedAt: now.toISOString(),
    attempts: 0,
  };
}

/**
 * Total minutes sitting unsent.
 *
 * Shown in the UI so "3 entries waiting to sync — 1h 45m" is visible rather
 * than the owner wondering whether their afternoon was recorded.
 */
export function pendingMinutes(queue: OutboxEntry[]): number {
  return queue.reduce((total, entry) => {
    const start = Date.parse(entry.startedAt);
    const end = Date.parse(entry.endedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return total;
    return total + Math.max(0, Math.round((end - start) / 60_000));
  }, 0);
}

/* ── Storage ──────────────────────────────────────────────────────────── */

/**
 * The storage surface, so the pure logic can be driven by a fake in tests.
 */
export interface OutboxStore {
  all(): Promise<OutboxEntry[]>;
  put(entry: OutboxEntry): Promise<void>;
  remove(clientKey: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * IndexedDB-backed storage.
 *
 * IndexedDB rather than localStorage: it survives more aggressive eviction, it
 * is transactional, and it does not block the main thread — which matters when
 * the write is between the owner pressing stop and believing their time is
 * safe.
 *
 * The database itself is opened by `@/lib/offline/database`, which owns the
 * version. It has to: the capture queue shares this database, and a version
 * bumped in one caller and not the other fails every open with a
 * `VersionError` — silently breaking offline logging from a change to an
 * unrelated module.
 */
export const indexedDbOutbox: OutboxStore = {
  async all() {
    return transact<OutboxEntry[]>(STORES.hours, "readonly", (store) =>
      store.getAll(),
    );
  },
  async put(entry) {
    await transact(STORES.hours, "readwrite", (store) => store.put(entry));
  },
  async remove(clientKey) {
    await transact(STORES.hours, "readwrite", (store) =>
      store.delete(clientKey),
    );
  },
  async clear() {
    await transact(STORES.hours, "readwrite", (store) => store.clear());
  },
};

/** True when this environment can store an outbox at all. */
export function outboxAvailable(): boolean {
  return offlineStorageAvailable();
}
