import { isMemoryMode } from "@/lib/data-mode";

import type { HoursInterval } from "./aggregate";
import type {
  CreateRulePayload,
  CreateTimeEntryPayload,
  EndSessionPayload,
  OverrideEventPayload,
  StartSessionPayload,
  UpdateRulePayload,
  UpdateTimeEntryPayload,
} from "./schema";
import type {
  PomodoroSession,
  ScheduledBlock,
  TimeEntry,
  WorkCategoryRule,
} from "./types";

/**
 * The seam every hours read and write goes through.
 *
 * Same shape as the task repository, for the same reason: one implementation
 * against self-hosted Supabase where RLS does the access control, one in
 * process so end-to-end tests exercise the real UI against real behaviour.
 *
 * Note what is **not** here: no `createScheduledEntry`. Scheduled hours are
 * read from the calendar by `listScheduledBlocks` and never written to the
 * ledger, and the absence of a write path is the point.
 */
export interface HoursRepository {
  /* Pomodoro */
  getRunningSession(): Promise<PomodoroSession | null>;
  listSessions(options: { from: Date; to: Date }): Promise<PomodoroSession[]>;
  startSession(input: StartSessionPayload): Promise<PomodoroSession>;
  endSession(
    id: string,
    input: EndSessionPayload,
  ): Promise<{ session: PomodoroSession; entry: TimeEntry | null }>;

  /* The ledger */
  listTimeEntries(options: { from: Date; to: Date }): Promise<TimeEntry[]>;
  createTimeEntry(input: CreateTimeEntryPayload): Promise<TimeEntry>;
  updateTimeEntry(
    id: string,
    patch: UpdateTimeEntryPayload,
  ): Promise<TimeEntry>;
  deleteTimeEntry(id: string): Promise<void>;

  /* Derived scheduled time */
  listScheduledBlocks(options: {
    from: Date;
    to: Date;
  }): Promise<ScheduledBlock[]>;
  overrideEvent(
    eventId: string,
    patch: OverrideEventPayload,
  ): Promise<ScheduledBlock>;

  /* Classification rules */
  listRules(): Promise<WorkCategoryRule[]>;
  createRule(input: CreateRulePayload): Promise<WorkCategoryRule>;
  updateRule(id: string, patch: UpdateRulePayload): Promise<WorkCategoryRule>;
  deleteRule(id: string): Promise<void>;
}

/** Thrown when a row is absent, or present but not the caller's. */
export class HoursRecordNotFoundError extends Error {
  constructor(what: string, id: string) {
    super(`${what} ${id} was not found`);
    this.name = "HoursRecordNotFoundError";
  }
}

/**
 * Thrown when a `client_key` has already been used.
 *
 * This is a **success** from the caller's point of view — the entry is already
 * recorded — and it carries the existing row so the route can return it with
 * 200 rather than an error. See `docs/hours.md`.
 */
export class DuplicateClientKeyError extends Error {
  constructor(public readonly existing: TimeEntry) {
    super(`An entry with client key ${existing.clientKey} already exists`);
    this.name = "DuplicateClientKeyError";
  }
}

/** Thrown when a second session is started while one is still running. */
export class SessionAlreadyRunningError extends Error {
  constructor(public readonly running: PomodoroSession) {
    super("A Pomodoro session is already running");
    this.name = "SessionAlreadyRunningError";
  }
}

export async function getHoursRepository(): Promise<HoursRepository> {
  if (isMemoryMode()) {
    const { memoryHoursRepository } = await import("./repository.memory");
    return memoryHoursRepository;
  }
  const { createSupabaseHoursRepository } =
    await import("./repository.supabase");
  return createSupabaseHoursRepository();
}

/**
 * Turns the ledger and the calendar into one list of intervals.
 *
 * The single place the three sources are brought together, so the dashboard
 * card, the hours view and the (Phase 6) weekly digest cannot disagree about
 * what a week contained.
 *
 * `blocks` are already classified — `countsTowardHours` reflects the
 * precedence in `classify.ts` — so anything that does not count is simply
 * absent rather than filtered again here.
 */
export function toIntervals(
  entries: TimeEntry[],
  blocks: ScheduledBlock[],
): HoursInterval[] {
  const fromLedger: HoursInterval[] = entries.map((entry) => ({
    source: entry.source,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    categoryId: entry.categoryId,
    taskId: entry.taskId,
    label: entry.note,
  }));

  const fromCalendar: HoursInterval[] = blocks
    .filter((block) => block.countsTowardHours && !block.isCancelled)
    .map((block) => ({
      source: "scheduled" as const,
      startedAt: block.startsAt,
      endedAt: block.endsAt,
      categoryId: block.categoryId,
      eventId: block.eventId,
      label: block.title,
    }));

  return [...fromLedger, ...fromCalendar];
}
