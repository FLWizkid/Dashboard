import { z } from "zod";

import { CACHING_POLICIES, SENDER_IMPORTANCES } from "./types";

/** Request shapes for the mail and calendar routes. */

export const threadQuerySchema = z.object({
  accountId: z.string().uuid().optional(),
  mailboxKind: z.enum(["inbox", "sent", "drafts", "archive"]).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  unreadOnly: z.coerce.boolean().optional(),
  flaggedOnly: z.coerce.boolean().optional(),
  minImportance: z.enum(SENDER_IMPORTANCES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const updateAccountSchema = z
  .object({
    cachingPolicy: z.enum(CACHING_POLICIES).optional(),
    syncMailEnabled: z.boolean().optional(),
    syncCalendarEnabled: z.boolean().optional(),
    // Two years by default; the schema's own bound is what stops a typo
    // becoming an indefinite retention policy.
    retentionMonths: z.number().int().min(1).max(120).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Nothing to change",
  });

export const markReadSchema = z.object({
  messageIds: z.array(z.string().uuid()).min(1).max(500),
  read: z.boolean(),
});

export const flagSchema = z.object({ flagged: z.boolean() });

export const rateSenderSchema = z.object({
  address: z.string().trim().min(3).max(320),
  importance: z.enum(SENDER_IMPORTANCES),
  notes: z.string().trim().max(500).nullish(),
});

export const eventQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  calendarId: z.string().uuid().optional(),
  hideDeclined: z.coerce.boolean().optional(),
});

export const calendarVisibilitySchema = z.object({ isVisible: z.boolean() });

export type ThreadQueryInput = z.infer<typeof threadQuerySchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
