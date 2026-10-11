import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  isThemeSetting,
  resolveTheme,
  THEME_BOOT_SCRIPT,
  THEME_BOOT_SCRIPT_HASH,
  THEME_STORAGE_KEY,
} from "./theme";

describe("the boot script's hash", () => {
  it("matches the script the CSP is authorising", () => {
    // The one test in this file that has to exist. The hash is written out by
    // hand so the edge middleware does not have to hash anything at request
    // time, which means an edit to the script silently invalidates it. The
    // symptom would be subtle — the script blocked, the page painting in the
    // wrong theme for a frame, and nothing in the logs unless someone is
    // reading CSP reports — so it is caught here instead.
    const digest = createHash("sha256")
      .update(THEME_BOOT_SCRIPT, "utf8")
      .digest("base64");

    expect(`sha256-${digest}`).toBe(THEME_BOOT_SCRIPT_HASH);
  });
});

describe("the boot script", () => {
  it("reads the same key the toggle writes", () => {
    // Two places name this key. If they disagree, the toggle appears to work
    // and the preference is forgotten on reload.
    expect(THEME_BOOT_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
  });

  it("falls back to dark when the system has no preference", () => {
    // The script asks whether light is *preferred*, rather than whether dark
    // is. Those differ precisely when the machine says nothing, and that gap
    // is the product's stated default. Asserted on the source because the
    // behaviour lives in a string that no unit test can execute.
    expect(THEME_BOOT_SCRIPT).toContain("prefers-color-scheme: light");
    expect(THEME_BOOT_SCRIPT).not.toContain("prefers-color-scheme: dark");
  });

  it("survives storage being unavailable", () => {
    // Private windows and locked-down browsers throw on `localStorage`
    // access rather than returning null. Unguarded, that throws before the
    // theme is stamped and the page renders unstyled-ish for a frame.
    expect(THEME_BOOT_SCRIPT).toContain("catch");
  });
});

describe("resolveTheme", () => {
  it("honours an explicit choice over the system", () => {
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
  });

  it("follows the system when there is no choice", () => {
    expect(resolveTheme("system", true)).toBe("light");
  });

  it("prefers dark when the system expresses nothing", () => {
    expect(resolveTheme("system", false)).toBe("dark");
  });
});

describe("isThemeSetting", () => {
  it("accepts the three settings", () => {
    expect(isThemeSetting("system")).toBe(true);
    expect(isThemeSetting("light")).toBe(true);
    expect(isThemeSetting("dark")).toBe(true);
  });

  it("rejects anything else, including old stored values", () => {
    // Whatever is in `localStorage` came from a previous version of this
    // application and is not to be trusted into a `data-theme` attribute.
    expect(isThemeSetting("auto")).toBe(false);
    expect(isThemeSetting(null)).toBe(false);
    expect(isThemeSetting("")).toBe(false);
  });
});
