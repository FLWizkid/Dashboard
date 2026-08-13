import { describe, expect, it, vi } from "vitest";

import {
  createProtonAdapter,
  extractRfc822Body,
  normalizeImapMessage,
  PROTON_CAPABILITIES,
  specialUseKind,
  type ImapClientLike,
  type ImapMailboxInfo,
  type ImapMessage,
  type SmtpTransportLike,
} from "./proton";
import { AdapterError } from "./types";

/* ── A fake Bridge ────────────────────────────────────────────────────── */

function fakeImap(overrides: Partial<ImapClientLike> = {}): ImapClientLike {
  return {
    connect: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    list: vi.fn(async () => [] as ImapMailboxInfo[]),
    status: vi.fn(async () => ({ messages: 0, unseen: 0, uidValidity: 1 })),
    getMailboxLock: vi.fn(async () => ({ release: vi.fn() })),
    // eslint-disable-next-line require-yield
    fetch: vi.fn(async function* () {}) as ImapClientLike["fetch"],
    messageFlagsAdd: vi.fn(async () => true),
    messageFlagsRemove: vi.fn(async () => true),
    ...overrides,
  };
}

type SmtpMessage = { envelope: { from: string; to: string[] }; raw: string };

function adapter(imap: ImapClientLike, smtp?: () => SmtpTransportLike) {
  return createProtonAdapter({
    emailAddress: "doug@proton.me",
    createImapClient: () => imap,
    createSmtpTransport: smtp,
  });
}

const envelope = {
  messageId: "<abc@proton.me>",
  subject: "Vendor renewal",
  date: new Date("2026-08-09T09:00:00Z"),
  from: [{ name: "Maya Chen", address: "Maya@Example.com" }],
  to: [{ address: "doug@proton.me", name: null }],
  cc: [],
  inReplyTo: null,
};

/* ── MIME reading ─────────────────────────────────────────────────────── */

describe("extractRfc822Body", () => {
  it("reads a single-part text message", () => {
    const source = [
      "Subject: Hi",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "The renewal is due Friday.",
    ].join("\r\n");

    expect(extractRfc822Body(source)).toEqual({
      body: "The renewal is due Friday.",
      format: "text",
    });
  });

  it("prefers text/plain in a multipart/alternative", () => {
    const source = [
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain",
      "",
      "Plain version",
      "--b1",
      "Content-Type: text/html",
      "",
      "<p>HTML version</p>",
      "--b1--",
    ].join("\r\n");

    expect(extractRfc822Body(source)).toEqual({
      body: "Plain version",
      format: "text",
    });
  });

  it("falls back to HTML when there is no plain part", () => {
    const source = [
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/html",
      "",
      "<p>Only HTML</p>",
      "--b1--",
    ].join("\r\n");

    expect(extractRfc822Body(source)).toEqual({
      body: "<p>Only HTML</p>",
      format: "html",
    });
  });

  it("skips an attachment part", () => {
    const source = [
      'Content-Type: multipart/mixed; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain",
      'Content-Disposition: attachment; filename="notes.txt"',
      "",
      "attachment text",
      "--b1",
      "Content-Type: text/plain",
      "",
      "actual body",
      "--b1--",
    ].join("\r\n");

    expect(extractRfc822Body(source).body).toBe("actual body");
  });

  it("decodes quoted-printable, including soft line breaks", () => {
    const source = [
      "Content-Type: text/plain",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Due Friday =E2=80=94 please confirm the long=",
      " renewal figure",
    ].join("\r\n");

    expect(extractRfc822Body(source).body).toBe(
      "Due Friday — please confirm the long renewal figure",
    );
  });

  it("decodes base64", () => {
    const source = [
      "Content-Type: text/plain",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("Encoded body", "utf8").toString("base64"),
    ].join("\r\n");

    expect(extractRfc822Body(source).body).toBe("Encoded body");
  });

  it("returns nothing rather than garbage for a message it cannot read", () => {
    // "Open it in Proton" is a better outcome than mangled text.
    expect(extractRfc822Body("no header separator at all")).toEqual({
      body: null,
      format: null,
    });
    expect(
      extractRfc822Body(
        'Content-Type: multipart/mixed; boundary="b1"\r\n\r\n--b1\r\nContent-Type: image/png\r\n\r\nbinary\r\n--b1--',
      ),
    ).toEqual({ body: null, format: null });
  });
});

/* ── Normalization ────────────────────────────────────────────────────── */

