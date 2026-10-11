import "server-only";

import { isMemoryMode, MEMORY_MODE_USER } from "@/lib/data-mode";
import { createServiceClient } from "@/lib/supabase/service";

import {
  chooseScheduledUser,
  NoScheduledUserError,
  type Account,
  type ScheduledUser,
} from "./choose-user";

export {
  chooseScheduledUser,
  NoScheduledUserError,
  type Account,
  type ScheduledUser,
};

/**
 * Who a scheduled job is acting for.
 *
 * A request from a browser carries its answer in a cookie. A request from the
 * scheduler carries a shared token, which proves *that it is the scheduler*
 * and says nothing about *whose* brief to build. Those are different
 * questions and the token only answers the first one.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 *
 *   1. `DASHBOARD_OWNER_USER_ID`, if set. An explicit answer always wins.
 *   2. Otherwise, the single account in the database.
 *   3. If there is more than one, **refuse**.
 *
 * Rule 3 is the point of this module. This is a single-user product today and
 * "just use the first row" would work for months — right up until teammate
 * mode adds a second account, at which point a scheduler picking one at
 * random would deliver one person's brief to another person's inbox. That is
 * not a failure you want to discover from the contents of an email.
 *
 * Refusing is loud, recoverable, and takes one environment variable to fix.
 */

export async function resolveScheduledUser(): Promise<ScheduledUser> {
  if (isMemoryMode()) {
    return { ...MEMORY_MODE_USER, source: "memory" };
  }

  const configured = process.env.DASHBOARD_OWNER_USER_ID?.trim();
  if (configured) return chooseScheduledUser(configured, []);

  const supabase = createServiceClient();

  // Two, not one: the second row is the whole reason to ask. Fetching a single
  // row would make "there is exactly one account" indistinguishable from
  // "there are nine and this is the oldest".
  const { data, error } = await supabase
    .schema("auth")
    .from("users")
    .select("id, email")
    .order("created_at", { ascending: true })
    .limit(2)
    .returns<Account[]>();

  if (error) {
    throw new NoScheduledUserError(
      `Could not read the account list: ${error.message}`,
    );
  }

  return chooseScheduledUser(undefined, data ?? []);
}
