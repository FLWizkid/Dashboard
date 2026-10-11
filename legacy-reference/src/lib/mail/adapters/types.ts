/**
 * The provider adapter contract.
 *
 * One interface, three very different providers behind it. The design problem
 * is that they are *not* equally capable — Proton through the Bridge cannot
 * do server-side search, and Proton Calendar cannot be written at all — and
 * the honest way to handle that is to declare it rather than to fail at the
 * moment the owner clicks something.
 *
 * Hence {@link ProviderCapabilities}: the UI asks what a provider can do and
 * hides or explains what it cannot, and every optional method is genuinely
 * optional. A missing capability is a documented product behaviour, not a
 * runtime surprise.
 */

import type {
  CalendarEvent,
  MailAddress,
  Mailbox,
  MailProvider,
} from "../types";

/* ── Capabilities ─────────────────────────────────────────────────────── */

export interface ProviderCapabilities {
  /** Mail can be read at all. */
  readMail: boolean;
  /** Mail can be sent, and replies threaded. */
  sendMail: boolean;
  /** The provider searches server-side. When false we search only what is cached. */
  serverSearch: boolean;
  /** Incremental sync via a cursor, rather than re-listing everything. */
  incrementalSync: boolean;
  /** Read/unread and flag changes can be pushed back to the provider. */
  writeFlags: boolean;
  /** Calendars can be listed and read. */
  readCalendar: boolean;
  /** Events can be created or modified. */
  writeCalendar: boolean;
  /** Push notification / webhook support, as opposed to polling. */
  push: boolean;
  /**
   * Human-readable constraints, shown in the UI and in the capability matrix.
   * Anything a reasonable owner would be surprised by belongs here.
   */
  limitations: string[];
}

/* ── Errors ───────────────────────────────────────────────────────────── */

export type AdapterErrorKind =
  /** The token is invalid or revoked. Needs the owner to sign in again. */
  | "auth"
  /** An administrator has not approved the app for this mailbox. */
  | "admin_consent_required"
  /** Rate limited. `retryAfterMs` is set when the provider told us. */
  | "rate_limited"
  /** The provider or the Bridge is unreachable. Cached data stays valid. */
  | "unavailable"
  /** The provider cannot do this at all — see capabilities. */
  | "unsupported"
  /** Anything else. */
  | "unknown";

export class AdapterError extends Error {
  readonly kind: AdapterErrorKind;
  readonly provider: MailProvider;
  readonly retryAfterMs?: number;
  /**
   * Whether previously cached data should still be shown.
   *
   * True for everything except `auth`: if a provider is merely down, showing
   * yesterday's mail marked "stale" is far better than showing nothing.
   */
  readonly staleDataUsable: boolean;

  constructor(
    provider: MailProvider,
    kind: AdapterErrorKind,
    message: string,
    options: { retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AdapterError";
    this.provider = provider;
    this.kind = kind;
    this.retryAfterMs = options.retryAfterMs;
    this.staleDataUsable = kind !== "auth";
  }
}

/* ── Payloads ─────────────────────────────────────────────────────────── */

/**
 * A message as the provider gives it to us, before it is stored.
 *
 * `body` is populated only when the caller asked for it — which the sync
 * service only does under the Full policy. That way a Metadata mailbox never
 * has its bodies in the process's memory at all, let alone in the database.
 */
export interface FetchedMessage {
  remoteId: string;
  threadRemoteId: string | null;
  mailboxRemoteId: string | null;
  messageIdHeader: string | null;

  subject: string | null;
  snippet: string | null;

  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];

  sentAt: string | null;
  receivedAt: string;

  isRead: boolean;
  isFlagged: boolean;
  isDraft: boolean;
  hasAttachments: boolean;

  body: string | null;
  bodyFormat: "text" | "html" | null;
}

export interface FetchedThread {
  remoteId: string;
  subject: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  unreadCount: number;
  hasAttachments: boolean;
}

export interface FetchedCalendar {
  remoteId: string;
  name: string;
  description: string | null;
  timeZone: string | null;
  isPrimary: boolean;
  access: "read" | "read_write";
}

