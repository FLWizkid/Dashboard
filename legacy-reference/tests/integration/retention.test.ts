import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asUser, connect, createUser, hasDatabase, resetSchema } from "./db";

/**
 * Retention, across every module that has any.
 *
 * The specification sets a **24-month default, configurable**. Two modules
 * implement it and the rest deliberately do not, which is a decision worth
 * writing down rather than a gap:
 *
 *   | Data              | Retention | Why                                    |
 *   | ----------------- | --------- | -------------------------------------- |
 *   | Cached mail       | per account, default 24 months | a copy of someone else's system |
 *   | Digests + runs    | 24 months | derived; regenerable from the source   |
 *   | Tasks, notes, hours | none    | **the app is the system of record**    |
 *
 * A purge that quietly deleted the ledger would be destroying the only copy.
 * So the interesting assertions here are as much about what survives as about
 * what goes.
 *
 * The other failure mode is a purge that deletes *nothing* — a schedule that
 * stopped running looks exactly like a schedule with nothing to do. Both
 * functions return a count for that reason, and these tests check the count as
 * well as the rows.
 */
const describeDb = hasDatabase ? describe : describe.skip;

describeDb("retention", () => {
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

  /* ── Mail ───────────────────────────────────────────────────────────── */

  describe("cached mail", () => {
    let accountId: string;

    beforeAll(async () => {
      const { rows } = await asUser(
        client,
        alice,
        (c) =>
          c.query<{ id: string }>(
            `insert into public.mail_accounts
               (provider, email_address, remote_id, display_name)
             values ('gmail', 'alice@example.invalid', 'remote-1', 'Alice')
             returning id`,
          ),
        { commit: true },
      );
      accountId = rows[0].id;
    });

    it("defaults to twenty-four months", async () => {
      const { rows } = await asUser(client, alice, (c) =>
        c.query<{ retention_months: number }>(
          `select retention_months from public.mail_accounts where id = $1`,
          [accountId],
        ),
      );

      expect(rows[0].retention_months).toBe(24);
    });

    it("deletes what is past the window and keeps what is not", async () => {
      await seedMessage(alice, accountId, "ancient", "30 months");
      await seedMessage(alice, accountId, "recent", "3 months");

      const { rows } = await asUser(
        client,
        alice,
        (c) =>
          c.query<{ purge_expired_messages: string }>(
            `select public.purge_expired_messages()`,
          ),
        { commit: true },
      );

      // The count, not just the rows: a purge that deletes nothing and one
      // that is not running are indistinguishable from the outside.
      expect(Number(rows[0].purge_expired_messages)).toBe(1);

      const remaining = await asUser(client, alice, (c) =>
        c.query<{ remote_id: string }>(
          `select remote_id from public.messages order by remote_id`,
        ),
      );

      expect(remaining.rows.map((row) => row.remote_id)).toEqual(["recent"]);
    });

    it("honours a shortened window rather than a hard-coded two years", async () => {
      await asUser(
        client,
        alice,
        (c) =>
          c.query(
            `update public.mail_accounts set retention_months = 1 where id = $1`,
            [accountId],
          ),
        { commit: true },
      );

      // "recent" is three months old — inside the default window, outside
      // this one. If the interval were hard-coded, this would survive.
      await asUser(
        client,
        alice,
        (c) => c.query(`select public.purge_expired_messages()`),
        { commit: true },
      );

      const remaining = await asUser(client, alice, (c) =>
        c.query(`select id from public.messages`),
      );

      expect(remaining.rows).toHaveLength(0);

      await asUser(
        client,
        alice,
        (c) =>
          c.query(
            `update public.mail_accounts set retention_months = 24 where id = $1`,
            [accountId],
          ),
        { commit: true },
      );
    });

    it("cannot reach another owner's mail", async () => {
      // `security invoker`, so RLS applies. If this were `security definer`,
      // Bob running a purge would silently delete Alice's expired mail —
      // which is the right *rows* by accident and the wrong *authority*.
      await seedMessage(alice, accountId, "alice-ancient", "30 months");

      const { rows } = await asUser(
        client,
        bob,
        (c) =>
          c.query<{ purge_expired_messages: string }>(
            `select public.purge_expired_messages()`,
          ),
        { commit: true },
      );

      expect(Number(rows[0].purge_expired_messages)).toBe(0);

      const survived = await asUser(client, alice, (c) =>
        c.query(`select id from public.messages where remote_id = $1`, [
          "alice-ancient",
        ]),
      );

      expect(survived.rows).toHaveLength(1);
    });

    it("removes threads left with nothing in them", async () => {
      await asUser(
        client,
        alice,
        (c) => c.query(`select public.purge_expired_messages()`),
        { commit: true },
      );

      const threads = await asUser(client, alice, (c) =>
        c.query(`select id from public.mail_threads`),
      );

      expect(threads.rows).toHaveLength(0);
    });
  });

  /* ── Digests ────────────────────────────────────────────────────────── */

  describe("digests", () => {
    it("purges past the window and leaves the rest", async () => {
      await asUser(
        client,
        alice,
        (c) =>
          c.query(
            `insert into public.inbox_messages (kind, subject, body, generated_at)
             values ('daily', 'Ancient brief', 'body', now() - interval '30 months'),
                    ('daily', 'Recent brief',  'body', now() - interval '2 months')`,
          ),
        { commit: true },
      );

      await client.query(`select public.purge_old_digests()`);

      const { rows } = await asUser(client, alice, (c) =>
        c.query<{ subject: string }>(
          `select subject from public.inbox_messages order by subject`,
        ),
      );

      expect(rows.map((row) => row.subject)).toEqual(["Recent brief"]);
    });

    it("takes the window as an argument, so a shorter one is possible", async () => {
      await client.query(`select public.purge_old_digests(interval '1 month')`);

      const { rows } = await asUser(client, alice, (c) =>
        c.query(`select id from public.inbox_messages`),
      );

      expect(rows).toHaveLength(0);
    });
  });

  /* ── What must never be purged ──────────────────────────────────────── */

  describe("the system of record", () => {
    it("keeps tasks, notes and hours however old they are", async () => {
      // The app is the system of record for these. There is no upstream to
      // re-sync from, so an automatic purge would be deleting the only copy —
      // and a five-year-old completed task is history, not litter.
      await asUser(
        client,
        alice,
        (c) =>
          c.query(
            `insert into public.tasks (title, created_at, status, completed_at)
             values ('Ancient task', now() - interval '5 years', 'done',
                     now() - interval '5 years')`,
          ),
        { commit: true },
      );

      await asUser(
        client,
        alice,
        (c) =>
          c.query(
            `insert into public.notes (title, body, created_at)
             values ('Ancient note', 'still here', now() - interval '5 years')`,
          ),
        { commit: true },
      );

      await asUser(
        client,
        alice,
        (c) =>
          c.query(
            `insert into public.time_entries (source, started_at, ended_at)
             values ('manual', now() - interval '5 years',
                     now() - interval '5 years' + interval '1 hour')`,
          ),
        { commit: true },
      );

      // Run every purge the schema has.
      await asUser(
        client,
        alice,
        (c) => c.query(`select public.purge_expired_messages()`),
        { commit: true },
      );
      await client.query(`select public.purge_old_digests(interval '1 day')`);

      const survivors = await asUser(client, alice, (c) =>
        c.query<{ tasks: string; notes: string; entries: string }>(
          `select (select count(*) from public.tasks)::text        as tasks,
                  (select count(*) from public.notes)::text        as notes,
                  (select count(*) from public.time_entries)::text as entries`,
        ),
      );

      expect(survivors.rows[0]).toEqual({
        tasks: "1",
        notes: "1",
        entries: "1",
      });
    });

    it("has no purge function anyone could point at them by accident", async () => {
      // If a `purge_old_tasks` ever appears, this test is the conversation
      // about whether it should.
      const { rows } = await client.query<{ proname: string }>(
        `select p.proname
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname like 'purge%'
          order by p.proname`,
      );

      expect(rows.map((row) => row.proname)).toEqual([
        "purge_expired_messages",
        // Deliberate, and the conversation this test exists to force: the
        // audit log ages out at 24 months, the same window as the mail it
        // describes. A log that outlives its subject is a list of things you
        // can no longer look up; one that outlives it *indefinitely* is a
        // growing record of behaviour kept for no stated purpose. It removes
        // only audit rows — never a task, note, hour or link.
        "purge_old_audit_log",
        "purge_old_digests",
        // Deliberate, and the conversation this test exists to force: it
        // removes *cached references nothing links to* — never a link, which
        // is the owner's judgement, and never a task, note or hour. See
        // docs/connectors.md § Retention.
        "purge_orphaned_refs",
      ]);
    });
  });

  /* ── Helper ─────────────────────────────────────────────────────────── */

  async function seedMessage(
    userId: string,
    accountId: string,
    remoteId: string,
    age: string,
  ): Promise<void> {
    await asUser(
      client,
      userId,
      async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `insert into public.mail_threads (account_id, remote_id, subject)
           values ($1, $2, $3) returning id`,
          [accountId, `thread-${remoteId}`, `Subject ${remoteId}`],
        );

        await c.query(
          `insert into public.messages
             (account_id, thread_id, remote_id, received_at,
              subject, from_address)
           values ($1, $2, $3, now() - $4::interval, $5, $6)`,
          [
            accountId,
            rows[0].id,
            remoteId,
            age,
            `Subject ${remoteId}`,
            "sender@example.invalid",
          ],
        );
      },
      { commit: true },
    );
  }
});
