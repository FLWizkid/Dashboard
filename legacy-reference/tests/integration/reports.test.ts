import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { composeDigest } from "@/lib/reports/digest";
import {
  createStubEmailChannel,
  deliverDigest,
  type DeliveryStore,
} from "@/lib/reports/delivery";
import type { ExecutiveSummary } from "@/lib/reports/summary";

import {
  asUser,
  connect,
  createUser,
  errorCode,
  hasDatabase,
  resetSchema,
} from "./db";

/**
 * Reports and digests, through the database.
 *
 * The claim this file exists to prove is the gate's: **a scheduled brief is
 * generated and delivered.** Delivery here means the in-app copy lands in
 * Postgres and the email goes to the stub channel — the same path a real
 * relay would take, with the last hop swapped.
 *
 * The other half is idempotency. A cron that fires twice, or a container that
 * restarts mid-run, must not produce two morning briefs, and that is a
 * database guarantee rather than an application one.
 */
const describeDb = hasDatabase ? describe : describe.skip;

function summary(partial: Partial<ExecutiveSummary> = {}): ExecutiveSummary {
  return {
    openTasks: 4,
    overdue: 1,
    dueSoon: 2,
    ready: 3,
    untriaged: 0,
    completedThisWeek: 2,
    hoursThisWeek: null,
    criticalUnread: null,
    topPriorities: [],
    ...partial,
  };
}

