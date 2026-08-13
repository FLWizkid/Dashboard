import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * A Supabase client that is **not** bound to a request's cookies.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * Every table in this schema is `user_id uuid not null default auth.uid()`
 * protected by `auth.uid() = user_id`. That is the right design: access
 * control is a property of the database, not of application code that a later
 * refactor can forget to call.
 *
 * It has one consequence that is easy to miss until something scheduled runs.
 * A scheduler has no session. `auth.uid()` is null, so reads return nothing
 * and writes violate NOT NULL — the job "succeeds" and does nothing at all,
 * which is the worst shape a failure can take.
 *
 * So a scheduled job authenticates as the *service role* and states the user
 * it is acting for explicitly. It is the only place in the product that
 * bypasses RLS, and it is deliberately awkward to reach:
 *
 *   - `server-only`, so importing it from a component fails the build rather
 *     than shipping a key that can read everything.
 *   - It never reads cookies, so it cannot accidentally serve a browser
 *     request with elevated rights.
 *   - Every caller must pass a user id — see `scopedInsert` — because a write
 *     with no owner is not something this schema should ever accept.
 *
 * ── Why not a Postgres role per user, or `set local role` ─────────────────
 * Both are better in a multi-tenant system, and this is a single-user product
 * on a private tailnet. The service role plus an explicit user id is a smaller
 * thing to hold correct, and teammate mode will need this seam either way:
 * "which user is this job for" becomes a real question then, and it is asked
 * in exactly one place today.
 */

export interface ServiceClientOptions {
  url?: string;
  key?: string;
}

export class ServiceRoleUnavailableError extends Error {
  constructor() {
    super(
      "SUPABASE_SERVICE_ROLE_KEY is not set, so nothing scheduled can run. " +
        "See docs/scheduler.md.",
    );
    this.name = "ServiceRoleUnavailableError";
  }
}

/**
 * The service-role client.
 *
 * Throws rather than degrading. A scheduler that quietly falls back to an
 * anonymous client is the bug this module was written to remove.
 */
/**
 * Where the server reaches Supabase.
 *
 * `NEXT_PUBLIC_SUPABASE_URL` is the *tailnet* hostname, because that is what
 * the browser has to use. Reaching it from inside the app container means
 * leaving Docker's network, resolving a tailnet name and completing a TLS
 * handshake — three things that can each be down while the database is
 * perfectly healthy, and none of which a scheduled job should depend on.
 *
 * `SUPABASE_INTERNAL_URL` is the gateway on the compose network. Unset falls
 * back to the public one, which is correct for local development.
 */
export function serviceUrl(env = process.env): string | undefined {
  return env.SUPABASE_INTERNAL_URL || env.NEXT_PUBLIC_SUPABASE_URL;
}

export function createServiceClient(options: ServiceClientOptions = {}) {
  const url = options.url ?? serviceUrl();
  const key = options.key ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) throw new ServiceRoleUnavailableError();

  return createSupabaseClient(url, key, {
    auth: {
      // No session to persist and nothing to refresh: this client is created
      // per job and thrown away. Persisting would write a token to whatever
      // storage happens to be available, which on a server is a file.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/** Whether a scheduled run is possible at all. Used to answer, not to guess. */
export function hasServiceRole(): boolean {
  return Boolean(serviceUrl() && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
