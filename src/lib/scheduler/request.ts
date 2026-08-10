import "server-only";

import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { isMemoryMode } from "@/lib/data-mode";
import { serviceScope, sessionScope, type DataScope } from "@/lib/db/scope";
import { NoScheduledUserError, resolveScheduledUser } from "./identity";
import { isSchedulerRequest } from "./token";

/**
 * Turning "who is asking" into "whose rows to touch", for the endpoints the
 * scheduler drives.
 *
 * There are exactly two callers of a scheduled endpoint and they need
 * different treatment:
 *
 *   **A person**, pressing a button. They have a session, RLS knows who they
 *   are, and nothing special is needed.
 *
 *   **The scheduler**, presenting a shared token. It has no session, so the
 *   identity has to be resolved separately and the queries run with the
 *   service role.
 *
 * Getting this wrong in the direction of "just use the anonymous client" is
 * not a visible failure — the job runs, reads nothing, writes nothing and
 * reports success. So this returns a discriminated result rather than a
 * nullable client: there is no shape of it that lets a caller proceed without
 * having decided what happened.
 */

export type ScopeResult =
  | {
      ok: true;
      scope: DataScope;
      userId: string;
      actor: "session" | "scheduler";
    }
  | { ok: false; status: 401 | 503; error: string };

export async function scopeForRequest(request: Request): Promise<ScopeResult> {
  const user = await getSessionUser();

  if (user) {
    return {
      ok: true,
      scope: sessionScope(),
      userId: user.id,
      actor: "session",
    };
  }

  if (!isSchedulerRequest(request.headers)) {
    return { ok: false, status: 401, error: "Not authorised" };
  }

  // Memory mode has no Supabase at all; the in-memory repositories ignore the
  // scope and answer as the single pretend user. Resolving an identity here
  // keeps the E2E path exercising the same branch the box does.
  if (isMemoryMode()) {
    const owner = await resolveScheduledUser();
    return {
      ok: true,
      scope: sessionScope(),
      userId: owner.id,
      actor: "scheduler",
    };
  }

  try {
    const owner = await resolveScheduledUser();
    return {
      ok: true,
      scope: serviceScope(owner.id),
      userId: owner.id,
      actor: "scheduler",
    };
  } catch (error) {
    // A scheduler that cannot tell whose work it is has a configuration
    // problem, not an authentication one. 503 says "ask again once this is
    // fixed", which is what a retrying scheduler should do — and it keeps the
    // message out of the 401 bucket where nobody reads it.
    if (error instanceof NoScheduledUserError) {
      return { ok: false, status: 503, error: error.message };
    }
    return {
      ok: false,
      status: 503,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/** The response for a failed scope resolution. */
export function schedulerFailure(
  result: Extract<ScopeResult, { ok: false }>,
): NextResponse {
  return NextResponse.json({ error: result.error }, { status: result.status });
}
