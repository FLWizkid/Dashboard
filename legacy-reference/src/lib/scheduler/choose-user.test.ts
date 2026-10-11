import { describe, expect, it } from "vitest";

import { chooseScheduledUser, NoScheduledUserError } from "./choose-user";

/**
 * Whose work a scheduled job does.
 *
 * The rule being protected: **when the answer is ambiguous, refuse.** A
 * scheduler that guesses delivers one person's private brief to another
 * person's inbox, and does it on a timer.
 */

const ALICE = { id: "11111111-1111-4111-8111-111111111111", email: "a@x.test" };
const BOB = { id: "22222222-2222-4222-8222-222222222222", email: "b@x.test" };

describe("with nothing configured", () => {
  it("uses the only account there is", () => {
    expect(chooseScheduledUser(undefined, [ALICE])).toEqual({
      id: ALICE.id,
      email: ALICE.email,
      source: "only_account",
    });
  });

  it("refuses when a second account exists", () => {
    // The entire point. Everything else here is bookkeeping.
    expect(() => chooseScheduledUser(undefined, [ALICE, BOB])).toThrow(
      NoScheduledUserError,
    );
  });

  it("names the fix in the refusal", () => {
    // A scheduled job's error is read hours later, out of context, by someone
    // wondering why no brief arrived. It has to carry its own remedy.
    expect(() => chooseScheduledUser(undefined, [ALICE, BOB])).toThrow(
      /DASHBOARD_OWNER_USER_ID/,
    );
  });

  it("refuses when there is no account at all", () => {
    expect(() => chooseScheduledUser(undefined, [])).toThrow(
      NoScheduledUserError,
    );
  });
});

describe("with an owner configured", () => {
  it("uses it, and does not care how many accounts exist", () => {
    expect(chooseScheduledUser(BOB.id, [ALICE, BOB])).toEqual({
      id: BOB.id,
      email: null,
      source: "configured",
    });
  });

  it("uses it even when the account list is empty", () => {
    // The list comes from a query that may fail or be filtered. An explicit
    // answer should not depend on a second opinion.
    expect(chooseScheduledUser(ALICE.id, []).id).toBe(ALICE.id);
  });

  it("rejects a value that is not a UUID rather than running as nobody", () => {
    expect(() => chooseScheduledUser("the-owner", [ALICE])).toThrow(
      NoScheduledUserError,
    );
  });

  it("quotes the bad value, because a typo is invisible unquoted", () => {
    expect(() => chooseScheduledUser("  ", [ALICE])).toThrow(/"  "/);
  });
});
