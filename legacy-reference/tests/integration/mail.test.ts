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
 * Mail and calendar schema, Row Level Security, and the caching policy.
 *
 * The policy assertions are the point of this file. "Corporate mailboxes
 * default to Off" is only a real guarantee if the database refuses to store
 * more than the policy allows — otherwise it is a convention that survives
 * exactly until someone writes a new sync path.
 */
const describeDb = hasDatabase ? describe : describe.skip;

describeDb("mail and calendar", () => {
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

  /** Creates an account as `user` and returns its id. */
  async function makeAccount(
    user: string,
    over: {
      remoteId?: string;
      policy?: "off" | "metadata" | "full";
      corporate?: boolean;
      consent?: string;
    } = {},
  ): Promise<string> {
    return asUser(
      client,
      user,
      async (db) => {
        const { rows } = await db.query<{ id: string }>(
          `insert into public.mail_accounts
             (provider, remote_id, email_address, caching_policy, is_corporate, admin_consent)
           values ('gmail', $1, $2, $3, $4, $5)
           returning id`,
          [
            over.remoteId ?? `remote-${Math.random()}`,
            `${user.slice(0, 8)}@example.invalid`,
            over.policy ?? "metadata",
            over.corporate ?? false,
            over.consent ?? "not_required",
          ],
        );
        return rows[0].id;
      },
      { commit: true },
    );
  }

  /* ── Caching policy ────────────────────────────────────────────────── */

  describe("caching policy", () => {
    it("stores nothing at all under Off", async () => {
      const account = await makeAccount(alice, { policy: "off" });

      const error = await asUser(client, alice, async (db) => {
        try {
          await db.query(
            `insert into public.messages (account_id, remote_id, from_address)
             values ($1, 'm1', 'maya@example.com')`,
            [account],
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(error).not.toBeNull();
      expect(errorCode(error)).toBe("23514"); // check_violation
      expect((error as Error).message).toMatch(/Off/);
    });

    it("stores headers but refuses a body under Metadata", async () => {
      const account = await makeAccount(alice, { policy: "metadata" });

      // Headers are fine.
      const stored = await asUser(client, alice, async (db) => {
        const result = await db.query(
          `insert into public.messages (account_id, remote_id, from_address, subject)
           values ($1, 'm-meta', 'maya@example.com', 'Q3 board pack')
           returning id`,
          [account],
        );
        return result.rowCount;
      });
      expect(stored).toBe(1);

      // A body is not.
      const error = await asUser(client, alice, async (db) => {
        try {
          await db.query(
            `insert into public.messages
               (account_id, remote_id, from_address, body_cipher)
             values ($1, 'm-meta-2', 'maya@example.com', 'cio1.v1.abc')`,
            [account],
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23514");
      expect((error as Error).message).toMatch(/Metadata/);
    });

    it("accepts an encrypted body under Full", async () => {
      const account = await makeAccount(alice, { policy: "full" });

      const stored = await asUser(client, alice, async (db) => {
        const result = await db.query(
          `insert into public.messages
             (account_id, remote_id, from_address, body_cipher, body_format)
           values ($1, 'm-full', 'maya@example.com', 'cio1.v1.abc', 'text')`,
          [account],
        );
        return result.rowCount;
      });

      expect(stored).toBe(1);
    });

    it("refuses a body that is not an encryption envelope", async () => {
      // Belt and braces against a future write path that forgets to encrypt.
      const account = await makeAccount(alice, { policy: "full" });

      const error = await asUser(client, alice, async (db) => {
        try {
          await db.query(
            `insert into public.messages
               (account_id, remote_id, from_address, body_cipher)
             values ($1, 'm-plain', 'maya@example.com', 'this is plaintext')`,
            [account],
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23514");
      expect((error as Error).message).toMatch(/body_cipher/);
    });

    it("refuses Full on a corporate mailbox without admin consent", async () => {
      const error = await asUser(client, alice, async (db) => {
        try {
          await db.query(
            `insert into public.mail_accounts
               (provider, remote_id, email_address, caching_policy, is_corporate)
             values ('microsoft', 'corp-1', 'doug@corp.example', 'full', true)`,
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23514");
      expect((error as Error).message).toMatch(/admin consent/);
    });

    it("allows Full on a corporate mailbox once consent is granted", async () => {
      const stored = await asUser(client, alice, async (db) => {
        const result = await db.query(
          `insert into public.mail_accounts
             (provider, remote_id, email_address, caching_policy, is_corporate, admin_consent)
           values ('microsoft', 'corp-2', 'doug@corp.example', 'full', true, 'granted')`,
        );
        return result.rowCount;
      });

      expect(stored).toBe(1);
    });

    it("re-checks the policy when a mailbox is downgraded", async () => {
      // Turning Full off must not leave the bodies already stored reachable
      // by a later update that keeps them.
      const account = await makeAccount(alice, { policy: "full" });

      await asUser(
        client,
        alice,
        async (db) => {
          await db.query(
            `insert into public.messages
               (account_id, remote_id, from_address, body_cipher)
             values ($1, 'downgrade-me', 'maya@example.com', 'cio1.v1.abc')`,
            [account],
          );
        },
        { commit: true },
      );

      const error = await asUser(client, alice, async (db) => {
        await db.query(
          `update public.mail_accounts set caching_policy = 'metadata' where id = $1`,
          [account],
        );
        try {
          // Touching body_cipher now re-runs the trigger.
          await db.query(
            `update public.messages set body_cipher = 'cio1.v1.def'
              where account_id = $1 and remote_id = 'downgrade-me'`,
            [account],
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23514");
    });
  });

  /* ── Row Level Security ────────────────────────────────────────────── */

  describe("row level security", () => {
    it("hides one user's accounts from another", async () => {
      await makeAccount(alice, { remoteId: "alice-hidden" });

      const visible = await asUser(client, bob, async (db) => {
        const result = await db.query(
          "select id from public.mail_accounts where remote_id = 'alice-hidden'",
        );
        return result.rowCount;
      });

      expect(visible).toBe(0);
    });

    it("hides messages", async () => {
      const account = await makeAccount(alice, { remoteId: "alice-msgs" });
      await asUser(
        client,
        alice,
        async (db) => {
          await db.query(
            `insert into public.messages (account_id, remote_id, from_address, subject)
             values ($1, 'secret-1', 'maya@example.com', 'Confidential merger memo')`,
            [account],
          );
        },
        { commit: true },
      );

      const seen = await asUser(client, bob, async (db) => {
        const result = await db.query("select id from public.messages");
        return result.rowCount;
      });

      expect(seen).toBe(0);
    });

    it("stops a message being attached to someone else's account", async () => {
      // RLS alone cannot express this: the account is invisible to Bob, so
      // the failure has to come from the ownership trigger.
      const aliceAccount = await makeAccount(alice, { remoteId: "alice-fk" });

      const error = await asUser(client, bob, async (db) => {
        try {
          await db.query(
            `insert into public.messages (account_id, remote_id, from_address)
             values ($1, 'cross-user', 'x@y.z')`,
            [aliceAccount],
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(error).not.toBeNull();
      expect(errorCode(error)).toBe("23514");
    });

    it("stops an event being attached to someone else's calendar", async () => {
      const account = await makeAccount(alice, { remoteId: "alice-cal" });
      const calendar = await asUser(
        client,
        alice,
        async (db) => {
          const result = await db.query<{ id: string }>(
            `insert into public.calendars (account_id, remote_id, name)
             values ($1, 'primary', 'Doug') returning id`,
            [account],
          );
          return result.rows[0].id;
        },
        { commit: true },
      );

      const error = await asUser(client, bob, async (db) => {
        try {
          await db.query(
            `insert into public.calendar_events
               (calendar_id, remote_id, title, starts_at, ends_at)
             values ($1, 'e1', 'Board review', now(), now() + interval '1 hour')`,
            [calendar],
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23514");
    });

    it("keeps credentials invisible across users", async () => {
      const account = await makeAccount(alice, { remoteId: "alice-creds" });
      await asUser(
        client,
        alice,
        async (db) => {
          await db.query(
            "update public.mail_accounts set credentials_cipher = 'cio1.v1.token' where id = $1",
            [account],
          );
        },
        { commit: true },
      );

      const leaked = await asUser(client, bob, async (db) => {
        const result = await db.query(
          "select credentials_cipher from public.mail_accounts",
        );
        return result.rows;
      });

      expect(leaked).toEqual([]);
    });

    it("refuses a credential that is not an encryption envelope", async () => {
      const account = await makeAccount(alice, { remoteId: "alice-plaincred" });

      const error = await asUser(client, alice, async (db) => {
        try {
          await db.query(
            "update public.mail_accounts set credentials_cipher = 'ya29.plaintext' where id = $1",
            [account],
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23514");
    });

    it("does not leak mail through full-text search", async () => {
      const account = await makeAccount(alice, { remoteId: "alice-fts" });
      await asUser(
        client,
        alice,
        async (db) => {
          await db.query(
            `insert into public.messages
               (account_id, remote_id, from_address, subject, search_vector)
             values ($1, 'fts-1', 'maya@example.com', 'Merger memo',
                     to_tsvector('english', 'confidential merger memo'))`,
            [account],
          );
        },
        { commit: true },
      );

      const hits = await asUser(client, bob, async (db) => {
        const result = await db.query(
          `select id from public.messages
            where search_vector @@ plainto_tsquery('english', 'merger')`,
        );
        return result.rowCount;
      });

      expect(hits).toBe(0);
    });
  });

  /* ── Retention ─────────────────────────────────────────────────────── */

  describe("retention", () => {
    it("purges messages past the account's window and leaves the rest", async () => {
      const account = await makeAccount(alice, { remoteId: "alice-retention" });

      await asUser(
        client,
        alice,
        async (db) => {
          await db.query(
            `update public.mail_accounts set retention_months = 24 where id = $1`,
            [account],
          );
          await db.query(
            `insert into public.messages (account_id, remote_id, from_address, received_at)
             values ($1, 'old', 'a@b.c', now() - interval '30 months'),
                    ($1, 'recent', 'a@b.c', now() - interval '1 month')`,
            [account],
          );
        },
        { commit: true },
      );

      const { purged, remaining } = await asUser(
        client,
        alice,
        async (db) => {
          const result = await db.query<{ purge_expired_messages: string }>(
            "select public.purge_expired_messages()",
          );
          const left = await db.query<{ remote_id: string }>(
            "select remote_id from public.messages where account_id = $1",
            [account],
          );
          return {
            purged: Number(result.rows[0].purge_expired_messages),
            remaining: left.rows.map((row) => row.remote_id),
          };
        },
        { commit: true },
      );

      expect(purged).toBe(1);
      expect(remaining).toEqual(["recent"]);
    });

    it("cannot purge another user's mail", async () => {
      // The function runs as its caller, so RLS applies to it too.
      const account = await makeAccount(alice, { remoteId: "alice-safe" });
      await asUser(
        client,
        alice,
        async (db) => {
          await db.query(
            `insert into public.messages (account_id, remote_id, from_address, received_at)
             values ($1, 'alice-old', 'a@b.c', now() - interval '40 months')`,
            [account],
          );
        },
        { commit: true },
      );

      const purgedByBob = await asUser(client, bob, async (db) => {
        const result = await db.query<{ purge_expired_messages: string }>(
          "select public.purge_expired_messages()",
        );
        return Number(result.rows[0].purge_expired_messages);
      });

      expect(purgedByBob).toBe(0);

      const stillThere = await asUser(client, alice, async (db) => {
        const result = await db.query(
          "select id from public.messages where remote_id = 'alice-old'",
        );
        return result.rowCount;
      });
      expect(stillThere).toBe(1);
    });
  });

  /* ── Uniqueness ────────────────────────────────────────────────────── */

  describe("identity", () => {
    it("re-syncing the same message updates rather than duplicates", async () => {
      const account = await makeAccount(alice, { remoteId: "alice-dupes" });

      const rowCount = await asUser(client, alice, async (db) => {
        await db.query(
          `insert into public.messages (account_id, remote_id, from_address, subject)
           values ($1, 'stable-id', 'a@b.c', 'First')
           on conflict (account_id, remote_id) do update set subject = excluded.subject`,
          [account],
        );
        await db.query(
          `insert into public.messages (account_id, remote_id, from_address, subject)
           values ($1, 'stable-id', 'a@b.c', 'Updated')
           on conflict (account_id, remote_id) do update set subject = excluded.subject`,
          [account],
        );

        const result = await db.query<{ subject: string }>(
          "select subject from public.messages where account_id = $1 and remote_id = 'stable-id'",
          [account],
        );
        return result.rows;
      });

      expect(rowCount).toEqual([{ subject: "Updated" }]);
    });

    it("treats a sender address case-insensitively", async () => {
      // Otherwise "Maya@example.com" and "maya@example.com" become two people
      // with two different importance ratings.
      const error = await asUser(client, alice, async (db) => {
        await db.query(
          "insert into public.senders (address, importance) values ('maya@example.com', 'critical')",
        );
        try {
          await db.query(
            "insert into public.senders (address) values ('Maya@Example.com')",
          );
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(errorCode(error)).toBe("23505"); // unique_violation
    });
  });
});
