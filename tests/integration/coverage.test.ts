import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connect, hasDatabase, resetSchema } from "./db";

/**
 * Schema-wide invariants.
 *
 * Every other integration file proves that *a particular* table isolates *a
 * particular* pair of users. That is the right test to write, and it has one
 * blind spot that matters more than anything it catches: a table nobody wrote
 * a test for.
 *
 * Six phases have each added their own tables. The failure mode is not a
 * broken policy — those get noticed — it is a `create table` that ships with
 * no policy at all, in a migration whose reviewer was looking at the columns.
 * PostgREST exposes everything in `public`, so such a table is readable by any
 * signed-in user on the box the moment it exists.
 *
 * These tests ask the catalogue instead of asking a test author to remember.
 */
const describeDb = hasDatabase ? describe : describe.skip;

/**
 * Tables that are deliberately readable by everyone who is signed in.
 *
 * There are none today. The list exists so that adding one is a decision
 * somebody writes down, with a reason, in a diff — rather than the absence of
 * a policy.
 */
const INTENTIONALLY_SHARED: string[] = [];

interface TableRow {
  tablename: string;
  rowsecurity: boolean;
}

describeDb("every table in the API surface", () => {
  let client: Client;
  let tables: TableRow[];

  beforeAll(async () => {
    client = await connect();
    await resetSchema(client);

    const { rows } = await client.query<TableRow>(
      `select tablename, rowsecurity
         from pg_tables
        where schemaname = 'public'
        order by tablename`,
    );
    tables = rows;
  }, 60_000);

  afterAll(async () => {
    await client?.end();
  });

  it("finds the tables at all — a silent empty set would pass everything", () => {
    // Without this, a broken query returning zero rows would make every
    // assertion below vacuously true and the whole file a green no-op.
    expect(tables.length).toBeGreaterThan(15);
  });

  it("has row level security enabled, without exception", async () => {
    const unprotected = tables
      .filter((table) => !table.rowsecurity)
      .map((table) => table.tablename)
      .filter((name) => !INTENTIONALLY_SHARED.includes(name));

    expect(unprotected).toEqual([]);
  });

  it("has at least one policy on every table that has RLS on", async () => {
    // RLS enabled with no policy denies everything, which is safe but is
    // almost always a half-finished migration rather than an intention.
    const { rows } = await client.query<{ tablename: string }>(
      `select t.tablename
         from pg_tables t
         left join pg_policies p
           on p.schemaname = t.schemaname and p.tablename = t.tablename
        where t.schemaname = 'public'
          and t.rowsecurity
        group by t.tablename
       having count(p.policyname) = 0`,
    );

    expect(rows.map((row) => row.tablename)).toEqual([]);
  });

  it("forces RLS on the owner too, or scopes every policy to a user", async () => {
    // A policy of `using (true)` is RLS that is on and does nothing. Every
    // policy in this schema should mention the current user in some form.
    const { rows } = await client.query<{
      tablename: string;
      policyname: string;
      qual: string | null;
      with_check: string | null;
    }>(
      `select tablename, policyname, qual, with_check
         from pg_policies
        where schemaname = 'public'`,
    );

    const unscoped = rows.filter((policy) => {
      const expressions = [policy.qual, policy.with_check]
        .filter((value): value is string => Boolean(value))
        .join(" ");

      if (!expressions) return true;
      return !/auth\.uid\(\)|user_id|owner_id|current_setting/i.test(
        expressions,
      );
    });

    expect(
      unscoped.map((policy) => `${policy.tablename}.${policy.policyname}`),
    ).toEqual([]);
  });

  it("keeps the retired placeholders out of the API surface", async () => {
    // They were moved to `archive` rather than dropped, because dropping is
    // irreversible. PostgREST only exposes `public`, so the move is what makes
    // them unreachable.
    expect(tables.map((table) => table.tablename)).not.toContain("priorities");

    const { rows } = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'archive' order by table_name`,
    );

    expect(rows.map((row) => row.table_name)).toEqual([
      "priorities",
      "time_entries",
    ]);
  });

  it("has the Phase 4 time_entries in public, not the retired one", async () => {
    // `time_entries` is the one name that appears on both sides of the
    // retirement. The placeholder was a label-and-hours log; Phase 4's is the
    // real ledger, and the retirement migration guards against archiving it
    // by mistake on a re-run. Asserting on the *columns* is what tells those
    // two apart — asserting on the name would fail either way round.
    const { rows } = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'time_entries'`,
    );
    const columns = rows.map((row) => row.column_name);

    expect(columns).toContain("source");
    expect(columns).toContain("started_at");
    expect(columns).toContain("minutes");

    // The placeholder's shape, which must not be what is exposed.
    expect(columns).not.toContain("logged_on");
    expect(columns).not.toContain("hours");
  });
});

describeDb("functions that run as their definer", () => {
  let client: Client;

  beforeAll(async () => {
    client = await connect();
  }, 60_000);

  afterAll(async () => {
    await client?.end();
  });

  it("all pin a search_path", async () => {
    // A `security definer` function without a fixed `search_path` is the
    // classic Postgres privilege escalation: a caller creates a table or an
    // operator in a schema earlier on their own path, and the function
    // resolves to theirs while running as the owner.
    const { rows } = await client.query<{ proname: string }>(
      `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosecdef
          and not exists (
            select 1 from unnest(coalesce(p.proconfig, '{}')) as config
             where config like 'search_path=%'
          )`,
    );

    expect(rows.map((row) => row.proname)).toEqual([]);
  });

  it("finds some — an empty result would prove nothing", async () => {
    const { rows } = await client.query<{ count: string }>(
      `select count(*)::text as count
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef`,
    );

    expect(Number(rows[0].count)).toBeGreaterThan(0);
  });
});
