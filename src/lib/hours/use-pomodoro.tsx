"use client";

import * as React from "react";

import { useEndSession, usePomodoro, useStartSession } from "./client";
import {
  contributesToHours,
  DEFAULT_POMODORO,
  elapsedMs,
  IDLE,
  isComplete,
  isRunning,
  nextKind,
  pause as pauseState,
  effectivePlannedMinutes,
  plannedMinutes,
  remainingSeconds,
  resume as resumeState,
  skip as skipState,
  start as startState,
  stop as stopState,
  type PomodoroKind,
  type PomodoroSettings,
  type PomodoroState,
} from "./pomodoro";
import { newClientKey } from "./outbox";

/**
 * The Pomodoro machine, wired to the browser and the server.
 *
 * Three things are kept in step and it is worth being explicit about which is
 * authoritative for what:
 *
 *   **The machine** (`pomodoro.ts`) owns the arithmetic. It holds instants,
 *   so it is right about elapsed time across a sleep, a lock and a reload.
 *
 *   **`localStorage`** owns durability across a reload on *this* device. It is
 *   written on every transition, not on a timer, so the last thing that
 *   happened is always what comes back.
 *
 *   **The server** owns the record. It is the reason a session survives
 *   clearing site data, and the reason the second device knows you are
 *   already focusing.
 *
 * The ticking is a 250ms interval that only forces a re-render — it never
 * advances state. Nothing here would be wrong if the interval stopped firing;
 * the display would just freeze until the tab woke up, and then jump to the
 * correct value rather than to a stale one.
 */

const STORAGE_KEY = "dashboard.pomodoro.v1";
const TICK_MS = 250;

export interface UsePomodoroResult {
  state: PomodoroState;
  settings: PomodoroSettings;
  /** Seconds left in the current interval. */
  remaining: number;
  /** 0–1, for the ring. */
  progress: number;
  running: boolean;
  complete: boolean;
  /** The session row, when the server has one. */
  sessionId: string | null;
  /**
   * True while a start or stop is in flight, or before the stored state has
   * been read back. Controls stay disabled until then — a Start button that
   * accepts a click it is going to discard is worse than one that waits.
   */
  busy: boolean;
  error: string | null;

  start(options?: {
    kind?: PomodoroKind;
    taskId?: string | null;
  }): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
  skip(): void;
  setTask(taskId: string | null): void;
  setCategory(categoryId: string | null): void;
  setPlannedOverride(minutes: number | null): void;
}

function readStored(): PomodoroState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PomodoroState>;
    // Only the fields the machine understands, so a stale shape from an older
    // version degrades to idle rather than throwing on every render.
    return {
      ...IDLE,
      kind: parsed.kind ?? IDLE.kind,
      startedAt: parsed.startedAt ?? null,
      elapsedBeforeMs: parsed.elapsedBeforeMs ?? 0,
      paused: parsed.paused ?? false,
      completedFocus: parsed.completedFocus ?? 0,
      taskId: parsed.taskId ?? null,
      sessionId: parsed.sessionId ?? null,
    };
  } catch {
    return null;
  }
}

function persist(state: PomodoroState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A full or disabled storage costs durability across a reload, not
    // correctness now, and the server session still covers the important case.
  }
}

/**
 * The implementation. Call this **once**, in the provider below.
 *
 * Two copies of this hook is not merely wasteful, it is wrong: both persist to
 * the same `localStorage` key, so an idle instance — the shell's focus
 * indicator, say — overwrites a running one and the timer resets itself on the
 * next reload. Exported for tests; everything else uses `usePomodoroTimer`.
 */
