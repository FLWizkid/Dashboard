/**
 * The rule for deciding whose work a scheduled job is doing.
 *
 * Separated from the query that feeds it so it can be tested for the case that
 * matters — the second account — without a database. The IO wrapper lives in
 * `./identity.ts`.
 */

export class NoScheduledUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoScheduledUserError";
  }
}

export interface Account {
  id: string;
  email: string | null;
}

export interface ScheduledUser {
  id: string;
  email: string | null;
  /** How it was decided, so a log line can say why. */
  source: "configured" | "only_account" | "memory";
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param configured `DASHBOARD_OWNER_USER_ID`, if it is set.
 * @param accounts Up to two accounts, oldest first. Two is enough: the
 *   question is only ever "is there more than one".
 */
export function chooseScheduledUser(
  configured: string | undefined,
  accounts: readonly Account[],
): ScheduledUser {
  if (configured) {
    // A malformed id is a typo, and the alternative to complaining is running
    // as nobody and silently doing nothing — the failure this whole module
    // exists to prevent.
    if (!UUID.test(configured)) {
      throw new NoScheduledUserError(
        `DASHBOARD_OWNER_USER_ID is not a UUID: ${JSON.stringify(configured)}`,
      );
    }
    return { id: configured, email: null, source: "configured" };
  }

  if (accounts.length === 0) {
    throw new NoScheduledUserError(
      "There is no account yet, so there is nothing to schedule. " +
        "Create one and the next run will find it.",
    );
  }

  if (accounts.length > 1) {
    // The important branch. This is a single-user product and "take the first
    // row" would work for months — until teammate mode adds a second account
    // and the scheduler starts delivering one person's brief to another.
    // Refusing is loud, recoverable, and one environment variable to fix.
    throw new NoScheduledUserError(
      "More than one account exists, so a scheduled job cannot tell whose " +
        "work it is. Set DASHBOARD_OWNER_USER_ID to the account it should " +
        "act for. See docs/scheduler.md.",
    );
  }

  return {
    id: accounts[0].id,
    email: accounts[0].email,
    source: "only_account",
  };
}
