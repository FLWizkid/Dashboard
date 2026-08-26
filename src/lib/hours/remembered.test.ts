import { describe, expect, it } from "vitest";

import {
  readRemembered,
  writeRemembered,
  type RememberedStore,
} from "./remembered";

function fakeStore(initial: Record<string, string> = {}): RememberedStore & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

/** A browser that refuses storage entirely — a private window, or blocked site data. */
function hostileStore(): RememberedStore {
  return {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("SecurityError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
  };
}

describe("remembered quick-log values", () => {
  it("round-trips a value under a namespaced key", () => {
    const store = fakeStore();
    writeRemembered("note", "Board pack review", store);

    expect(store.data["dashboard.quick-log.note"]).toBe("Board pack review");
    expect(readRemembered("note", store)).toBe("Board pack review");
  });

  it("reads an empty string when nothing was ever stored", () => {
    // Not null and not undefined: the caller puts this straight into a
    // controlled input, and either of those turns it into an uncontrolled one.
    expect(readRemembered("note", fakeStore())).toBe("");
  });

  it("forgets the key when the value is cleared", () => {
    // Clearing the box is a decision — "the next block is something else" —
    // and storing a blank would mean it came back on the next reload.
    const store = fakeStore({ "dashboard.quick-log.note": "Board pack" });
    writeRemembered("note", "", store);

    expect("dashboard.quick-log.note" in store.data).toBe(false);
    expect(readRemembered("note", store)).toBe("");
  });

  it("survives a browser that refuses storage", () => {
    // The whole point: carrying a description over is a convenience. A private
    // window must cost you a retype, never an entry.
    const store = hostileStore();

    expect(() => writeRemembered("note", "anything", store)).not.toThrow();
    expect(readRemembered("note", store)).toBe("");
  });

  it("survives having no store at all", () => {
    expect(readRemembered("note", null)).toBe("");
    expect(() => writeRemembered("note", "anything", null)).not.toThrow();
  });
});
