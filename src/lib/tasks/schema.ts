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
  links: z.array(taskLinkInputSchema).max(20).default([]),
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
