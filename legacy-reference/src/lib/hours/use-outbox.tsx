"use client";

import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { hoursKeys } from "./client";
import {
  draftEntry,
  dueForFlush,
  indexedDbOutbox,
  outboxAvailable,
  pendingMinutes,
  reconcileOutbox,
  type FlushOutcome,
  type OutboxEntry,
  type OutboxStore,
} from "./outbox";

/**
 * The outbox, wired to the browser.
 *
 * The rule the whole module exists to keep: **the network is never on the path
 * between the owner logging time and that time being safe.** `log()` writes to
 * IndexedDB and returns. Sending happens afterwards, and failing to send
 * changes nothing about whether the hour was recorded.
 *
 * A flush is attempted when: something is queued, the browser fires `online`,
 * the tab becomes visible again, or the back-off timer for a failed entry
 * expires. No polling — a phone in a pocket should not be waking up to check.
 *
 * ── One queue per tab, not one per component ─────────────────────────────
 * The state lives in a provider mounted once. An earlier version let every
 * caller run its own copy of the hook, and the result was exactly the bug you
 * would predict: the quick-log button queued an entry into its own React
 * state, the banner had a different copy, and an entry sitting unsent showed
 * nothing at all. They shared IndexedDB but not the state derived from it,
 * which is the worst of both. `useOutbox` now reads a context, so there is one
 * queue, one flush in flight, and one answer to "is anything waiting?".
 */

export interface OutboxState {
  queue: OutboxEntry[];
  pendingMinutes: number;
  /** Entries the server refused permanently. Shown, never silently dropped. */
  rejected: { entry: OutboxEntry; error: string }[];
  flushing: boolean;
  online: boolean;
  /** False when IndexedDB isn't available; the UI then says so plainly. */
  available: boolean;
}

export interface UseOutboxResult extends OutboxState {
  log(
    input: Omit<OutboxEntry, "clientKey" | "queuedAt" | "attempts">,
  ): Promise<OutboxEntry>;
  flush(): Promise<void>;
  dismissRejected(clientKey: string): void;
}

/**
 * The implementation. Call this **once**, in the provider below.
 *
 * Exported so tests can drive it against a fake store without mounting the
 * whole application, and for nothing else.
 */
export function useOutboxState(
  store: OutboxStore = indexedDbOutbox,
): UseOutboxResult {
  const queryClient = useQueryClient();

  const [queue, setQueue] = React.useState<OutboxEntry[]>([]);
  const [rejected, setRejected] = React.useState<
    { entry: OutboxEntry; error: string }[]
  >([]);
  const [flushing, setFlushing] = React.useState(false);
  const [online, setOnline] = React.useState(true);
  const [available, setAvailable] = React.useState(true);

  // A ref as well as state: the flush callback must see the current queue
  // without being re-created on every change, or the effect below would
  // re-subscribe constantly.
  const queueRef = React.useRef<OutboxEntry[]>([]);
  const flushingRef = React.useRef(false);

  const apply = React.useCallback((next: OutboxEntry[]) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  /* ── Load whatever survived the last session ────────────────────────── */

  React.useEffect(() => {
    setAvailable(outboxAvailable());
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);

    if (!outboxAvailable()) return;

    let cancelled = false;
    void store
      .all()
      .then((entries) => {
        if (!cancelled) apply(entries);
      })
      .catch(() => {
        // A browser that refuses IndexedDB (private mode on some engines) is
        // reported rather than silently degraded — the owner needs to know
        // their offline logging isn't actually offline-safe.
        if (!cancelled) setAvailable(false);
      });

    return () => {
      cancelled = true;
    };
  }, [store, apply]);

  /* ── Flushing ───────────────────────────────────────────────────────── */

  const flush = React.useCallback(async () => {
    if (flushingRef.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    const due = dueForFlush(queueRef.current);
    if (due.length === 0) return;

    flushingRef.current = true;
    setFlushing(true);

    const outcomes: FlushOutcome[] = [];

    // Sequential rather than parallel. These are a handful of small rows, and
    // a burst of parallel writes on a connection that has just come back is
    // the reliable way to get half of them to fail.
    for (const entry of due) {
      outcomes.push(await send(entry));
    }

    const result = reconcileOutbox(queueRef.current, outcomes);

    for (const clientKey of result.settled) {
      await store.remove(clientKey).catch(() => undefined);
    }
    for (const entry of result.retained) {
      await store.put(entry).catch(() => undefined);
    }

    apply(result.retained);
    if (result.rejected.length > 0) {
      setRejected((current) => [...current, ...result.rejected]);
    }

    flushingRef.current = false;
    setFlushing(false);

    if (result.settled.length > 0) {
      void queryClient.invalidateQueries({ queryKey: hoursKeys.all });
    }
  }, [store, apply, queryClient]);

  /* ── When to try ────────────────────────────────────────────────────── */

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const goOnline = () => {
      setOnline(true);
      void flush();
    };
    const goOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") void flush();
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [flush]);

  // One timer, set to the soonest back-off deadline, rather than an interval.
  React.useEffect(() => {
    if (queue.length === 0) return;
    if (dueForFlush(queue).length > 0) {
      void flush();
      return;
    }

    const timer = window.setTimeout(() => void flush(), 15_000);
    return () => window.clearTimeout(timer);
  }, [queue, flush]);

  /* ── Logging ────────────────────────────────────────────────────────── */

  const log = React.useCallback(
    async (input: Omit<OutboxEntry, "clientKey" | "queuedAt" | "attempts">) => {
      const entry = draftEntry(input);

      // Durable before anything else happens. If the tab dies on the next
      // line, the entry is still there on the next load.
      if (outboxAvailable()) {
        await store.put(entry);
      }

      apply([...queueRef.current, entry]);
      void flush();

      return entry;
    },
    [store, apply, flush],
  );

  const dismissRejected = React.useCallback((clientKey: string) => {
    setRejected((current) =>
      current.filter((item) => item.entry.clientKey !== clientKey),
    );
  }, []);

  return {
    queue,
    pendingMinutes: pendingMinutes(queue),
    rejected,
    flushing,
    online,
    available,
    log,
    flush,
    dismissRejected,
  };
}

