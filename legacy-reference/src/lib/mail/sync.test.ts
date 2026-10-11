import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decryptField, aad, resetKeyringCache } from "@/lib/crypto/envelope";

import {
  AdapterError,
  type MailAdapter,
  type FetchedMessage,
} from "./adapters/types";
import {
  backOffMs,
  describe as describeError,
  policyAllowsBodies,
  policyAllowsStorage,
  prepareForStorage,
  shouldAttemptSync,
  syncMessages,
} from "./sync";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.DASHBOARD_ENCRYPTION_KEYS = `v1:${Buffer.alloc(32, 7).toString("base64")}`;
  process.env.DASHBOARD_ENCRYPTION_ACTIVE_KEY = "v1";
  resetKeyringCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetKeyringCache();
  vi.restoreAllMocks();
});

const fetched = (over: Partial<FetchedMessage> = {}): FetchedMessage => ({
  remoteId: "r1",
  threadRemoteId: "t1",
  mailboxRemoteId: "INBOX",
  messageIdHeader: "<a@b.c>",
  subject: "Q3 board pack",
  snippet: "The pack is attached",
  from: { address: "maya@example.com", name: "Maya Chen" },
  to: [{ address: "doug@theonefor.ai", name: null }],
  cc: [],
  sentAt: "2026-08-09T09:00:00.000Z",
  receivedAt: "2026-08-09T09:01:00.000Z",
  isRead: false,
  isFlagged: false,
  isDraft: false,
  hasAttachments: true,
  body: "The renewal figure is £412,000. Please sign by Friday.",
  bodyFormat: "text",
  ...over,
});

function adapter(over: Partial<MailAdapter> = {}): MailAdapter {
  return {
    provider: "gmail",
    capabilities: {
      readMail: true,
      sendMail: false,
      serverSearch: false,
      incrementalSync: true,
      writeFlags: false,
      readCalendar: false,
      writeCalendar: false,
      push: false,
      limitations: [],
    },
    identify: vi.fn(),
    listMailboxes: vi.fn(),
    listMessages: vi.fn(async () => ({
      messages: [fetched()],
      threads: [],
      cursor: "next",
    })),
    getMessage: vi.fn(),
    ...over,
  } as unknown as MailAdapter;
}

const target = (policy: "off" | "metadata" | "full") => ({
  accountId: "acc-1",
  provider: "gmail" as const,
  cachingPolicy: policy,
  cursor: null,
});

const ids = () => ({ newId: () => "msg-fixed-id" });

/* ── The policy ───────────────────────────────────────────────────────── */

describe("policy predicates", () => {
  it("say what each level allows", () => {
    expect(policyAllowsStorage("off")).toBe(false);
    expect(policyAllowsStorage("metadata")).toBe(true);
    expect(policyAllowsStorage("full")).toBe(true);

    expect(policyAllowsBodies("off")).toBe(false);
    expect(policyAllowsBodies("metadata")).toBe(false);
    expect(policyAllowsBodies("full")).toBe(true);
  });
});

