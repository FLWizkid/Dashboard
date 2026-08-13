/**
 * Proton adapter — via Proton Bridge, over IMAP and SMTP.
 *
 * This one is **constrained**, and the constraints are the interesting part.
 * Proton's servers are never spoken to directly: Bridge runs on the same box,
 * holds the account keys, and exposes a local IMAP/SMTP server that serves
 * already-decrypted mail. Everything below therefore talks to `127.0.0.1`.
 *
 * ── What that costs, honestly ────────────────────────────────────────────
 * • **No server-side search worth having.** IMAP SEARCH exists, but Bridge
 *   implements it by scanning locally; on a large mailbox it is slow enough
 *   to be a worse experience than searching what we have cached. Declared as
 *   `serverSearch: false`, so the product searches the local cache instead.
 * • **No cheap incremental sync.** There is no history cursor; the cursor is
 *   a `UIDVALIDITY:UID` pair, and if Bridge renumbers the mailbox
 *   (`UIDVALIDITY` changes) the only correct response is a full resync.
 * • **Proton Calendar is not exposed by Bridge at all.** There is no CalDAV
 *   endpoint, so `readCalendar` is false. The spec asks for read-visibility
 *   first, and until Proton ships an interface, visibility means the owner
 *   adding the account to Google or Outlook and us reading it there. Saying
 *   so is better than a calendar that silently never populates.
 * • **Bridge must be running.** When it is not, this is `unavailable` — the
 *   cached mail stays visible and marked stale, exactly like a provider
 *   outage.
 *
 * The IMAP and SMTP clients are injected so this file can be tested without
 * a live Bridge.
 */

import {
  parseAddressList,
  parseMailAddress,
  type Mailbox,
  type MailboxKind,
} from "../types";
import { buildRfc822, summarizeThreads } from "./google";
import {
  AdapterError,
  NO_CAPABILITIES,
  type AccountIdentity,
  type FetchedMessage,
  type ListMessagesOptions,
  type MailAdapter,
  type MessagePage,
  type OutgoingMessage,
  type ProviderCapabilities,
  type SentMessage,
} from "./types";

export const PROTON_CAPABILITIES: ProviderCapabilities = {
  ...NO_CAPABILITIES,
  readMail: true,
  sendMail: true,
  serverSearch: false,
  incrementalSync: true,
  writeFlags: true,
  readCalendar: false,
  writeCalendar: false,
  push: false,
  limitations: [
    "Requires Proton Bridge to be installed, signed in and running on this box. When Bridge is stopped, cached mail is shown and marked stale.",
    "Search runs against locally cached mail only — Bridge's IMAP search scans the mailbox and is too slow to sit behind a search box.",
    "Incremental sync tracks IMAP UIDs. If Bridge renumbers a mailbox (UIDVALIDITY changes), the next sync is a full one.",
    "Proton Calendar is not exposed by Bridge, so it cannot be read here. To see it in this dashboard, share it into a Google or Outlook calendar and connect that account.",
    "Threading is reconstructed from References and In-Reply-To headers rather than a provider-supplied conversation id, so it is occasionally coarser than Gmail's.",
  ],
};

/* ── The narrow client surfaces this adapter needs ────────────────────── */

export interface ImapEnvelope {
  messageId?: string | null;
  subject?: string | null;
  date?: Date | null;
  from?: { name?: string | null; address?: string | null }[] | null;
  to?: { name?: string | null; address?: string | null }[] | null;
  cc?: { name?: string | null; address?: string | null }[] | null;
  inReplyTo?: string | null;
}

export interface ImapMessage {
  uid: number;
  flags?: Set<string> | string[];
  envelope?: ImapEnvelope;
  internalDate?: Date;
  /** Raw source, present only when bodies were requested. */
  source?: Buffer | string;
  bodyStructure?: { childNodes?: unknown[]; disposition?: string };
}

export interface ImapMailboxInfo {
  path: string;
  name?: string;
  specialUse?: string;
  subscribed?: boolean;
  status?: {
    messages?: number;
    unseen?: number;
    uidValidity?: number | bigint;
  };
}

/**
 * The slice of an IMAP client this adapter uses.
 *
 * Deliberately tiny: `imapflow` satisfies it, and so does a fake in a test.
 * A dependency this thin can be replaced when Proton ships something better.
 */