describeDb("reports and digests", () => {
  let client: Client;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    client = await connect();
    await resetSchema(client);
    alice = await createUser(client, "alice@example.invalid");
    bob = await createUser(client, "bob@example.invalid");
  }, 60_000);

  afterAll(async () => {
    await client?.end();
  });

  /** A delivery store backed by the real database, as the app's is. */
  function storeFor(userId: string): DeliveryStore {
    return {
      async writeInbox(message) {
        const { rows } = await asUser(
          client,
          userId,
          (c) =>
            c.query<{ id: string }>(
              `insert into public.inbox_messages
                 (kind, subject, preview, body, html, generated_at)
               values ($1, $2, $3, $4, $5, $6) returning id`,
              [
                message.kind,
                message.subject,
                message.preview,
                message.body,
                message.html,
                message.generatedAt,
              ],
            ),
          { commit: true },
        );
        return rows[0].id;
      },

      async recordRun(run) {
        await asUser(
          client,
          userId,
          (c) =>
            c.query(
              `insert into public.digest_runs
                 (kind, period_date, inbox_message_id, email_attempted,
                  email_ok, email_error, channel)
               values ($1, current_date, $2, $3, $4, $5, $6)
               on conflict (user_id, kind, period_date) do update
                 set inbox_message_id = excluded.inbox_message_id,
                     email_attempted = excluded.email_attempted,
                     email_ok = excluded.email_ok,
                     email_error = excluded.email_error,
                     channel = excluded.channel`,
              [
                run.kind,
                run.inboxMessageId,
                run.emailAttempted,
                run.emailOk,
                run.emailError,
                run.channel,
              ],
            ),
          { commit: true },
        );
      },
    };
  }

  /* ── The gate: generated and delivered ────────────────────────────── */

  describe("a scheduled brief", () => {
    it("lands in the in-app inbox and goes to the email channel", async () => {
      const email = createStubEmailChannel();

      const digest = composeDigest({
        kind: "daily",
        generatedAt: new Date(),
        timeZone: "UTC",
        summary: summary(),
      });

      const outcome = await deliverDigest({
        digest,
        store: storeFor(alice),
        email,
        to: "doug@example.invalid",
      });

      expect(outcome.emailOk).toBe(true);
      expect(email.sent).toHaveLength(1);
      expect(email.sent[0].subject).toContain("Morning brief");

      const { rows } = await asUser(client, alice, (c) =>
        c.query<{ subject: string; body: string; read_at: string | null }>(
          `select subject, body, read_at from public.inbox_messages
            where id = $1`,
          [outcome.inboxMessageId],
        ),
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].subject).toContain("Morning brief");
      // Arrives unread — a brief nobody has to mark as new.
      expect(rows[0].read_at).toBeNull();
    });

    it("keeps the in-app copy when the email fails", async () => {
      // The whole reason the inbox is written first.
      const failing = {
        name: "failing",
        async send() {
          return { ok: false, error: "connection refused" };
        },
      };

      const outcome = await deliverDigest({
        digest: composeDigest({
          kind: "daily",
          generatedAt: new Date(),
          timeZone: "UTC",
          summary: summary(),
        }),
        store: storeFor(bob),
        email: failing,
        to: "bob@example.invalid",
      });

      expect(outcome.emailOk).toBe(false);

      const { rows } = await asUser(client, bob, (c) =>
        c.query(`select id from public.inbox_messages where id = $1`, [
          outcome.inboxMessageId,
        ]),
      );

      expect(rows).toHaveLength(1);
    });
  });

  /* ── Idempotency ───────────────────────────────────────────────────── */

  describe("the period claim", () => {
    it("refuses a second run for the same kind and period", async () => {
      await asUser(
        client,
        alice,
        (c) =>
          c.query(
            `insert into public.digest_runs (kind, period_date)
             values ('weekly', date '2026-08-10')`,
          ),
        { commit: true },
      );

      await expect(
        asUser(client, alice, (c) =>
          c.query(
            `insert into public.digest_runs (kind, period_date)
             values ('weekly', date '2026-08-10')`,
          ),
        ),
      ).rejects.toSatisfy((error) => errorCode(error) === "23505");
    });

    it("allows the same period for a different kind", async () => {
      await expect(
        asUser(client, alice, (c) =>
          c.query(
            `insert into public.digest_runs (kind, period_date)
             values ('monthly', date '2026-08-10')`,
          ),
        ),
      ).resolves.toBeDefined();
    });

    it("does not let one owner's claim block another's", async () => {
      await expect(
        asUser(client, bob, (c) =>
          c.query(
            `insert into public.digest_runs (kind, period_date)
             values ('weekly', date '2026-08-10')`,
          ),
        ),
      ).resolves.toBeDefined();
    });

    it("refuses a run that claims success and an error at once", async () => {
      await expect(
        asUser(client, alice, (c) =>
          c.query(
            `insert into public.digest_runs
               (kind, period_date, email_ok, email_error)
             values ('daily', date '2026-01-01', true, 'it worked but also did not')`,
          ),
        ),
      ).rejects.toSatisfy((error) => errorCode(error) === "23514");
    });
  });

  /* ── Isolation ─────────────────────────────────────────────────────── */

  describe("isolation", () => {
    it("keeps one owner's inbox invisible to another", async () => {
      await asUser(
        client,
        alice,
        (c) =>
          c.query(
            `insert into public.inbox_messages (kind, subject, body)
             values ('daily', 'Alice private brief', 'body')`,
          ),
        { commit: true },
      );

      const { rows } = await asUser(client, bob, (c) =>
        c.query(
          `select id from public.inbox_messages
            where subject = 'Alice private brief'`,
        ),
      );

      expect(rows).toHaveLength(0);
    });

    it("refuses a run pointing at someone else's inbox message", async () => {
      const { rows } = await asUser(
        client,
        alice,
        (c) =>
          c.query<{ id: string }>(
            `insert into public.inbox_messages (kind, subject, body)
             values ('daily', 'Alice message', 'body') returning id`,
          ),
        { commit: true },
      );

      await expect(
        asUser(client, bob, (c) =>
          c.query(
            `insert into public.digest_runs
               (kind, period_date, inbox_message_id)
             values ('daily', date '2026-02-02', $1)`,
            [rows[0].id],
          ),
        ),
      ).rejects.toBeDefined();
    });

    it("keeps digest settings private", async () => {
      await asUser(
        client,
        alice,
        (c) =>
          c.query(
            `insert into public.digest_settings (email_to)
             values ('alice-secret@example.invalid')`,
          ),
        { commit: true },
      );

      const { rows } = await asUser(client, bob, (c) =>
        c.query(`select email_to from public.digest_settings`),
      );

      expect(rows).toHaveLength(0);
    });
  });

  /* ── Settings ──────────────────────────────────────────────────────── */

  describe("settings", () => {
    it("refuses an hour outside the day", async () => {
      await expect(
        asUser(client, bob, (c) =>
          c.query(
            `insert into public.digest_settings (daily_hour) values (25)`,
          ),
        ),
      ).rejects.toSatisfy((error) => errorCode(error) === "23514");
    });

    it("refuses a weekday outside the week", async () => {
      await expect(
        asUser(client, bob, (c) =>
          c.query(`insert into public.digest_settings (weekly_dow) values (9)`),
        ),
      ).rejects.toSatisfy((error) => errorCode(error) === "23514");
    });

    it("allows a null address — in-app only is a valid configuration", async () => {
      await expect(
        asUser(client, bob, (c) =>
          c.query(
            `insert into public.digest_settings (email_to) values (null)`,
          ),
        ),
      ).resolves.toBeDefined();
    });
  });

  /* ── Retention ─────────────────────────────────────────────────────── */

  it("purges digests older than the retention window", async () => {
    await asUser(
      client,
      alice,
      (c) =>
        c.query(
          `insert into public.inbox_messages (kind, subject, body, generated_at)
           values ('daily', 'Ancient brief', 'body', now() - interval '30 months')`,
        ),
      { commit: true },
    );

    await client.query("select public.purge_old_digests()");

    const { rows } = await asUser(client, alice, (c) =>
      c.query(`select id from public.inbox_messages
                where subject = 'Ancient brief'`),
    );

    expect(rows).toHaveLength(0);
  });
});
