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
 * Schema and Row Level Security integration tests.
 *
 * These run against a real Postgres with the migrations applied. Without a
 * `DATABASE_URL` they skip — see `docs/testing.md` for how to point one at a
 * scratch database, and never at the one holding real data.
 */
const describeDb = hasDatabase ? describe : describe.skip;

describeDb("tasks schema and RLS", () => {
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

  /* ── Seeding ─────────────────────────────────────────────────────── */

  describe("default taxonomy", () => {
    it("seeds eight categories when a user signs up", async () => {
      const rows = await asUser(client, alice, async (db) => {
        const result = await db.query(
          "select slug, name, position, is_default from public.activity_categories order by position",
        );
        return result.rows;
      });

      expect(rows).toHaveLength(8);
      expect(rows.map((row) => row.slug)).toEqual([
        "strategic",
        "operational",
        "people-team",
        "stakeholder-board",
        "vendor-budget",
        "security-risk-compliance",
        "innovation-rd",
        "admin-inbox",
      ]);
      expect(rows.every((row) => row.is_default)).toBe(true);
    });

    it("gives each user their own copy", async () => {
      const aliceIds = await asUser(client, alice, async (db) =>
        (await db.query("select id from public.activity_categories")).rows.map(
          (row) => row.id,
        ),
      );
      const bobIds = await asUser(client, bob, async (db) =>
        (await db.query("select id from public.activity_categories")).rows.map(
          (row) => row.id,
        ),
      );

      expect(bobIds).toHaveLength(8);
      expect(aliceIds.some((id) => bobIds.includes(id))).toBe(false);
    });
  });

  /* ── CRUD ────────────────────────────────────────────────────────── */

  describe("task CRUD", () => {
    it("creates a task and defaults user_id to the caller", async () => {
      await asUser(client, alice, async (db) => {
        const { rows } = await db.query(
          `insert into public.tasks (title, priority, due_at)
           values ('Draft the board deck', 'high', '2026-08-07T21:00:00Z')
           returning id, user_id, status, pinned, is_ready, completed_at`,
        );

        expect(rows[0]).toMatchObject({
          user_id: alice,
          status: "inbox",
          pinned: false,
          is_ready: true,
          completed_at: null,
        });
      });
    });

    it("reads, updates and deletes its own task", async () => {
      await asUser(client, alice, async (db) => {
        const { rows } = await db.query(
          "insert into public.tasks (title) values ('Review the SOW') returning id",
        );
        const id = rows[0].id;

        const read = await db.query(
          "select title from public.tasks where id = $1",
          [id],
        );
        expect(read.rows[0].title).toBe("Review the SOW");

        const updated = await db.query(
          "update public.tasks set priority = 'low' where id = $1 returning priority",
          [id],
        );
        expect(updated.rows[0].priority).toBe("low");

        const deleted = await db.query(
          "delete from public.tasks where id = $1 returning id",
          [id],
        );
        expect(deleted.rowCount).toBe(1);
      });
    });

    it("keeps updated_at fresh", async () => {
      await asUser(client, alice, async (db) => {
        const { rows } = await db.query(
          "insert into public.tasks (title) values ('Touch me') returning id, updated_at",
        );
        const updated = await db.query(
          "update public.tasks set title = 'Touched' where id = $1 returning updated_at",
          [rows[0].id],
        );
        expect(
          new Date(updated.rows[0].updated_at).getTime(),
        ).toBeGreaterThanOrEqual(new Date(rows[0].updated_at).getTime());
      });
    });
  });

  /* ── Generated columns and constraints ───────────────────────────── */

  describe("Ready state", () => {
    it("is false without a due date", async () => {
      await asUser(client, alice, async (db) => {
        const { rows } = await db.query(
          "insert into public.tasks (title, priority) values ('No due date', 'high') returning is_ready",
        );
        expect(rows[0].is_ready).toBe(false);
      });
    });

    it("is false without a priority", async () => {
      await asUser(client, alice, async (db) => {
        const { rows } = await db.query(
          `insert into public.tasks (title, due_at)
           values ('No priority', '2026-08-07T21:00:00Z') returning is_ready`,
        );
        expect(rows[0].is_ready).toBe(false);
      });
    });

    it("flips as soon as the missing field lands", async () => {
      await asUser(client, alice, async (db) => {
        const { rows } = await db.query(
          "insert into public.tasks (title, priority) values ('Nearly', 'normal') returning id, is_ready",
        );
        expect(rows[0].is_ready).toBe(false);

        const updated = await db.query(
          "update public.tasks set due_at = now() where id = $1 returning is_ready",
          [rows[0].id],
        );
        expect(updated.rows[0].is_ready).toBe(true);
      });
    });

    it("cannot be written directly — it is generated", async () => {
      await expect(
        asUser(client, alice, async (db) => {
          await db.query(
            "insert into public.tasks (title, is_ready) values ('Cheat', true)",
          );
        }),
      ).rejects.toThrow();
    });
  });

  describe("status and completed_at move together", () => {
    it("rejects done without a completion time", async () => {
      const error = await asUser(client, alice, async (db) => {
        try {
          await db.query(
            "insert into public.tasks (title, status) values ('Bad', 'done')",
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });
      expect(errorCode(error)).toBe("23514"); // check_violation
    });

    it("rejects a completion time on an open task", async () => {
      const error = await asUser(client, alice, async (db) => {
        try {
          await db.query(
            "insert into public.tasks (title, completed_at) values ('Bad', now())",
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });
      expect(errorCode(error)).toBe("23514");
    });

    it("accepts a properly completed task", async () => {
      await asUser(client, alice, async (db) => {
        const { rows } = await db.query(
          `insert into public.tasks (title, status, completed_at)
           values ('Done properly', 'done', now()) returning status`,
        );
        expect(rows[0].status).toBe("done");
      });
    });
  });

  describe("title constraint", () => {
    it("rejects an empty title", async () => {
      const error = await asUser(client, alice, async (db) => {
        try {
          await db.query("insert into public.tasks (title) values ('   ')");
          return null;
        } catch (caught) {
          return caught;
        }
      });
      expect(errorCode(error)).toBe("23514");
    });
  });

  /* ── RLS isolation — the point of the exercise ───────────────────── */

  describe("row level security", () => {
    let aliceTaskId: string;

    beforeAll(async () => {
      aliceTaskId = await asUser(
        client,
        alice,
        async (db) => {
          const { rows } = await db.query(
            "insert into public.tasks (title, priority) values ('Alice private', 'critical') returning id",
          );
          return rows[0].id as string;
        },
        { commit: true },
      );
    });

    it("hides another user's task from a list query", async () => {
      const titles = await asUser(client, bob, async (db) =>
        (await db.query("select title from public.tasks")).rows.map(
          (row) => row.title,
        ),
      );
      expect(titles).not.toContain("Alice private");
    });

    it("hides another user's task from a direct lookup by id", async () => {
      const rowCount = await asUser(client, bob, async (db) => {
        const result = await db.query(
          "select id from public.tasks where id = $1",
          [aliceTaskId],
        );
        return result.rowCount;
      });
      expect(rowCount).toBe(0);
    });

    it("silently affects nothing when another user tries to update it", async () => {
      const rowCount = await asUser(client, bob, async (db) => {
        const result = await db.query(
          "update public.tasks set title = 'stolen' where id = $1",
          [aliceTaskId],
        );
        return result.rowCount;
      });
      expect(rowCount).toBe(0);

      // And the original is untouched.
      const title = await asUser(client, alice, async (db) => {
        const result = await db.query(
          "select title from public.tasks where id = $1",
          [aliceTaskId],
        );
        return result.rows[0].title;
      });
      expect(title).toBe("Alice private");
    });

    it("silently affects nothing when another user tries to delete it", async () => {
      const rowCount = await asUser(client, bob, async (db) => {
        const result = await db.query(
          "delete from public.tasks where id = $1",
          [aliceTaskId],
        );
        return result.rowCount;
      });
      expect(rowCount).toBe(0);
    });

    it("refuses an insert that claims someone else's user_id", async () => {
      const error = await asUser(client, bob, async (db) => {
        try {
          await db.query(
            "insert into public.tasks (user_id, title) values ($1, 'Forged')",
            [alice],
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });
      expect(errorCode(error)).toBe("42501"); // insufficient_privilege (RLS)
    });

    it("refuses to hand a task to another user via update", async () => {
      const error = await asUser(client, alice, async (db) => {
        try {
          await db.query("update public.tasks set user_id = $1 where id = $2", [
            bob,
            aliceTaskId,
          ]);
          return null;
        } catch (caught) {
          return caught;
        }
      });
      expect(errorCode(error)).toBe("42501");
    });

    it("isolates categories the same way", async () => {
      const aliceCategoryId = await asUser(client, alice, async (db) => {
        const result = await db.query(
          "select id from public.activity_categories where slug = 'strategic'",
        );
        return result.rows[0].id as string;
      });

      const rowCount = await asUser(client, bob, async (db) => {
        const result = await db.query(
          "select id from public.activity_categories where id = $1",
          [aliceCategoryId],
        );
        return result.rowCount;
      });
      expect(rowCount).toBe(0);
    });

    it("blocks attaching someone else's category to your task", async () => {
      const aliceCategoryId = await asUser(client, alice, async (db) => {
        const result = await db.query(
          "select id from public.activity_categories where slug = 'operational'",
        );
        return result.rows[0].id as string;
      });

      const error = await asUser(client, bob, async (db) => {
        try {
          await db.query(
            "insert into public.tasks (title, category_id) values ('Sneaky', $1)",
            [aliceCategoryId],
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });
      // The ownership trigger raises check_violation.
      expect(errorCode(error)).toBe("23514");
    });

    it("blocks linking to someone else's task", async () => {
      const error = await asUser(client, bob, async (db) => {
        try {
          await db.query(
            `insert into public.task_links (task_id, kind, target_label)
             values ($1, 'event', 'Board review')`,
            [aliceTaskId],
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });
      expect(errorCode(error)).toBe("23514");
    });

    it("shows nothing at all to an unauthenticated caller", async () => {
      await client.query("begin");
      try {
        await client.query("set local role anon");
        // `anon` was never granted table privileges, so this must not succeed.
        await expect(
          client.query("select id from public.tasks"),
        ).rejects.toThrow();
      } finally {
        await client.query("rollback");
        await client.query("reset role");
      }
    });
  });

  /* ── Task links ──────────────────────────────────────────────────── */

  describe("task links", () => {
    it("defaults to unconfirmed — confirm-before-link is a schema rule", async () => {
      await asUser(client, alice, async (db) => {
        const task = await db.query(
          "insert into public.tasks (title) values ('Prep the deck') returning id",
        );
        const { rows } = await db.query(
          `insert into public.task_links (task_id, kind, relation, target_label)
           values ($1, 'event', 'prep', 'Q3 board review')
           returning confirmed_at, target_id, relation`,
          [task.rows[0].id],
        );

        expect(rows[0].confirmed_at).toBeNull();
        // Unresolved until a calendar provider lands in Phase 2.
        expect(rows[0].target_id).toBeNull();
        expect(rows[0].relation).toBe("prep");
      });
    });

    it("allows many unresolved links to the same task", async () => {
      await asUser(client, alice, async (db) => {
        const task = await db.query(
          "insert into public.tasks (title) values ('Multi-link') returning id",
        );
        const id = task.rows[0].id;

        await db.query(
          `insert into public.task_links (task_id, kind, relation, target_label)
           values ($1, 'event', 'prep', 'One'), ($1, 'event', 'prep', 'Two')`,
          [id],
        );

        const { rows } = await db.query(
          "select count(*)::int as count from public.task_links where task_id = $1",
          [id],
        );
        expect(rows[0].count).toBe(2);
      });
    });

    it("rejects a duplicate resolved link", async () => {
      const error = await asUser(client, alice, async (db) => {
        const task = await db.query(
          "insert into public.tasks (title) values ('Duplicate link') returning id",
        );
        const id = task.rows[0].id;

        await db.query(
          `insert into public.task_links (task_id, kind, relation, target_id, target_label)
           values ($1, 'event', 'prep', 'evt_123', 'Board review')`,
          [id],
        );

        try {
          await db.query(
            `insert into public.task_links (task_id, kind, relation, target_id, target_label)
             values ($1, 'event', 'prep', 'evt_123', 'Board review again')`,
            [id],
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });
      expect(errorCode(error)).toBe("23505"); // unique_violation
    });

    it("cascades when the task is deleted", async () => {
      await asUser(client, alice, async (db) => {
        const task = await db.query(
          "insert into public.tasks (title) values ('Cascade me') returning id",
        );
        const id = task.rows[0].id;

        await db.query(
          `insert into public.task_links (task_id, kind, target_label)
           values ($1, 'note', 'Decision log')`,
          [id],
        );
        await db.query("delete from public.tasks where id = $1", [id]);

        const { rows } = await db.query(
          "select count(*)::int as count from public.task_links where task_id = $1",
          [id],
        );
        expect(rows[0].count).toBe(0);
      });
    });
  });

  /* ── Full-text search ────────────────────────────────────────────── */

  describe("full-text search", () => {
    it("matches on the title and the notes", async () => {
      await asUser(client, alice, async (db) => {
        await db.query(
          `insert into public.tasks (title, notes)
           values ('Renew the Datadog contract', 'Check the observability spend first')`,
        );

        const byTitle = await db.query(
          "select title from public.tasks where search_vector @@ plainto_tsquery('english', 'datadog')",
        );
        expect(byTitle.rowCount).toBe(1);

        const byNotes = await db.query(
          "select title from public.tasks where search_vector @@ plainto_tsquery('english', 'observability')",
        );
        expect(byNotes.rowCount).toBe(1);
      });
    });

    it("does not leak another user's rows through search", async () => {
      await asUser(
        client,
        alice,
        async (db) => {
          await db.query(
            "insert into public.tasks (title) values ('Confidential merger memo')",
          );
        },
        { commit: true },
      );

      const rowCount = await asUser(client, bob, async (db) => {
        const result = await db.query(
          "select id from public.tasks where search_vector @@ plainto_tsquery('english', 'merger')",
        );
        return result.rowCount;
      });
      expect(rowCount).toBe(0);
    });
  });
});
