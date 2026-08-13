import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";

/**
 * Harness for the schema/RLS integration tests.
 *
 * Every test connects as the `authenticated` role with a JWT claim, exactly
 * as PostgREST does on the real box. Running them as the owning superuser
 * would silently bypass every policy and turn the whole suite into a
 * no-op — so `asUser` is the only way these tests touch data.
 */

export const DATABASE_URL = process.env.DATABASE_URL;

/** Tests call this to skip cleanly when no scratch database is configured. */
export const hasDatabase = Boolean(DATABASE_URL);

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const BOOTSTRAP = join(process.cwd(), "tests", "integration", "bootstrap.sql");

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  return client;
}

/**
 * Drop everything and rebuild from the migrations on disk.
 *
 * Rebuilding rather than truncating means the tests exercise the migration
 * files themselves — a migration that doesn't apply cleanly fails here.
 */
export async function resetSchema(client: Client): Promise<void> {
  await client.query(`
    drop schema if exists public cascade;
    drop schema if exists auth cascade;
    -- The retirement migration moves the superseded tables here. Without
    -- dropping it too, a second run would find archive.priorities already
    -- present and the migration would fail on a schema it had every right to
    -- expect was empty.
    drop schema if exists archive cascade;
    create schema public;
  `);

  await client.query(readFileSync(BOOTSTRAP, "utf8"));

  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const migration of migrations) {
    const sql = readFileSync(join(MIGRATIONS_DIR, migration), "utf8");
    try {
      await client.query(sql);
    } catch (error) {
      throw new Error(
        `Migration ${migration} failed: ${(error as Error).message}`,
      );
    }
  }

  // PostgREST grants these on the real instance; do the same here so the only
  // thing standing between a user and someone else's row is RLS.
  await client.query(`
    grant select, insert, update, delete on all tables in schema public
      to authenticated;
    grant usage, select on all sequences in schema public to authenticated;
  `);
}

export async function createUser(
  client: Client,
  email: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [email],
  );
  return rows[0].id;
}

/**
 * Run `body` inside a transaction as the given user, then roll back.
 *
 * Rolling back keeps each assertion independent without a reset between them.
 * Pass `commit: true` when a later test needs the rows to survive.
 */
export async function asUser<T>(
  client: Client,
  userId: string,
  body: (client: Client) => Promise<T>,
  options: { commit?: boolean } = {},
): Promise<T> {
  await client.query("begin");
  try {
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [
      userId,
    ]);
    await client.query("set local role authenticated");

    const result = await body(client);

    await client.query(options.commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    // `set local role` is undone by the transaction end, but be explicit:
    // a leaked role would make the next test lie.
    await client.query("reset role");
  }
}

/** A Postgres error code, for asserting on the failure rather than the text. */
export function errorCode(error: unknown): string | undefined {
  return (error as { code?: string } | undefined)?.code;
}
