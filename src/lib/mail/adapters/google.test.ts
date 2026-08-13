import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AdapterError } from "./types";
import {
  buildRfc822,
  createGoogleAdapter,
  extractBody,
  GOOGLE_CAPABILITIES,
  hasAttachment,
  labelKind,
  normalizeEvent,
  primaryMailbox,
  summarizeThreads,
} from "./google";

/* ── Fixtures ─────────────────────────────────────────────────────────── */

const b64 = (value: string) => Buffer.from(value, "utf8").toString("base64url");

const GMAIL = "https://gmail.googleapis.com/gmail/v1";
const CALENDAR = "https://www.googleapis.com/calendar/v3";

/** A realistic multipart/alternative message: plain text plus an HTML twin. */
const multipartMessage = {
  id: "msg-1",
  threadId: "thread-1",
  labelIds: ["INBOX", "UNREAD", "IMPORTANT", "Label_7"],
  snippet: "The board pack is attached",
  internalDate: "1786312800000",
  payload: {
    mimeType: "multipart/mixed",
    headers: [
      { name: "From", value: "Maya Chen <maya@example.com>" },
      { name: "To", value: "doug@theonefor.ai" },
      { name: "Cc", value: '"Chen, Sam" <sam@example.com>, ops@example.com' },
      { name: "Subject", value: "Q3 board pack" },
      { name: "Date", value: "Sun, 09 Aug 2026 12:00:00 +0000" },
      { name: "Message-ID", value: "<abc123@example.com>" },
    ],
    parts: [
      {
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: b64("Plain text version") } },
          {
            mimeType: "text/html",
            body: { data: b64("<p>HTML version</p>") },
          },
        ],
      },
      {
        mimeType: "application/pdf",
        filename: "board-pack.pdf",
        body: { attachmentId: "att-1", size: 1024 },
      },
    ],
  },
};

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

type AdapterOverrides = Partial<Parameters<typeof createGoogleAdapter>[0]>;

function adapter(overrides: AdapterOverrides = {}) {
  return createGoogleAdapter({
    getAccessToken: async () => "test-token",
    // No sleeping in tests; the back-off maths is exercised separately.
    retryBaseMs: 0,
    ...overrides,
  });
}

/* ── Pure helpers ─────────────────────────────────────────────────────── */

describe("extractBody", () => {
  it("prefers text/plain over the HTML twin", () => {
    // Plain text is what a person wrote, it is what search wants, and it
    // cannot carry a tracking pixel.
    expect(extractBody(multipartMessage.payload)).toEqual({
      body: "Plain text version",
      format: "text",
    });
  });

  it("falls back to HTML when there is no plain part", () => {
    expect(
      extractBody({
        mimeType: "multipart/alternative",
        parts: [{ mimeType: "text/html", body: { data: b64("<b>only</b>") } }],
      }),
    ).toEqual({ body: "<b>only</b>", format: "html" });
  });

  it("ignores a text/plain attachment", () => {
    // A .txt attachment is not the message body, however tempting its MIME
    // type makes it look.
    expect(
      extractBody({
        mimeType: "multipart/mixed",
        parts: [
          {
            mimeType: "text/plain",
            filename: "notes.txt",
            body: { data: b64("attachment contents") },
          },
          { mimeType: "text/html", body: { data: b64("<p>real body</p>") } },
        ],
      }),
    ).toEqual({ body: "<p>real body</p>", format: "html" });
  });

  it("reads a single-part message", () => {
    expect(
      extractBody({ mimeType: "text/plain", body: { data: b64("just text") } }),
    ).toEqual({ body: "just text", format: "text" });
  });

  it("returns nothing for a message with no body", () => {
    expect(extractBody(undefined)).toEqual({ body: null, format: null });
    expect(extractBody({ mimeType: "multipart/mixed" })).toEqual({
      body: null,
      format: null,
    });
  });

  it("stops descending rather than hanging on absurd nesting", () => {
    let deepest: Record<string, unknown> = {
      mimeType: "text/plain",
      body: { data: b64("bottom") },
    };
    for (let i = 0; i < 40; i += 1) {
      deepest = { mimeType: "multipart/mixed", parts: [deepest] };
    }
    expect(() => extractBody(deepest)).not.toThrow();
    expect(extractBody(deepest).body).toBeNull();
  });

  it("decodes base64url, not plain base64", () => {
    // Gmail uses the URL-safe alphabet; decoding it as standard base64
    // corrupts any body containing the bytes that map to + and /.
    const tricky = "subject?? ~ ok >>";
    expect(
      extractBody({ mimeType: "text/plain", body: { data: b64(tricky) } }).body,
    ).toBe(tricky);
  });
});

