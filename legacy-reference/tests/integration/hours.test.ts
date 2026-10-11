import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { totalsFor, type HoursInterval } from "@/lib/hours/aggregate";
import { classifyEvent } from "@/lib/hours/classify";

import {
  asUser,
  connect,
  createUser,
  errorCode,
  hasDatabase,
  resetSchema,
} from "./db";

/**
 * Hours, end to end through the database.
 *
 * The unit tests cover the arithmetic. What this covers is the join: that a
 * Pomodoro session written to Postgres becomes a focused time entry, that a
 * classified calendar event contributes scheduled minutes, and that the
 * constraints protecting all of that actually hold when a real client writes.
 */
const describeDb = hasDatabase ? describe : describe.skip;

describeDb("hours", () => {
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

  /* ── Pomodoro contributes to hours ─────────────────────────────────── */

  describe("a Pomodoro session becomes focused hours", () => {
    it("writes a session and a linked time entry", async () => {
      const minutes = await asUser(client, alice, async (db) => {
        const session = await db.query<{ id: string }>(
          `insert into public.pomodoro_sessions
             (kind, planned_minutes, started_at, ended_at, completed)
           values ('focus', 25, now() - interval '25 minutes', now(), true)
           returning id`,
        );

        const entry = await db.query<{ minutes: number; source: string }>(
          `insert into public.time_entries
             (source, session_id, started_at, ended_at)
           values ('focused', $1, now() - interval '25 minutes', now())
           returning minutes, source`,
          [session.rows[0].id],
        );

        return entry.rows[0];
      });

      expect(minutes).toEqual({ minutes: 25, source: "focused" });
    });

    it("computes the session's seconds from its own timestamps", async () => {
      // Generated, so the duration cannot disagree with the interval.
      const seconds = await asUser(client, alice, async (db) => {
        const result = await db.query<{ seconds: number }>(
          `insert into public.pomodoro_sessions
             (planned_minutes, started_at, ended_at)
           values (25, '2026-08-12T14:00:00Z', '2026-08-12T14:22:30Z')
           returning seconds`,
        );
        return result.rows[0].seconds;
      });

      expect(seconds).toBe(1350);
    });

    it("leaves seconds null while a session is running", async () => {
      const seconds = await asUser(client, alice, async (db) => {
        const result = await db.query<{ seconds: number | null }>(
          `insert into public.pomodoro_sessions (planned_minutes) values (25)
           returning seconds`,
        );
        return result.rows[0].seconds;
      });

      expect(seconds).toBeNull();
    });

    it("allows only one running session at a time", async () => {
      // Two running timers means two overlapping claims on the same hour, and
      // the totals stop meaning anything.
      const error = await asUser(client, alice, async (db) => {
        await db.query(
          `insert into public.pomodoro_sessions (planned_minutes) values (25)`,
        );
        try {
          await db.query(
            `insert into public.pomodoro_sessions (planned_minutes) values (25)`,
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23505");
    });

    it("cascades the entry when the session is deleted", async () => {
      const remaining = await asUser(client, alice, async (db) => {
        const session = await db.query<{ id: string }>(
          `insert into public.pomodoro_sessions
             (planned_minutes, started_at, ended_at)
           values (25, now() - interval '25 min', now())
           returning id`,
        );
        await db.query(
          `insert into public.time_entries (source, session_id, started_at, ended_at)
           values ('focused', $1, now() - interval '25 min', now())`,
          [session.rows[0].id],
        );

        await db.query("delete from public.pomodoro_sessions where id = $1", [
          session.rows[0].id,
        ]);

        const left = await db.query(
          "select id from public.time_entries where session_id = $1",
          [session.rows[0].id],
        );
        return left.rowCount;
      });

      expect(remaining).toBe(0);
    });
  });

  /* ── The ledger's shape ────────────────────────────────────────────── */

  describe("the ledger", () => {
    it("refuses a focused entry with no session", async () => {
      const error = await asUser(client, alice, async (db) => {
        try {
          await db.query(
            `insert into public.time_entries (source, started_at, ended_at)
             values ('focused', now() - interval '25 min', now())`,
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23514");
    });

    it("refuses to store scheduled hours at all", async () => {
      // Scheduled time is derived from the calendar, so a moved or cancelled
      // meeting can never leave a stale ledger row behind.
      const error = await asUser(client, alice, async (db) => {
        try {
          await db.query(
            `insert into public.time_entries (source, started_at, ended_at)
             values ('scheduled', now(), now() + interval '1 hour')`,
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23514");
    });

    it("accepts a manual entry with a note", async () => {
      const row = await asUser(client, alice, async (db) => {
        const result = await db.query<{ minutes: number; note: string }>(
          `insert into public.time_entries (source, started_at, ended_at, note)
           values ('manual', now() - interval '90 minutes', now(), 'Offsite')
           returning minutes, note`,
        );
        return result.rows[0];
      });

      expect(row).toEqual({ minutes: 90, note: "Offsite" });
    });

    it("refuses an entry that ends before it starts", async () => {
      const error = await asUser(client, alice, async (db) => {
        try {
          await db.query(
            `insert into public.time_entries (source, started_at, ended_at)
             values ('manual', now(), now() - interval '1 hour')`,
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23514");
    });
  });

  /* ── The offline outbox's idempotency ──────────────────────────────── */

  describe("the offline outbox", () => {
    it("cannot store the same client key twice", async () => {
      // This is what makes a replayed flush safe: the normal outcome of a
      // connection dying after the write but before the response.
      const error = await asUser(client, alice, async (db) => {
        await db.query(
          `insert into public.time_entries (source, started_at, ended_at, client_key)
           values ('manual', now() - interval '1 hour', now(), 'ob-abcdef123456')`,
        );
        try {
          await db.query(
            `insert into public.time_entries (source, started_at, ended_at, client_key)
             values ('manual', now() - interval '1 hour', now(), 'ob-abcdef123456')`,
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23505");
    });

    it("lets two users use the same key, since it is only unique per person", async () => {
      await asUser(
        client,
        alice,
        async (db) => {
          await db.query(
            `insert into public.time_entries (source, started_at, ended_at, client_key)
             values ('manual', now() - interval '1 hour', now(), 'ob-shared000001')`,
          );
        },
        { commit: true },
      );

      const stored = await asUser(client, bob, async (db) => {
        const result = await db.query(
          `insert into public.time_entries (source, started_at, ended_at, client_key)
           values ('manual', now() - interval '1 hour', now(), 'ob-shared000001')
           returning id`,
        );
        return result.rowCount;
      });

      expect(stored).toBe(1);
    });

    it("allows many entries with no client key", async () => {
      // The unique index is partial; entries created in the app carry none.
      const stored = await asUser(client, alice, async (db) => {
        const result = await db.query(
          `insert into public.time_entries (source, started_at, ended_at)
           values ('manual', now() - interval '1 hour', now()),
                  ('manual', now() - interval '2 hour', now() - interval '1 hour')
           returning id`,
        );
        return result.rowCount;
      });

      expect(stored).toBe(2);
    });
  });

  /* ── Classification ────────────────────────────────────────────────── */

  describe("classification", () => {
    async function makeCalendar(user: string): Promise<string> {
      return asUser(
        client,
        user,
        async (db) => {
          const account = await db.query<{ id: string }>(
            `insert into public.mail_accounts (provider, remote_id, email_address)
             values ('gmail', $1, 'a@b.c') returning id`,
            [`acct-${Math.random()}`],
          );
          const calendar = await db.query<{ id: string }>(
            `insert into public.calendars (account_id, remote_id, name)
             values ($1, $2, 'Work') returning id`,
            [account.rows[0].id, `cal-${Math.random()}`],
          );
          return calendar.rows[0].id;
        },
        { commit: true },
      );
    }

    it("refuses to overwrite a manual override", async () => {
      // The classifier re-runs on every sync; without this it would reassert
      // itself the moment the owner looked away.
      const calendarId = await makeCalendar(alice);

      const error = await asUser(client, alice, async (db) => {
        await db.query(
          `insert into public.calendar_events
             (calendar_id, remote_id, title, starts_at, ends_at, category_source)
           values ($1, 'evt-manual', 'Board review', now(), now() + interval '1 hour', 'manual')`,
          [calendarId],
        );
        try {
          await db.query(
            `update public.calendar_events set category_source = 'rule'
              where remote_id = 'evt-manual'`,
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23514");
      expect((error as Error).message).toMatch(/set manually/);
    });

    it("allows a manual override to be changed to another manual choice", async () => {
      const calendarId = await makeCalendar(alice);

      const updated = await asUser(client, alice, async (db) => {
        await db.query(
          `insert into public.calendar_events
             (calendar_id, remote_id, title, starts_at, ends_at, category_source)
           values ($1, 'evt-remanual', 'Board', now(), now() + interval '1 hour', 'manual')`,
          [calendarId],
        );
        const result = await db.query(
          `update public.calendar_events
              set category_source = 'manual', category_id = null
            where remote_id = 'evt-remanual'`,
        );
        return result.rowCount;
      });

      expect(updated).toBe(1);
    });

    it("stores the event-level toggle as a tri-state", async () => {
      const calendarId = await makeCalendar(alice);

      const values = await asUser(client, alice, async (db) => {
        const result = await db.query<{ hours_include: boolean | null }>(
          `insert into public.calendar_events
             (calendar_id, remote_id, title, starts_at, ends_at, hours_include)
           values ($1, 'a', 'A', now(), now() + interval '1 hour', null),
                  ($1, 'b', 'B', now(), now() + interval '1 hour', true),
                  ($1, 'c', 'C', now(), now() + interval '1 hour', false)
           returning hours_include`,
          [calendarId],
        );
        return result.rows.map((row) => row.hours_include);
      });

      expect(values).toEqual([null, true, false]);
    });

    it("turns stored events into scheduled hours through the classifier", async () => {
      const calendarId = await makeCalendar(alice);

      const events = await asUser(
        client,
        alice,
        async (db) => {
          await db.query(
            `insert into public.calendar_events
               (calendar_id, remote_id, title, starts_at, ends_at, hours_include, is_cancelled)
             values
               ($1, 'counts',   'Board review', '2026-08-12T13:00:00Z', '2026-08-12T14:00:00Z', null,  false),
               ($1, 'excluded', 'Dentist',      '2026-08-12T15:00:00Z', '2026-08-12T16:00:00Z', false, false),
               ($1, 'cancelled','Standup',      '2026-08-12T09:00:00Z', '2026-08-12T09:30:00Z', null,  true)`,
            [calendarId],
          );

          const result = await db.query<{
            id: string;
            remote_id: string;
            title: string;
            starts_at: Date;
            ends_at: Date;
            hours_include: boolean | null;
            is_cancelled: boolean;
            attendee_count: number;
            is_external: boolean;
          }>(
            `select id, remote_id, title, starts_at, ends_at, hours_include,
                    is_cancelled, attendee_count, is_external
               from public.calendar_events where calendar_id = $1 order by remote_id`,
            [calendarId],
          );
          return result.rows;
        },
        { commit: true },
      );

      const intervals: HoursInterval[] = events
        .map((row) => ({
          row,
          classification: classifyEvent({
            event: {
              id: row.id,
              title: row.title,
              location: null,
              organizerAddress: null,
              attendeeAddresses: [],
              attendeeCount: row.attendee_count,
              isExternal: row.is_external,
              isCancelled: row.is_cancelled,
              categoryId: null,
              categorySource: "unclassified",
              hoursInclude: row.hours_include,
            },
            calendar: {
              id: calendarId,
              name: "Work",
              countsTowardHours: true,
              defaultCategoryId: "cat-operational",
            },
          }),
        }))
        .filter(({ classification }) => classification.countsTowardHours)
        .map(({ row }) => ({
          source: "scheduled" as const,
          startedAt: row.starts_at.toISOString(),
          endedAt: row.ends_at.toISOString(),
          eventId: row.id,
        }));

      // Only the one that counts: the excluded and cancelled events drop out.
      expect(intervals).toHaveLength(1);
      expect(totalsFor(intervals).scheduled).toBe(60);
    });
  });

  /* ── Rules and RLS ─────────────────────────────────────────────────── */

  describe("rules", () => {
    it("belong to their owner alone", async () => {
      await asUser(
        client,
        alice,
        async (db) => {
          await db.query(
            `insert into public.work_category_rules (pattern, field) values ('board', 'title')`,
          );
        },
        { commit: true },
      );

      const seen = await asUser(client, bob, async (db) => {
        const result = await db.query(
          "select id from public.work_category_rules",
        );
        return result.rowCount;
      });

      expect(seen).toBe(0);
    });

    it("reject a pattern too short to be useful", async () => {
      const error = await asUser(client, alice, async (db) => {
        try {
          await db.query(
            `insert into public.work_category_rules (pattern) values ('a')`,
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23514");
    });
  });

  describe("row level security", () => {
    it("hides sessions and entries from another user", async () => {
      await asUser(
        client,
        alice,
        async (db) => {
          await db.query(
            `insert into public.pomodoro_sessions (planned_minutes, started_at, ended_at)
             values (25, now() - interval '25 min', now())`,
          );
          await db.query(
            `insert into public.time_entries (source, started_at, ended_at)
             values ('manual', now() - interval '1 hour', now())`,
          );
        },
        { commit: true },
      );

      const seen = await asUser(client, bob, async (db) => {
        const sessions = await db.query(
          "select id from public.pomodoro_sessions",
        );
        const entries = await db.query("select id from public.time_entries");
        return { sessions: sessions.rowCount, entries: entries.rowCount };
      });

      expect(seen).toEqual({ sessions: 0, entries: 0 });
    });

    it("stops a session being linked to someone else's task", async () => {
      const aliceTask = await asUser(
        client,
        alice,
        async (db) => {
          const result = await db.query<{ id: string }>(
            "insert into public.tasks (title) values ('Alice only') returning id",
          );
          return result.rows[0].id;
        },
        { commit: true },
      );

      const error = await asUser(client, bob, async (db) => {
        try {
          await db.query(
            `insert into public.pomodoro_sessions (planned_minutes, task_id)
             values (25, $1)`,
            [aliceTask],
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23514");
    });
  });
});
