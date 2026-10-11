/**
 * The sync service.
 *
 * Sits between the adapters and the database and owns the three rules that
 * are too important to leave to any single adapter:
 *
 *   1. **The caching policy decides what is even requested.** Under Off,
 *      nothing is fetched or stored. Under Metadata, bodies are never asked
 *      for. Under Full, bodies are fetched, encrypted, and the search vector
 *      is built from the plaintext before it is thrown away. The database
 *      enforces this too (see the migration) — this is the layer that means
 *      the enforcement is never reached in normal operation.
 *
 *   2. **A provider being down is not a data loss.** Anything except an auth
 *      failure leaves the cached rows exactly where they are and marks the
 *      account `degraded`. The UI then shows mail with a "last updated"
 *      stamp rather than an empty page. Stale-but-safe.
 *
 *   3. **Bodies are never held longer than they must be.** A body exists in
 *      memory between fetch and encrypt, and nowhere else.
 */

import {
  aad,
  encryptField,
  isEncryptionConfigured,
} from "@/lib/crypto/envelope";
import { reportError } from "@/lib/observability/report";

import {
  AdapterError,
  type MailAdapter,
  type FetchedMessage,
} from "./adapters/types";
import type { AccountStatus, CachingPolicy, MailProvider } from "./types";

export interface SyncTarget {
  accountId: string;
  provider: MailProvider;
  cachingPolicy: CachingPolicy;
  /** Cursor from the previous run, if any. */
  cursor: string | null;
  /** Highest number of messages to take in one run. */
  limit?: number;
}

export interface StoredMessage {
  accountId: string;
  remoteId: string;
  threadRemoteId: string | null;
  mailboxRemoteId: string | null;
  messageIdHeader: string | null;
  subject: string | null;
  snippet: string | null;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  sentAt: string | null;
  receivedAt: string;
  isRead: boolean;
  isFlagged: boolean;
  isDraft: boolean;
  hasAttachments: boolean;
  /** Present only under the Full policy. Always an encryption envelope. */
  bodyCipher: string | null;
  bodyFormat: "text" | "html" | null;

  /**
   * **Transient plaintext. Must never be persisted as-is.**
   *
   * Postgres cannot index ciphertext, so the search vector has to be built
   * from the plaintext. This field carries it exactly as far as the SQL
   * statement that calls `to_tsvector()` on it — the *vector* is stored, this
   * string is not. Writing it into a column would undo the encryption
   * entirely, which is why it is named for the job rather than for the value.
   *
   * The residual disclosure — a tsvector leaks the set of lexemes in a
   * message, though not their order — is recorded in docs/threat-model.md.
   */
  searchIndexInput: string | null;
}

export interface SyncResult {
  status: AccountStatus;
  /** Messages prepared for storage. Empty under the Off policy. */
  messages: StoredMessage[];
  cursor: string | null;
  requiresFullResync: boolean;
  /** True when this run failed but the cached data is still worth showing. */
  degraded: boolean;
  error: string | null;
  /** Human-readable, shown against the account in the UI. */
  detail: string | null;
}

/** The Off policy, expressed once. */
export function policyAllowsStorage(policy: CachingPolicy): boolean {
  return policy !== "off";
}

/** Whether bodies may be fetched at all. */
export function policyAllowsBodies(policy: CachingPolicy): boolean {
  return policy === "full";
}

/**
 * Prepares one message for storage under a policy.
 *
 * Exported because this is the function worth testing directly: it is where a
 * mistake would mean a corporate mailbox's body sitting in the database.
 */
export function prepareForStorage(
  message: FetchedMessage,
  options: { accountId: string; policy: CachingPolicy; messageId: string },
): StoredMessage {
  const keepBody = policyAllowsBodies(options.policy) && message.body !== null;

  // The search vector is built from the plaintext, then the plaintext is
  // dropped. This is the documented trade-off: Postgres cannot index
  // ciphertext, and a searchable mailbox is a product requirement. See
  // docs/threat-model.md and the migration header.
  const searchIndexInput = keepBody
    ? [message.subject, message.body].filter(Boolean).join("\n")
    : message.subject;

  return {
    accountId: options.accountId,
    remoteId: message.remoteId,
    threadRemoteId: message.threadRemoteId,
    mailboxRemoteId: message.mailboxRemoteId,
    messageIdHeader: message.messageIdHeader,
    subject: message.subject,
    // A snippet is a fragment of the body. Under Metadata it is not stored,
    // because "headers only" has to mean headers only.
    snippet: policyAllowsBodies(options.policy) ? message.snippet : null,
    fromAddress: message.from.address,
    fromName: message.from.name,
    toAddresses: message.to.map((entry) => entry.address),
    ccAddresses: message.cc.map((entry) => entry.address),
    sentAt: message.sentAt,
    receivedAt: message.receivedAt,
    isRead: message.isRead,
    isFlagged: message.isFlagged,
    isDraft: message.isDraft,
    hasAttachments: message.hasAttachments,
    bodyCipher: keepBody
      ? encryptField(message.body as string, aad.messageBody(options.messageId))
      : null,
    bodyFormat: keepBody ? message.bodyFormat : null,
    searchIndexInput:
      searchIndexInput && searchIndexInput.trim() !== ""
        ? searchIndexInput
        : null,
  };
}

