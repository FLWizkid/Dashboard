import { z } from "zod";

import {
  TASK_LINK_KINDS,
  TASK_LINK_RELATIONS,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "./types";

/**
 * Wire schemas for the task API.
 *
 * These are the single validation boundary: the route handlers parse with
 * them, and the client derives its form types from them, so a field can't be
 * accepted in one place and rejected in the other.
 */

const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime());

const nullableIso = isoDateTime.nullable();

export const taskLinkInputSchema = z.object({
  kind: z.enum(TASK_LINK_KINDS),
  relation: z.enum(TASK_LINK_RELATIONS).default("related"),
  targetId: z.string().max(500).nullable().default(null),
  targetLabel: z.string().trim().min(1).max(300),
  targetUrl: z.string().url().max(2000).nullable().default(null),
  /**
   * Confirm-before-link: the client must say, explicitly, that the owner
   * agreed to this link. There is no "confirm by default" path.
   */
  confirmed: z.boolean().default(false),
});

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "A title is required").max(500),
  notes: z.string().max(20_000).nullable().default(null),
  priority: z.enum(TASK_PRIORITIES).nullable().default(null),
  dueAt: nullableIso.default(null),
  categoryId: z.string().uuid().nullable().default(null),
  status: z.enum(TASK_STATUSES).default("inbox"),
  pinned: z.boolean().default(false),
  sourceLink: z.string().url().max(2000).nullable().default(null),
  owner: z.string().trim().max(120).nullable().default(null),
  /**
   * A follow-up captured from a note arrives as a draft: visible on the note
   * it came from, absent from the board and every count until an owner, a due
   * date and a priority are supplied. Defaults false, so an ordinary capture
   * is live work and only a caller that means it can make a draft.
   */
  isDraft: z.boolean().default(false),
  links: z.array(taskLinkInputSchema).max(20).default([]),
  /**
   * Idempotency key for a capture made while offline.
   *
   * Generated on the device *before* the first attempt, so a request that
   * dies after the row was written but before the response arrived can be
   * safely replayed — the unique index answers the retry with the row that
   * already exists instead of a second task. Absent for the ordinary online
   * path, which has nothing to replay.
   */
  clientKey: z.string().min(8).max(128).nullable().default(null),
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    notes: z.string().max(20_000).nullable(),
    priority: z.enum(TASK_PRIORITIES).nullable(),
    dueAt: nullableIso,
    categoryId: z.string().uuid().nullable(),
    status: z.enum(TASK_STATUSES),
    pinned: z.boolean(),
    sourceLink: z.string().url().max(2000).nullable(),
    /** `null` releases the task back to the priority engine. */
    manualRank: z.number().int().min(0).max(9999).nullable(),
    owner: z.string().trim().max(120).nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });

export const listTasksQuerySchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  /** `open` excludes done; `all` includes it. Defaults to `open`. */
  scope: z.enum(["open", "all", "done"]).default("open"),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export type CreateTaskInput = z.input<typeof createTaskSchema>;
export type CreateTaskPayload = z.output<typeof createTaskSchema>;
export type UpdateTaskPayload = z.output<typeof updateTaskSchema>;
export type TaskLinkInput = z.output<typeof taskLinkInputSchema>;
export type ListTasksQuery = z.output<typeof listTasksQuerySchema>;

/* ── The taxonomy ─────────────────────────────────────────────────────── */

/**
 * Colour is a design-system token, never a hex value.
 *
 * The database says the same thing. A stored `#3f5f4a` survives a theme
 * change and stops matching anything around it; a token follows the theme,
 * which is the whole point of having one.
 */
export const CATEGORY_COLORS = [
  "primary",
  "accent",
  "critical",
  "high",
  "normal",
  "low",
  "neutral",
] as const;

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "A name is required").max(60),
  description: z.string().trim().max(300).nullable().default(null),
  color: z.enum(CATEGORY_COLORS).default("primary"),
});

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(300).nullable(),
    color: z.enum(CATEGORY_COLORS),
    position: z.number().int().min(0).max(999),
    /**
     * Archiving, not deleting.
     *
     * Tasks, hours and classification rules all point at a category, and the
     * reports read months of them. Removing one would either orphan that
     * history or rewrite it; archiving takes it out of every picker while
     * leaving what already happened intact and explainable.
     */
    isArchived: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to change",
  });

export type CreateCategoryPayload = z.infer<typeof createCategorySchema>;
export type UpdateCategoryPayload = z.infer<typeof updateCategorySchema>;