export interface ImapClientLike {
  connect(): Promise<void>;
  logout(): Promise<void>;
  list(): Promise<ImapMailboxInfo[]>;
  status(
    path: string,
    query: { messages?: boolean; unseen?: boolean; uidValidity?: boolean },
  ): Promise<{
    messages?: number;
    unseen?: number;
    uidValidity?: number | bigint;
  }>;
  getMailboxLock(path: string): Promise<{ release: () => void }>;
  fetch(
    range: string | { uid: string },
    query: Record<string, boolean>,
    options?: { uid?: boolean },
  ): AsyncIterable<ImapMessage>;
  messageFlagsAdd(
    range: string,
    flags: string[],
    options?: { uid?: boolean },
  ): Promise<boolean>;
  messageFlagsRemove(
    range: string,
    flags: string[],
    options?: { uid?: boolean },
  ): Promise<boolean>;
}

export interface SmtpTransportLike {
  sendMail(message: {
    envelope: { from: string; to: string[] };
    raw: string;
  }): Promise<{ messageId?: string }>;
}

/* ── Normalization ────────────────────────────────────────────────────── */

export function specialUseKind(info: ImapMailboxInfo): MailboxKind {
  switch (info.specialUse) {
    case "\\Inbox":
      return "inbox";
    case "\\Sent":
      return "sent";
    case "\\Drafts":
      return "drafts";
    case "\\Archive":
      return "archive";
    case "\\Junk":
      return "spam";
    case "\\Trash":
      return "trash";
    default:
      return info.path.toLowerCase() === "inbox" ? "inbox" : "custom";
  }
}

function addressOf(
  entries:
    { name?: string | null; address?: string | null }[] | null | undefined,
) {
  return (entries ?? [])
    .filter((entry) => entry.address)
    .map((entry) => ({
      address: (entry.address as string).toLowerCase(),
      name: entry.name ?? null,
    }));
}

/**
 * Pulls the first text part out of a raw RFC 822 message.
 *
 * Bridge hands over decrypted source; this is a deliberately small MIME
 * reader that covers what Proton actually emits — a single text part, or a
 * multipart/alternative of plain and HTML. Anything more exotic falls back to
 * "no body", which shows as "open in Proton" rather than as mangled text.
 */
export function extractRfc822Body(source: string): {
  body: string | null;
  format: "text" | "html" | null;
} {
  const separator = /\r?\n\r?\n/.exec(source);
  if (!separator) return { body: null, format: null };

  const headers = source.slice(0, separator.index);
  const rest = source.slice(separator.index + separator[0].length);

  const contentType =
    /^content-type:\s*(.+)$/im.exec(headers)?.[1] ?? "text/plain";
  const encoding =
    /^content-transfer-encoding:\s*(.+)$/im
      .exec(headers)?.[1]
      ?.trim()
      .toLowerCase() ?? "7bit";

  const boundaryMatch = /boundary="?([^";\r\n]+)"?/i.exec(contentType);

  if (!boundaryMatch) {
    const format = /text\/html/i.test(contentType) ? "html" : "text";
    return { body: decodeTransfer(rest, encoding).trim(), format };
  }

  // multipart: walk the parts, preferring text/plain for the same reasons as
  // the Gmail adapter.
  const parts = rest.split(`--${boundaryMatch[1]}`);
  let html: string | null = null;

  for (const part of parts) {
    const partSeparator = /\r?\n\r?\n/.exec(part);
    if (!partSeparator) continue;

    const partHeaders = part.slice(0, partSeparator.index);
    const partBody = part.slice(partSeparator.index + partSeparator[0].length);
    const partType = /^content-type:\s*(.+)$/im.exec(partHeaders)?.[1] ?? "";
    const partEncoding =
      /^content-transfer-encoding:\s*(.+)$/im
        .exec(partHeaders)?.[1]
        ?.trim()
        .toLowerCase() ?? "7bit";

    // A part with a filename is an attachment, not the body.
    if (/filename=/i.test(partHeaders)) continue;

    if (/text\/plain/i.test(partType)) {
      return {
        body: decodeTransfer(partBody, partEncoding)
          .replace(/\r?\n--\s*$/, "")
          .trim(),
        format: "text",
      };
    }
    if (/text\/html/i.test(partType) && html === null) {
      html = decodeTransfer(partBody, partEncoding)
        .replace(/\r?\n--\s*$/, "")
        .trim();
    }
  }

  return html === null
    ? { body: null, format: null }
    : { body: html, format: "html" };
}