describe("prepareForStorage", () => {
  it("encrypts the body under Full, and it round-trips", () => {
    const stored = prepareForStorage(fetched(), {
      accountId: "acc-1",
      policy: "full",
      messageId: "msg-1",
    });

    expect(stored.bodyCipher).toMatch(/^cio1\./);
    expect(decryptField(stored.bodyCipher!, aad.messageBody("msg-1"))).toBe(
      "The renewal figure is £412,000. Please sign by Friday.",
    );
  });

  it("keeps the plaintext out of everything except the transient index input", () => {
    // The one place plaintext may still appear is `searchIndexInput`, which
    // exists only to be handed to `to_tsvector()` and is never written to a
    // column. Everything else — including the ciphertext — must be free of it.
    const stored = prepareForStorage(fetched(), {
      accountId: "acc-1",
      policy: "full",
      messageId: "msg-1",
    });

    const { searchIndexInput, ...persisted } = stored;

    expect(JSON.stringify(persisted)).not.toContain("412,000");
    expect(stored.bodyCipher).not.toContain("renewal");
    // And the index input does carry it, which is the documented trade-off.
    expect(searchIndexInput).toContain("412,000");
  });

  it("binds the ciphertext to its message id", () => {
    // Write access to the database must not let a body be moved to another row.
    const stored = prepareForStorage(fetched(), {
      accountId: "acc-1",
      policy: "full",
      messageId: "msg-1",
    });

    expect(() =>
      decryptField(stored.bodyCipher!, aad.messageBody("msg-2")),
    ).toThrow();
  });

  it("stores no body and no snippet under Metadata", () => {
    // "Headers only" has to mean headers only — a snippet is a fragment of
    // the body, so it goes too.
    const stored = prepareForStorage(fetched(), {
      accountId: "acc-1",
      policy: "metadata",
      messageId: "msg-1",
    });

    expect(stored.bodyCipher).toBeNull();
    expect(stored.bodyFormat).toBeNull();
    expect(stored.snippet).toBeNull();
    expect(stored.subject).toBe("Q3 board pack");
  });

  it("indexes only the subject under Metadata", () => {
    const stored = prepareForStorage(fetched(), {
      accountId: "acc-1",
      policy: "metadata",
      messageId: "msg-1",
    });

    expect(stored.searchIndexInput).toBe("Q3 board pack");
    expect(stored.searchIndexInput).not.toContain("renewal");
  });

  it("indexes subject and body under Full", () => {
    const stored = prepareForStorage(fetched(), {
      accountId: "acc-1",
      policy: "full",
      messageId: "msg-1",
    });

    expect(stored.searchIndexInput).toContain("Q3 board pack");
    expect(stored.searchIndexInput).toContain("renewal figure");
  });

  it("keeps the metadata that makes a message findable", () => {
    const stored = prepareForStorage(fetched(), {
      accountId: "acc-1",
      policy: "metadata",
      messageId: "msg-1",
    });

    expect(stored).toMatchObject({
      fromAddress: "maya@example.com",
      fromName: "Maya Chen",
      toAddresses: ["doug@theonefor.ai"],
      isRead: false,
      hasAttachments: true,
      messageIdHeader: "<a@b.c>",
    });
  });

  it("tolerates a message with no body at all", () => {
    const stored = prepareForStorage(
      fetched({ body: null, bodyFormat: null }),
      {
        accountId: "acc-1",
        policy: "full",
        messageId: "msg-1",
      },
    );

    expect(stored.bodyCipher).toBeNull();
    expect(stored.searchIndexInput).toBe("Q3 board pack");
  });
});

/* ── The sync pass ────────────────────────────────────────────────────── */

describe("syncMessages", () => {
  it("makes no request at all under the Off policy", async () => {
    // A mailbox set to Off should not even appear in the provider's access
    // log against our credentials.
    const gmail = adapter();
    const result = await syncMessages(gmail, target("off"), ids());

    expect(gmail.listMessages).not.toHaveBeenCalled();
    expect(result.messages).toEqual([]);
    expect(result.status).toBe("connected");
    expect(result.detail).toMatch(/Caching is off/);
  });

  it("does not ask the provider for bodies under Metadata", async () => {
    const gmail = adapter();
    await syncMessages(gmail, target("metadata"), ids());

    expect(gmail.listMessages).toHaveBeenCalledWith(
      expect.objectContaining({ includeBodies: false }),
    );
  });

  it("asks for bodies under Full", async () => {
    const gmail = adapter();
    await syncMessages(gmail, target("full"), ids());

    expect(gmail.listMessages).toHaveBeenCalledWith(
      expect.objectContaining({ includeBodies: true }),
    );
  });

  it("refuses Full caching when no encryption key is configured", async () => {
    // The alternative is writing plaintext bodies, which the database would
    // reject anyway — failing here says why.
    delete process.env.DASHBOARD_ENCRYPTION_KEYS;
    resetKeyringCache();

    const gmail = adapter();
    const result = await syncMessages(gmail, target("full"), ids());

    expect(gmail.listMessages).not.toHaveBeenCalled();
    expect(result.error).toBe("encryption_not_configured");
    expect(result.detail).toMatch(/DASHBOARD_ENCRYPTION_KEYS/);
  });

  it("returns the cursor for the next run", async () => {
    const result = await syncMessages(adapter(), target("metadata"), ids());
    expect(result.cursor).toBe("next");
  });

  it("passes a full-resync demand through", async () => {
    const gmail = adapter({
      listMessages: vi.fn(async () => ({
        messages: [],
        threads: [],
        cursor: "100:0",
        requiresFullResync: true,
      })),
    });

    expect(
      (await syncMessages(gmail, target("metadata"), ids())).requiresFullResync,
    ).toBe(true);
  });
});

