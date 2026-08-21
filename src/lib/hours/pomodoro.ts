/**
 * The Pomodoro timer.
 *
 * 25 / 5 / 15, long break every fourth focus — the specification's defaults,
 * and all three configurable.
 *
 * ── Why this is a pure state machine ─────────────────────────────────────
 * The timer must survive a reload, a phone locking, and a laptop sleeping for
 * an hour. A `setInterval` that decrements a counter does none of those: it
 * stops when the tab is backgrounded and lies about how long has passed.
 *
 * So state holds *instants*, not remaining seconds, and every derived value is
 * computed from `now`. Sleep for forty minutes mid-session and the timer knows
 * exactly what happened when it wakes: the interval finished, thirty-five
 * minutes ago.
 */

export const POMODORO_KINDS = ["focus", "short_break", "long_break"] as const;
export type PomodoroKind = (typeof POMODORO_KINDS)[number];

export const POMODORO_KIND_LABELS: Record<PomodoroKind, string> = {
  focus: "Focus",
  short_break: "Short break",
  long_break: "Long break",
};

export interface PomodoroSettings {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  /** A long break after every Nth focus interval. */
  longBreakEvery: number;
}

export const DEFAULT_POMODORO: PomodoroSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
};

export interface PomodoroState {
  kind: PomodoroKind;
  /** null when nothing is running and nothing is paused. */
  startedAt: string | null;
  /**
   * Milliseconds already elapsed before the current `startedAt`.
   * This is how pausing works without touching the clock.
   */
  elapsedBeforeMs: number;
  paused: boolean;
  /** Focus intervals completed in this run, for the long-break cadence. */
  completedFocus: number;
  /** Optional task linkage, as specified. */
  taskId: string | null;
  /**
   * What this focus block is for, chosen before starting.
   *
   * Carried onto the time entry when the session ends, so focused hours land
   * in the weekly split instead of arriving unfiled.
   */
  categoryId: string | null;
  /**
   * A one-off length for this block, in minutes.
   *
   * `null` means "use the configured 25/5/15". Kept beside the state rather
   * than written into settings because "I have forty minutes before the next
   * meeting" is a fact about this afternoon, not a new preference.
   */
  plannedOverrideMinutes: number | null;
  /** The session row this maps to, once one exists. */
  sessionId: string | null;
}

export const IDLE: PomodoroState = {
  kind: "focus",
  startedAt: null,
  elapsedBeforeMs: 0,
  paused: false,
  completedFocus: 0,
  taskId: null,
  categoryId: null,
  plannedOverrideMinutes: null,
  sessionId: null,
};

export function plannedMinutes(
  kind: PomodoroKind,
  settings: PomodoroSettings = DEFAULT_POMODORO,
): number {
  switch (kind) {
    case "focus":
      return settings.focusMinutes;
    case "short_break":
      return settings.shortBreakMinutes;
    case "long_break":
      return settings.longBreakMinutes;
  }
}

/**
 * The length this state's interval actually has.
 *
 * The one-off override applies to focus blocks only, and it has to be applied
 * *here* rather than only at session creation: the first version sent the
 * override to the server and left the countdown reading the settings, so a
 * forty-minute block was recorded as forty minutes while the dial counted
 * down twenty-five. The clock the owner watches and the row the ledger keeps
 * must be the same number, and this function is where both now look.
 */
export function effectivePlannedMinutes(
  state: Pick<PomodoroState, "kind" | "plannedOverrideMinutes">,
  settings: PomodoroSettings = DEFAULT_POMODORO,
): number {
  if (state.kind === "focus" && state.plannedOverrideMinutes) {
    return state.plannedOverrideMinutes;
  }
  return plannedMinutes(state.kind, settings);
}

/** Milliseconds elapsed in the current interval. */
export function elapsedMs(state: PomodoroState, now: Date): number {
  if (!state.startedAt || state.paused) return state.elapsedBeforeMs;

  const started = Date.parse(state.startedAt);
  if (!Number.isFinite(started)) return state.elapsedBeforeMs;

  return state.elapsedBeforeMs + Math.max(0, now.getTime() - started);
}

/** Seconds left, floored at zero. */
export function remainingSeconds(
  state: PomodoroState,
  now: Date,
  settings: PomodoroSettings = DEFAULT_POMODORO,
): number {
  const total = effectivePlannedMinutes(state, settings) * 60_000;
  return Math.max(0, Math.ceil((total - elapsedMs(state, now)) / 1000));
}

/** True once the interval has run its full length. */
export function isComplete(
  state: PomodoroState,
  now: Date,
  settings: PomodoroSettings = DEFAULT_POMODORO,
): boolean {
  if (!state.startedAt) return false;
  return (
    elapsedMs(state, now) >= effectivePlannedMinutes(state, settings) * 60_000
  );
}

