import { isMemoryMode } from "@/lib/data-mode";
import type { DataScope } from "@/lib/db/scope";

import type {
  Calendar,
  CalendarEvent,
  CachingPolicy,
  MailAccount,
  Mailbox,
  MailProvider,
  Message,
  Sender,
  SenderImportance,
} from "./types";

/**
 * The seam every mail and calendar read and write goes through.
 *
 * Same shape as tasks, notes and hours. Two things are specific to this module
 * and both are about not spraying mail content where it was not asked for:
 *
 * **Bodies are a separate call.** `listMessages` never returns one; only
 * `getMessage` does, and only when the account's policy permits. A list view
 * that accidentally carried bodies would put mail content into a response
 * whose only job was subjects — and into whatever logs that response passes.
 *
 * **Credentials are never returned.** `MailAccount.hasCredentials` is a
 * boolean. The sealed envelope is read on the server, by the sync service, and
 * has no representation that could reach a browser.
 */

export interface ThreadQuery {
  /** Omitted means every connected account — the unified inbox. */
  accountId?: string;
  mailboxKind?: "inbox" | "sent" | "drafts" | "archive";
  /** Full-text over the search vector built before encryption. */
  q?: string;
  unreadOnly?: boolean;
  flaggedOnly?: boolean;
  /** `critical` and above, for the attention card. */
  minImportance?: SenderImportance;
  limit?: number;
}

export interface ThreadSummary {
  id: string;
  accountId: string;
  accountAddress: string;
  provider: MailProvider;
  subject: string | null;
  /** The most recent message's sender, which is who you would reply to. */
  from: { address: string; name: string | null };
  snippet: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  unreadCount: number;
  hasAttachments: boolean;
  senderImportance: SenderImportance;
}

export interface EventQuery {
  from: string;
  to: string;
  calendarId?: string;
  /** Hide events you declined. Default true — a declined meeting is not yours. */
  hideDeclined?: boolean;
}

export interface SendRequest {
  accountId: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  /** Set when this is a reply, so the provider threads it correctly. */
  inReplyToMessageId?: string;
}

export interface MailRepository {
  /* ── Accounts ─────────────────────────────────────────────────────── */

  listAccounts(): Promise<MailAccount[]>;
  getAccount(id: string): Promise<MailAccount | null>;
  updateAccount(
    id: string,
    patch: {
      cachingPolicy?: CachingPolicy;
      syncMailEnabled?: boolean;
      syncCalendarEnabled?: boolean;
      retentionMonths?: number;
    },
  ): Promise<MailAccount>;
  disconnectAccount(id: string): Promise<void>;

  listMailboxes(accountId: string): Promise<Mailbox[]>;

  /* ── Mail ─────────────────────────────────────────────────────────── */

  listThreads(query: ThreadQuery): Promise<ThreadSummary[]>;

  /** Every message in a thread, oldest first. Bodies included where allowed. */
  getThread(
    id: string,
  ): Promise<{ thread: ThreadSummary; messages: Message[] } | null>;

  /** One message, with its body when the policy permits. */
  getMessage(id: string): Promise<Message | null>;

  markRead(messageIds: string[], read: boolean): Promise<void>;
  setFlag(messageId: string, flagged: boolean): Promise<Message>;

  /* ── Senders ──────────────────────────────────────────────────────── */

  listSenders(): Promise<Sender[]>;
  rateSender(
    address: string,
    importance: SenderImportance,
    notes?: string | null,
  ): Promise<Sender>;

  /* ── Calendar ─────────────────────────────────────────────────────── */

  listCalendars(): Promise<Calendar[]>;
  listEvents(query: EventQuery): Promise<CalendarEvent[]>;
  setCalendarVisible(id: string, visible: boolean): Promise<Calendar>;
}

export class MailAccountNotFoundError extends Error {
  constructor(id: string) {
    super(`Mail account ${id} was not found`);
    this.name = "MailAccountNotFoundError";
  }
}

export class MessageNotFoundError extends Error {
  constructor(id: string) {
    super(`Message ${id} was not found`);
    this.name = "MessageNotFoundError";
  }
}

/**
 * Raised when a read asks for something the account's caching policy forbids.
 *
 * A distinct type rather than an empty body, because "there is no body stored"
 * and "you may not have this body" are different answers and the interface
 * says different things about them.
 */
export class PolicyForbidsError extends Error {
  readonly policy: CachingPolicy;

  constructor(policy: CachingPolicy) {
    super(
      policy === "off"
        ? "This account stores nothing, so there is no body to show."
        : "This account stores metadata only, so bodies are not kept.",
    );
    this.name = "PolicyForbidsError";
    this.policy = policy;
  }
}

export async function getMailRepository(
  scope?: DataScope,
): Promise<MailRepository> {
  if (isMemoryMode()) {
    const { memoryMailRepository } = await import("./repository.memory");
    return memoryMailRepository;
  }
  const { createSupabaseMailRepository } =
    await import("./repository.supabase");
  const { sessionScope } = await import("@/lib/db/scope");
  return createSupabaseMailRepository(scope ?? sessionScope());
}

export type { SendRequest as MailSendRequest };
