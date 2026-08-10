import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Whose rows a repository is working with, and which client reaches them.
 *
 * ── The problem this solves ──────────────────────────────────────────────
 * Every table is `user_id uuid not null default auth.uid()` under
 * `auth.uid() = user_id`. For a browser request that is complete: the session
 * supplies the identity, the default fills the column, and the policy does the
 * filtering. No application code has to remember anything, which is exactly
 * why the schema is built that way.
 *
 * A scheduled job has no session. `auth.uid()` is null, so reads match nothing
 * and inserts violate NOT NULL — the job succeeds and does nothing, silently.
 *
 * A scope makes the difference explicit and small:
 *
 *   **session** — `userId` is null. The database answers both questions, as
 *   before. Nothing about the browser path changes.
 *
 *   **service** — `userId` is set. The client bypasses RLS, so the repository
 *   must supply the owner on every write and the filter on every read. The
 *   `userId` being non-null is what forces that: `owned()` and `scoped()`
 *   below are no-ops in session mode and mandatory in service mode.
 *
 * ── Why not always use the service role and always filter ─────────────────
 * Because then a missing `.eq("user_id", …)` is a data leak rather than an
 * empty result. Keeping the session path on RLS means the common case fails
 * safe, and the one path that can fail unsafely is short, named, and only
 * reachable from a scheduled job.
 */

/**
 * Both scopes hand back the same client shape, so a repository written against
 * a scope cannot tell which one it got — which is the point. Deriving the type
 * rather than writing it keeps it correct when the Supabase SDK's changes.
 */
type ScopedClient = Awaited<ReturnType<typeof createClient>>;

export interface DataScope {
  /** The client to query through. */
  client(): Promise<ScopedClient>;
  /**
   * The owner to write and filter by, or `null` when RLS is doing it.
   *
   * Null is not "no owner" — it is "the database already knows".
   */
  userId: string | null;
}

/** The default: a browser request, with RLS doing the work. */
export function sessionScope(): DataScope {
  return {
    client: () => createClient(),
    userId: null,
  };
}

/** A scheduled job acting for one person, with RLS bypassed. */
export function serviceScope(userId: string): DataScope {
  if (!userId) {
    throw new Error("A service scope needs a user; refusing to act for nobody");
  }

  return {
    // The service client comes from `@supabase/supabase-js` and the session
    // one from `@supabase/ssr`; they are the same client with different
    // construction, and the query surface a repository uses is identical.
    client: async () => createServiceClient() as unknown as ScopedClient,
    userId,
  };
}

/**
 * Adds the owner to a row being written.
 *
 * In session mode this returns the row untouched and `default auth.uid()`
 * fills the column. In service mode there is no `auth.uid()`, so the owner has
 * to be stated.
 */
export function owned<T extends Record<string, unknown>>(
  scope: DataScope,
  row: T,
): T | (T & { user_id: string }) {
  return scope.userId ? { ...row, user_id: scope.userId } : row;
}

/**
 * The owner filter for a query, as something to pass to `.match()`.
 *
 * Empty in session mode, where the policy has already done the filtering.
 * Applying a redundant filter there would be harmless but misleading — it
 * would suggest the filter is what protects the row, and it isn't.
 *
 * A filter object rather than a wrapper function because wrapping a Supabase
 * query builder means naming its type, and that type is deep enough that the
 * compiler gives up on some chains.
 */
export function ownerFilter(scope: DataScope): { user_id?: string } {
  return scope.userId ? { user_id: scope.userId } : {};
}