describe("hasAttachment", () => {
  it("finds a real attachment", () => {
    expect(hasAttachment(multipartMessage.payload)).toBe(true);
  });

  it("does not count an inline body part", () => {
    expect(
      hasAttachment({
        mimeType: "text/plain",
        body: { data: b64("hi"), size: 2 },
      }),
    ).toBe(false);
  });
});

describe("labelKind", () => {
  it("maps Gmail's system labels onto folders", () => {
    expect(labelKind({ id: "INBOX", name: "INBOX" })).toBe("inbox");
    expect(labelKind({ id: "SENT", name: "SENT" })).toBe("sent");
    expect(labelKind({ id: "DRAFT", name: "DRAFT" })).toBe("drafts");
    expect(labelKind({ id: "SPAM", name: "SPAM" })).toBe("spam");
    expect(labelKind({ id: "TRASH", name: "TRASH" })).toBe("trash");
    expect(labelKind({ id: "Label_7", name: "Board" })).toBe("custom");
  });
});

describe("primaryMailbox", () => {
  it("prefers a user label to INBOX", () => {
    expect(primaryMailbox(["INBOX", "UNREAD", "Label_7"])).toBe("Label_7");
  });

  it("falls back to a system label when there is no user one", () => {
    expect(primaryMailbox(["INBOX", "UNREAD"])).toBe("INBOX");
  });

  it("ignores state and category labels entirely", () => {
    // UNREAD and CATEGORY_* are not places a message lives.
    expect(primaryMailbox(["UNREAD", "CATEGORY_PROMOTIONS"])).toBeNull();
    expect(primaryMailbox([])).toBeNull();
    expect(primaryMailbox(undefined)).toBeNull();
  });
});

describe("summarizeThreads", () => {
  const message = (over: Record<string, unknown>) =>
    ({
      remoteId: "m",
      threadRemoteId: "t1",
      mailboxRemoteId: null,
      messageIdHeader: null,
      subject: "Subject",
      snippet: null,
      from: { address: "a@x.com", name: null },
      to: [],
      cc: [],
      sentAt: null,
      receivedAt: "2026-08-09T10:00:00.000Z",
      isRead: true,
      isFlagged: false,
      isDraft: false,
      hasAttachments: false,
      body: null,
      bodyFormat: null,
      ...over,
    }) as Parameters<typeof summarizeThreads>[0][number];

  it("takes the subject from the oldest message, not the newest", () => {
    // Otherwise the list flickers between "Q3 plan" and "Re: Re: Q3 plan".
    const threads = summarizeThreads([
      message({
        receivedAt: "2026-08-09T12:00:00.000Z",
        subject: "Re: Q3 plan",
      }),
      message({ receivedAt: "2026-08-09T09:00:00.000Z", subject: "Q3 plan" }),
    ]);

    expect(threads).toHaveLength(1);
    expect(threads[0].subject).toBe("Q3 plan");
    expect(threads[0].lastMessageAt).toBe("2026-08-09T12:00:00.000Z");
    expect(threads[0].messageCount).toBe(2);
  });

  it("counts unread and attachments across the thread", () => {
    const threads = summarizeThreads([
      message({ isRead: false }),
      message({ receivedAt: "2026-08-09T11:00:00.000Z", hasAttachments: true }),
    ]);

    expect(threads[0].unreadCount).toBe(1);
    expect(threads[0].hasAttachments).toBe(true);
  });

  it("skips messages with no thread", () => {
    expect(summarizeThreads([message({ threadRemoteId: null })])).toEqual([]);
  });
});

/* ── RFC 822 ──────────────────────────────────────────────────────────── */

