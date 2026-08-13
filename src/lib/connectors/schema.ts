import { z } from "zod";

import { EXTERNAL_LINK_RELATIONS } from "./model";

/**
 * What the interface may ask for.
 *
 * The URL is validated here rather than only in the connector so that a
 * malformed paste is a 400 with a sentence, not a connector error the route
 * has to translate.
 */
export const attachSchema = z
  .object({
    /** A pasted URL to resolve, or an existing reference to reuse. */
    url: z.string().trim().url().max(2000).optional(),
    refId: z.string().uuid().optional(),

    taskId: z.string().uuid().optional(),
    noteId: z.string().uuid().optional(),

    relation: z.enum(EXTERNAL_LINK_RELATIONS).default("about"),
  })
  .refine((value) => Boolean(value.url) !== Boolean(value.refId), {
    message: "Provide either a url or a refId, not both",
  })
  .refine((value) => Boolean(value.taskId) !== Boolean(value.noteId), {
    // The database says the same thing. Saying it here too means the owner
    // gets a sentence instead of a constraint name.
    message: "Attach to exactly one of a task or a note",
  });

export type AttachPayload = z.output<typeof attachSchema>;

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  /**
   * `linked` searches what is already attached; `provider` asks the service.
   * Defaulting to `linked` keeps the common case — "where did I put that
   * PR" — free of a network round trip.
   */
  scope: z.enum(["linked", "provider"]).default("linked"),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const listLinksQuerySchema = z
  .object({
    taskId: z.string().uuid().optional(),
    noteId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine((value) => !(value.taskId && value.noteId), {
    message: "Ask for one subject at a time",
  });

export const updateLinkSchema = z.object({
  /** The only thing a link's owner may change after the fact. */
  confirmed: z.literal(true),
});
