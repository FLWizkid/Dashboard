/**
 * Domain types for the hours module.
 *
 * The shapes the API and the UI speak, deliberately separate from the row
 * shapes in `database.types.ts` — same reasoning as the task module: a column
 * rename shouldn't ripple into every component, and the in-memory repository
 * has to satisfy the same contract for end-to-end tests.
 */

import type { HoursSource } from "./aggregate";
import type { ClassificationSource, RuleField } from "./classify";
import type { PomodoroKind } from "./pomodoro";

export interface PomodoroSession {
  id: string;
  kind: PomodoroKind;
  taskId: string | null;
  plannedMinutes: number;
  startedAt: string;
  /** `null` while it is still running. */
  endedAt: string | null;
  /** Ran its full planned length, as opposed to being stopped early. */
  completed: boolean;
  /** Server-computed from the two instants; `null` while running. */
  seconds: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimeEntry {
  id: string;
  /** Only ever `focused` or `manual`. Scheduled hours are derived, never stored. */
  source: Exclude<HoursSource, "scheduled">;
  taskId: string | null;
  categoryId: string | null;
  /** The Pomodoro this came from, for `focused` entries. */
  sessionId: string | null;
  startedAt: string;
  endedAt: string;
  /** Server-computed. */
  minutes: number;
  note: string | null;
  /**
   * The idempotency key the client minted before it tried to send.
   *
   * This is what makes a retry after an ambiguous failure safe: the database
   * rejects the duplicate rather than logging the hour twice.
   */
  clientKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkCategoryRule {
  id: string;
  pattern: string;
  field: RuleField;
  categoryId: string | null;
  countsTowardHours: boolean;
  /** Lower runs first. First match wins, so order is meaningful. */
  position: number;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A calendar event as the hours module needs it.
 *
 * Scheduled hours are read out of the calendar at request time rather than
 * copied into the ledger, so this is a projection of `calendar_events` — not
 * a table of its own.
 */
export interface ScheduledBlock {
  eventId: string;
  calendarId: string;
  calendarName: string;
  title: string;
  startsAt: string;
  endsAt: string;
  categoryId: string | null;
  categorySource: ClassificationSource;
  categoryReason: string | null;
  /** `null` = inherit, `true` = always count, `false` = never count. */
  hoursInclude: boolean | null;
  countsTowardHours: boolean;
  isCancelled: boolean;
}

export const HOURS_WINDOWS = ["week", "month"] as const;
export type HoursWindow = (typeof HOURS_WINDOWS)[number];