describe("buildRfc822", () => {
  const base = {
    to: [{ address: "maya@example.com", name: "Maya Chen" }],
    subject: "Re: Q3 board pack",
    body: "Looks good.",
    bodyFormat: "text" as const,
  };

  it("writes the headers Gmail needs", () => {
    const raw = buildRfc822(base);

    expect(raw).toContain('To: "Maya Chen" <maya@example.com>');
    expect(raw).toContain("Subject: Re: Q3 board pack");
    expect(raw).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(raw.endsWith("Looks good.")).toBe(true);
  });

  it("uses CRLF line endings", () => {
    expect(buildRfc822(base)).toContain("\r\n");
  });

  it("threads a reply with In-Reply-To and References", () => {
    const raw = buildRfc822({
      ...base,
      inReplyToMessageIdHeader: "<abc123@example.com>",
      references: ["<start@example.com>"],
    });

    expect(raw).toContain("In-Reply-To: <abc123@example.com>");
    // Without the full chain some clients start a new thread from a reply.
    expect(raw).toContain(
      "References: <start@example.com> <abc123@example.com>",
    );
  });

  it("strips newlines from headers — this is header injection", () => {
    // A crafted display name or subject must not be able to add its own Bcc.
    const raw = buildRfc822({
      ...base,
      subject: "Innocent\r\nBcc: attacker@evil.example",
      to: [{ address: "maya@example.com", name: "Maya\r\nBcc: evil@x.com" }],
    });

    const headerSection = raw.slice(0, raw.indexOf("\r\n\r\n"));
    expect(headerSection).not.toMatch(/^Bcc:/m);
    expect(headerSection.match(/^Bcc:/gm)).toBeNull();
    expect(raw).toContain("Subject: Innocent Bcc: attacker@evil.example");
  });

  it("writes cc and bcc when present", () => {
    const raw = buildRfc822({
      ...base,
      cc: [{ address: "sam@example.com", name: null }],
      bcc: [{ address: "archive@example.com", name: null }],
    });

    expect(raw).toContain("Cc: sam@example.com");
    expect(raw).toContain("Bcc: archive@example.com");
  });

  it("marks an HTML body as HTML", () => {
    expect(
      buildRfc822({ ...base, body: "<p>hi</p>", bodyFormat: "html" }),
    ).toContain('Content-Type: text/html; charset="UTF-8"');
  });
});

/* ── Against a mocked Gmail ───────────────────────────────────────────── */