export function isRunning(state: PomodoroState): boolean {
  return state.startedAt !== null && !state.paused;
}

/** "24:59". Monospace-friendly, always two digits. */
export function formatRemaining(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/* ── Transitions ──────────────────────────────────────────────────────── */

export function start(
  state: PomodoroState,
  now: Date,
  options: { taskId?: string | null; sessionId?: string | null } = {},
): PomodoroState {
  return {
    ...state,
    startedAt: now.toISOString(),
    elapsedBeforeMs: 0,
    paused: false,
    taskId: options.taskId ?? state.taskId,
    sessionId: options.sessionId ?? null,
  };
}

export function pause(state: PomodoroState, now: Date): PomodoroState {
  if (!isRunning(state)) return state;

  return {
    ...state,
    // The elapsed time is banked, so resuming does not need the original
    // start instant and a long pause cannot inflate the interval.
    elapsedBeforeMs: elapsedMs(state, now),
    startedAt: null,
    paused: true,
  };
}

export function resume(state: PomodoroState, now: Date): PomodoroState {
  if (!state.paused) return state;
  return { ...state, startedAt: now.toISOString(), paused: false };
}

/**
 * Stops the current interval.
 *
 * Returns the state to persist *and* the session to record. Time actually
 * spent is counted even when the interval was abandoned — a product that
 * discards twenty minutes of focus because you were interrupted at minute
 * twenty-one teaches you not to use the timer.
 */
export function stop(
  state: PomodoroState,
  now: Date,
  settings: PomodoroSettings = DEFAULT_POMODORO,
): { next: PomodoroState; session: CompletedSession | null } {
  if (!state.startedAt && !state.paused) {
    return { next: state, session: null };
  }

  const spentMs = elapsedMs(state, now);
  const completed = isComplete(state, now, settings);

  const session: CompletedSession = {
    kind: state.kind,
    taskId: state.taskId,
    sessionId: state.sessionId,
    plannedMinutes: plannedMinutes(state.kind, settings),
    // The interval may have overrun while the tab was asleep; the session is
    // capped at what was planned so a sleeping laptop cannot log eight hours.
    seconds: Math.min(
      Math.round(spentMs / 1000),
      plannedMinutes(state.kind, settings) * 60,
    ),
    completed,
    endedAt: now.toISOString(),
  };

  const completedFocus =
    state.kind === "focus" && completed
      ? state.completedFocus + 1
      : state.completedFocus;

  return {
    next: {
      ...IDLE,
      kind: nextKind({ ...state, completedFocus }, settings),
      completedFocus,
      taskId: state.taskId,
    },
    session,
  };
}

export interface CompletedSession {
  kind: PomodoroKind;
  taskId: string | null;
  sessionId: string | null;
  plannedMinutes: number;
  seconds: number;
  /** Ran its full length, as opposed to being stopped early. */
  completed: boolean;
  endedAt: string;
}

/** Skips to the next interval without recording the current one. */
export function skip(
  state: PomodoroState,
  settings: PomodoroSettings = DEFAULT_POMODORO,
): PomodoroState {
  return {
    ...IDLE,
    kind: nextKind(state, settings),
    completedFocus: state.completedFocus,
    taskId: state.taskId,
  };
}

/**
 * What comes after the current interval.
 *
 * Focus is followed by a long break every Nth time and a short break
 * otherwise; any break is followed by focus.
 */
export function nextKind(
  state: PomodoroState,
  settings: PomodoroSettings = DEFAULT_POMODORO,
): PomodoroKind {
  if (state.kind !== "focus") return "focus";

  const every = Math.max(1, settings.longBreakEvery);
  return state.completedFocus > 0 && state.completedFocus % every === 0
    ? "long_break"
    : "short_break";
}

/**
 * Only completed **focus** intervals become hours.
 *
 * Breaks are not work, and an abandoned focus session is still time spent —
 * both are the specification's position and both are here in one predicate so
 * no caller has to remember.
 */
export function contributesToHours(session: CompletedSession): boolean {
  return session.kind === "focus" && session.seconds > 0;
}

/** The time entry a finished focus session becomes. */
export function toTimeEntry(
  session: CompletedSession,
): { startedAt: string; endedAt: string; taskId: string | null } | null {
  if (!contributesToHours(session)) return null;

  const end = Date.parse(session.endedAt);
  if (!Number.isFinite(end)) return null;

  return {
    startedAt: new Date(end - session.seconds * 1000).toISOString(),
    endedAt: session.endedAt,
    taskId: session.taskId,
  };
}