function decodeTransfer(value: string, encoding: string): string {
  if (encoding === "base64") {
    return Buffer.from(value.replace(/\s+/g, ""), "base64").toString("utf8");
  }

  if (encoding === "quoted-printable") {
    // Quoted-printable encodes *octets*, not characters. `=E2=80=94` is the
    // three UTF-8 bytes of an em dash, so the bytes have to be collected and
    // decoded together — turning each one into a character individually
    // yields "â" and every non-ASCII body arrives mangled.
    //
    // UTF-8 is assumed, which is what Proton emits; a body in another charset
    // would need the Content-Type parameter honoured too.
    const withoutSoftBreaks = value.replace(/=\r?\n/g, "");
    const bytes: number[] = [];

    for (let index = 0; index < withoutSoftBreaks.length; index += 1) {
      const char = withoutSoftBreaks[index];

      if (
        char === "=" &&
        /^[0-9A-Fa-f]{2}$/.test(withoutSoftBreaks.substr(index + 1, 2))
      ) {
        bytes.push(Number.parseInt(withoutSoftBreaks.substr(index + 1, 2), 16));
        index += 2;
        continue;
      }

      bytes.push(char.charCodeAt(0) & 0xff);
    }

    return Buffer.from(bytes).toString("utf8");
  }

  return value;
}

export function normalizeImapMessage(
  message: ImapMessage,
  mailboxPath: string,
  includeBody: boolean,
): FetchedMessage {
  const flags = message.flags
    ? new Set(Array.isArray(message.flags) ? message.flags : [...message.flags])
    : new Set<string>();

  const envelope = message.envelope ?? {};
  const from = addressOf(envelope.from)[0] ?? {
    address: "unknown@invalid",
    name: null,
  };

  const source =
    includeBody && message.source
      ? typeof message.source === "string"
        ? message.source
        : message.source.toString("utf8")
      : null;

  const extracted = source
    ? extractRfc822Body(source)
    : { body: null, format: null as "text" | "html" | null };

  const received = message.internalDate ?? envelope.date ?? new Date();

  return {
    remoteId: String(message.uid),
    // IMAP has no conversation id. In-Reply-To is the closest durable thing;
    // the sync layer groups on it, and messages that start a thread group on
    // their own Message-ID.
    threadRemoteId: envelope.inReplyTo ?? envelope.messageId ?? null,
    mailboxRemoteId: mailboxPath,
    messageIdHeader: envelope.messageId ?? null,

    subject: envelope.subject ?? null,
    // IMAP gives no snippet; a short prefix of the body is the honest
    // substitute, and only when we were allowed the body at all.
    snippet: extracted.body ? extracted.body.slice(0, 200) : null,

    from,
    to: addressOf(envelope.to),
    cc: addressOf(envelope.cc),

    sentAt: envelope.date ? envelope.date.toISOString() : null,
    receivedAt: received.toISOString(),

    isRead: flags.has("\\Seen"),
    isFlagged: flags.has("\\Flagged"),
    isDraft: flags.has("\\Draft"),
    hasAttachments: hasImapAttachment(message),

    body: extracted.body,
    bodyFormat: extracted.format,
  };
}

function hasImapAttachment(message: ImapMessage): boolean {
  const nodes = message.bodyStructure?.childNodes;
  if (!Array.isArray(nodes)) return false;

  return nodes.some((node) => {
    const disposition = (node as { disposition?: string }).disposition;
    return disposition === "attachment";
  });
}

/* ── The adapter ──────────────────────────────────────────────────────── */

export interface ProtonAdapterOptions {
  emailAddress: string;
  /** Factory, so a reconnect after Bridge restarts gets a fresh client. */
  createImapClient: () => ImapClientLike;
  createSmtpTransport?: () => SmtpTransportLike;
}

