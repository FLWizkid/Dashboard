import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { rankTasks } from "@/lib/priority/rank";
import type { EventContext } from "@/lib/priority/importance";
import type { Task } from "@/lib/tasks/types";

import {
  asUser,
  connect,
  createUser,
  errorCode,
  hasDatabase,
  resetSchema,
} from "./db";

/**
 * The priority engine, through the database.
 *
 * The unit tests cover the arithmetic. What this covers is the two guarantees
 * that have to hold when a real client writes:
 *
 *   **A manual override beats the engine, and nothing automatic can clear it.**
 *   **An event link cannot be created already-confirmed** — which is what
 *   makes "never auto-link silently" a property of the system rather than a
 *   promise about the application code.
 */
const describeDb = hasDatabase ? describe : describe.skip;

const NOW = new Date("2026-08-10T09:00:00.000Z");

describeDb("priority engine", () => {
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

  async function newTask(
    userId: string,
    title: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const columns = ["title", ...Object.keys(extra)];
    const values = [title, ...Object.values(extra)];
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");

    // Committed: later assertions in the same test read these rows back
    // through a *separate* transaction, and a rolled-back task would look
    // like it belonged to nobody.
    const { rows } = await asUser(
      client,
      userId,
      (c) =>
        c.query<{ id: string }>(
          `insert into public.tasks (${columns.join(", ")})
           values (${placeholders}) returning id`,
          values,
        ),
      { commit: true },
    );
    return rows[0].id;
  }

  /* ── The manual override ──────────────────────────────────────────── */

  describe("manual override", () => {
    it("stamps the time when a rank is set, without the app asking", async () => {
      const id = await newTask(alice, "Place me");

      const { rows } = await asUser(client, alice, (c) =>
        c.query<{ manual_rank: number; manual_rank_set_at: string | null }>(
          `update public.tasks set manual_rank = 0 where id = $1
           returning manual_rank, manual_rank_set_at`,
          [id],
        ),
      );

      expect(rows[0].manual_rank).toBe(0);
      expect(rows[0].manual_rank_set_at).not.toBeNull();
    });

    it("clears the stamp when the task is released back to the engine", async () => {
      const id = await newTask(alice, "Release me", { manual_rank: 3 });

      const { rows } = await asUser(client, alice, (c) =>
        c.query<{ manual_rank_set_at: string | null }>(
          `update public.tasks set manual_rank = null where id = $1
           returning manual_rank_set_at`,
          [id],
        ),
      );

      expect(rows[0].manual_rank_set_at).toBeNull();
    });

    it("is not touched by an ordinary edit", async () => {
      // The whole point of "sticky": editing the title, the priority or the
      // due date must not disturb where the owner put it.
      const id = await newTask(alice, "Sticky", { manual_rank: 2 });

      await asUser(client, alice, (c) =>
        c.query(
          `update public.tasks
              set title = 'Renamed', priority = 'low', due_at = now()
            where id = $1`,
          [id],
        ),
      );

      const { rows } = await asUser(client, alice, (c) =>
        c.query<{ manual_rank: number }>(
          `select manual_rank from public.tasks where id = $1`,
          [id],
        ),
      );

      expect(rows[0].manual_rank).toBe(2);
    });

    it("refuses a rank outside the allowed range", async () => {
      await expect(
        newTask(alice, "Out of range", { manual_rank: 100_000 }),
      ).rejects.toSatisfy((error) => errorCode(error) === "23514");
    });

    it("keeps one owner's ranks invisible to another", async () => {
      await newTask(alice, "Alice's placed task", { manual_rank: 0 });

      const { rows } = await asUser(client, bob, (c) =>
        c.query(`select id from public.tasks where manual_rank is not null`),
      );

      expect(rows).toHaveLength(0);
    });

    it("beats the engine, read back through the real scorer", async () => {
      // The end-to-end claim, using rows that came out of Postgres rather
      // than hand-built objects.
      const screaming = await newTask(alice, "Critical and weeks overdue", {
        priority: "critical",
        due_at: "2026-07-01T09:00:00.000Z",
      });
      const placed = await newTask(alice, "Low, but I put it first", {
        priority: "low",
        manual_rank: 0,
      });

      const { rows } = await asUser(client, alice, (c) =>
        c.query(
          `select id, title, notes, priority, due_at, category_id, status,
                  pinned, source_link, owner, is_ready, is_draft, can_activate,
                  manual_rank, manual_rank_set_at, completed_at,
                  created_at, updated_at
             from public.tasks
            where id = any($1::uuid[])`,
          [[screaming, placed]],
        ),
      );

      const tasks: Task[] = rows.map((row) => ({
        id: row.id,
        title: row.title,
        notes: row.notes,
        priority: row.priority,
        dueAt: row.due_at?.toISOString?.() ?? row.due_at,
        categoryId: row.category_id,
        status: row.status,
        pinned: row.pinned,
        sourceLink: row.source_link,
        owner: row.owner,
        isReady: row.is_ready,
        isDraft: row.is_draft,
        canActivate: row.can_activate,
        manualRank: row.manual_rank,
        manualRankSetAt: row.manual_rank_set_at?.toISOString?.() ?? null,
        completedAt: row.completed_at?.toISOString?.() ?? null,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        links: [],
      }));

      const ranked = rankTasks({ tasks, events: new Map(), now: NOW });
      expect(ranked[0].task.id).toBe(placed);
    });
  });

  /* ── Confirm before link ──────────────────────────────────────────── */

  describe("confirm before link", () => {
    async function newEvent(userId: string, title: string): Promise<string> {
      // One committed transaction for the whole chain — account, calendar and
      // event have to outlive it for the link assertions that follow.
      return asUser(
        client,
        userId,
        async (c) => {
          const { rows: accounts } = await c.query<{ id: string }>(
            `insert into public.mail_accounts
               (provider, remote_id, email_address, display_name)
             values ('gmail', $1, $2, 'Test') returning id`,
            [`acct-${title}`, `${userId}-${title}@example.invalid`],
          );

          const { rows: calendars } = await c.query<{ id: string }>(
            `insert into public.calendars (account_id, remote_id, name)
             values ($1, $2, 'Work') returning id`,
            [accounts[0].id, `cal-${title}`],
          );

          const { rows } = await c.query<{ id: string }>(
            `insert into public.calendar_events
               (calendar_id, remote_id, title, starts_at, ends_at, attendee_count)
             values ($1, $2, $3, now() + interval '1 day',
                     now() + interval '1 day 1 hour', 6)
             returning id`,
            [calendars[0].id, `remote-${title}`, title],
          );

          return rows[0].id;
        },
        { commit: true },
      );
    }

    it("refuses an event link that arrives already confirmed in the past", async () => {
      // This is the shape a silent auto-link would take: a row that looks as
      // though the owner agreed at some point.
      const taskId = await newTask(alice, "Board deck");
      const eventId = await newEvent(alice, "Board meeting");

      await expect(
        asUser(client, alice, (c) =>
          c.query(
            `insert into public.task_links
               (task_id, kind, relation, target_id, target_label, confirmed_at)
             values ($1, 'event', 'prep', $2, 'Board meeting',
                     now() - interval '1 hour')`,
            [taskId, eventId],
          ),
        ),
      ).rejects.toSatisfy((error) => errorCode(error) === "23514");
    });

    it("allows an unconfirmed event link", async () => {
      const taskId = await newTask(alice, "Unconfirmed link");
      const eventId = await newEvent(alice, "Some meeting");

      await expect(
        asUser(client, alice, (c) =>
          c.query(
            `insert into public.task_links
               (task_id, kind, relation, target_id, target_label)
             values ($1, 'event', 'prep', $2, 'Some meeting')`,
            [taskId, eventId],
          ),
        ),
      ).resolves.toBeDefined();
    });

    it("allows a link confirmed right now — the owner just said yes", async () => {
      const taskId = await newTask(alice, "Confirmed now");
      const eventId = await newEvent(alice, "Another meeting");

      await expect(
        asUser(client, alice, (c) =>
          c.query(
            `insert into public.task_links
               (task_id, kind, relation, target_id, target_label, confirmed_at)
             values ($1, 'event', 'prep', $2, 'Another meeting', now())`,
            [taskId, eventId],
          ),
        ),
      ).resolves.toBeDefined();
    });
  });

  /* ── Suggestions ──────────────────────────────────────────────────── */

  describe("suggestions", () => {
    it("refuses a suggestion for someone else's task", async () => {
      const aliceTask = await newTask(alice, "Alice's work");

      await expect(
        asUser(client, bob, (c) =>
          c.query(
            `insert into public.link_suggestions (task_id, kind, reason)
             values ($1, 'prep', 'guessing')`,
            [aliceTask],
          ),
        ),
      ).rejects.toBeDefined();
    });

    it("refuses a decided suggestion with no decision time", async () => {
      const taskId = await newTask(alice, "Decide me");

      await expect(
        asUser(client, alice, (c) =>
          c.query(
            `insert into public.link_suggestions (task_id, kind, reason, state)
             values ($1, 'prep', 'because', 'accepted')`,
            [taskId],
          ),
        ),
      ).rejects.toSatisfy((error) => errorCode(error) === "23514");
    });

    it("refuses a pending suggestion that claims to have been decided", async () => {
      const taskId = await newTask(alice, "Contradiction");

      await expect(
        asUser(client, alice, (c) =>
          c.query(
            `insert into public.link_suggestions
               (task_id, kind, reason, state, decided_at)
             values ($1, 'prep', 'because', 'pending', now())`,
            [taskId],
          ),
        ),
      ).rejects.toSatisfy((error) => errorCode(error) === "23514");
    });

    it("keeps one owner's suggestions invisible to another", async () => {
      const taskId = await newTask(alice, "Private suggestion");
      await asUser(client, alice, (c) =>
        c.query(
          `insert into public.link_suggestions (task_id, kind, reason)
           values ($1, 'prep', 'shared words')`,
          [taskId],
        ),
      );

      const { rows } = await asUser(client, bob, (c) =>
        c.query(`select id from public.link_suggestions`),
      );

      expect(rows).toHaveLength(0);
    });
  });

  /* ── The calendar half, against stored rows ───────────────────────── */

  it("boosts a task linked to a real stored meeting", async () => {
    const taskId = await newTask(alice, "Prepare the board pack");

    const { rows: accounts } = await asUser(
      client,
      alice,
      (c) =>
        c.query<{ id: string }>(
          `insert into public.mail_accounts
           (provider, remote_id, email_address, display_name)
         values ('gmail', 'acct-boost', 'alice-cal@example.invalid', 'Alice')
         returning id`,
        ),
      { commit: true },
    );
    const { rows: calendars } = await asUser(
      client,
      alice,
      (c) =>
        c.query<{ id: string }>(
          `insert into public.calendars (account_id, remote_id, name)
           values ($1, 'cal-2', 'Work') returning id`,
          [accounts[0].id],
        ),
      { commit: true },
    );
    const { rows: events } = await asUser(client, alice, (c) =>
      c.query<{
        id: string;
        title: string;
        starts_at: Date;
        ends_at: Date;
        attendee_count: number;
        is_external: boolean;
        is_cancelled: boolean;
        organizer_address: string | null;
      }>(
        `insert into public.calendar_events
           (calendar_id, remote_id, title, starts_at, ends_at,
            attendee_count, is_external)
         values ($1, 'evt-1', 'Board decision', $2, $3, 9, true)
         returning id, title, starts_at, ends_at, attendee_count,
                   is_external, is_cancelled, organizer_address`,
        [
          calendars[0].id,
          new Date(NOW.getTime() + 20 * 3_600_000),
          new Date(NOW.getTime() + 21 * 3_600_000),
        ],
      ),
    );

    const event = events[0];
    const context: EventContext = {
      id: event.id,
      title: event.title,
      startsAt: event.starts_at.toISOString(),
      endsAt: event.ends_at.toISOString(),
      attendeeCount: event.attendee_count,
      isExternal: event.is_external,
      isCancelled: event.is_cancelled,
      organizerAddress: event.organizer_address,
      isOwnerOrganiser: false,
    };

    const base: Task = {
      id: taskId,
      title: "Prepare the board pack",
      notes: null,
      priority: null,
      dueAt: null,
      categoryId: null,
      status: "inbox",
      pinned: false,
      sourceLink: null,
      owner: null,
      isReady: false,
      isDraft: false,
      canActivate: false,
      manualRank: null,
      manualRankSetAt: null,
      completedAt: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      links: [],
    };

    const unlinked = rankTasks({
      tasks: [base],
      events: new Map(),
      now: NOW,
    });

    const linked = rankTasks({
      tasks: [
        {
          ...base,
          links: [
            {
              id: "link-1",
              taskId,
              kind: "event",
              relation: "prep",
              targetId: event.id,
              targetLabel: event.title,
              targetUrl: null,
              confirmedAt: NOW.toISOString(),
              createdAt: NOW.toISOString(),
            },
          ],
        },
      ],
      events: new Map([[event.id, context]]),
      now: NOW,
    });

    expect(linked[0].score.total).toBeGreaterThan(unlinked[0].score.total);
    expect(linked[0].importance.hits.length).toBeGreaterThan(0);
  });
});