describe("Gmail over HTTP", () => {
  it("identifies the account", async () => {
    server.use(
      http.get(`${GMAIL}/users/me/profile`, () =>
        HttpResponse.json({ emailAddress: "doug@theonefor.ai" }),
      ),
    );

    expect(await adapter().identify()).toEqual({
      remoteId: "doug@theonefor.ai",
      emailAddress: "doug@theonefor.ai",
      displayName: null,
    });
  });

  it("sends the access token as a bearer credential", async () => {
    let seen: string | null = null;
    server.use(
      http.get(`${GMAIL}/users/me/profile`, ({ request }) => {
        seen = request.headers.get("authorization");
        return HttpResponse.json({ emailAddress: "a@b.c" });
      }),
    );

    await adapter().identify();
    expect(seen).toBe("Bearer test-token");
  });

  it("maps labels to mailboxes and drops the ones that aren't folders", async () => {
    server.use(
      http.get(`${GMAIL}/users/me/labels`, () =>
        HttpResponse.json({
          labels: [
            {
              id: "INBOX",
              name: "INBOX",
              messagesUnread: 3,
              messagesTotal: 40,
            },
            { id: "SENT", name: "SENT" },
            { id: "SPAM", name: "SPAM" },
            { id: "UNREAD", name: "UNREAD" },
            { id: "CATEGORY_PROMOTIONS", name: "Promotions" },
            { id: "Label_7", name: "Board" },
          ],
        }),
      ),
    );

    const mailboxes = await adapter().listMailboxes();
    const ids = mailboxes.map((mailbox) => mailbox.remoteId);

    expect(ids).toEqual(["INBOX", "SENT", "SPAM", "Label_7"]);
    expect(mailboxes[0]).toMatchObject({ kind: "inbox", unreadCount: 3 });
    // Spam is storage the owner didn't ask us to mirror.
    expect(mailboxes.find((m) => m.remoteId === "SPAM")?.syncEnabled).toBe(
      false,
    );
    expect(mailboxes.find((m) => m.remoteId === "Label_7")?.syncEnabled).toBe(
      true,
    );
  });

  it("normalizes a message fully", async () => {
    server.use(
      http.get(`${GMAIL}/users/me/messages/msg-1`, () =>
        HttpResponse.json(multipartMessage),
      ),
    );

    const message = await adapter().getMessage("msg-1");

    expect(message).toMatchObject({
      remoteId: "msg-1",
      threadRemoteId: "thread-1",
      subject: "Q3 board pack",
      messageIdHeader: "<abc123@example.com>",
      from: { address: "maya@example.com", name: "Maya Chen" },
      isRead: false, // UNREAD label present
      isFlagged: false,
      hasAttachments: true,
      body: "Plain text version",
      bodyFormat: "text",
      mailboxRemoteId: "Label_7",
    });

    // A quoted display name containing a comma is one recipient, not two.
    expect(message.cc.map((entry) => entry.address)).toEqual([
      "sam@example.com",
      "ops@example.com",
    ]);
    expect(message.receivedAt).toBe(new Date(1786312800000).toISOString());
  });

  it("asks Google for metadata only when bodies are not wanted", async () => {
    // This is the caching policy reaching all the way to the wire: under
    // Metadata, the body never crosses the network at all.
    let format: string | null = null;
    server.use(
      http.get(`${GMAIL}/users/me/messages/msg-1`, ({ request }) => {
        format = new URL(request.url).searchParams.get("format");
        return HttpResponse.json({
          ...multipartMessage,
          payload: { ...multipartMessage.payload, parts: [] },
        });
      }),
    );

    const message = await adapter().getMessage("msg-1", { includeBody: false });

    expect(format).toBe("metadata");
    expect(message.body).toBeNull();
    expect(message.bodyFormat).toBeNull();
  });

  it("never returns a body when one was not asked for, even if Google sends one", async () => {
    // Defence in depth: the policy must not depend on the provider having
    // honoured a query parameter.
    server.use(
      http.get(`${GMAIL}/users/me/messages/msg-1`, () =>
        HttpResponse.json(multipartMessage),
      ),
    );

    const message = await adapter().getMessage("msg-1", { includeBody: false });
    expect(message.body).toBeNull();
  });

  it("lists messages and summarizes their threads", async () => {
    server.use(
      http.get(`${GMAIL}/users/me/messages`, () =>
        HttpResponse.json({
          messages: [{ id: "msg-1" }, { id: "msg-2" }],
          nextPageToken: "page-2",
        }),
      ),
      http.get(`${GMAIL}/users/me/messages/:id`, ({ params }) =>
        HttpResponse.json({
          ...multipartMessage,
          id: params.id as string,
          labelIds: ["INBOX"],
        }),
      ),
    );

    const page = await adapter().listMessages({ limit: 10 });

    expect(page.messages.map((m) => m.remoteId)).toEqual(["msg-1", "msg-2"]);
    expect(page.cursor).toBe("page-2");
    expect(page.threads).toHaveLength(1);
    expect(page.threads[0].messageCount).toBe(2);
  });

  it("translates `since` into Gmail's after: query", async () => {
    let query: string | null = null;
    server.use(
      http.get(`${GMAIL}/users/me/messages`, ({ request }) => {
        query = new URL(request.url).searchParams.get("q");
        return HttpResponse.json({ messages: [] });
      }),
    );

    await adapter().listMessages({ since: new Date("2026-08-01T00:00:00Z") });
    expect(query).toBe(
      `after:${Math.floor(Date.parse("2026-08-01T00:00:00Z") / 1000)}`,
    );
  });

  it("sends a message as RFC 822 in the thread it belongs to", async () => {
    let payload: { raw?: string; threadId?: string } = {};
    server.use(
      http.post(`${GMAIL}/users/me/messages/send`, async ({ request }) => {
        payload = (await request.json()) as typeof payload;
        return HttpResponse.json({ id: "sent-1", threadId: "thread-1" });
      }),
    );

    const sent = await adapter().sendMessage!({
      to: [{ address: "maya@example.com", name: null }],
      subject: "Re: Q3",
      body: "Approved.",
      bodyFormat: "text",
      threadRemoteId: "thread-1",
    });

    expect(sent).toEqual({
      remoteId: "sent-1",
      threadRemoteId: "thread-1",
      messageIdHeader: null,
    });
    expect(payload.threadId).toBe("thread-1");
    expect(Buffer.from(payload.raw!, "base64url").toString()).toContain(
      "Subject: Re: Q3",
    );
  });

  it("toggles read state through labels", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(
        `${GMAIL}/users/me/messages/:id/modify`,
        async ({ request }) => {
          bodies.push(await request.json());
          return HttpResponse.json({});
        },
      ),
    );

    await adapter().setRead!("msg-1", true);
    await adapter().setRead!("msg-1", false);
    await adapter().setFlagged!("msg-1", true);

    expect(bodies).toEqual([
      { removeLabelIds: ["UNREAD"] },
      { addLabelIds: ["UNREAD"] },
      { addLabelIds: ["STARRED"] },
    ]);
  });

  it("searches server-side", async () => {
    let query: string | null = null;
    server.use(
      http.get(`${GMAIL}/users/me/messages`, ({ request }) => {
        query = new URL(request.url).searchParams.get("q");
        return HttpResponse.json({ messages: [{ id: "msg-1" }] });
      }),
      http.get(`${GMAIL}/users/me/messages/:id`, () =>
        HttpResponse.json(multipartMessage),
      ),
    );

    const results = await adapter().searchMessages!({ query: "from:maya" });

    expect(query).toBe("from:maya");
    expect(results).toHaveLength(1);
  });
});

