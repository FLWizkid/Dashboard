/**
 * Google adapter — Gmail and Google Calendar.
 *
 * One adapter, because they are one connection: the same OAuth grant covers
 * both, and splitting them would mean two token refresh paths for one account.
 *
 * ── Notes that cost time to rediscover ───────────────────────────────────
 * • Gmail has labels, not folders. A message carries several at once, so the
 *   mapping to our single `mailboxId` picks the most meaningful one — see
 *   {@link primaryMailbox}.
 * • `messages.list` returns ids only. Bodies need a second call each, which is
 *   why `includeBodies` matters so much: under the Metadata policy we use
 *   `format=metadata` and Google never sends us the body at all.
 * • Incremental sync uses `historyId`. Google expires history after about a
 *   week; when it does, the API 404s and the only recovery is a full resync,
 *   which is what `requiresFullResync` signals.
 */

import {
  parseAddressList,
  parseMailAddress,
  type Mailbox,
  type MailboxKind,
} from "../types";
import { decodeBase64Url, encodeBase64Url, HttpClient } from "./http";
import {
  AdapterError,
  NO_CAPABILITIES,
  type AccountIdentity,
  type FetchedCalendar,
  type FetchedEvent,
  type FetchedMessage,
  type FetchedThread,
  type ListMessagesOptions,
  type MailAdapter,
  type MessagePage,
  type OutgoingMessage,
  type ProviderCapabilities,
  type SearchOptions,
  type SentMessage,
} from "./types";

export const GOOGLE_CAPABILITIES: ProviderCapabilities = {
  ...NO_CAPABILITIES,
  readMail: true,
  sendMail: true,
  serverSearch: true,
  incrementalSync: true,
  writeFlags: true,
  readCalendar: true,
  writeCalendar: true,
  push: true,
  limitations: [
    "Gmail labels are not folders: a message can be in several at once, so the folder shown is the most specific label it carries.",
    "Incremental sync uses Gmail's historyId, which expires after roughly a week of inactivity. When it does, the next sync is a full one.",
    "Read and unread changes are pushed back to Gmail; Gmail's own filters may move a message again afterwards.",
  ],
};

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

/* ── Wire shapes (only the fields used) ───────────────────────────────── */

interface GmailProfile {
  emailAddress: string;
  messagesTotal?: number;
  historyId?: string;
}

interface GmailLabel {
  id: string;
  name: string;
  type?: "system" | "user";
  messagesTotal?: number;
  messagesUnread?: number;
}

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

