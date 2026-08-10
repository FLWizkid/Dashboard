import { describe, expect, it } from "vitest";

import type { Task } from "@/lib/tasks/types";

import { composeDigest, escapeHtml, type DigestInput } from "./digest";
import {
  createStubEmailChannel,
  createSmtpEmailChannel,
  deliverDigest,
  emailChannelFromEnv,
  type DeliveryStore,
  type InboxWrite,
} from "./delivery";
import type { ExecutiveSummary } from "./summary";

/**
 * Digest composition and delivery.
 *
 * The delivery tests are the important half, and the property they protect is
 * blunt: **a failed email must never lose the digest.** The in-app copy is
 * written first, unconditionally, and everything after that can fail.
 */

const NOW = new Date("2026-08-12T07:00:00.000Z");

function task(partial: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Draft the board deck",
    notes: null,
    priority: "high",
    dueAt: "2026-08-13T17:00:00.000Z",
    categoryId: null,
    status: "inbox",
    pinned: false,
    sourceLink: null,
    owner: null,
    isReady: true,
    isDraft: false,
    canActivate: false,
    manualRank: null,
    manualRankSetAt: null,
    completedAt: null,
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
    links: [],
    ...partial,
  };
}

function summary(partial: Partial<ExecutiveSummary> = {}): ExecutiveSummary {
  return {
    openTasks: 7,
    overdue: 2,
    dueSoon: 3,
    ready: 4,
    untriaged: 1,
    completedThisWeek: 5,
    hoursThisWeek: null,
    criticalUnread: null,
    topPriorities: [task()],
    ...partial,
  };
}

function input(partial: Partial<DigestInput> = {}): DigestInput {
  return {
    kind: "daily",
    generatedAt: NOW,
    timeZone: "UTC",
    summary: summary(),
    ...partial,
  };
}

describe("composition", () => {
  it("names the digest by kind and date", () => {
    expect(composeDigest(input()).subject).toContain("Morning brief");
    expect(composeDigest(input({ kind: "weekly" })).subject).toContain(
      "Week in review",
    );
    expect(composeDigest(input({ kind: "monthly" })).subject).toContain(
      "Month in review",
    );
  });

  it("always produces both a text and an HTML rendering", () => {
    const digest = composeDigest(input());

    expect(digest.text.length).toBeGreaterThan(0);
    expect(digest.html).toContain("<!doctype html>");
  });

  it("leads the preview with whatever changes what you do next", () => {
    expect(composeDigest(input()).preview).toContain("2 overdue");

    const clear = composeDigest(
      input({ summary: summary({ overdue: 0, dueSoon: 0 }) }),
    );
    expect(clear.preview).toContain("nothing overdue");
  });

  it("says '— not recorded' rather than printing a confident zero", () => {
    const digest = composeDigest(input());

    expect(digest.text).toContain("not recorded");
    expect(digest.text).toContain("no mail account connected");
  });

  it("prints a real zero when zero is the true answer", () => {
    const digest = composeDigest(
      input({ summary: summary({ criticalUnread: 0 }) }),
    );

    expect(digest.text).not.toContain("no mail account connected");
  });

  it("includes the two-day rollup in a daily brief", () => {
    const digest = composeDigest(
      input({
        twoDay: [
          {
            start: "2026-08-12T00:00:00.000Z",
            label: "Today",
            events: [
              {
                id: "e1",
                title: "Board meeting",
                startsAt: "2026-08-12T10:00:00.000Z",
                endsAt: "2026-08-12T11:00:00.000Z",
                isCancelled: false,
              },
            ],
            tasks: [],
          },
          {
            start: "2026-08-13T00:00:00.000Z",
            label: "Tomorrow",
            events: [],
            tasks: [],
          },
        ],
      }),
    );

    expect(digest.text).toContain("Board meeting");
    expect(digest.html).toContain("Board meeting");
    // An empty day says so rather than being silently omitted.
    expect(digest.text).toContain("Nothing scheduled.");
  });

  it("includes activity splits in a rollup", () => {
    const digest = composeDigest(
      input({
        kind: "weekly",
        splits: [
          {
            categoryId: "cat-1",
            name: "Strategic",
            openTasks: 3,
            completed: 2,
            minutes: 300,
            share: 60,
          },
        ],
      }),
    );

    expect(digest.text).toContain("Strategic");
    expect(digest.html).toContain("60%");
  });

  it("omits an empty group rather than printing a bare heading", () => {
    const digest = composeDigest(
      input({
        groups: [
          {
            group: "overdue",
            label: "Overdue",
            description: "",
            tasks: [],
          },
          {
            group: "dueSoon",
            label: "Due soon",
            description: "",
            tasks: [task({ id: "b", title: "Something due" })],
          },
        ],
      }),
    );

    expect(digest.text).not.toContain("OVERDUE");
    expect(digest.text).toContain("DUE SOON");
  });

  it("is deterministic for the same input", () => {
    const a = composeDigest(input());
    const b = composeDigest(input());
    expect(a.html).toBe(b.html);
    expect(a.text).toBe(b.text);
  });
});

