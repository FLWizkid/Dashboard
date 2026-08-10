import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asUser,
  connect,
  createUser,
  errorCode,
  hasDatabase,
  resetSchema,
} from "./db";

/**
 * External context, through the database.
 *
 * The claims worth proving in Postgres rather than in TypeScript are the ones
 * that have to survive the next import script: **confirm before link**, one
 * subject per link, one reference per external thing, and isolation between
 * owners. Everything else about connectors is application logic and is tested
 * as such.
 */
const describeDb = hasDatabase ? describe : describe.skip;

describeDb("external context", () => {
  let client: Client;
  let alice: string;
  let bob: string;
  let aliceTask: string;
  let aliceNote: string;

  beforeAll(async () => {
    client = await connect();
    await resetSchema(client);
    alice = await createUser(client, "alice@example.invalid");
    bob = await createUser(client, "bob@example.invalid");

    const task = await asUser(
      client,
      alice,
      (c) =>
        c.query<{ id: string }>(
          `insert into public.tasks (title) values ('Review the auth PR')
           returning id`,
        ),
      { commit: true },
    );
    aliceTask = task.rows[0].id;

    const note = await asUser(
      client,
      alice,
      (c) =>
        c.query<{ id: string }>(
          `insert into public.notes (title, body) values ('Auth design', 'x')
           returning id`,
        ),
      { commit: true },
    );
    aliceNote = note.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await client?.end();
  });

  /** A reference owned by `userId`, committed. */
  async function makeRef(
    userId: string,
    remoteId: string,
    over: Partial<{ title: string; state: string; url: string }> = {},
  ): Promise<string> {
    const { rows } = await asUser(
      client,
      userId,
      (c) =>
        c.query<{ id: string }>(
          `insert into public.external_refs
             (provider, kind, remote_id, url, title, state)
           values ('github', 'pull_request', $1, $2, $3, $4)
           returning id`,
          [
            remoteId,
            over.url ?? `https://github.test/acme/api/pull/${remoteId}`,
            over.title ?? `Pull request ${remoteId}`,
            over.state ?? "open",
          ],
        ),
      { commit: true },
    );
    return rows[0].id;
  }

  /* ── Confirm before link ────────────────────────────────────────────── */

  describe("confirm before link", () => {
    it("refuses a link created already-confirmed in the past", async () => {
      // The shape a silent auto-linker would take. Making this a database
      // rule rather than an application one is what stops the guarantee
      // depending on today's code.
      const ref = await makeRef(alice, "guard-1");

      await expect(
        asUser(client, alice, (c) =>
          c.query(
            `insert into public.external_links (ref_id, task_id, confirmed_at)
             values ($1, $2, now() - interval '1 hour')`,
            [ref, aliceTask],
          ),
        ),
      ).rejects.toSatisfy((error) => errorCode(error) === "23514");
    });

    it("allows a confirmation stamped now — a paste is a confirmation", async () => {
      // Pasting a URL onto a task is an explicit act by the owner, so it does
      // not need a second question. What it must not do is arrive backdated.
      const ref = await makeRef(alice, "guard-2");

      await expect(
        asUser(
          client,
          alice,
          (c) =>
            c.query(
              `insert into public.external_links (ref_id, task_id, confirmed_at)
               values ($1, $2, now())`,
              [ref, aliceTask],
            ),
          { commit: true },
        ),
      ).resolves.toBeDefined();
    });

    it("allows an unconfirmed link — that is what a suggestion is", async () => {
      const ref = await makeRef(alice, "guard-3");

      const { rows } = await asUser(
        client,
        alice,
        (c) =>
          c.query<{ confirmed_at: string | null }>(
            `insert into public.external_links (ref_id, task_id)
             values ($1, $2) returning confirmed_at`,
            [ref, aliceTask],
          ),
        { commit: true },
      );

      expect(rows[0].confirmed_at).toBeNull();
    });
  });

  /* ── Shape ──────────────────────────────────────────────────────────── */

  describe("a link", () => {
    it("must have exactly one subject, not two", async () => {
      const ref = await makeRef(alice, "shape-1");

      await expect(
        asUser(client, alice, (c) =>
          c.query(
            `insert into public.external_links (ref_id, task_id, note_id)
             values ($1, $2, $3)`,
            [ref, aliceTask, aliceNote],
          ),
        ),
      ).rejects.toSatisfy((error) => errorCode(error) === "23514");
    });

    it("must have exactly one subject, not none", async () => {
      const ref = await makeRef(alice, "shape-2");

      await expect(
        asUser(client, alice, (c) =>
          c.query(`insert into public.external_links (ref_id) values ($1)`, [
            ref,
          ]),
        ),
      ).rejects.toSatisfy((error) => errorCode(error) === "23514");
    });

    it("can attach the same reference to a task and to a note", async () => {
      // Different subjects, so the partial unique indexes must not collide.
      const ref = await makeRef(alice, "shape-3");

      await asUser(
        client,
        alice,
        (c) =>
          c.query(
            `insert into public.external_links (ref_id, task_id) values ($1, $2)`,
            [ref, aliceTask],
          ),
        { commit: true },
      );

      await expect(
        asUser(
          client,
          alice,
          (c) =>
            c.query(
              `insert into public.external_links (ref_id, note_id) values ($1, $2)`,
              [ref, aliceNote],
            ),
          { commit: true },
        ),
      ).resolves.toBeDefined();
    });

    it("cannot attach the same reference to one task twice", async () => {
      // Otherwise a double-click leaves two identical chips on the row.
      const ref = await makeRef(alice, "shape-4");

      await asUser(
        client,
        alice,
        (c) =>
          c.query(
            `insert into public.external_links (ref_id, task_id) values ($1, $2)`,
            [ref, aliceTask],
          ),
        { commit: true },
      );

      await expect(
        asUser(client, alice, (c) =>
          c.query(
            `insert into public.external_links (ref_id, task_id) values ($1, $2)`,
            [ref, aliceTask],
          ),
        ),
      ).rejects.toSatisfy((error) => errorCode(error) === "23505");
    });

    it("goes when its task goes", async () => {
      const ref = await makeRef(alice, "cascade-1");
      const { rows } = await asUser(
        client,
        alice,
        (c) =>
          c.query<{ id: string }>(
            `insert into public.tasks (title) values ('Temporary') returning id`,
          ),
        { commit: true },
      );

      await asUser(
        client,
        alice,
        (c) =>
          c.query(
            `insert into public.external_links (ref_id, task_id) values ($1, $2)`,
            [ref, rows[0].id],
          ),
        { commit: true },
      );

      await asUser(
        client,
        alice,
        (c) => c.query(`delete from public.tasks where id = $1`, [rows[0].id]),
        { commit: true },
      );

      const remaining = await asUser(client, alice, (c) =>
        c.query(`select id from public.external_links where ref_id = $1`, [
          ref,
        ]),
      );

      expect(remaining.rows).toHaveLength(0);
    });
  });

  /* ── References ─────────────────────────────────────────────────────── */

  describe("a reference", () => {
    it("is one row per external thing, per owner", async () => {
      // Pasting the same PR onto a second task must reuse the reference.
      // Two copies would drift, and the interface would show one task an open
      // PR and another the same PR merged.
      await makeRef(alice, "identity-1");

      await expect(
        asUser(client, alice, (c) =>
          c.query(
            `insert into public.external_refs
               (provider, kind, remote_id, url, title)
             values ('github', 'pull_request', 'identity-1',
                     'https://github.test/a/b/pull/1', 'Duplicate')`,
          ),
        ),
      ).rejects.toSatisfy((error) => errorCode(error) === "23505");
    });

    it("does not let one owner's identity block another's", async () => {
      await expect(makeRef(bob, "identity-1")).resolves.toBeDefined();
    });

    it("insists on a URL that can actually be opened", async () => {
      // A reference nobody can open is not context, it is a note to self.
      await expect(
        asUser(client, alice, (c) =>
          c.query(
            `insert into public.external_refs (provider, remote_id, url, title)
             values ('github', 'bad-url', 'not-a-url', 'T')`,
          ),
        ),
      ).rejects.toSatisfy((error) => errorCode(error) === "23514");
    });

    it("refuses to record a failure it never attempted", async () => {
      await expect(
        asUser(client, alice, (c) =>
          c.query(
            `insert into public.external_refs
               (provider, remote_id, url, title, fetch_error)
             values ('github', 'bad-shape', 'https://x.test', 'T', 'boom')`,
          ),
        ),
      ).rejects.toSatisfy((error) => errorCode(error) === "23514");
    });

    it("is searchable by title", async () => {
      await makeRef(alice, "search-1", {
        title: "Rotate the encryption keys before the audit",
      });

      const { rows } = await asUser(client, alice, (c) =>
        c.query<{ title: string }>(
          `select title from public.external_refs
            where search_vector @@ plainto_tsquery('english', 'rotate encryption')`,
        ),
      );

      expect(rows.map((row) => row.title)).toContain(
        "Rotate the encryption keys before the audit",
      );
    });
  });

  /* ── Isolation ──────────────────────────────────────────────────────── */

  describe("isolation", () => {
    it("keeps one owner's references invisible to another", async () => {
      await makeRef(alice, "private-1", { title: "Alice's private PR" });

      const { rows } = await asUser(client, bob, (c) =>
        c.query(`select id from public.external_refs
                  where title = 'Alice''s private PR'`),
      );

      expect(rows).toHaveLength(0);
    });

    it("refuses a link from one owner to another's task", async () => {
      // RLS does *not* cover this on its own: foreign key checks run as the
      // referenced table's owner and ignore row level security, so Alice's
      // task id satisfies the constraint perfectly well. The ownership
      // trigger is the only thing that refuses it.
      const ref = await makeRef(bob, "cross-1");

      await expect(
        asUser(client, bob, (c) =>
          c.query(
            `insert into public.external_links (ref_id, task_id) values ($1, $2)`,
            [ref, aliceTask],
          ),
        ),
      ).rejects.toBeDefined();
    });

    it("refuses a link from one owner to another's reference", async () => {
      // Same hole, the other side of the join: the `ref_id` foreign key is
      // satisfied by any reference in the table.
      const aliceRef = await makeRef(alice, "cross-2");
      const { rows } = await asUser(
        client,
        bob,
        (c) =>
          c.query<{ id: string }>(
            `insert into public.tasks (title) values ('Bob task') returning id`,
          ),
        { commit: true },
      );

      await expect(
        asUser(client, bob, (c) =>
          c.query(
            `insert into public.external_links (ref_id, task_id) values ($1, $2)`,
            [aliceRef, rows[0].id],
          ),
        ),
      ).rejects.toSatisfy((error) => errorCode(error) === "42501");
    });
  });

  /* ── Retention ──────────────────────────────────────────────────────── */

  describe("retention", () => {
    /**
     * A reference that has not been touched for `age`.
     *
     * Inserted stale rather than updated stale: `set_updated_at` fires on
     * update and would immediately stamp `now()` over anything set here. That
     * is also *why* `updated_at` is the right column to age on — a reference
     * nothing links to stops being refreshed, so its timestamp stops moving.
     */
    async function makeStaleRef(
      remoteId: string,
      age: string,
    ): Promise<string> {
      const { rows } = await asUser(
        client,
        alice,
        (c) =>
          c.query<{ id: string }>(
            `insert into public.external_refs
               (provider, remote_id, url, title, updated_at)
             values ('github', $1, 'https://github.test/a/b/pull/9', 'Stale',
                     now() - $2::interval)
             returning id`,
            [remoteId, age],
          ),
        { commit: true },
      );
      return rows[0].id;
    }

    it("removes a reference nothing points at any more", async () => {
      const ref = await makeStaleRef("orphan-1", "90 days");

      const { rows } = await asUser(
        client,
        alice,
        (c) =>
          c.query<{ purge_orphaned_refs: number }>(
            `select public.purge_orphaned_refs()`,
          ),
        { commit: true },
      );

      expect(rows[0].purge_orphaned_refs).toBeGreaterThanOrEqual(1);

      const gone = await asUser(client, alice, (c) =>
        c.query(`select id from public.external_refs where id = $1`, [ref]),
      );
      expect(gone.rows).toHaveLength(0);
    });

    it("never removes a reference something still links to", async () => {
      // A link is the owner's judgement. Ageing it out would be deleting
      // their judgement, not stale data.
      const ref = await makeStaleRef("kept-1", "10 years");

      await asUser(
        client,
        alice,
        (c) =>
          c.query(
            `insert into public.external_links (ref_id, task_id) values ($1, $2)`,
            [ref, aliceTask],
          ),
        { commit: true },
      );

      await asUser(
        client,
        alice,
        (c) => c.query(`select public.purge_orphaned_refs()`),
        { commit: true },
      );

      const survived = await asUser(client, alice, (c) =>
        c.query(`select id from public.external_refs where id = $1`, [ref]),
      );

      expect(survived.rows).toHaveLength(1);
    });

    it("cannot reach another owner's orphans", async () => {
      // `security invoker`, so RLS applies — Bob purging cannot delete
      // Alice's rows even when they qualify.
      const ref = await makeStaleRef("orphan-2", "90 days");

      const { rows } = await asUser(
        client,
        bob,
        (c) =>
          c.query<{ purge_orphaned_refs: number }>(
            `select public.purge_orphaned_refs()`,
          ),
        { commit: true },
      );

      expect(rows[0].purge_orphaned_refs).toBe(0);

      const survived = await asUser(client, alice, (c) =>
        c.query(`select id from public.external_refs where id = $1`, [ref]),
      );
      expect(survived.rows).toHaveLength(1);
    });
  });
});