describe("normalizeImapMessage", () => {
  const message: ImapMessage = {
    uid: 42,
    flags: new Set(["\\Seen", "\\Flagged"]),
    envelope,
    internalDate: new Date("2026-08-09T09:05:00Z"),
    source: "Content-Type: text/plain\r\n\r\nBody text",
  };

  it("maps flags, addresses and dates", () => {
    const normalized = normalizeImapMessage(message, "INBOX", true);

    expect(normalized).toMatchObject({
      remoteId: "42",
      mailboxRemoteId: "INBOX",
      subject: "Vendor renewal",
      messageIdHeader: "<abc@proton.me>",
      isRead: true,
      isFlagged: true,
      isDraft: false,
      body: "Body text",
      bodyFormat: "text",
    });
    // Addresses are lower-cased so one person is one row in `senders`.
    expect(normalized.from).toEqual({
      address: "maya@example.com",
      name: "Maya Chen",
    });
    expect(normalized.receivedAt).toBe("2026-08-09T09:05:00.000Z");
    expect(normalized.sentAt).toBe("2026-08-09T09:00:00.000Z");
  });

  it("withholds the body when it was not requested", () => {
    const normalized = normalizeImapMessage(message, "INBOX", false);
    expect(normalized.body).toBeNull();
    expect(normalized.snippet).toBeNull();
  });

  it("derives a snippet from the body, since IMAP has none", () => {
    const long = normalizeImapMessage(
      {
        ...message,
        source: `Content-Type: text/plain\r\n\r\n${"x".repeat(500)}`,
      },
      "INBOX",
      true,
    );
    expect(long.snippet).toHaveLength(200);
  });

  it("threads on In-Reply-To, falling back to the message's own id", () => {
    // IMAP has no conversation id, so a thread starter groups on itself and a
    // reply groups on what it answers.
    expect(normalizeImapMessage(message, "INBOX", false).threadRemoteId).toBe(
      "<abc@proton.me>",
    );
    expect(
      normalizeImapMessage(
        {
          ...message,
          envelope: { ...envelope, inReplyTo: "<root@proton.me>" },
        },
        "INBOX",
        false,
      ).threadRemoteId,
    ).toBe("<root@proton.me>");
  });

  it("treats a message with no envelope as unknown rather than throwing", () => {
    const bare = normalizeImapMessage({ uid: 7 }, "INBOX", false);
    expect(bare.from.address).toBe("unknown@invalid");
    expect(bare.subject).toBeNull();
  });

  it("detects attachments from the body structure", () => {
    const withAttachment = normalizeImapMessage(
      {
        ...message,
        bodyStructure: { childNodes: [{ disposition: "attachment" }] },
      },
      "INBOX",
      false,
    );
    expect(withAttachment.hasAttachments).toBe(true);
  });
});

describe("specialUseKind", () => {
  it("maps IMAP special-use flags", () => {
    expect(specialUseKind({ path: "INBOX", specialUse: "\\Inbox" })).toBe(
      "inbox",
    );
    expect(specialUseKind({ path: "Sent", specialUse: "\\Sent" })).toBe("sent");
    expect(specialUseKind({ path: "Trash", specialUse: "\\Trash" })).toBe(
      "trash",
    );
    expect(specialUseKind({ path: "Folders/Board" })).toBe("custom");
  });

  it("recognises INBOX by name when the server omits the flag", () => {
    expect(specialUseKind({ path: "inbox" })).toBe("inbox");
  });
});

/* ── Behaviour against the fake Bridge ────────────────────────────────── */

