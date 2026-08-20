import { describe, expect, it } from "vitest";

import { findFollowUps } from "./follow-ups";

describe("findFollowUps", () => {
  it("finds unchecked and checked checkboxes with their line numbers", () => {
    const actions = findFollowUps(
      [
        "Context line",
        "- [ ] Inventory the Okta apps",
        "* [x] Told legal",
      ].join("\n"),
    );

    expect(actions).toEqual([
      { line: 1, title: "Inventory the Okta apps", checked: false },
      { line: 2, title: "Told legal", checked: true },
    ]);
  });

  it("strips Obsidian Tasks metadata from the title", () => {
    // The vault writes this shape, so a follow-up round-tripped through
    // Obsidian must not come back with its own annotations in the title.
    const [action] = findFollowUps(
      "- [ ] Inventory the Okta apps #draft 👤 Maya ⏫ 📅 2026-09-01",
    );

    expect(action.title).toBe("Inventory the Okta apps");
  });

  it("ignores ordinary list items and prose", () => {
    expect(findFollowUps("- a bullet\nsome prose\n1. numbered\n")).toHaveLength(
      0,
    );
  });

  it("handles indented checkboxes", () => {
    const [action] = findFollowUps("  - [ ] Nested follow-up");
    expect(action?.title).toBe("Nested follow-up");
  });

  it("skips a checkbox with no text left after stripping", () => {
    expect(findFollowUps("- [ ] #draft")).toHaveLength(0);
  });
});
