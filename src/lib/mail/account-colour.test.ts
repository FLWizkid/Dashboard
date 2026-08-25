import { describe, expect, it } from "vitest";

import {
  ACCOUNT_TINTS,
  accountShortName,
  accountTint,
  tintsByAccountId,
} from "./account-colour";

describe("accountTint", () => {
  it("gives the first account tint 1", () => {
    expect(accountTint(0)).toBe(1);
  });

  it("hands out every tint before repeating", () => {
    const first = [0, 1, 2, 3].map(accountTint);
    expect(new Set(first).size).toBe(ACCOUNT_TINTS);
  });

  it("wraps rather than running off the end", () => {
    // The fifth account shares the first one's tint. Pinned because the
    // alternative failure is a class name like `text-account-5`, which
    // Tailwind never generated and which renders as no colour at all —
    // silently, and only for whoever has five mailboxes.
    expect(accountTint(4)).toBe(1);
    expect(accountTint(9)).toBe(2);
  });

  it("does not produce a negative tint", () => {
    // `indexOf` returns -1 for an account that has gone missing, and a naive
    // modulo would turn that into tint 0 — another class that does not exist.
    expect(accountTint(-1)).toBe(4);
  });
});

describe("accountShortName", () => {
  it("uses the domain, because the local part is always the same", () => {
    expect(accountShortName({ emailAddress: "doug@theonefor.ai" })).toBe(
      "theonefor",
    );
    expect(accountShortName({ emailAddress: "doug@encountive.com" })).toBe(
      "encountive",
    );
    expect(accountShortName({ emailAddress: "dougtully@proton.me" })).toBe(
      "proton",
    );
  });

  it("survives an address with no domain", () => {
    expect(accountShortName({ emailAddress: "malformed" })).toBe("malformed");
  });
});

describe("tintsByAccountId", () => {
  it("keys the tints by id so a row can look one up", () => {
    const tints = tintsByAccountId([{ id: "a" }, { id: "b" }, { id: "c" }]);

    expect(tints.get("a")).toBe(1);
    expect(tints.get("b")).toBe(2);
    expect(tints.get("c")).toBe(3);
  });

  it("returns nothing for an unknown id rather than guessing", () => {
    expect(tintsByAccountId([{ id: "a" }]).get("gone")).toBeUndefined();
  });
});
