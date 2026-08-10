import { z } from "zod";

import { POMODORO_KINDS } from "./pomodoro";
import { RULE_FIELDS } from "./classify";

/**
 * Wire schemas for the hours API.
 *
 * One validation boundary, shared by the route handlers and the client forms,
 * so a value cannot be accepted in one place and rejected in the other.
 */

const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime());

/* ── Pomodoro ─────────────────────────────────────────────────────────── */

export const startSessionSchema = z.object({
  kind: z.enum(POMODORO_KINDS).default("focus"),
  taskId: z.string().uuid().nullable().default(null),
  plannedMinutes: z.number().int().min(1).max(240),
  /**
   * The client's clock, not the server's.
   *
   * The timer is running in the browser and its start instant is the truth;
   * making the server stamp it would silently shift every session by the
   * round-trip. Bounded below so a stale request cannot backdate a session.
   */
  startedAt: isoDateTime.optional(),
});

export const endSessionSchema = z.object({
  endedAt: isoDateTime,
  completed: z.boolean().default(false),
  note: z.string().trim().max(500).nullable().default(null),
  /**
   * Whether to write the matching `focused` time entry.
   *
   * Only completed-or-abandoned *focus* intervals become hours; the client
   * decides using `contributesToHours` and says so explicitly here rather than
   * the server re-deriving it from a different set of rules.
   */
  logHours: z.boolean().default(false),
  /** Idempotency key for the time entry, minted before the first attempt. */
  clientKey: z.string().min(8).max(100).optional(),
});

/* ── Time entries ─────────────────────────────────────────────────────── */

export const createTimeEntrySchema = z
  .object({
    /**
     * `scheduled` is deliberately absent from the enum, not merely rejected
     * later: scheduled hours are derived from the calendar and a route that
     * could write them would defeat the whole design.
     */
    source: z.literal("manual").default("manual"),
    taskId: z.string().uuid().nullable().default(null),
    categoryId: z.string().uuid().nullable().default(null),
    startedAt: isoDateTime,
    endedAt: isoDateTime,
    note: z.string().trim().max(500).nullable().default(null),
    clientKey: z.string().min(8).max(100).optional(),
  })
  .refine((value) => Date.parse(value.endedAt) >= Date.parse(value.startedAt), {
    message: "The end has to come after the start",
    path: ["endedAt"],
  })
  .refine(
    (value) =>
      Date.parse(value.endedAt) - Date.parse(value.startedAt) <=
      24 * 60 * 60_000,
    {
      // A typo in the date field otherwise logs a fortnight in one row and the
      // week's total becomes nonsense with no obvious cause.
      message: "A single entry can't be longer than 24 hours",
      path: ["endedAt"],
    },
  );

export const updateTimeEntrySchema = z
  .object({
    taskId: z.string().uuid().nullable(),
    categoryId: z.string().uuid().nullable(),
    startedAt: isoDateTime,
    endedAt: isoDateTime,
    note: z.string().trim().max(500).nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to change",
  });

/* ── Rules ────────────────────────────────────────────────────────────── */

export const createRuleSchema = z.object({
  pattern: z.string().trim().min(2, "Needs at least two characters").max(200),
  field: z.enum(RULE_FIELDS).default("title"),
  categoryId: z.string().uuid().nullable().default(null),
  countsTowardHours: z.boolean().default(true),
  position: z.number().int().min(0).max(9999).optional(),
  isEnabled: z.boolean().default(true),
});

export const updateRuleSchema = z
  .object({
    pattern: z.string().trim().min(2).max(200),
    field: z.enum(RULE_FIELDS),
    categoryId: z.string().uuid().nullable(),
    countsTowardHours: z.boolean(),
    position: z.number().int().min(0).max(9999),
    isEnabled: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to change",
  });

/* ── Per-event classification override ────────────────────────────────── */

export const overrideEventSchema = z
  .object({
    /** Setting this marks the event `manual`, which the trigger then protects. */
    categoryId: z.string().uuid().nullable(),
    /** Tri-state: null inherits, true always counts, false never counts. */
    hoursInclude: z.boolean().nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to change",
  });

/* ── Queries ──────────────────────────────────────────────────────────── */

export const hoursQuerySchema = z.object({
  /** Inclusive. Defaults to the start of the current week in the client's zone. */
  from: isoDateTime.optional(),
  /** Exclusive. */
  to: isoDateTime.optional(),
  timeZone: z.string().trim().min(1).max(80).optional(),
});

export type StartSessionPayload = z.infer<typeof startSessionSchema>;
export type EndSessionPayload = z.infer<typeof endSessionSchema>;
export type CreateTimeEntryPayload = z.infer<typeof createTimeEntrySchema>;
export type UpdateTimeEntryPayload = z.infer<typeof updateTimeEntrySchema>;
export type CreateRulePayload = z.infer<typeof createRuleSchema>;
export type UpdateRulePayload = z.infer<typeof updateRuleSchema>;
export type OverrideEventPayload = z.infer<typeof overrideEventSchema>;
export type HoursQuery = z.infer<typeof hoursQuerySchema>;