/* ── Failure handling ─────────────────────────────────────────────────── */

describe("failure handling", () => {
  it("maps 401 to an auth error whose cached data is NOT usable", async () => {
    server.use(
      http.get(`${GMAIL}/users/me/profile`, () =>
        HttpResponse.json(
          { error: { message: "Invalid Credentials" } },
          { status: 401 },
        ),
      ),
    );

    const error = await adapter()
      .identify()
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(AdapterError);
    expect(error.kind).toBe("auth");
    // A revoked token means we should stop showing this mailbox as live.
    expect(error.staleDataUsable).toBe(false);
  });

  it("maps 429 to rate limiting, and keeps cached data usable", async () => {
    server.use(
      http.get(`${GMAIL}/users/me/profile`, () =>
        HttpResponse.json(
          { error: { message: "slow down" } },
          {
            status: 429,
            headers: { "retry-after": "12" },
          },
        ),
      ),
    );

    const error = await adapter({
      getAccessToken: async () => "t",
      maxAttempts: 1,
    })
      .identify()
      .catch((caught) => caught);

    expect(error.kind).toBe("rate_limited");
    expect(error.retryAfterMs).toBe(12_000);
    expect(error.staleDataUsable).toBe(true);
  });

  it("maps a 403 quota failure to rate limiting, not to auth", async () => {
    // Google reports quota exhaustion as 403. Treating it as an auth failure
    // would send the owner round the sign-in loop for no reason.
    server.use(
      http.get(`${GMAIL}/users/me/profile`, () =>
        HttpResponse.json(
          {
            error: {
              message: "quota",
              errors: [{ reason: "rateLimitExceeded" }],
            },
          },
          { status: 403 },
        ),
      ),
    );

    const error = await adapter({
      getAccessToken: async () => "t",
      maxAttempts: 1,
    })
      .identify()
      .catch((caught) => caught);

    expect(error.kind).toBe("rate_limited");
  });

  it("maps an admin-consent refusal to its own kind", async () => {
    server.use(
      http.get(`${GMAIL}/users/me/profile`, () =>
        HttpResponse.json(
          {
            error: {
              message: "not configured",
              errors: [{ reason: "accessNotConfigured" }],
            },
          },
          { status: 403 },
        ),
      ),
    );

    const error = await adapter({
      getAccessToken: async () => "t",
      maxAttempts: 1,
    })
      .identify()
      .catch((caught) => caught);

    expect(error.kind).toBe("admin_consent_required");
  });

  it("retries a 500 and succeeds", async () => {
    let calls = 0;
    server.use(
      http.get(`${GMAIL}/users/me/profile`, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ error: { message: "boom" } }, { status: 500 })
          : HttpResponse.json({ emailAddress: "a@b.c" });
      }),
    );

    expect(await adapter().identify()).toMatchObject({ emailAddress: "a@b.c" });
    expect(calls).toBe(2);
  });

  it("gives up after the configured attempts", async () => {
    let calls = 0;
    server.use(
      http.get(`${GMAIL}/users/me/profile`, () => {
        calls += 1;
        return HttpResponse.json(
          { error: { message: "down" } },
          { status: 503 },
        );
      }),
    );

    const error = await adapter({
      getAccessToken: async () => "t",
      maxAttempts: 2,
      retryBaseMs: 0,
    })
      .identify()
      .catch((caught) => caught);

    expect(calls).toBe(2);
    expect(error.kind).toBe("unavailable");
    expect(error.staleDataUsable).toBe(true);
  });

  it("does not retry a 400", async () => {
    let calls = 0;
    server.use(
      http.get(`${GMAIL}/users/me/profile`, () => {
        calls += 1;
        return HttpResponse.json(
          { error: { message: "bad" } },
          { status: 400 },
        );
      }),
    );

    await expect(adapter().identify()).rejects.toBeInstanceOf(AdapterError);
    expect(calls).toBe(1);
  });

  it("treats an unreachable host as unavailable, not as an auth failure", async () => {
    server.use(
      http.get(`${GMAIL}/users/me/profile`, () => HttpResponse.error()),
    );

    const error = await adapter({
      getAccessToken: async () => "t",
      maxAttempts: 1,
    })
      .identify()
      .catch((caught) => caught);

    expect(error.kind).toBe("unavailable");
    expect(error.staleDataUsable).toBe(true);
  });
});

