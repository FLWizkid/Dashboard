import { describe, expect, it } from "vitest";

import {
  DEFAULT_OWNER,
  readOwners,
  rememberOwner,
  type OwnerStore,
} from "./owners";

function fakeStore(initial: Record<string, string> = {}): OwnerStore & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

function hostileStore(): OwnerStore {
  return {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("SecurityError");
    },
  };
}

describe("remembered task owners", () => {
  it("offers the default even before anything has been recorded", () => {
    expect(readOwners(fakeStore())).toEqual([DEFAULT_OWNER]);
  });

  it("puts the most recently used name first", () => {
    const store = fakeStore();
    rememberOwner("Maya", store);
    rememberOwner("Priya", store);

    expect(readOwners(store)).toEqual(["Priya", "Maya", DEFAULT_OWNER]);
  });

  it("moves an existing name to the front instead of duplicating it", () => {
    const store = fakeStore();
    rememberOwner("Maya", store);
    rememberOwner("Priya", store);
    rememberOwner("Maya", store);

    expect(readOwners(store)).toEqual(["Maya", "Priya", DEFAULT_OWNER]);
  });

  it("treats one person spelled two ways as one person", () => {
    // Otherwise the list fills up with "maya", "Maya" and "MAYA", and the
    // suggestions become noise rather than a shortcut.
    const store = fakeStore();
    rememberOwner("maya", store);
    rememberOwner("Maya", store);

    expect(readOwners(store)).toEqual(["Maya", DEFAULT_OWNER]);
  });

  it("keeps the default in the list even when other names are recorded", () => {
    // The default is the answer for almost every task. Losing it off the end
    // of the list would make the common case the one you have to type.
    const store = fakeStore();
    for (const name of ["A", "B", "C", "D", "E"]) rememberOwner(name, store);

    expect(readOwners(store)).toContain(DEFAULT_OWNER);
  });

  it("caps the list rather than growing without bound", () => {
    const store = fakeStore();
    for (let i = 0; i < 30; i += 1) rememberOwner(`Person ${i}`, store);

    expect(readOwners(store)).toHaveLength(12);
    expect(readOwners(store)[0]).toBe("Person 29");
  });

  it("ignores blank input rather than recording an empty name", () => {
    const store = fakeStore();
    rememberOwner("   ", store);

    expect(readOwners(store)).toEqual([DEFAULT_OWNER]);
  });

  it("trims what it records", () => {
    const store = fakeStore();
    rememberOwner("  Maya  ", store);

    expect(readOwners(store)).toEqual(["Maya", DEFAULT_OWNER]);
  });

  it("survives corrupt stored data", () => {
    // Hand-edited storage, a half-written value, or a format from a future
    // version. None of them should break capture.
    expect(
      readOwners(fakeStore({ "dashboard.owners.v1": "not json" })),
    ).toEqual([DEFAULT_OWNER]);
    expect(readOwners(fakeStore({ "dashboard.owners.v1": "{}" }))).toEqual([
      DEFAULT_OWNER,
    ]);
    expect(
      readOwners(fakeStore({ "dashboard.owners.v1": '["Maya", 7, null]' })),
    ).toEqual(["Maya", DEFAULT_OWNER]);
  });

  it("survives a browser that refuses storage", () => {
    const store = hostileStore();

    expect(readOwners(store)).toEqual([DEFAULT_OWNER]);
    expect(() => rememberOwner("Maya", store)).not.toThrow();
    expect(rememberOwner("Maya", store)).toEqual(["Maya", DEFAULT_OWNER]);
  });

  it("survives having no store at all", () => {
    expect(readOwners(null)).toEqual([DEFAULT_OWNER]);
    expect(() => rememberOwner("Maya", null)).not.toThrow();
  });
});
