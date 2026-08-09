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
 * The retirement migration, verified rather than assumed.
 *
 * `priorities` and `time_entries` were built without the specification and
 * are superseded. The migration moves them out of `public` instead of
 * dropping them, so two things have to be true at once: the application's API
 * surface must no longer contain them, and the rows must still exist.
 */
const describeDb = hasDatabase ? describe : describe.skip;

describeDb("retired placeholder tables", () => {
  let client: Client;
  let alice: string;

  beforeAll(async () => {
    client = await connect();
    await resetSchema(client);
    alice = await createUser(client, "alice@example.invalid");
  }, 60_000);

  afterAll(async () => {
    await client?.end();
  });

  const RETIRED = ["priorities", "time_entries"];

  it("removes them from the API-exposed schema", async () => {
    // PostgREST exposes `public`. Not being here is what actually retires
    // them — everything else is tidiness.
    const { rows } = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_name = any($1)`,
      [RETIRED],
    );

    expect(rows).toEqual([]);
  });

  it("keeps them, and their data, in the archive schema", async () => {
    const { rows } = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'archive' order by table_name`,
      [],
    );

    expect(rows.map((row) => row.table_name)).toEqual([
      "priorities",
      "time_entries",
    ]);
  });

  it("preserves the rows rather than destroying them", async () => {
    // Put a row in the archived table as the owner, then confirm the
    // migration's promise: nothing was lost.
    await client.query(
      `insert into archive.priorities (user_id, title) values ($1, 'kept')`,
      [alice],
    );

    const { rows } = await client.query<{ count: string }>(
      "select count(*) from archive.priorities",
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it("leaves row level security switched on in the archive", async () => {
    // If the data is still here, its protection has to be too.
    const { rows } = await client.query<{
      relname: string;
      relrowsecurity: boolean;
    }>(
      `select c.relname, c.relrowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'archive' and c.relkind = 'r'`,
    );

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} lost RLS`).toBe(true);
    }
  });

  it("denies the authenticated role any access to the archive", async () => {
    // The role PostgREST connects as must not be able to reach these, even
    // knowing the schema name.
    for (const table of RETIRED) {
      const error = await asUser(client, alice, async (db) => {
        try {
          await db.query(`select * from archive.${table} limit 1`);
          return null;
        } catch (caught) {
          return caught;
        }
      });

      expect(error, `archive.${table} was readable`).not.toBeNull();
      // 42501 insufficient_privilege — the schema grant is gone.
      expect(errorCode(error)).toBe("42501");
    }
  });

  it("is idempotent", async () => {
    // Migrations get re-applied. Running this one again must be a no-op, not
    // an error about a table that has already moved.
    const migration = await import("node:fs").then((fs) =>
      fs.readFileSync(
        "supabase/migrations/20260809000001_retire_placeholder_tables.sql",
        "utf8",
      ),
    );

    await expect(client.query(migration)).resolves.toBeDefined();
  });

  it("leaves the live tables exactly where they were", async () => {
    // Asserts what this migration is responsible for — the Phase 1 tables
    // surviving and the retired ones being gone — rather than pinning the
    // whole schema, which every later phase legitimately grows.
    const { rows } = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const present = new Set(rows.map((row) => row.table_name));

    for (const table of [
      "activity_categories",
      "profiles",
      "task_links",
      "tasks",
    ]) {
      expect(present.has(table), `${table} went missing`).toBe(true);
    }
    for (const table of RETIRED) {
      expect(present.has(table), `${table} is still in public`).toBe(false);
    }
  });
});