describe("Proton adapter", () => {
  it("reports Bridge being down as unavailable, keeping cached mail usable", async () => {
    const imap = fakeImap({
      connect: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    });

    const error = await adapter(imap)
      .identify()
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(AdapterError);
    expect(error.kind).toBe("unavailable");
    // The whole point: Bridge being stopped must not blank the mailbox.
    expect(error.staleDataUsable).toBe(true);
    expect(error.message).toMatch(/Bridge/);
  });

  it("lists mailboxes with their counts", async () => {
    const imap = fakeImap({
      list: vi.fn(async () => [
        { path: "INBOX", name: "INBOX", specialUse: "\\Inbox" },
        { path: "Trash", name: "Trash", specialUse: "\\Trash" },
      ]),
      status: vi.fn(async (path: string) =>
        path === "INBOX"
          ? { messages: 12, unseen: 3 }
          : { messages: 4, unseen: 0 },
      ),
    });

    const mailboxes = await adapter(imap).listMailboxes();

    expect(mailboxes[0]).toMatchObject({
      remoteId: "INBOX",
      kind: "inbox",
      unreadCount: 3,
      totalCount: 12,
      syncEnabled: true,
    });
    expect(mailboxes[1].syncEnabled).toBe(false);
  });

  it("asks Bridge for the source only when bodies are allowed", async () => {
    // The caching policy, reaching all the way to the IMAP FETCH.
    const calls: Record<string, boolean>[] = [];
    const imap = fakeImap({
      fetch: vi.fn(async function* (_range, query) {
        calls.push(query);
        yield { uid: 5, envelope, flags: ["\\Seen"] } as ImapMessage;
      }) as ImapClientLike["fetch"],
    });

    await adapter(imap).listMessages({ includeBodies: false });
    expect(calls[0].source).toBe(false);

    await adapter(imap).listMessages({ includeBodies: true });
    expect(calls[1].source).toBe(true);
  });

  it("returns a UIDVALIDITY:UID cursor", async () => {
    const imap = fakeImap({
      status: vi.fn(async () => ({ uidValidity: 99 })),
      fetch: vi.fn(async function* () {
        yield { uid: 10, envelope } as ImapMessage;
        yield { uid: 14, envelope } as ImapMessage;
      }) as ImapClientLike["fetch"],
    });

    const page = await adapter(imap).listMessages({});
    expect(page.cursor).toBe("99:14");
  });

  it("demands a full resync when Bridge renumbers the mailbox", async () => {
    // A changed UIDVALIDITY makes every stored UID meaningless. Continuing
    // would silently attach new mail to the wrong rows.
    const imap = fakeImap({
      status: vi.fn(async () => ({ uidValidity: 100 })),
    });

    const page = await adapter(imap).listMessages({ cursor: "99:14" });

    expect(page.requiresFullResync).toBe(true);
    expect(page.messages).toEqual([]);
    expect(page.cursor).toBe("100:0");
  });

  it("resumes from the cursor rather than re-reading the mailbox", async () => {
    let range: unknown = null;
    const imap = fakeImap({
      status: vi.fn(async () => ({ uidValidity: 99 })),
      fetch: vi.fn(async function* (requested) {
        range = requested;
      }) as ImapClientLike["fetch"],
    });

    await adapter(imap).listMessages({ cursor: "99:14" });
    expect(range).toBe("15:*");
  });

  it("always releases the mailbox lock, even when the fetch throws", async () => {
    // IMAP allows one selected mailbox; a leaked lock deadlocks every later
    // call, and the symptom appears far from the cause.
    const release = vi.fn();
    const imap = fakeImap({
      getMailboxLock: vi.fn(async () => ({ release })),
      fetch: vi.fn(() => {
        throw new Error("connection reset");
      }) as unknown as ImapClientLike["fetch"],
    });

    await expect(adapter(imap).listMessages({})).rejects.toThrow();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("sets and clears flags through IMAP", async () => {
    const imap = fakeImap();
    const proton = adapter(imap);

    await proton.setRead!("42", true);
    await proton.setRead!("42", false);
    await proton.setFlagged!("42", true);

    expect(imap.messageFlagsAdd).toHaveBeenCalledWith("42", ["\\Seen"], {
      uid: true,
    });
    expect(imap.messageFlagsRemove).toHaveBeenCalledWith("42", ["\\Seen"], {
      uid: true,
    });
    expect(imap.messageFlagsAdd).toHaveBeenCalledWith("42", ["\\Flagged"], {
      uid: true,
    });
  });

  it("sends through SMTP using the shared RFC 822 builder", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const sendMail = vi.fn(async (_message: SmtpMessage) => ({
      messageId: "<new@proton.me>",
    }));
    const imap = fakeImap();

    const sent = await adapter(imap, () => ({ sendMail })).sendMessage!({
      to: [{ address: "maya@example.com", name: "Maya" }],
      cc: [{ address: "sam@example.com", name: null }],
      subject: "Re: renewal",
      body: "Approved.",
      bodyFormat: "text",
    });

    const payload = sendMail.mock.calls[0][0];

    expect(payload.envelope.from).toBe("doug@proton.me");
    expect(payload.envelope.to).toEqual([
      "maya@example.com",
      "sam@example.com",
    ]);
    expect(payload.raw).toContain("Subject: Re: renewal");
    expect(sent.messageIdHeader).toBe("<new@proton.me>");
    // SMTP cannot tell us where the sent copy landed.
    expect(sent.remoteId).toBeNull();
  });

  it("refuses to send when no SMTP transport is configured", async () => {
    const error = await adapter(fakeImap()).sendMessage!({
      to: [{ address: "a@b.c", name: null }],
      subject: "x",
      body: "y",
      bodyFormat: "text",
    }).catch((caught) => caught);

    expect(error.kind).toBe("unsupported");
  });

  it("logs out on close and reconnects afterwards", async () => {
    const imap = fakeImap();
    const proton = adapter(imap);

    await proton.identify();
    await proton.close!();
    await proton.identify();

    expect(imap.logout).toHaveBeenCalledTimes(1);
    expect(imap.connect).toHaveBeenCalledTimes(2);
  });
});

describe("declared constraints", () => {
  it("does not claim server-side search", async () => {
    // Bridge's IMAP SEARCH scans the mailbox; putting it behind a search box
    // would be slower than searching the local cache.
    expect(PROTON_CAPABILITIES.serverSearch).toBe(false);
    expect(adapter(fakeImap()).searchMessages).toBeUndefined();
  });

  it("does not claim a calendar Bridge does not expose", () => {
    expect(PROTON_CAPABILITIES.readCalendar).toBe(false);
    expect(adapter(fakeImap()).listCalendars).toBeUndefined();
  });

  it("documents every constraint for the capability matrix", () => {
    expect(PROTON_CAPABILITIES.limitations.length).toBeGreaterThanOrEqual(4);
    expect(PROTON_CAPABILITIES.limitations.join(" ")).toMatch(/Calendar/);
  });
});
