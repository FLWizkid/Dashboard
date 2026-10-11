import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The dark palette is written twice — once under `prefers-color-scheme` and
 * once under `[data-theme="dark"]` — because plain CSS cannot share a
 * custom-property set between a media query and an attribute selector.
 *
 * Duplication that has to stay identical is duplication that will not, and
 * the failure is quiet: the toggle and the system preference drift apart, and
 * whichever one you are not testing in gets a stale colour. Nobody notices
 * until a screenshot looks wrong months later.
 *
 * So the two blocks are compared here. The media-query copy carries the
 * explanatory comments and is the one to edit; this test's job is to say so
 * out loud when only one of them changed.
 */

const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** Every `--name: value;` inside one brace-delimited block. */
function declarations(block: string): Map<string, string> {
  const found = new Map<string, string>();

  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    // Collapse whitespace so a reformat by Prettier — which wraps the longer
    // shadow values across lines in one copy and not the other — is not read
    // as a difference in the value itself.
    found.set(match[1], match[2].replace(/\s+/g, " ").trim());
  }

  return found;
}

/** The body of the first block whose selector line contains `needle`. */
function blockAfter(needle: string): string {
  const start = CSS.indexOf(needle);
  expect(start, `no block matching ${needle}`).toBeGreaterThan(-1);

  const open = CSS.indexOf("{", start);
  let depth = 0;

  for (let i = open; i < CSS.length; i += 1) {
    if (CSS[i] === "{") depth += 1;
    if (CSS[i] === "}") {
      depth -= 1;
      if (depth === 0) return CSS.slice(open + 1, i);
    }
  }

  throw new Error(`unbalanced braces after ${needle}`);
}

describe("the dark palette", () => {
  const media = declarations(blockAfter(':root:not([data-theme="light"])'));
  const attribute = declarations(blockAfter(':root[data-theme="dark"]'));

  it("is defined in both places", () => {
    expect(media.size).toBeGreaterThan(30);
    expect([...attribute.keys()].sort()).toEqual([...media.keys()].sort());
  });

  it("agrees on every value", () => {
    // Reported as one object rather than a loop of assertions, so a drift in
    // three tokens shows all three at once instead of the first.
    const drifted: Record<string, { media: string; attribute: string }> = {};

    for (const [name, value] of media) {
      const other = attribute.get(name);
      if (other !== value) {
        drifted[name] = { media: value, attribute: other ?? "(missing)" };
      }
    }

    expect(drifted).toEqual({});
  });
});

describe("the light palette", () => {
  const light = declarations(blockAfter(":root {"));

  it("defines every token the dark theme overrides", () => {
    // A token that exists only in the dark block inherits whatever the light
    // theme happened to leave behind — usually nothing, which renders as a
    // transparent fill rather than as an obvious error.
    const dark = declarations(blockAfter(':root[data-theme="dark"]'));
    const missing = [...dark.keys()].filter((name) => !light.has(name));

    expect(missing).toEqual([]);
  });

  it("keeps pure white out of the page surfaces", () => {
    // The owner's words were "I don't like the plain white screens". The page
    // and its ordinary cards are tinted; `--surface-raised` is the single
    // deliberate exception, for the things that need to float above them.
    expect(light.get("--bg")).not.toBe("255 255 255");
    expect(light.get("--surface")).not.toBe("255 255 255");
  });
});
