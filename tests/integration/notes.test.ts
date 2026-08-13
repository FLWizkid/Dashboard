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
 * Notes, draft activation and promote-to-Ready, against real Postgres.
 *
 * The two rules worth asserting in the database rather than only in TypeScript
 * are the ones the product would quietly break without: a decision note is
 * incomplete until it has both anchors, and a draft cannot become live work
 * without an owner, a due date and a priority.
 */
const describeDb = hasDatabase ? describe : describe.skip;

describeDb("notes and drafts", () => {
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

  /* ── Decision notes ────────────────────────────────────────────────── */

  describe("decision notes", () => {
    it("are incomplete with only a decision", async () => {
      // Decision and rationale are equal anchors. A decision log whose
      // reasoning is optional is a list of edicts.
      const complete = await asUser(client, alice, async (db) => {
        const result = await db.query<{ is_complete_decision: boolean }>(
          `insert into public.notes (kind, title, decision)
           values ('decision', 'Pick a vendor', 'Go with Acme')
           returning is_complete_decision`,
        );
        return result.rows[0].is_complete_decision;
      });

      expect(complete).toBe(false);
    });

    it("are complete once the rationale is there", async () => {
      const complete = await asUser(client, alice, async (db) => {
        const result = await db.query<{ is_complete_decision: boolean }>(
          `insert into public.notes (kind, title, decision, rationale)
           values ('decision', 'Pick a vendor', 'Go with Acme', 'Best SLA')
           returning is_complete_decision`,
        );
        return result.rows[0].is_complete_decision;
      });

      expect(complete).toBe(true);
    });

    it("treat whitespace as an absent anchor", async () => {
      const complete = await asUser(client, alice, async (db) => {
        const result = await db.query<{ is_complete_decision: boolean }>(
          `insert into public.notes (kind, title, decision, rationale)
           values ('decision', 'T', 'D', '   ')
           returning is_complete_decision`,
        );
        return result.rows[0].is_complete_decision;
      });

      expect(complete).toBe(false);
    });

    it("do not apply the rule to other kinds", async () => {
      const complete = await asUser(client, alice, async (db) => {
        const result = await db.query<{ is_complete_decision: boolean }>(
          `insert into public.notes (kind, title) values ('meeting', 'Standup')
           returning is_complete_decision`,
        );
        return result.rows[0].is_complete_decision;
      });

      expect(complete).toBe(true);
    });

    it("index every field for search", async () => {
      const found = await asUser(client, alice, async (db) => {
        await db.query(
          `insert into public.notes (kind, title, decision, rationale, body)
           values ('decision', 'Identity', 'Move to Entra', 'Fewer audit trails', 'Extra prose')`,
        );

        const result = await db.query(
          `select id from public.notes
            where search_vector @@ plainto_tsquery('english', 'audit trails')`,
        );
        return result.rowCount;
      });

      expect(found).toBe(1);
    });
  });

  /* ── Vault paths ───────────────────────────────────────────────────── */

  describe("vault paths", () => {
    it("cannot be claimed by two notes", async () => {
      const error = await asUser(client, alice, async (db) => {
        await db.query(
          `insert into public.notes (title, vault_path) values ('A', 'Notes/A.md')`,
        );
        try {
          await db.query(
            `insert into public.notes (title, vault_path) values ('B', 'Notes/A.md')`,
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23505");
    });

    it("may be shared across users, since each has their own vault", async () => {
      const rows = await asUser(
        client,
        alice,
        async (db) => {
          const result = await db.query(
            `insert into public.notes (title, vault_path) values ('Shared name', 'Notes/Same.md')
             returning id`,
          );
          return result.rowCount;
        },
        { commit: true },
      );
      expect(rows).toBe(1);

      const bobRows = await asUser(client, bob, async (db) => {
        const result = await db.query(
          `insert into public.notes (title, vault_path) values ('Shared name', 'Notes/Same.md')
           returning id`,
        );
        return result.rowCount;
      });
      expect(bobRows).toBe(1);
    });
  });

  /* ── Draft activation ──────────────────────────────────────────────── */

  describe("draft activation", () => {
    it("refuses to activate without owner, due date and priority", async () => {
      const error = await asUser(client, alice, async (db) => {
        await db.query(
          `insert into public.tasks (title, is_draft) values ('Chase the SOW', true)`,
        );
        try {
          await db.query(
            `update public.tasks set is_draft = false where title = 'Chase the SOW'`,
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23514");
      expect((error as Error).message).toMatch(
        /owner, a due date and a priority/,
      );
    });

    it("activates once all three are present", async () => {
      const activated = await asUser(client, alice, async (db) => {
        await db.query(
          `insert into public.tasks (title, is_draft, owner, due_at, priority)
           values ('Ready draft', true, 'Maya', now() + interval '2 days', 'high')`,
        );
        const result = await db.query(
          `update public.tasks set is_draft = false where title = 'Ready draft'`,
        );
        return result.rowCount;
      });

      expect(activated).toBe(1);
    });

    it("computes can_activate as the same three fields", async () => {
      // The generated column and the TypeScript twin must agree; this is the
      // database half of that assertion.
      const rows = await asUser(client, alice, async (db) => {
        const result = await db.query<{ can_activate: boolean }>(
          `insert into public.tasks (title, is_draft, owner, due_at, priority)
           values
             ('none', true, null, null, null),
             ('owner only', true, 'Maya', null, null),
             ('two of three', true, 'Maya', now(), null),
             ('all three', true, 'Maya', now(), 'high')
           returning can_activate`,
        );
        return result.rows.map((row) => row.can_activate);
      });

      expect(rows).toEqual([false, false, false, true]);
    });

    it("refuses an owner that is only whitespace", async () => {
      const error = await asUser(client, alice, async (db) => {
        await db.query(
          `insert into public.tasks (title, is_draft, owner, due_at, priority)
           values ('Blank owner', true, '   ', now(), 'high')`,
        );
        try {
          await db.query(
            `update public.tasks set is_draft = false where title = 'Blank owner'`,
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23514");
    });
  });

  /* ── Promote to Ready ──────────────────────────────────────────────── */

  describe("promote to Ready", () => {
    it("is_ready reflects the three fields, whatever the lane", async () => {
      const rows = await asUser(client, alice, async (db) => {
        const result = await db.query<{ title: string; is_ready: boolean }>(
          `insert into public.tasks (title, status, priority, due_at)
           values
             ('bare', 'inbox', null, null),
             ('priced', 'inbox', 'high', null),
             ('complete', 'inbox', 'high', now() + interval '1 day')
           returning title, is_ready`,
        );
        return result.rows;
      });

      expect(rows).toEqual([
        { title: "bare", is_ready: false },
        { title: "priced", is_ready: false },
        { title: "complete", is_ready: true },
      ]);
    });

    it("promotes a complete card from Inbox to Ready", async () => {
      const status = await asUser(client, alice, async (db) => {
        await db.query(
          `insert into public.tasks (title, status, priority, due_at)
           values ('Promote me', 'inbox', 'high', now() + interval '1 day')`,
        );
        const result = await db.query<{ status: string; is_ready: boolean }>(
          `update public.tasks set status = 'ready' where title = 'Promote me'
           returning status, is_ready`,
        );
        return result.rows[0];
      });

      expect(status).toEqual({ status: "ready", is_ready: true });
    });
  });

  /* ── Links and RLS ─────────────────────────────────────────────────── */

  describe("note links", () => {
    it("records a wiki-link to a note that does not exist yet", async () => {
      // Unresolved is a real state, not an error.
      const row = await asUser(client, alice, async (db) => {
        const note = await db.query<{ id: string }>(
          `insert into public.notes (title) values ('Q3 planning') returning id`,
        );
        const result = await db.query<{ target_note_id: string | null }>(
          `insert into public.note_links (note_id, kind, target_label)
           values ($1, 'note', 'Board approval')
           returning target_note_id`,
          [note.rows[0].id],
        );
        return result.rows[0];
      });

      expect(row.target_note_id).toBeNull();
    });

    it("refuses a wiki-link that also carries a target id", async () => {
      const error = await asUser(client, alice, async (db) => {
        const note = await db.query<{ id: string }>(
          `insert into public.notes (title) values ('N') returning id`,
        );
        try {
          await db.query(
            `insert into public.note_links (note_id, kind, target_label, target_id)
             values ($1, 'note', 'X', gen_random_uuid())`,
            [note.rows[0].id],
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23514");
    });

    it("stops a link being attached to someone else's note", async () => {
      const aliceNote = await asUser(
        client,
        alice,
        async (db) => {
          const result = await db.query<{ id: string }>(
            `insert into public.notes (title) values ('Alice private') returning id`,
          );
          return result.rows[0].id;
        },
        { commit: true },
      );

      const error = await asUser(client, bob, async (db) => {
        try {
          await db.query(
            `insert into public.note_links (note_id, kind, target_label)
             values ($1, 'note', 'anything')`,
            [aliceNote],
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23514");
    });

    it("hides one user's notes from another", async () => {
      await asUser(
        client,
        alice,
        async (db) => {
          await db.query(
            `insert into public.notes (kind, title, decision, rationale)
             values ('decision', 'Confidential merger', 'Proceed', 'Strategic fit')`,
          );
        },
        { commit: true },
      );

      const seen = await asUser(client, bob, async (db) => {
        const result = await db.query(
          `select id from public.notes
            where search_vector @@ plainto_tsquery('english', 'merger')`,
        );
        return result.rowCount;
      });

      expect(seen).toBe(0);
    });
  });

  /* ── Vault files ───────────────────────────────────────────────────── */

  describe("vault files", () => {
    it("track one file per note", async () => {
      const error = await asUser(client, alice, async (db) => {
        const note = await db.query<{ id: string }>(
          `insert into public.notes (title) values ('Tracked') returning id`,
        );
        await db.query(
          `insert into public.vault_files (path, note_id) values ('Notes/Tracked.md', $1)`,
          [note.rows[0].id],
        );
        try {
          await db.query(
            `insert into public.vault_files (path, note_id) values ('Notes/Other.md', $1)`,
            [note.rows[0].id],
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23505");
    });

    it("reject a hash that is not a SHA-256", async () => {
      const error = await asUser(client, alice, async (db) => {
        try {
          await db.query(
            `insert into public.vault_files (path, synced_hash) values ('Notes/A.md', 'short')`,
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23514");
    });

    it("hide one user's vault state from another", async () => {
      await asUser(
        client,
        alice,
        async (db) => {
          await db.query(
            `insert into public.vault_files (path) values ('Notes/Alice private.md')`,
          );
        },
        { commit: true },
      );

      const seen = await asUser(client, bob, async (db) => {
        const result = await db.query("select id from public.vault_files");
        return result.rowCount;
      });

      expect(seen).toBe(0);
    });
  });
});