export interface FetchedEvent {
  remoteId: string;
  calendarRemoteId: string;
  seriesId: string | null;
  title: string;
  location: string | null;
  description: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timeZone: string | null;
  organizer: MailAddress | null;
  attendeeAddresses: string[];
  /**
   * At least one attendee outside the configured internal domains.
   *
   * Computed by the adapter, which is the only layer that knows how a given
   * provider spells an attendee. Phase 5's ranking treats external meetings
   * as more important, so it matters that this is decided once.
   */
  isExternal: boolean;
  response: CalendarEvent["response"];
  isCancelled: boolean;
  meetingUrl: string | null;
}

export interface MessagePage {
  messages: FetchedMessage[];
  threads: FetchedThread[];
  /** Opaque; hand it back next time. `null` when fully caught up. */
  cursor: string | null;
  /** Some providers tell us the cursor expired and a full resync is needed. */
  requiresFullResync?: boolean;
}

export interface ListMessagesOptions {
  /** Cursor from the previous run, for incremental sync. */
  cursor?: string | null;
  /** Restrict to one folder/label. */
  mailboxRemoteId?: string | null;
  /** Hard cap on messages returned. Adapters must honour it. */
  limit?: number;
  /**
   * Whether to fetch bodies.
   *
   * The sync service passes `false` for Metadata mailboxes, so bodies are
   * never even requested from the provider.
   */
  includeBodies?: boolean;
  /** Only messages at or after this instant. */
  since?: Date;
}

export interface SearchOptions {
  query: string;
  limit?: number;
  includeBodies?: boolean;
}

export interface OutgoingMessage {
  to: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  subject: string;
  body: string;
  bodyFormat: "text" | "html";
  /** Reply threading: the provider thread and the RFC Message-ID replied to. */
  inReplyToMessageIdHeader?: string | null;
  threadRemoteId?: string | null;
  references?: string[];
}

export interface SentMessage {
  remoteId: string | null;
  threadRemoteId: string | null;
  messageIdHeader: string | null;
}

export interface AccountIdentity {
  remoteId: string;
  emailAddress: string;
  displayName: string | null;
}

/* ── The adapter ──────────────────────────────────────────────────────── */

/**
 * What every provider must implement.
 *
 * Methods are optional exactly where {@link ProviderCapabilities} says the
 * capability may be absent. Callers check the capability; they do not
 * `try/catch` their way to finding out.
 */
export interface MailAdapter {
  readonly provider: MailProvider;
  readonly capabilities: ProviderCapabilities;

  /** Who this connection belongs to, used to key the account row. */
  identify(): Promise<AccountIdentity>;

  listMailboxes(): Promise<Mailbox[]>;

  listMessages(options?: ListMessagesOptions): Promise<MessagePage>;

  /** One message, with its body if the caller is allowed one. */
  getMessage(
    remoteId: string,
    options?: { includeBody?: boolean },
  ): Promise<FetchedMessage>;

  /** Only when `capabilities.serverSearch`. */
  searchMessages?(options: SearchOptions): Promise<FetchedMessage[]>;

  /** Only when `capabilities.sendMail`. */
  sendMessage?(message: OutgoingMessage): Promise<SentMessage>;

  /** Only when `capabilities.writeFlags`. */
  setRead?(remoteId: string, read: boolean): Promise<void>;
  setFlagged?(remoteId: string, flagged: boolean): Promise<void>;

  /** Only when `capabilities.readCalendar`. */
  listCalendars?(): Promise<FetchedCalendar[]>;
  listEvents?(options: {
    calendarRemoteId: string;
    from: Date;
    to: Date;
    cursor?: string | null;
  }): Promise<{ events: FetchedEvent[]; cursor: string | null }>;

  /** Release sockets and the like. IMAP needs it; HTTP adapters don't. */
  close?(): Promise<void>;
}

/** Everything false. Adapters spread this and turn on what they support. */
export const NO_CAPABILITIES: ProviderCapabilities = {
  readMail: false,
  sendMail: false,
  serverSearch: false,
  incrementalSync: false,
  writeFlags: false,
  readCalendar: false,
  writeCalendar: false,
  push: false,
  limitations: [],
};
