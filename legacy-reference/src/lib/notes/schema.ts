import { z } from "zod";

import { NOTE_KINDS } from "./markdown";
import { NOTE_LINK_KINDS } from "./types";

/**
 * Wire schemas for the notes API.
 *
 * The interesting constraint is the one that isn't here: **a decision note is
 * not rejected for missing its rationale.** You capture the decision the
 * moment it is made, in a meeting, and write down why afterwards. Refusing the
 * save would mean losing the decision entirely.
 *
 * Instead the database's `is_complete_decision` marks it, the list shows it,
 * and the editor says what is missing. Incomplete is a visible state, not an
 * error — the same shape as an untriaged task.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const noteLinkInputSchema = z.object({
  kind: z.enum(NOTE_LINK_KINDS),
  targetNoteId: z.string().uuid().nullable().default(null),
  targetId: z.string().uuid().nullable().default(null),
  targetLabel: z.string().trim().min(1).max(300),
});

export const createNoteSchema = z.object({
  kind: z.enum(NOTE_KINDS).default("freeform"),
  title: z.string().trim().min(1, "A title is required").max(300),
  decision: z.string().max(10_000).nullable().default(null),
  rationale: z.string().max(10_000).nullable().default(null),
  context: z.string().max(10_000).nullable().default(null),
  owner: z.string().trim().max(120).nullable().default(null),
  decidedOn: isoDate.nullable().default(null),
  body: z.string().max(200_000).default(""),
  links: z.array(noteLinkInputSchema).max(100).default([]),
});

export const updateNoteSchema = z
  .object({
    kind: z.enum(NOTE_KINDS),
    title: z.string().trim().min(1).max(300),
    decision: z.string().max(10_000).nullable(),
    rationale: z.string().max(10_000).nullable(),
    context: z.string().max(10_000).nullable(),
    owner: z.string().trim().max(120).nullable(),
    decidedOn: isoDate.nullable(),
    body: z.string().max(200_000),
    isArchived: z.boolean(),
    links: z.array(noteLinkInputSchema).max(100),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to change",
  });

export const listNotesQuerySchema = z.object({
  kind: z.enum(NOTE_KINDS).optional(),
  /** Full-text search across the note. Postgres does the work. */
  q: z.string().trim().max(200).optional(),
  includeArchived: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export type CreateNotePayload = z.infer<typeof createNoteSchema>;
export type UpdateNotePayload = z.infer<typeof updateNoteSchema>;
export type ListNotesQuery = z.infer<typeof listNotesQuerySchema>;
export type NoteLinkInput = z.infer<typeof noteLinkInputSchema>;
