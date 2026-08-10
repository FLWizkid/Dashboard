"use client";

import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { taskKeys } from "./client";
import {
  captureQueueAvailable,
  dueForFlush,
  indexedDbCaptureStore,
  newClientKey,
  reconcileCaptures,
  type CaptureOutcome,
  type CaptureStore,
  type PendingCapture,
} from "./capture-queue";
import type { CreateTaskPayload } from "./schema";

/**
 * The capture queue, wired to the browser.
 *
 * The rule: **the network is never on the path between pressing Enter and the
 * capture being safe.** `capture()` writes to IndexedDB and returns. Sending
 * happens afterwards; failing to send changes nothing about whether the
 * thought was recorded.
 *
 * Structured exactly like the hours outbox, including the mistake it already
 * paid for: the state lives in a provider mounted **once**, and the hook reads
 * a context. Letting every caller run its own copy gives each component a
 * different idea of what is queued — they share IndexedDB but not the state
 * derived from it, which is the worst of both.
 *
 * ── When a capture is queued ─────────────────────────────────────────────
 * Only when the direct POST fails, or the browser already knows it is offline.
 * The normal online path is untouched: a task appears in the list because the
 * server said so, not because the queue optimistically drew it. Routing every
 * capture through the queue would mean the common case inherits the failure
 * modes of the rare one.
 */

export interface CaptureQueueState {
  queue: PendingCapture[];
  rejected: { capture: PendingCapture; error: string }[];
  flushing: boolean;
  online: boolean;
  /** False when IndexedDB isn't available; the UI then says so plainly. */
  available: boolean;
}

export interface UseCaptureQueueResult extends CaptureQueueState {
  /** Queue a capture that could not be sent. Durable before it returns. */
  enqueue(payload: CreateTaskPayload): Promise<PendingCapture>;
  flush(): Promise<void>;
  dismissRejected(clientKey: string): void;
}

const CaptureQueueContext = React.createContext<UseCaptureQueueResult | null>(
  null,
);

/**
 * The implementation. Call this **once**, in the provider below.
 *
 * Exported so tests can drive it against a fake store without mounting the
 * whole application, and for nothing else.
 */
export function useCaptureQueueState(
  store: CaptureStore = indexedDbCaptureStore,
): UseCaptureQueueResult {
  const queryClient = useQueryClient();

  const [queue, setQueue] = React.useState<PendingCapture[]>([]);
  const [rejected, setRejected] = React.useState<
    { capture: PendingCapture; error: string }[]
  >([]);
  const [flushing, setFlushing] = React.useState(false);
  const [online, setOnline] = React.useState(true);
  const [available, setAvailable] = React.useState(true);

  // A ref as well as state, so the flush callback sees the current queue
  // without being re-created on every change.
  const queueRef = React.useRef<PendingCapture[]>([]);
  const flushingRef = React.useRef(false);

  const apply = React.useCallback((next: PendingCapture[]) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  /* ── Load whatever survived the last session ────────────────────────── */

  React.useEffect(() => {
    setAvailable(captureQueueAvailable());
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);

    if (!captureQueueAvailable()) return;

    let cancelled = false;
    void store
      .all()
      .then((captures) => {
        if (!cancelled) apply(captures);
      })
      .catch(() => {
        // A browser that refuses IndexedDB is reported rather than silently
        // degraded: the owner needs to know that capture is not offline-safe
        // here, because they will trust it if nothing says otherwise.
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

    const outcomes: CaptureOutcome[] = [];

    // Sequential, and in the order they were typed. A burst of parallel
    // writes on a connection that has just come back is the reliable way to
    // get half of them to fail, and it would also scramble the order the
    // tasks appear in.
    for (const capture of due) {
      outcomes.push(await send(capture));
    }

    const result = reconcileCaptures(queueRef.current, outcomes);

    for (const clientKey of result.settled) {
      await store.remove(clientKey).catch(() => undefined);
    }
    for (const capture of result.retained) {
      await store.put(capture).catch(() => undefined);
    }
    for (const { capture } of result.rejected) {
      await store.remove(capture.clientKey).catch(() => undefined);
    }

    apply(result.retained);
    if (result.rejected.length > 0) {
      setRejected((current) => [...current, ...result.rejected]);
    }

    flushingRef.current = false;
    setFlushing(false);

    if (result.settled.length > 0) {
      void queryClient.invalidateQueries({ queryKey: taskKeys.all });
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

  // One timer rather than an interval — a phone in a pocket should not be
  // waking up to check.
  React.useEffect(() => {
    if (queue.length === 0) return;
    if (dueForFlush(queue).length > 0) {
      void flush();
      return;
    }

    const timer = window.setTimeout(() => void flush(), 15_000);
    return () => window.clearTimeout(timer);
  }, [queue, flush]);

  /* ── Queueing ───────────────────────────────────────────────────────── */

  const enqueue = React.useCallback(
    async (payload: CreateTaskPayload) => {
      const clientKey = newClientKey();
      const capture: PendingCapture = {
        clientKey,
        // The key travels *with* the payload, so whichever attempt reaches
        // the server carries the same idempotency key as every other.
        payload: { ...payload, clientKey },
        queuedAt: new Date().toISOString(),
        attempts: 0,
      };

      // Durable before anything else happens. If the tab dies on the next
      // line, the capture is still there on the next load.
      if (captureQueueAvailable()) {
        await store.put(capture);
      }

      apply([...queueRef.current, capture]);
      void flush();

      return capture;
    },
    [store, apply, flush],
  );

  const dismissRejected = React.useCallback((clientKey: string) => {
    setRejected((current) =>
      current.filter((item) => item.capture.clientKey !== clientKey),
    );
  }, []);

  return {
    queue,
    rejected,
    flushing,
    online,
    available,
    enqueue,
    flush,
    dismissRejected,
  };
}

/** Sends one capture. Never throws — every outcome is a value. */
async function send(capture: PendingCapture): Promise<CaptureOutcome> {
  try {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(capture.payload),
    });

    // 200 is the server saying "this key already made a task" — a success.
    // 201 is a new one. Both mean the capture is safe and can leave the queue.
    if (response.status === 200) {
      return { clientKey: capture.clientKey, status: "duplicate" };
    }
    if (response.ok) {
      return { clientKey: capture.clientKey, status: "accepted" };
    }

    // 4xx other than 429 will never succeed on a retry: the payload itself is
    // the problem. Anything else is worth trying again.
    if (
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 429
    ) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      return {
        clientKey: capture.clientKey,
        status: "rejected",
        error: body?.error ?? `The server refused it (${response.status})`,
      };
    }

    return {
      clientKey: capture.clientKey,
      status: "failed",
      error: `The server is unavailable (${response.status})`,
    };
  } catch (error) {
    return {
      clientKey: capture.clientKey,
      status: "failed",
      error: error instanceof Error ? error.message : "Network unavailable",
    };
  }
}

export function CaptureQueueProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const value = useCaptureQueueState();
  return (
    <CaptureQueueContext.Provider value={value}>
      {children}
    </CaptureQueueContext.Provider>
  );
}

/**
 * Throws outside the provider rather than falling back to a private queue.
 *
 * A silent fallback is how the hours module ended up with one queue per
 * component; the bug was invisible because everything still "worked".
 */
export function useCaptureQueue(): UseCaptureQueueResult {
  const value = React.useContext(CaptureQueueContext);
  if (!value) {
    throw new Error(
      "useCaptureQueue must be used inside a CaptureQueueProvider",
    );
  }
  return value;
}