interface GmailListResponse {
  messages?: { id: string; threadId?: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GoogleCalendarEntry {
  id: string;
  summary?: string;
  description?: string;
  timeZone?: string;
  primary?: boolean;
  accessRole?: string;
}

interface GoogleEvent {
  id: string;
  recurringEventId?: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: { uri?: string; entryPointType?: string }[];
  };
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: { email?: string; responseStatus?: string; self?: boolean }[];
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

function headerValue(part: GmailPart | undefined, name: string): string | null {
  const target = name.toLowerCase();
  return (
    part?.headers?.find((header) => header.name.toLowerCase() === target)
      ?.value ?? null
  );
}

/**
 * Walks the MIME tree for a body.
 *
 * Prefers `text/plain`: it is what a person wrote, it is what full-text search
 * wants, and it cannot carry a tracking pixel or a script. HTML is the
 * fallback, kept as-is so the reader can sanitize it at render time rather
 * than us silently discarding formatting here.
 */
export function extractBody(payload: GmailPart | undefined): {
  body: string | null;
  format: "text" | "html" | null;
} {
  if (!payload) return { body: null, format: null };

  let plain: string | null = null;
  let html: string | null = null;

  const visit = (part: GmailPart, depth: number) => {
    if (depth > 12) return; // hostile or malformed nesting

    const mime = (part.mimeType ?? "").toLowerCase();

    // A part with a filename is an attachment, even when it is text/plain.
    const isAttachment = Boolean(part.filename && part.filename.length > 0);

    if (!isAttachment && part.body?.data) {
      if (mime === "text/plain" && plain === null) {
        plain = decodeBase64Url(part.body.data);
      } else if (mime === "text/html" && html === null) {
        html = decodeBase64Url(part.body.data);
      }
    }

    for (const child of part.parts ?? []) visit(child, depth + 1);
  };

  visit(payload, 0);

  if (plain !== null) return { body: plain, format: "text" };
  if (html !== null) return { body: html, format: "html" };
  return { body: null, format: null };
}

export function hasAttachment(payload: GmailPart | undefined): boolean {
  if (!payload) return false;

  const visit = (part: GmailPart, depth: number): boolean => {
    if (depth > 12) return false;
    if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
      return true;
    }
    return (part.parts ?? []).some((child) => visit(child, depth + 1));
  };

  return visit(payload, 0);
}

/** Gmail's system labels, mapped onto our folder vocabulary. */
export function labelKind(label: GmailLabel): MailboxKind {
  switch (label.id) {
    case "INBOX":
      return "inbox";
    case "SENT":
      return "sent";
    case "DRAFT":
      return "drafts";
    case "SPAM":
      return "spam";
    case "TRASH":
      return "trash";
    default:
      return "custom";
  }
}

/**
 * Picks one label to show as "the folder this is in".
 *
 * A Gmail message carries several — `INBOX`, `UNREAD`, `IMPORTANT`, a user
 * label. Category and state labels are not folders, so they are skipped; a
 * user label is more informative than `INBOX`, so it wins.
 */
export function primaryMailbox(labelIds: string[] | undefined): string | null {
  if (!labelIds || labelIds.length === 0) return null;

  const stateLabels = new Set([
    "UNREAD",
    "STARRED",
    "IMPORTANT",
    "CHAT",
    "CATEGORY_PERSONAL",
    "CATEGORY_SOCIAL",
    "CATEGORY_PROMOTIONS",
    "CATEGORY_UPDATES",
    "CATEGORY_FORUMS",
  ]);

  const candidates = labelIds.filter((id) => !stateLabels.has(id));
  if (candidates.length === 0) return null;

  const userLabel = candidates.find((id) => !/^[A-Z_]+$/.test(id));
  return userLabel ?? candidates[0];
}

function normalizeMessage(message: GmailMessage): FetchedMessage {
  const payload = message.payload;
  const labels = message.labelIds ?? [];

  const fromHeader = headerValue(payload, "from");
  const { body, format } = extractBody(payload);

  const internalDate = message.internalDate
    ? new Date(Number(message.internalDate))
    : null;
  const dateHeader = headerValue(payload, "date");
  const sentAt = dateHeader ? safeDate(dateHeader) : null;

  return {
    remoteId: message.id,
    threadRemoteId: message.threadId ?? null,
    mailboxRemoteId: primaryMailbox(message.labelIds),
    messageIdHeader: headerValue(payload, "message-id"),

    subject: headerValue(payload, "subject"),
    snippet: message.snippet ?? null,

    from: fromHeader
      ? parseMailAddress(fromHeader)
      : { address: "unknown@invalid", name: null },
    to: parseAddressList(headerValue(payload, "to")),
    cc: parseAddressList(headerValue(payload, "cc")),

    sentAt: sentAt ?? internalDate?.toISOString() ?? null,
    // internalDate is when Gmail received it, which is the honest "arrived"
    // time; the Date header is whatever the sender's clock said.
    receivedAt: (internalDate ?? new Date()).toISOString(),

    isRead: !labels.includes("UNREAD"),
    isFlagged: labels.includes("STARRED"),
    isDraft: labels.includes("DRAFT"),
    hasAttachments: hasAttachment(payload),

    body,
    bodyFormat: format,
  };
}

function safeDate(value: string): string | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/* ── The adapter ──────────────────────────────────────────────────────── */

export interface GoogleAdapterOptions {
  getAccessToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  retryBaseMs?: number;
  /** Domains treated as internal when deciding if a meeting is external. */
  internalDomains?: string[];
}

export function createGoogleAdapter(
  options: GoogleAdapterOptions,
): MailAdapter {
  const gmail = new HttpClient({
    provider: "gmail",
    baseUrl: GMAIL_BASE,
    getAccessToken: options.getAccessToken,
    fetchImpl: options.fetchImpl,
    maxAttempts: options.maxAttempts,
    retryBaseMs: options.retryBaseMs,
  });

  const calendar = new HttpClient({
    provider: "gmail",
    baseUrl: CALENDAR_BASE,
    getAccessToken: options.getAccessToken,
    fetchImpl: options.fetchImpl,
    maxAttempts: options.maxAttempts,
    retryBaseMs: options.retryBaseMs,
  });

  const internalDomains = (options.internalDomains ?? []).map((domain) =>
    domain.toLowerCase().replace(/^@/, ""),
  );

  async function fetchMessage(
    remoteId: string,
    includeBody: boolean,
  ): Promise<FetchedMessage> {
    const message = await gmail.request<GmailMessage>(
      `/users/me/messages/${encodeURIComponent(remoteId)}`,
      {
        query: {
          // `metadata` makes Google omit the body server-side. Under the
          // Metadata caching policy the body never crosses the network.
          format: includeBody ? "full" : "metadata",
          ...(includeBody
            ? {}
            : {
                metadataHeaders: "From,To,Cc,Subject,Date,Message-ID",
              }),
        },
      },
    );

    const normalized = normalizeMessage(message);

    // Belt and braces. `format=metadata` means Google should not have sent a
    // body at all, but the caching policy is too important to rest on the
    // provider having honoured a query parameter.
    return includeBody
      ? normalized
      : { ...normalized, body: null, bodyFormat: null };
  }

  return {
    provider: "gmail",
    capabilities: GOOGLE_CAPABILITIES,

    async identify(): Promise<AccountIdentity> {
      const profile = await gmail.request<GmailProfile>("/users/me/profile");
      return {
        remoteId: profile.emailAddress,
        emailAddress: profile.emailAddress,
        displayName: null,
      };
    },

    async listMailboxes(): Promise<Mailbox[]> {
      const response = await gmail.request<{ labels?: GmailLabel[] }>(
        "/users/me/labels",
      );

      return (
        (response.labels ?? [])
          // Gmail's category labels are a filing convenience, not folders.
          .filter((label) => !label.id.startsWith("CATEGORY_"))
          .filter(
            (label) => !["UNREAD", "STARRED", "IMPORTANT"].includes(label.id),
          )
          .map((label, index) => ({
            id: "",
            accountId: "",
            remoteId: label.id,
            name: label.name,
            kind: labelKind(label),
            unreadCount: label.messagesUnread ?? 0,
            totalCount: label.messagesTotal ?? 0,
            // Spam and Trash are storage the owner did not ask us to mirror.
            syncEnabled: !["SPAM", "TRASH"].includes(label.id),
            position: index,
          }))
      );
    },

    async listMessages(
      listOptions: ListMessagesOptions = {},
    ): Promise<MessagePage> {
      const limit = Math.min(listOptions.limit ?? 50, 200);
      const includeBodies = listOptions.includeBodies ?? false;

      const query: Record<string, string | number | undefined> = {
        maxResults: limit,
      };

      if (listOptions.mailboxRemoteId) {
        query.labelIds = listOptions.mailboxRemoteId;
      }
      if (listOptions.since) {
        // Gmail's `after:` takes seconds since the epoch.
        query.q = `after:${Math.floor(listOptions.since.getTime() / 1000)}`;
      }
      if (listOptions.cursor) {
        query.pageToken = listOptions.cursor;
      }

      const list = await gmail.request<GmailListResponse>(
        "/users/me/messages",
        { query },
      );

      const ids = (list.messages ?? []).map((entry) => entry.id);

      // Sequential rather than parallel: Gmail's per-user rate limit is easy
      // to trip, and a burst that gets the account throttled costs far more
      // than the seconds saved.
      const messages: FetchedMessage[] = [];
      for (const id of ids) {
        messages.push(await fetchMessage(id, includeBodies));
      }

      return {
        messages,
        threads: summarizeThreads(messages),
        cursor: list.nextPageToken ?? null,
      };
    },

    async getMessage(remoteId, getOptions = {}) {
      return fetchMessage(remoteId, getOptions.includeBody ?? true);
    },

    async searchMessages(searchOptions: SearchOptions) {
      const list = await gmail.request<GmailListResponse>(
        "/users/me/messages",
        {
          query: {
            q: searchOptions.query,
            maxResults: Math.min(searchOptions.limit ?? 25, 100),
          },
        },
      );

      const messages: FetchedMessage[] = [];
      for (const entry of list.messages ?? []) {
        messages.push(
          await fetchMessage(entry.id, searchOptions.includeBodies ?? false),
        );
      }
      return messages;
    },

    async sendMessage(message: OutgoingMessage): Promise<SentMessage> {
      const raw = encodeBase64Url(buildRfc822(message));

      const sent = await gmail.request<{ id: string; threadId?: string }>(
        "/users/me/messages/send",
        {
          method: "POST",
          body: {
            raw,
            ...(message.threadRemoteId
              ? { threadId: message.threadRemoteId }
              : {}),
          },
        },
      );

      return {
        remoteId: sent.id,
        threadRemoteId: sent.threadId ?? null,
        messageIdHeader: null,
      };
    },

    async setRead(remoteId: string, read: boolean) {
      await gmail.request(
        `/users/me/messages/${encodeURIComponent(remoteId)}/modify`,
        {
          method: "POST",
          body: read
            ? { removeLabelIds: ["UNREAD"] }
            : { addLabelIds: ["UNREAD"] },
        },
      );
    },

    async setFlagged(remoteId: string, flagged: boolean) {
      await gmail.request(
        `/users/me/messages/${encodeURIComponent(remoteId)}/modify`,
        {
          method: "POST",
          body: flagged
            ? { addLabelIds: ["STARRED"] }
            : { removeLabelIds: ["STARRED"] },
        },
      );
    },

    async listCalendars(): Promise<FetchedCalendar[]> {
      const response = await calendar.request<{
        items?: GoogleCalendarEntry[];
      }>("/users/me/calendarList");

      return (response.items ?? []).map((entry) => ({
        remoteId: entry.id,
        name: entry.summary ?? entry.id,
        description: entry.description ?? null,
        timeZone: entry.timeZone ?? null,
        isPrimary: entry.primary === true,
        access:
          entry.accessRole === "owner" || entry.accessRole === "writer"
            ? "read_write"
            : "read",
      }));
    },

    async listEvents({ calendarRemoteId, from, to, cursor }) {
      const response = await calendar.request<{
        items?: GoogleEvent[];
        nextSyncToken?: string;
        nextPageToken?: string;
      }>(`/calendars/${encodeURIComponent(calendarRemoteId)}/events`, {
        query: {
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          // Expand recurrences, so a weekly stand-up appears on each day it
          // actually happens rather than once, on the day it was created.
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 250,
          showDeleted: false,
          ...(cursor ? { pageToken: cursor } : {}),
        },
      });

      const events = (response.items ?? []).map((event) =>
        normalizeEvent(event, calendarRemoteId, internalDomains),
      );

      return { events, cursor: response.nextPageToken ?? null };
    },
  };
}

/* ── Normalization helpers ────────────────────────────────────────────── */

export function summarizeThreads(messages: FetchedMessage[]): FetchedThread[] {
  const byThread = new Map<string, FetchedMessage[]>();

  for (const message of messages) {
    if (!message.threadRemoteId) continue;
    const existing = byThread.get(message.threadRemoteId);
    if (existing) existing.push(message);
    else byThread.set(message.threadRemoteId, [message]);
  }

  return [...byThread].map(([remoteId, thread]) => {
    const newest = thread.reduce((latest, message) =>
      message.receivedAt > latest.receivedAt ? message : latest,
    );

    return {
      remoteId,
      // The oldest message's subject is the thread's subject; later replies
      // carry "Re:" prefixes that would make the list flicker between them.
      subject:
        thread.reduce((oldest, message) =>
          message.receivedAt < oldest.receivedAt ? message : oldest,
        ).subject ?? null,
      lastMessageAt: newest.receivedAt,
      messageCount: thread.length,
      unreadCount: thread.filter((message) => !message.isRead).length,
      hasAttachments: thread.some((message) => message.hasAttachments),
    };
  });
}

export function normalizeEvent(
  event: GoogleEvent,
  calendarRemoteId: string,
  internalDomains: string[],
): FetchedEvent {
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);

