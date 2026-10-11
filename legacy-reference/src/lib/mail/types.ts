/**
 * The normalized mail and calendar model.
 *
 * Everything above the adapters — the UI, the attention card, email→task, the
 * calendar rollup — speaks only these shapes. Gmail's `labelIds`, Graph's
 * `parentFolderId` and IMAP's UIDs never appear outside their own adapter.
 *
 * The point is not tidiness. It is that adding Microsoft Graph, or swapping
 * Proton Bridge for something better, must not touch a single component.
 */

export const MAIL_PROVIDERS = ["gmail", "microsoft", "proton_bridge"] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<MailProvider, string> = {
  gmail: "Gmail",
  microsoft: "Microsoft 365",
  proton_bridge: "Proton (Bridge)",
};

/**
 * How much of a mailbox is mirrored locally.
 *
 * - `off` — nothing is stored. The mailbox is read live, on demand, and
 *   disappears from local search. This is the corporate default.
 * - `metadata` — headers only: sender, subject, timestamps, flags.
 * - `full` — bodies as well, field-encrypted, and therefore searchable.
 */
export const CACHING_POLICIES = ["off", "metadata", "full"] as const;
export type CachingPolicy = (typeof CACHING_POLICIES)[number];

export const CACHING_POLICY_LABELS: Record<CachingPolicy, string> = {
  off: "Off",
  metadata: "Metadata only",
  full: "Full",
};

export const ACCOUNT_STATUSES = [
  "connected",
  "degraded",
  "needs_reauth",
  "disconnected",
] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ADMIN_CONSENT_STATES = [
  "not_required",
  "required",
  "requested",
  "granted",
  "denied",
] as const;
export type AdminConsentState = (typeof ADMIN_CONSENT_STATES)[number];

export const MAILBOX_KINDS = [
  "inbox",
  "sent",
  "drafts",
  "archive",
  "spam",
  "trash",
  "custom",
] as const;
export type MailboxKind = (typeof MAILBOX_KINDS)[number];

export const SENDER_IMPORTANCES = [
  "critical",
  "high",
  "normal",
  "low",
] as const;
export type SenderImportance = (typeof SENDER_IMPORTANCES)[number];

export const SENDER_IMPORTANCE_LABELS: Record<SenderImportance, string> = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
  low: "Low",
};

export const EVENT_RESPONSES = [
  "accepted",
  "tentative",
  "declined",
  "needs_action",
  "organizer",
  "unknown",
] as const;
export type EventResponse = (typeof EVENT_RESPONSES)[number];

/* ── Records ──────────────────────────────────────────────────────────── */

export interface MailAccount {
  id: string;
  provider: MailProvider;
  remoteId: string;
  emailAddress: string;
  displayName: string | null;
  status: AccountStatus;
  statusDetail: string | null;
  cachingPolicy: CachingPolicy;
  isCorporate: boolean;
  adminConsent: AdminConsentState;
  retentionMonths: number;
  syncMailEnabled: boolean;
  syncCalendarEnabled: boolean;
  /** Whether credentials are present. The credentials themselves never leave the server. */
  hasCredentials: boolean;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string;
}

export interface Mailbox {
  id: string;
  accountId: string;
  remoteId: string;
  name: string;
  kind: MailboxKind;
  unreadCount: number;
  totalCount: number;
  syncEnabled: boolean;
  position: number;
}

export interface MailThread {
  id: string;
  accountId: string;
  remoteId: string;
  subject: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  unreadCount: number;
  hasAttachments: boolean;
}

export interface MailAddress {
  address: string;
  name: string | null;
}

/**
 * A message as the product understands it.
 *
 * `body` is present only when the account's caching policy is Full **and**
 * the caller asked for it — list views never carry bodies, so a rendering
 * mistake cannot spray mail content through a page that only needed subjects.
 */
export interface Message {
  id: string;
  accountId: string;
  threadId: string | null;
  mailboxId: string | null;
  remoteId: string;
  messageIdHeader: string | null;

  subject: string | null;
  snippet: string | null;

  from: MailAddress;
  to: string[];
  cc: string[];

  sentAt: string | null;
  receivedAt: string;

  isRead: boolean;
  isFlagged: boolean;
  isDraft: boolean;
  hasAttachments: boolean;

  /** Decrypted on the server, only for a single-message read. */
  body: string | null;
  bodyFormat: "text" | "html" | null;

  /** Joined from `senders`; `normal` when the sender has never been rated. */
  senderImportance: SenderImportance;
}

export interface Sender {
  id: string;
  address: string;
  displayName: string | null;
  importance: SenderImportance;
  notes: string | null;
  updatedAt: string;
}

export interface Calendar {
  id: string;
  accountId: string;
  remoteId: string;
  name: string;
  description: string | null;
  color: string;
  timeZone: string | null;
  isPrimary: boolean;
  isVisible: boolean;
  access: "read" | "read_write";
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  remoteId: string;
  seriesId: string | null;

  title: string;
  location: string | null;
  description: string | null;

  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timeZone: string | null;

  organizer: MailAddress | null;
  attendeeCount: number;
  /** At least one attendee outside your own domains. Feeds P5's ranking. */
  isExternal: boolean;
  response: EventResponse;
  isCancelled: boolean;
  meetingUrl: string | null;
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

/**
 * Rank order for sender importance. Lower sorts first, matching
 * `PRIORITY_RANK` in the task module so the two read the same way.
 */
export const SENDER_IMPORTANCE_RANK: Record<SenderImportance, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function isSenderImportance(value: unknown): value is SenderImportance {
  return (
    typeof value === "string" &&
    (SENDER_IMPORTANCES as readonly string[]).includes(value)
  );
}

export function isCachingPolicy(value: unknown): value is CachingPolicy {
  return (
    typeof value === "string" &&
    (CACHING_POLICIES as readonly string[]).includes(value)
  );
}

/** Addresses are compared lower-cased; anything else duplicates people. */
export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

/** "Maya Chen <maya@example.com>" → both halves. Tolerant of bare addresses. */
export function parseMailAddress(raw: string): MailAddress {
  const trimmed = raw.trim();
  const angled = /^(.*?)<([^>]+)>\s*$/.exec(trimmed);

  if (angled) {
    const name = angled[1]
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .trim();
    return { address: normalizeAddress(angled[2]), name: name || null };
  }

  return { address: normalizeAddress(trimmed), name: null };
}

/** Splits a header list on commas that aren't inside quotes or angle brackets. */
export function parseAddressList(
  raw: string | null | undefined,
): MailAddress[] {
  if (!raw) return [];

  const out: MailAddress[] = [];
  let current = "";
  let inQuotes = false;
  let inAngle = false;

  for (const char of raw) {
    if (char === '"') inQuotes = !inQuotes;
    else if (char === "<") inAngle = true;
    else if (char === ">") inAngle = false;

    if (char === "," && !inQuotes && !inAngle) {
      if (current.trim()) out.push(parseMailAddress(current));
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) out.push(parseMailAddress(current));
  return out.filter((entry) => entry.address !== "");
}

/** The display name if we have one, otherwise the address. */
export function displayFor(address: MailAddress): string {
  return address.name ?? address.address;
}
