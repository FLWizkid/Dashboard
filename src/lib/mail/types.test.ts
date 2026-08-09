import { describe, expect, it } from "vitest";

import {
  displayFor,
  isCachingPolicy,
  isSenderImportance,
  normalizeAddress,
  parseAddressList,
  parseMailAddress,
  SENDER_IMPORTANCE_RANK,
} from "./types";

describe("parseMailAddress", () => {
  it("splits a display name from an address", () => {
    expect(parseMailAddress("Maya Chen <maya@example.com>")).toEqual({
      address: "maya@example.com",
      name: "Maya Chen",
    });
  });

  it("handles a bare address", () => {
    expect(parseMailAddress("maya@example.com")).toEqual({
      address: "maya@example.com",
      name: null,
    });
  });

  it("strips the quotes providers put round names containing commas", () => {
    expect(parseMailAddress('"Chen, Maya" <maya@example.com>')).toEqual({
      address: "maya@example.com",
      name: "Chen, Maya",
    });
  });

  it("lower-cases the address but leaves the name alone", () => {
    expect(parseMailAddress("Maya Chen <Maya@Example.COM>")).toEqual({
      address: "maya@example.com",
      name: "Maya Chen",
    });
  });

  it("treats an empty display name as absent", () => {
    expect(parseMailAddress("<maya@example.com>").name).toBeNull();
  });
});

describe("parseAddressList", () => {
  it("splits on commas", () => {
    expect(parseAddressList("a@x.com, b@y.com")).toEqual([
      { address: "a@x.com", name: null },
      { address: "b@y.com", name: null },
    ]);
  });

  it("does not split inside a quoted display name", () => {
    // The classic header bug: "Chen, Maya" becomes two recipients, and a
    // reply-all goes to a mailbox called "Chen".
    const parsed = parseAddressList(
      '"Chen, Maya" <maya@example.com>, sam@example.com',
    );

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      address: "maya@example.com",
      name: "Chen, Maya",
    });
    expect(parsed[1].address).toBe("sam@example.com");
  });

  it("does not split inside angle brackets", () => {
    expect(parseAddressList("<a,b@x.com>")).toHaveLength(1);
  });

  it("returns nothing for empty input", () => {
    expect(parseAddressList(null)).toEqual([]);
    expect(parseAddressList(undefined)).toEqual([]);
    expect(parseAddressList("")).toEqual([]);
    expect(parseAddressList("   ,  ")).toEqual([]);
  });

  it("tolerates trailing commas and extra whitespace", () => {
    expect(parseAddressList("  a@x.com ,  b@y.com , ")).toHaveLength(2);
  });
});

describe("normalizeAddress", () => {
  it("trims and lower-cases", () => {
    expect(normalizeAddress("  Maya@Example.COM ")).toBe("maya@example.com");
  });
});

describe("displayFor", () => {
  it("prefers the name and falls back to the address", () => {
    expect(displayFor({ address: "a@x.com", name: "Ann" })).toBe("Ann");
    expect(displayFor({ address: "a@x.com", name: null })).toBe("a@x.com");
  });
});

describe("guards", () => {
  it("recognise the valid values and reject the rest", () => {
    expect(isSenderImportance("critical")).toBe(true);
    expect(isSenderImportance("urgent")).toBe(false);
    expect(isCachingPolicy("metadata")).toBe(true);
    expect(isCachingPolicy("partial")).toBe(false);
  });
});

describe("SENDER_IMPORTANCE_RANK", () => {
  it("sorts critical first and low last", () => {
    const sorted = ["normal", "low", "critical", "high"].sort(
      (a, b) =>
        SENDER_IMPORTANCE_RANK[a as keyof typeof SENDER_IMPORTANCE_RANK] -
        SENDER_IMPORTANCE_RANK[b as keyof typeof SENDER_IMPORTANCE_RANK],
    );

    expect(sorted).toEqual(["critical", "high", "normal", "low"]);
  });
});