  const startsAt = event.start?.dateTime ?? toAllDayInstant(event.start?.date);
  const endsAt = event.end?.dateTime ?? toAllDayInstant(event.end?.date);

  const attendees = (event.attendees ?? [])
    .map((attendee) => attendee.email?.toLowerCase())
    .filter((email): email is string => Boolean(email));

  const isExternal =
    internalDomains.length > 0 &&
    attendees.some((email) => {
      const domain = email.split("@")[1] ?? "";
      return domain !== "" && !internalDomains.includes(domain);
    });

  const self = (event.attendees ?? []).find((attendee) => attendee.self);

  return {
    remoteId: event.id,
    calendarRemoteId,
    seriesId: event.recurringEventId ?? null,
    title: event.summary ?? "(no title)",
    location: event.location ?? null,
    description: event.description ?? null,
    startsAt,
    endsAt,
    allDay,
    timeZone: event.start?.timeZone ?? null,
    organizer: event.organizer?.email
      ? {
          address: event.organizer.email.toLowerCase(),
          name: event.organizer.displayName ?? null,
        }
      : null,
    attendeeAddresses: attendees,
    response: event.organizer?.self
      ? "organizer"
      : mapResponse(self?.responseStatus),
    isExternal,
    isCancelled: event.status === "cancelled",
    meetingUrl:
      event.hangoutLink ??
      event.conferenceData?.entryPoints?.find(
        (entry) => entry.entryPointType === "video",
      )?.uri ??
      null,
  };
}

