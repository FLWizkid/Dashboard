import { NextResponse } from "next/server";
import type { z } from "zod";

import { getSessionUser } from "@/lib/auth";

import {
  DuplicateClientKeyError,
  HoursRecordNotFoundError,
  SessionAlreadyRunningError,
} from "./repository";

/**
 * Shared plumbing for the hours route handlers.
 *
 * Five routes with the same auth check, the same JSON parse and the same
 * error translation is five chances to get one of them subtly different. The
 * error mapping in particular is a behavioural contract, not boilerplate — a
 * duplicate client key returning 500 instead of 200 would make the offline
 * outbox retry forever.
 */

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const unauthorized = () =>
  NextResponse.json({ error: "Not signed in" }, { status: 401 });

export async function requireUser() {
  return getSessionUser();
}

/** Parses and validates a JSON body, returning either the value or a response. */
export async function readBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<{ data: z.infer<T> } | { response: NextResponse }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      response: NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      ),
    };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      response: NextResponse.json(
        { error: "Invalid request", issues: parsed.error.flatten() },
        { status: 400 },
      ),
    };
  }

  return { data: parsed.data };
}

/**
 * Turns a repository error into the right response.
 *
 * The two interesting cases:
 *
 *   **Duplicate client key → 200 with the existing entry.** The hour is
 *   already recorded. Returning an error would be technically accurate and
 *   practically wrong: the outbox would keep the entry queued and retry it
 *   forever, and the owner would see "not synced" against time that is
 *   sitting in the database.
 *
 *   **Session already running → 409 with the running session.** The UI adopts
 *   it rather than showing a failure for a timer the owner can see ticking in
 *   another tab.
 */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof DuplicateClientKeyError) {
    return NextResponse.json(
      { entry: error.existing, duplicate: true },
      { status: 200 },
    );
  }

  if (error instanceof SessionAlreadyRunningError) {
    return NextResponse.json(
      { error: error.message, session: error.running },
      { status: 409 },
    );
  }

  if (error instanceof HoursRecordNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Unknown error" },
    { status: 500 },
  );
}