/* ── Degradation ──────────────────────────────────────────────────────── */

describe("degradation", () => {
  const failing = (error: AdapterError) =>
    adapter({
      listMessages: vi.fn(async () => {
        throw error;
      }),
    });

  it("keeps cached data usable when the provider is down", async () => {
    const result = await syncMessages(
      failing(new AdapterError("gmail", "unavailable", "down")),
      { ...target("metadata"), cursor: "keep-me" },
      ids(),
    );

    expect(result.status).toBe("degraded");
    expect(result.degraded).toBe(true);
    // The cursor is preserved, so recovery resumes rather than re-reading.
    expect(result.cursor).toBe("keep-me");
    expect(result.detail).toMatch(/last mail that synced/);
  });

  it("keeps cached data usable when rate limited, and says for how long", async () => {
    const result = await syncMessages(
      failing(
        new AdapterError("gmail", "rate_limited", "slow down", {
          retryAfterMs: 30_000,
        }),
      ),
      target("metadata"),
      ids(),
    );

    expect(result.degraded).toBe(true);
    expect(result.detail).toMatch(/30s/);
  });

  it("marks a revoked token as needing sign-in, and NOT as merely degraded", async () => {
    // This is the one case where the cache should stop being presented as
    // live: the connection is genuinely broken until the owner acts.
    const result = await syncMessages(
      failing(new AdapterError("gmail", "auth", "revoked")),
      target("metadata"),
      ids(),
    );

    expect(result.status).toBe("needs_reauth");
    expect(result.degraded).toBe(false);
    expect(result.detail).toMatch(/Sign in again/);
  });

  it("distinguishes an administrator refusal from an ordinary auth failure", async () => {
    const result = await syncMessages(
      failing(
        new AdapterError("microsoft", "admin_consent_required", "no consent"),
      ),
      target("metadata"),
      ids(),
    );

    expect(result.error).toBe("admin_consent_required");
    expect(result.detail).toMatch(/administrator/);
  });

  it("survives an adapter throwing something that is not an AdapterError", async () => {
    const result = await syncMessages(
      adapter({
        listMessages: vi.fn(async () => {
          throw new TypeError("cannot read properties of undefined");
        }),
      }),
      target("metadata"),
      ids(),
    );

    expect(result.degraded).toBe(true);
    expect(result.error).toBe("unknown");
  });

  it("never throws for a provider problem", async () => {
    // The caller's job is to record the outcome against the account, not to
    // fail a request.
    await expect(
      syncMessages(
        failing(new AdapterError("gmail", "unavailable", "down")),
        target("full"),
        ids(),
      ),
    ).resolves.toBeDefined();
  });
});

describe("describeError", () => {
  it("is plain and actionable for every kind", () => {
    for (const kind of [
      "auth",
      "admin_consent_required",
      "rate_limited",
      "unavailable",
      "unsupported",
      "unknown",
    ] as const) {
      const sentence = describeError(new AdapterError("gmail", kind, "x"));
      expect(sentence.length).toBeGreaterThan(10);
      // No jargon leaking into the interface.
      expect(sentence).not.toMatch(/AdapterError|undefined|null/);
    }
  });
});

/* ── Back-off ─────────────────────────────────────────────────────────── */

describe("backOffMs", () => {
  it("does not wait before the first attempt", () => {
    expect(backOffMs(0)).toBe(0);
  });

  it("grows exponentially", () => {
    expect(backOffMs(1)).toBe(60_000);
    expect(backOffMs(2)).toBe(120_000);
    expect(backOffMs(3)).toBe(240_000);
  });

  it("stops at an hour", () => {
    // A provider down for a day does not need asking every 30 seconds, and a
    // recovered one should not wait a day to be noticed.
    expect(backOffMs(20)).toBe(3_600_000);
  });
});

describe("shouldAttemptSync", () => {
  const now = new Date("2026-08-09T12:00:00Z");

  it("always runs the first time", () => {
    expect(shouldAttemptSync(null, 0, now)).toBe(true);
  });

  it("waits out the back-off after a failure", () => {
    expect(shouldAttemptSync("2026-08-09T11:59:30Z", 2, now)).toBe(false);
    expect(shouldAttemptSync("2026-08-09T11:57:00Z", 2, now)).toBe(true);
  });
});
