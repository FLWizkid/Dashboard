/**
 * Proving a request came from the scheduler.
 *
 * The scheduler has no session, so it presents a shared secret. Two properties
 * matter and both are easy to get wrong:
 *
 * **An unset token closes the path, it does not open it.** "No token
 * configured means no auth required" is a failure mode that reads as
 * convenience and behaves as an open endpoint. Even on a tailnet, a job that
 * anyone on the network can trigger is not something to leave lying around.
 *
 * **Comparison does not short-circuit on content.** Lengths are compared
 * first — which leaks the token's length and nothing else — and the bytes are
 * then compared in full, so the time taken says nothing about how much of a
 * guess was right.
 */

import { timingSafeEqual } from "node:crypto";

/**
 * `DASHBOARD_CRON_TOKEN` is the name; `DIGEST_CRON_TOKEN` is what boxes
 * deployed before the scheduler existed already have in `.env`, and silently
 * breaking their digests to rename a variable would be a poor trade. The old
 * name keeps working and is documented as deprecated.
 */
export function schedulerToken(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): string | undefined {
  return env.DASHBOARD_CRON_TOKEN || env.DIGEST_CRON_TOKEN || undefined;
}

/** The presented bearer token, or `""` when the header is absent or malformed. */
export function bearerFrom(headers: Headers): string {
  const header = headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export function isSchedulerRequest(
  headers: Headers,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): boolean {
  const expected = schedulerToken(env);
  if (!expected) return false;

  return constantTimeEquals(bearerFrom(headers), expected);
}

/**
 * Constant-time comparison, using the platform's.
 *
 * There was a hand-rolled XOR loop here while `crypto.timingSafeEqual` was
 * already in use a module away, in the envelope encryption. Two
 * implementations of the same primitive is one more than anyone will keep
 * correct, and the hand-rolled one compared UTF-16 code units rather than
 * bytes — equivalent for the ASCII tokens this generates, wrong the moment
 * one is not.
 *
 * The length check stays and still short-circuits: `timingSafeEqual` throws
 * on mismatched lengths, and a token's length is not the secret.
 */
function constantTimeEquals(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