/**
 * Runs one sync pass.
 *
 * Never throws for a provider problem — it returns a result describing what
 * happened, because the caller's job is to record it against the account, not
 * to crash a request. Programming errors still throw.
 */
export async function syncMessages(
  adapter: MailAdapter,
  target: SyncTarget,
  options: { newId: () => string } = { newId: () => crypto.randomUUID() },
): Promise<SyncResult> {
  // Off means off. No request is made at all — a mailbox set to Off should
  // not even appear in the provider's access logs on our account.
  if (!policyAllowsStorage(target.cachingPolicy)) {
    return {
      status: "connected",
      messages: [],
      cursor: target.cursor,
      requiresFullResync: false,
      degraded: false,
      error: null,
      detail: "Caching is off for this mailbox; nothing is stored locally.",
    };
  }

  const wantBodies = policyAllowsBodies(target.cachingPolicy);

  if (wantBodies && !isEncryptionConfigured()) {
    // Refusing is the only safe answer: the alternative is writing plaintext
    // bodies, and the database would reject them anyway.
    return {
      status: "degraded",
      messages: [],
      cursor: target.cursor,
      requiresFullResync: false,
      degraded: true,
      error: "encryption_not_configured",
      detail:
        "Full caching needs an encryption key. Set DASHBOARD_ENCRYPTION_KEYS, " +
        "or set this mailbox to Metadata.",
    };
  }

  try {
    const page = await adapter.listMessages({
      cursor: target.cursor,
      limit: target.limit ?? 50,
      includeBodies: wantBodies,
    });

    const messages = page.messages.map((message) =>
      prepareForStorage(message, {
        accountId: target.accountId,
        policy: target.cachingPolicy,
        // The id is generated here so it can be bound into the body's AAD
        // before the row exists.
        messageId: options.newId(),
      }),
    );

    return {
      status: "connected",
      messages,
      cursor: page.cursor,
      requiresFullResync: page.requiresFullResync ?? false,
      degraded: false,
      error: null,
      detail: null,
    };
  } catch (caught) {
    return failureResult(caught, target);
  }
}

function failureResult(caught: unknown, target: SyncTarget): SyncResult {
  if (caught instanceof AdapterError) {
    // Deliberately not reported to the error reporter: a provider being
    // rate-limited or briefly down is expected operation, not an incident.
    const expected =
      caught.kind === "rate_limited" || caught.kind === "unavailable";
    if (!expected) {
      reportError(caught, {
        source: `sync:${target.provider}`,
        severity: "warning",
        extra: { accountId: target.accountId, kind: caught.kind },
      });
    }

    return {
      status: statusFor(caught),
      messages: [],
      cursor: target.cursor,
      requiresFullResync: false,
      // Everything except a revoked token leaves the cache worth showing.
      degraded: caught.staleDataUsable,
      error: caught.kind,
      detail: describe(caught),
    };
  }

  reportError(caught, {
    source: `sync:${target.provider}`,
    extra: { accountId: target.accountId },
  });

  return {
    status: "degraded",
    messages: [],
    cursor: target.cursor,
    requiresFullResync: false,
    degraded: true,
    error: "unknown",
    detail: "Sync failed unexpectedly. The mail shown is the last that synced.",
  };
}

function statusFor(error: AdapterError): AccountStatus {
  switch (error.kind) {
    case "auth":
      return "needs_reauth";
    case "admin_consent_required":
      return "needs_reauth";
    default:
      return "degraded";
  }
}

/** The sentence shown against the account. Plain, actionable, no jargon. */
export function describe(error: AdapterError): string {
  switch (error.kind) {
    case "auth":
      return "Sign in again to reconnect this mailbox. Nothing has been lost.";
    case "admin_consent_required":
      return "An administrator needs to approve this app for the mailbox before it can be read.";
    case "rate_limited":
      return error.retryAfterMs
        ? `The provider is rate-limiting us; retrying in about ${Math.ceil(error.retryAfterMs / 1000)}s. Showing the last mail that synced.`
        : "The provider is rate-limiting us. Showing the last mail that synced.";
    case "unavailable":
      return "The provider is not answering. Showing the last mail that synced.";
    case "unsupported":
      return "This provider cannot do that.";
    default:
      return "Sync failed. Showing the last mail that synced.";
  }
}

/**
 * Back-off between attempts, from the consecutive failure count.
 *
 * Exponential with a ceiling of an hour, because a provider that has been
 * down for a day does not need to be asked every thirty seconds — and a
 * mailbox that has just recovered should not wait a day to be noticed.
 */
export function backOffMs(failureCount: number): number {
  if (failureCount <= 0) return 0;
  const minutes = Math.min(2 ** (failureCount - 1), 60);
  return minutes * 60_000;
}

/** Whether a run is due, given the last attempt and the failure count. */
export function shouldAttemptSync(
  lastRunAt: string | null,
  failureCount: number,
  now: Date = new Date(),
): boolean {
  if (!lastRunAt) return true;
  return now.getTime() - Date.parse(lastRunAt) >= backOffMs(failureCount);
}