function toAllDayInstant(date: string | undefined): string {
  // An all-day event has no time. Midnight UTC is a placeholder; the `allDay`
  // flag is what the UI actually renders from, so this value is never shown.
  return date ? `${date}T00:00:00.000Z` : new Date().toISOString();
}

function mapResponse(status: string | undefined): FetchedEvent["response"] {
  switch (status) {
    case "accepted":
      return "accepted";
    case "tentative":
      return "tentative";
    case "declined":
      return "declined";
    case "needsAction":
      return "needs_action";
    default:
      return "unknown";
  }
}

/**
 * Builds the RFC 822 message Gmail's send endpoint wants.
 *
 * Header values are stripped of CR and LF: a newline in a subject or a
 * recipient name is header injection, and would let a crafted draft add its
 * own `Bcc:`.
 */
export function buildRfc822(message: OutgoingMessage): string {
  const headerSafe = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

  const formatAddress = (entry: { address: string; name: string | null }) =>
    entry.name
      ? `"${headerSafe(entry.name).replace(/"/g, "'")}" <${headerSafe(entry.address)}>`
      : headerSafe(entry.address);

  const lines: string[] = [`To: ${message.to.map(formatAddress).join(", ")}`];

  if (message.cc?.length)
    lines.push(`Cc: ${message.cc.map(formatAddress).join(", ")}`);
  if (message.bcc?.length)
    lines.push(`Bcc: ${message.bcc.map(formatAddress).join(", ")}`);

  lines.push(`Subject: ${headerSafe(message.subject)}`);

  if (message.inReplyToMessageIdHeader) {
    lines.push(`In-Reply-To: ${headerSafe(message.inReplyToMessageIdHeader)}`);
    // References carries the whole chain; without it, some clients start a
    // new thread from a perfectly good reply.
    const references = [
      ...(message.references ?? []),
      message.inReplyToMessageIdHeader,
    ];
    lines.push(`References: ${references.map(headerSafe).join(" ")}`);
  }

  lines.push("MIME-Version: 1.0");
  lines.push(
    `Content-Type: text/${message.bodyFormat === "html" ? "html" : "plain"}; charset="UTF-8"`,
  );
  lines.push("Content-Transfer-Encoding: 8bit");
  lines.push("");
  lines.push(message.body);

  return lines.join("\r\n");
}

export { AdapterError };