/* ── Calendar ─────────────────────────────────────────────────────────── */

describe("Google Calendar", () => {
  it("lists calendars with their access level", async () => {
    server.use(
      http.get(`${CALENDAR}/users/me/calendarList`, () =>
        HttpResponse.json({
          items: [
            {
              id: "primary",
              summary: "Doug",
              primary: true,
              accessRole: "owner",
              timeZone: "America/New_York",
            },
            { id: "team", summary: "Team", accessRole: "reader" },
          ],
        }),
      ),
    );

    expect(await adapter().listCalendars!()).toEqual([
      {
        remoteId: "primary",
        name: "Doug",
        description: null,
        timeZone: "America/New_York",
        isPrimary: true,
        access: "read_write",
      },
      {
        remoteId: "team",
        name: "Team",
        description: null,
        timeZone: null,
        isPrimary: false,
        access: "read",
      },
    ]);
  });

  it("expands recurrences rather than returning the series once", async () => {
    let singleEvents: string | null = null;
    server.use(
      http.get(`${CALENDAR}/calendars/:id/events`, ({ request }) => {
        singleEvents = new URL(request.url).searchParams.get("singleEvents");
        return HttpResponse.json({ items: [] });
      }),
    );

    await adapter().listEvents!({
      calendarRemoteId: "primary",
      from: new Date("2026-08-09T00:00:00Z"),
      to: new Date("2026-08-11T00:00:00Z"),
    });

    // Otherwise a weekly stand-up shows up once, on the day it was created.
    expect(singleEvents).toBe("true");
  });

  it("normalizes a timed event", async () => {
    server.use(
      http.get(`${CALENDAR}/calendars/:id/events`, () =>
        HttpResponse.json({
          items: [
            {
              id: "evt-1",
              recurringEventId: "series-1",
              summary: "Board review",
              location: "Room 3",
              description: "Agenda attached",
              hangoutLink: "https://meet.google.com/abc",
              start: {
                dateTime: "2026-08-10T14:00:00Z",
                timeZone: "America/New_York",
              },
              end: { dateTime: "2026-08-10T15:00:00Z" },
              organizer: {
                email: "Chair@Board.example",
                displayName: "The Chair",
              },
              attendees: [
                {
                  email: "doug@theonefor.ai",
                  self: true,
                  responseStatus: "accepted",
                },
                { email: "chair@board.example" },
              ],
            },
          ],
        }),
      ),
    );

    const { events } = await adapter({
      getAccessToken: async () => "t",
      internalDomains: ["theonefor.ai"],
    }).listEvents!({
      calendarRemoteId: "primary",
      from: new Date("2026-08-10T00:00:00Z"),
      to: new Date("2026-08-11T00:00:00Z"),
    });

    expect(events[0]).toMatchObject({
      remoteId: "evt-1",
      seriesId: "series-1",
      title: "Board review",
      startsAt: "2026-08-10T14:00:00Z",
      allDay: false,
      response: "accepted",
      meetingUrl: "https://meet.google.com/abc",
      // An attendee outside the internal domains — P5 ranks these higher.
      isExternal: true,
    });
    expect(events[0].organizer).toEqual({
      address: "chair@board.example",
      name: "The Chair",
    });
  });

  it("marks an all-day event", async () => {
    server.use(
      http.get(`${CALENDAR}/calendars/:id/events`, () =>
        HttpResponse.json({
          items: [
            {
              id: "evt-2",
              summary: "Offsite",
              start: { date: "2026-08-12" },
              end: { date: "2026-08-13" },
            },
          ],
        }),
      ),
    );

    const { events } = await adapter().listEvents!({
      calendarRemoteId: "primary",
      from: new Date("2026-08-12T00:00:00Z"),
      to: new Date("2026-08-13T00:00:00Z"),
    });

    expect(events[0].allDay).toBe(true);
    expect(events[0].startsAt).toBe("2026-08-12T00:00:00.000Z");
  });
});