export function usePomodoroMachine(
  settings: PomodoroSettings = DEFAULT_POMODORO,
): UsePomodoroResult {
  const [state, setState] = React.useState<PomodoroState>(IDLE);
  const [now, setNow] = React.useState(() => new Date(0));
  const [error, setError] = React.useState<string | null>(null);
  const [hydrated, setHydrated] = React.useState(false);

  const server = usePomodoro();
  const startMutation = useStartSession();
  const endMutation = useEndSession();

  /* ── Restore ────────────────────────────────────────────────────────── */

  React.useEffect(() => {
    // Restore only if nothing has moved yet.
    //
    // This is a passive effect, so React is free to flush it *after* paint —
    // which means the Start button is on screen and clickable before this
    // runs. An unguarded `setState(readStored())` then overwrites the session
    // the owner just started with whatever was in storage, and the timer
    // silently does nothing. `IDLE` is a module constant, so an identity check
    // is exactly the question being asked: has anything touched this yet?
    setState((current) =>
      current === IDLE ? (readStored() ?? IDLE) : current,
    );
    setNow(new Date());
    setHydrated(true);
  }, []);

  // A running session on the server that this device doesn't know about means
  // the timer was started elsewhere, or site data was cleared here. Adopting
  // it is better than showing an idle timer while the server believes you are
  // mid-session — and the database only permits one at a time anyway.
  const running = server.data?.running ?? null;
  React.useEffect(() => {
    if (!hydrated || !running) return;

    setState((current) => {
      if (current.sessionId === running.id) return current;
      if (isRunning(current)) return current;

      return {
        ...IDLE,
        kind: running.kind,
        startedAt: running.startedAt,
        taskId: running.taskId,
        sessionId: running.id,
        completedFocus: current.completedFocus,
      };
    });
  }, [hydrated, running]);

  React.useEffect(() => {
    if (hydrated) persist(state);
  }, [state, hydrated]);

  /* ── Ticking ────────────────────────────────────────────────────────── */

  React.useEffect(() => {
    if (!isRunning(state)) return;

    const id = window.setInterval(() => setNow(new Date()), TICK_MS);
    return () => window.clearInterval(id);
  }, [state]);

  // A wake from sleep fires visibilitychange, not the interval, so the display
  // corrects itself the instant the tab is looked at again.
  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(new Date());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const total = effectivePlannedMinutes(state, settings) * 60;
  const remaining = hydrated ? remainingSeconds(state, now, settings) : total;
  const elapsed = hydrated ? elapsedMs(state, now) : 0;
  const progress = total > 0 ? Math.min(1, elapsed / (total * 1000)) : 0;

  /* ── Transitions ────────────────────────────────────────────────────── */

  const start = React.useCallback(
    async (
      options: {
        kind?: PomodoroKind;
        taskId?: string | null;
        categoryId?: string | null;
        plannedOverrideMinutes?: number | null;
      } = {},
    ) => {
      setError(null);
      const at = new Date();
      const kind = options.kind ?? state.kind;
      const taskId = options.taskId ?? state.taskId;
      const categoryId = options.categoryId ?? state.categoryId;
      const override =
        options.plannedOverrideMinutes ?? state.plannedOverrideMinutes;
      // A one-off length only applies to focus. A forty-minute short break is
      // not a thing anyone means.
      const planned = effectivePlannedMinutes(
        { kind, plannedOverrideMinutes: override },
        settings,
      );

      // Optimistic: the timer starts on screen immediately and the row is
      // created behind it. A slow round trip must not cost the owner seconds
      // off their first Pomodoro.
      const optimistic = startState(
        {
          ...state,
          kind,
          taskId,
          categoryId,
          plannedOverrideMinutes: override,
        },
        at,
        { taskId },
      );
      setState(optimistic);
      setNow(at);

      try {
        const session = await startMutation.mutateAsync({
          kind,
          taskId: taskId ?? null,
          categoryId: categoryId ?? null,
          plannedMinutes: planned,
          startedAt: at.toISOString(),
        });
        setState((current) => ({ ...current, sessionId: session.id }));
      } catch (cause) {
        // The interval keeps running locally. Losing the row means losing the
        // history entry, not the time — the entry is written on stop, and the
        // stop path falls back to the outbox when there is no session.
        setError(
          cause instanceof Error
            ? cause.message
            : "Couldn't record the session on the server",
        );
      }
    },
    [state, settings, startMutation],
  );

  const pause = React.useCallback(() => {
    const at = new Date();
    setNow(at);
    setState((current) => pauseState(current, at));
  }, []);

  const resume = React.useCallback(() => {
    const at = new Date();
    setNow(at);
    setState((current) => resumeState(current, at));
  }, []);

  const stop = React.useCallback(async () => {
    setError(null);
    const at = new Date();
    const { next, session } = stopState(state, at, settings);

    setState(next);
    setNow(at);

    if (!session || !state.sessionId) return;

    try {
      await endMutation.mutateAsync({
        id: state.sessionId,
        endedAt: at.toISOString(),
        completed: session.completed,
        note: null,
        // Only focus intervals become hours, and the machine is the single
        // place that decides. The server writes what it is told rather than
        // re-deriving it from a second copy of the rule.
        logHours: contributesToHours(session),
        clientKey: newClientKey(),
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't save the session; it stays on this device",
      );
    }
  }, [state, settings, endMutation]);

  const skip = React.useCallback(() => {
    setState((current) => skipState(current, settings));
  }, [settings]);

  const setCategory = React.useCallback((categoryId: string | null) => {
    setState((current) => ({ ...current, categoryId }));
  }, []);

  const setPlannedOverride = React.useCallback((minutes: number | null) => {
    setState((current) => ({ ...current, plannedOverrideMinutes: minutes }));
  }, []);

  const setTask = React.useCallback((taskId: string | null) => {
    setState((current) => ({ ...current, taskId }));
  }, []);

  return {
    state,
    settings,
    remaining,
    progress,
    running: hydrated && isRunning(state),
    complete: hydrated && isComplete(state, now, settings),
    sessionId: state.sessionId,
    busy: !hydrated || startMutation.isPending || endMutation.isPending,
    error,
    start,
    pause,
    resume,
    stop,
    skip,
    setTask,
    setCategory,
    setPlannedOverride,
  };
}

/* ── The single instance ──────────────────────────────────────────────── */

const PomodoroContext = React.createContext<UsePomodoroResult | null>(null);

export function PomodoroProvider({
  children,
  settings,
}: {
  children: React.ReactNode;
  settings?: PomodoroSettings;
}) {
  const value = usePomodoroMachine(settings);
  return (
    <PomodoroContext.Provider value={value}>
      {children}
    </PomodoroContext.Provider>
  );
}

/**
 * The timer, shared by the Pomodoro page and the shell's focus indicator.
 *
 * Throws rather than starting a private machine: a second machine writes the
 * same storage key and resets the first one, which is invisible until a reload
 * loses a session in progress.
 */
export function usePomodoroTimer(): UsePomodoroResult {
  const context = React.useContext(PomodoroContext);
  if (!context) {
    throw new Error("usePomodoroTimer must be used inside a PomodoroProvider");
  }
  return context;
}

/** What the next interval will be, for the "up next" line. */
export function upNext(
  state: PomodoroState,
  settings: PomodoroSettings = DEFAULT_POMODORO,
): PomodoroKind {
  return nextKind(state, settings);
}