describe("escaping", () => {
  it("escapes the characters that would break the markup", () => {
    expect(escapeHtml(`Tom & Jerry <script>"'`)).toBe(
      "Tom &amp; Jerry &lt;script&gt;&quot;&#39;",
    );
  });

  it("escapes task titles in the HTML rendering", () => {
    // Owner-authored, but routinely contains `&` and `<`, and this is the one
    // place the application emits markup something else parses.
    const digest = composeDigest(
      input({
        summary: summary({
          topPriorities: [task({ title: "Review <Acme & Co> contract" })],
        }),
      }),
    );

    expect(digest.html).toContain("&lt;Acme &amp; Co&gt;");
    expect(digest.html).not.toContain("<Acme");
  });

  it("leaves the text rendering unescaped, because it is not markup", () => {
    const digest = composeDigest(
      input({
        summary: summary({
          topPriorities: [task({ title: "Review <Acme & Co> contract" })],
        }),
      }),
    );

    expect(digest.text).toContain("<Acme & Co>");
  });
});

/* ── Delivery ─────────────────────────────────────────────────────────── */

function createStore(): DeliveryStore & {
  inbox: InboxWrite[];
  runs: Parameters<DeliveryStore["recordRun"]>[0][];
} {
  const inbox: InboxWrite[] = [];
  const runs: Parameters<DeliveryStore["recordRun"]>[0][] = [];

  return {
    inbox,
    runs,
    async writeInbox(message) {
      inbox.push(message);
      return `inbox-${inbox.length}`;
    },
    async recordRun(run) {
      runs.push(run);
    },
  };
}

describe("delivery", () => {
  it("writes the in-app copy before attempting email", async () => {
    const store = createStore();
    const email = createStubEmailChannel();

    await deliverDigest({
      digest: composeDigest(input()),
      store,
      email,
      to: "doug@example.invalid",
    });

    expect(store.inbox).toHaveLength(1);
    expect(email.sent).toHaveLength(1);
  });

  it("keeps the in-app copy when the email fails", async () => {
    // The property the whole ordering exists for: an SMTP outage on Monday
    // morning costs the email, never the brief.
    const store = createStore();
    const failing = {
      name: "failing",
      async send() {
        return { ok: false, error: "connection refused" };
      },
    };

    const outcome = await deliverDigest({
      digest: composeDigest(input()),
      store,
      email: failing,
      to: "doug@example.invalid",
    });

    expect(store.inbox).toHaveLength(1);
    expect(outcome.emailOk).toBe(false);
    expect(outcome.emailError).toBe("connection refused");
    // And the failure is recorded rather than swallowed.
    expect(store.runs[0].emailError).toBe("connection refused");
  });

  it("delivers to the inbox only when no address is configured", async () => {
    const store = createStore();
    const email = createStubEmailChannel();

    const outcome = await deliverDigest({
      digest: composeDigest(input()),
      store,
      email,
      to: null,
    });

    expect(store.inbox).toHaveLength(1);
    expect(email.sent).toHaveLength(0);
    expect(outcome.emailAttempted).toBe(false);
  });

  it("treats a whitespace-only address as no address", async () => {
    const store = createStore();
    const email = createStubEmailChannel();

    await deliverDigest({
      digest: composeDigest(input()),
      store,
      email,
      to: "   ",
    });

    expect(email.sent).toHaveLength(0);
  });

  it("sends both renderings", async () => {
    const store = createStore();
    const email = createStubEmailChannel();

    await deliverDigest({
      digest: composeDigest(input()),
      store,
      email,
      to: "doug@example.invalid",
    });

    expect(email.sent[0].text.length).toBeGreaterThan(0);
    expect(email.sent[0].html).toContain("<!doctype html>");
  });
});

describe("the email channel", () => {
  it("falls back to the stub when nothing is configured", () => {
    // A box with no relay should get its brief in the app, not a crashed job.
    expect(emailChannelFromEnv({}).name).toBe("stub");
    expect(emailChannelFromEnv({ DIGEST_SMTP_HOST: "smtp.local" }).name).toBe(
      "stub",
    );
  });

  it("uses SMTP once host and from are both set", () => {
    expect(
      emailChannelFromEnv({
        DIGEST_SMTP_HOST: "smtp.local",
        DIGEST_FROM: "dashboard@example.invalid",
      }).name,
    ).toBe("smtp");
  });

  it("reports a transport failure rather than throwing", async () => {
    const channel = createSmtpEmailChannel({
      host: "smtp.local",
      port: 587,
      from: "dashboard@example.invalid",
      createTransport: async () => {
        throw new Error("no route to host");
      },
    });

    const result = await channel.send({
      to: "doug@example.invalid",
      subject: "x",
      html: "<p>x</p>",
      text: "x",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("no route to host");
  });

  it("passes the message through to the transport", async () => {
    const sent: unknown[] = [];
    const channel = createSmtpEmailChannel({
      host: "smtp.local",
      port: 587,
      from: "dashboard@example.invalid",
      createTransport: async () => ({
        async sendMail(message) {
          sent.push(message);
          return { messageId: "abc" };
        },
      }),
    });

    const result = await channel.send({
      to: "doug@example.invalid",
      subject: "Morning brief",
      html: "<p>hi</p>",
      text: "hi",
    });

    expect(result.ok).toBe(true);
    expect(result.messageId).toBe("abc");
    expect(sent).toHaveLength(1);
  });
});