describe("normalizeEvent", () => {
  const base = {
    id: "e",
    summary: "Sync",
    start: { dateTime: "2026-08-10T14:00:00Z" },
    end: { dateTime: "2026-08-10T15:00:00Z" },
  };

  it("is internal when every attendee shares a configured domain", () => {
    const event = normalizeEvent(
      {
        ...base,
        attendees: [{ email: "a@theonefor.ai" }, { email: "b@theonefor.ai" }],
      },
      "primary",
      ["theonefor.ai"],
    );
    expect(event.isExternal).toBe(false);
  });

  it("does not guess when no internal domains are configured", () => {
    // Calling everything external would be as wrong as calling nothing
    // external, and the owner has not told us which is which yet.
    const event = normalizeEvent(
      { ...base, attendees: [{ email: "a@anywhere.example" }] },
      "primary",
      [],
    );
    expect(event.isExternal).toBe(false);
  });

  it("reports the organizer's own event as such", () => {
    const event = normalizeEvent(
      { ...base, organizer: { email: "me@x.com", self: true } },
      "primary",
      [],
    );
    expect(event.response).toBe("organizer");
  });

  it("maps needsAction to needs_action", () => {
    const event = normalizeEvent(
      {
        ...base,
        attendees: [
          { email: "me@x.com", self: true, responseStatus: "needsAction" },
        ],
      },
      "primary",
      [],
    );
    expect(event.response).toBe("needs_action");
  });

  it("marks a cancelled event rather than dropping it", () => {
    // A meeting vanishing without explanation is worse than one shown struck
    // through: the owner may have prep linked to it.
    expect(
      normalizeEvent({ ...base, status: "cancelled" }, "primary", [])
        .isCancelled,
    ).toBe(true);
  });

  it("falls back to a placeholder title", () => {
    expect(
      normalizeEvent({ ...base, summary: undefined }, "primary", []).title,
    ).toBe("(no title)");
  });
});

describe("declared capabilities", () => {
  it("matches the methods the adapter actually implements", () => {
    const google = adapter();

    expect(GOOGLE_CAPABILITIES.serverSearch).toBe(true);
    expect(typeof google.searchMessages).toBe("function");
    expect(GOOGLE_CAPABILITIES.sendMail).toBe(true);
    expect(typeof google.sendMessage).toBe("function");
    expect(GOOGLE_CAPABILITIES.readCalendar).toBe(true);
    expect(typeof google.listCalendars).toBe("function");
    expect(GOOGLE_CAPABILITIES.writeFlags).toBe(true);
    expect(typeof google.setRead).toBe("function");
  });

  it("documents its limitations for the capability matrix", () => {
    expect(GOOGLE_CAPABILITIES.limitations.length).toBeGreaterThan(0);
  });
});