/* ── The single instance ──────────────────────────────────────────────── */

const OutboxContext = React.createContext<UseOutboxResult | null>(null);

export function OutboxProvider({
  children,
  store,
}: {
  children: React.ReactNode;
  store?: OutboxStore;
}) {
  const value = useOutboxState(store);
  return (
    <OutboxContext.Provider value={value}>{children}</OutboxContext.Provider>
  );
}

/**
 * The queue, shared by everything that logs or reports on it.
 *
 * Throws rather than falling back to a private instance: a component quietly
 * getting its own queue is the bug this replaced, and it is invisible until
 * someone logs time offline and the banner stays empty.
 */
export function useOutbox(): UseOutboxResult {
  const context = React.useContext(OutboxContext);
  if (!context) {
    throw new Error("useOutbox must be used inside an OutboxProvider");
  }
  return context;
}

/**
 * Sends one entry and classifies what came back.
 *
 * The classification is the contract with `reconcileOutbox`, and the
 * distinction that matters is 4xx versus everything else: a 400 will never
 * succeed however many times it is retried, while a 500 or a dropped socket
 * almost certainly will. A duplicate — which the server answers with 200 and
 * `duplicate: true` — is a success.
 */
async function send(entry: OutboxEntry): Promise<FlushOutcome> {
  try {
    const response = await fetch("/api/hours", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "manual",
        taskId: entry.taskId ?? null,
        categoryId: entry.categoryId ?? null,
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        note: entry.note ?? null,
        clientKey: entry.clientKey,
      }),
    });

    if (response.ok) {
      const body = (await response.json().catch(() => null)) as {
        duplicate?: boolean;
      } | null;

      return {
        clientKey: entry.clientKey,
        status: body?.duplicate ? "duplicate" : "accepted",
      };
    }

    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    const error = body?.error ?? `Request failed (${response.status})`;

    // 401 is deliberately transient: the session can be refreshed, and
    // discarding logged time because a cookie expired would be indefensible.
    if (
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 401
    ) {
      return { clientKey: entry.clientKey, status: "rejected", error };
    }

    return { clientKey: entry.clientKey, status: "failed", error };
  } catch (error) {
    return {
      clientKey: entry.clientKey,
      status: "failed",
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}