export function createProtonAdapter(
  options: ProtonAdapterOptions,
): MailAdapter {
  let client: ImapClientLike | null = null;

  async function connected(): Promise<ImapClientLike> {
    if (client) return client;

    const next = options.createImapClient();
    try {
      await next.connect();
    } catch (cause) {
      // Bridge not running is the common case by a wide margin, and it is
      // recoverable: keep showing cached mail.
      throw new AdapterError(
        "proton_bridge",
        "unavailable",
        "Proton Bridge is not answering. Is it running and signed in?",
        { cause },
      );
    }

    client = next;
    return client;
  }

  async function withMailbox<T>(
    path: string,
    body: (client: ImapClientLike) => Promise<T>,
  ): Promise<T> {
    const imap = await connected();
    const lock = await imap.getMailboxLock(path);
    try {
      return await body(imap);
    } finally {
      // IMAP is stateful and single-selected-mailbox. Failing to release the
      // lock deadlocks every later call, so this is a `finally`, always.
      lock.release();
    }
  }

  return {
    provider: "proton_bridge",
    capabilities: PROTON_CAPABILITIES,

    async identify(): Promise<AccountIdentity> {
      // Bridge has no "who am I" call; the address is configuration.
      await connected();
      return {
        remoteId: options.emailAddress.toLowerCase(),
        emailAddress: options.emailAddress.toLowerCase(),
        displayName: null,
      };
    },

    async listMailboxes(): Promise<Mailbox[]> {
      const imap = await connected();
      const boxes = await imap.list();

      const mailboxes: Mailbox[] = [];
      let position = 0;

      for (const box of boxes) {
        const status = await imap
          .status(box.path, { messages: true, unseen: true })
          .catch(() => ({}) as { messages?: number; unseen?: number });

        const kind = specialUseKind(box);
        mailboxes.push({
          id: "",
          accountId: "",
          remoteId: box.path,
          name: box.name ?? box.path,
          kind,
          unreadCount: status.unseen ?? 0,
          totalCount: status.messages ?? 0,
          syncEnabled: kind !== "spam" && kind !== "trash",
          position: position++,
        });
      }

      return mailboxes;
    },

    async listMessages(
      listOptions: ListMessagesOptions = {},
    ): Promise<MessagePage> {
      const path = listOptions.mailboxRemoteId ?? "INBOX";
      const limit = Math.min(listOptions.limit ?? 50, 200);
      const includeBodies = listOptions.includeBodies ?? false;

      return withMailbox(path, async (imap) => {
        const status = await imap.status(path, { uidValidity: true });
        const uidValidity = String(status.uidValidity ?? "0");

        const [cursorValidity, cursorUid] = (listOptions.cursor ?? "").split(
          ":",
        );

        // A changed UIDVALIDITY means every UID we hold is meaningless. The
        // only correct answer is to start again, and to say so.
        if (listOptions.cursor && cursorValidity !== uidValidity) {
          return {
            messages: [],
            threads: [],
            cursor: `${uidValidity}:0`,
            requiresFullResync: true,
          };
        }

        const from = cursorUid ? Number(cursorUid) + 1 : 1;
        const range = `${from}:*`;

        const messages: FetchedMessage[] = [];
        let highestUid = Number(cursorUid ?? 0);

        for await (const message of imap.fetch(
          range,
          {
            uid: true,
            flags: true,
            envelope: true,
            internalDate: true,
            bodyStructure: true,
            // Only ask Bridge for the source when we are allowed to keep it.
            source: includeBodies,
          },
          { uid: true },
        )) {
          messages.push(normalizeImapMessage(message, path, includeBodies));
          highestUid = Math.max(highestUid, message.uid);
          if (messages.length >= limit) break;
        }

        return {
          messages,
          threads: summarizeThreads(messages),
          cursor: `${uidValidity}:${highestUid}`,
        };
      });
    },

    async getMessage(remoteId, getOptions = {}) {
      const includeBody = getOptions.includeBody ?? true;

      return withMailbox("INBOX", async (imap) => {
        for await (const message of imap.fetch(
          { uid: remoteId },
          {
            uid: true,
            flags: true,
            envelope: true,
            internalDate: true,
            bodyStructure: true,
            source: includeBody,
          },
          { uid: true },
        )) {
          return normalizeImapMessage(message, "INBOX", includeBody);
        }

        throw new AdapterError(
          "proton_bridge",
          "unknown",
          `Message ${remoteId} is no longer in the mailbox`,
        );
      });
    },

    async sendMessage(message: OutgoingMessage): Promise<SentMessage> {
      if (!options.createSmtpTransport) {
        throw new AdapterError(
          "proton_bridge",
          "unsupported",
          "No SMTP transport is configured for Proton Bridge.",
        );
      }

      // Reuses the Gmail RFC 822 builder — including its header-injection
      // stripping. One implementation, one place to get it right.
      const raw = buildRfc822(message);

      const sent = await options.createSmtpTransport().sendMail({
        envelope: {
          from: options.emailAddress,
          to: [
            ...message.to,
            ...(message.cc ?? []),
            ...(message.bcc ?? []),
          ].map((entry) => entry.address),
        },
        raw,
      });

      return {
        // SMTP does not tell us where the copy landed; it appears when the
        // Sent folder next syncs.
        remoteId: null,
        threadRemoteId: message.threadRemoteId ?? null,
        messageIdHeader: sent.messageId ?? null,
      };
    },

    async setRead(remoteId: string, read: boolean) {
      await withMailbox("INBOX", async (imap) => {
        if (read)
          await imap.messageFlagsAdd(remoteId, ["\\Seen"], { uid: true });
        else await imap.messageFlagsRemove(remoteId, ["\\Seen"], { uid: true });
      });
    },

    async setFlagged(remoteId: string, flagged: boolean) {
      await withMailbox("INBOX", async (imap) => {
        if (flagged)
          await imap.messageFlagsAdd(remoteId, ["\\Flagged"], { uid: true });
        else
          await imap.messageFlagsRemove(remoteId, ["\\Flagged"], { uid: true });
      });
    },

    async close() {
      if (!client) return;
      await client.logout().catch(() => undefined);
      client = null;
    },
  };
}

/** Parses "Name <addr>" the same way the rest of the product does. */
export { parseMailAddress, parseAddressList };
