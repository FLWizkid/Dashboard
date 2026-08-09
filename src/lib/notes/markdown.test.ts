import { describe, expect, it } from "vitest";

import {
  parseDocument,
  serializeDocument,
  serializeFrontmatter,
} from "./frontmatter";
import {
  extractWikiLinks,
  markdownToNote,
  markdownToTask,
  noteToMarkdown,
  safeFileName,
  taskToMarkdown,
  vaultPathFor,
  type MarkdownTask,
  type NoteDocument,
} from "./markdown";

const note = (over: Partial<NoteDocument> = {}): NoteDocument => ({
  kind: "decision",
  title: "Consolidate on one identity provider",
  decision: "Move everything to Entra ID by Q1.",
  rationale:
    "Two providers means two audit trails and twice the offboarding risk.",
  context: "Raised by the SOC2 gap analysis.",
  owner: "Doug",
  decidedOn: "2026-08-11",
  body: "",
  followUps: [],
  extraFrontmatter: { data: {}, unknown: [] },
  ...over,
});

const task = (over: Partial<MarkdownTask> = {}): MarkdownTask => ({
  id: null,
  title: "Inventory the Okta apps",
  done: false,
  priority: null,
  dueAt: null,
  doneAt: null,
  owner: null,
  isDraft: false,
  ...over,
});

/* ── Frontmatter ──────────────────────────────────────────────────────── */

describe("parseDocument", () => {
  it("splits frontmatter from body", () => {
    const parsed = parseDocument("---\ntype: decision\n---\n\n# Title\n\nBody");

    expect(parsed.hadFrontmatter).toBe(true);
    expect(parsed.frontmatter.data.type).toBe("decision");
    expect(parsed.body).toBe("# Title\n\nBody");
  });

  it("handles a document with no frontmatter", () => {
    const parsed = parseDocument("# Just a note\n\nText");
    expect(parsed.hadFrontmatter).toBe(false);
    expect(parsed.body).toBe("# Just a note\n\nText");
  });

  it("does not swallow the note when a fence is unterminated", () => {
    // A `---` at the top with no closing fence is a horizontal rule, or a
    // mistake. Treating it as frontmatter would eat the whole file.
    const parsed = parseDocument("---\nnot really frontmatter\n\n# Heading");
    expect(parsed.hadFrontmatter).toBe(false);
    expect(parsed.body).toContain("# Heading");
  });

  it("normalises CRLF", () => {
    expect(parseDocument("---\r\ntype: decision\r\n---\r\n\r\nBody").body).toBe(
      "Body",
    );
  });

  it("reads scalars by type", () => {
    const { data } = parseDocument(
      "---\ncount: 3\nratio: 1.5\npinned: true\nempty:\nnothing: null\n---\n",
    ).frontmatter;

    expect(data).toMatchObject({
      count: 3,
      ratio: 1.5,
      pinned: true,
      empty: null,
      nothing: null,
    });
  });

  it("keeps a date as a string, not a number", () => {
    // "2026-08-11" starts with digits; parsing it as a number would give 2026.
    expect(
      parseDocument("---\ndecided: 2026-08-11\n---\n").frontmatter.data.decided,
    ).toBe("2026-08-11");
  });

  it("keeps a quoted value as a string whatever it looks like", () => {
    const { data } = parseDocument(
      '---\ntitle: "true"\nother: "2026-08-11"\n---\n',
    ).frontmatter;

    expect(data.title).toBe("true");
    expect(data.other).toBe("2026-08-11");
  });

  it("reads both sequence styles", () => {
    expect(
      parseDocument("---\ntags: [alpha, beta]\n---\n").frontmatter.data.tags,
    ).toEqual(["alpha", "beta"]);

    expect(
      parseDocument("---\ntags:\n  - alpha\n  - beta\n---\n").frontmatter.data
        .tags,
    ).toEqual(["alpha", "beta"]);
  });

  it("does not split a flow sequence inside quotes", () => {
    expect(
      parseDocument('---\ntags: ["Chen, Maya", beta]\n---\n').frontmatter.data
        .tags,
    ).toEqual(["Chen, Maya", "beta"]);
  });

  it("preserves lines it does not understand", () => {
    // The vault is the owner's. A plugin's own key must survive us.
    const parsed = parseDocument(
      "---\ntype: decision\n  weird: [nested, thing]\n---\n\nBody",
    );

    expect(parsed.frontmatter.unknown).toContain("  weird: [nested, thing]");
    expect(serializeFrontmatter(parsed.frontmatter)).toContain(
      "  weird: [nested, thing]",
    );
  });
});

describe("serializeFrontmatter", () => {
  it("round-trips what it parsed", () => {
    const source =
      "---\ntype: decision\ntitle: Pick a vendor\nowner: Doug\n---\n";
    const parsed = parseDocument(source);

    expect(`${serializeFrontmatter(parsed.frontmatter)}\n`).toBe(source);
  });

  it("quotes only when leaving it bare would change the meaning", () => {
    const output = serializeFrontmatter({
      data: {
        plain: "Consolidate identity",
        looksBoolean: "true",
        looksNumeric: "42",
        hasColon: "Decision: made",
        hasHash: "budget #3",
      },
      unknown: [],
    });

    expect(output).toContain("plain: Consolidate identity");
    expect(output).toContain('looksBoolean: "true"');
    expect(output).toContain('looksNumeric: "42"');
    expect(output).toContain('hasColon: "Decision: made"');
    expect(output).toContain('hasHash: "budget #3"');
  });

  it("is byte-stable across repeated writes", () => {
    // A phantom diff would make the sync think the file changed and start a
    // needless conflict cycle.
    const frontmatter = { data: { type: "decision", title: "X" }, unknown: [] };
    expect(serializeFrontmatter(frontmatter)).toBe(
      serializeFrontmatter(frontmatter),
    );
  });

  it("omits the fence entirely when there is nothing to write", () => {
    expect(serializeDocument({ data: {}, unknown: [] }, "Just prose")).toBe(
      "Just prose\n",
    );
  });
});

/* ── Obsidian Tasks ───────────────────────────────────────────────────── */

describe("taskToMarkdown", () => {
  it("writes a plain open task", () => {
    expect(taskToMarkdown(task())).toBe("- [ ] Inventory the Okta apps");
  });

  it("marks completion with [x]", () => {
    expect(taskToMarkdown(task({ done: true }))).toBe(
      "- [x] Inventory the Okta apps",
    );
  });

  it("uses the Obsidian Tasks emoji vocabulary", () => {
    const line = taskToMarkdown(
      task({
        priority: "high",
        dueAt: "2026-09-01T12:00:00.000Z",
        owner: "Maya",
        id: "abc-123",
      }),
    );

    expect(line).toBe(
      "- [ ] Inventory the Okta apps 👤 Maya ⏫ 📅 2026-09-01 🆔 abc-123",
    );
  });

  it("tags a draft so it is visibly not live work", () => {
    expect(taskToMarkdown(task({ isDraft: true }))).toContain("#draft");
  });

  it("writes dates without a time, as the plugin expects", () => {
    expect(
      taskToMarkdown(task({ dueAt: "2026-09-01T23:30:00.000Z" })),
    ).toContain("📅 2026-09-01");
  });
});

describe("markdownToTask", () => {
  it("reads a plain task", () => {
    expect(markdownToTask("- [ ] Inventory the Okta apps")).toMatchObject({
      title: "Inventory the Okta apps",
      done: false,
      priority: null,
    });
  });

  it("reads every field back", () => {
    expect(
      markdownToTask(
        "- [x] Inventory the Okta apps 👤 Maya ⏫ 📅 2026-09-01 ✅ 2026-09-02 🆔 abc-123",
      ),
    ).toEqual({
      id: "abc-123",
      title: "Inventory the Okta apps",
      done: true,
      priority: "high",
      dueAt: "2026-09-01T12:00:00.000Z",
      doneAt: "2026-09-02T12:00:00.000Z",
      owner: "Maya",
      isDraft: false,
    });
  });

  it("round-trips every priority", () => {
    for (const priority of ["critical", "high", "normal", "low"] as const) {
      const line = taskToMarkdown(task({ priority }));
      expect(markdownToTask(line)?.priority, line).toBe(priority);
    }
  });

  it("treats the plugin's 'lowest' as low, rather than dropping it", () => {
    expect(markdownToTask("- [ ] Something ⏬")?.priority).toBe("low");
  });

  it("reads a draft tag", () => {
    const parsed = markdownToTask("- [ ] Chase the SOW #draft 👤 Maya");
    expect(parsed?.isDraft).toBe(true);
    expect(parsed?.title).toBe("Chase the SOW");
  });

  it("survives an indented task inside a list", () => {
    expect(markdownToTask("    - [ ] Nested item")?.title).toBe("Nested item");
  });

  it("returns null for anything that is not a task", () => {
    for (const line of [
      "",
      "Just prose",
      "- a bullet",
      "## Heading",
      "- [] malformed",
    ]) {
      expect(markdownToTask(line), line).toBeNull();
    }
  });

  it("ignores a date it cannot read rather than inventing one", () => {
    expect(markdownToTask("- [ ] Something 📅 next Tuesday")?.dueAt).toBeNull();
  });

  it("round-trips a fully populated task", () => {
    const original = task({
      id: "task-1",
      title: "Inventory the Okta apps",
      done: true,
      priority: "critical",
      dueAt: "2026-09-01T12:00:00.000Z",
      doneAt: "2026-09-02T12:00:00.000Z",
      owner: "Maya",
      isDraft: true,
    });

    expect(markdownToTask(taskToMarkdown(original))).toEqual(original);
  });
});

/* ── Wiki-links ───────────────────────────────────────────────────────── */

describe("extractWikiLinks", () => {
  it("finds a plain link", () => {
    expect(extractWikiLinks("See [[Vendor renewal]] for detail")).toEqual([
      { target: "Vendor renewal", alias: null, raw: "[[Vendor renewal]]" },
    ]);
  });

  it("reads an alias", () => {
    expect(extractWikiLinks("[[Vendor renewal|the renewal]]")[0]).toMatchObject(
      {
        target: "Vendor renewal",
        alias: "the renewal",
      },
    );
  });

  it("links to the page, not the heading", () => {
    expect(extractWikiLinks("[[Vendor renewal#Rationale]]")[0].target).toBe(
      "Vendor renewal",
    );
  });

  it("does not link inside code", () => {
    // A note documenting the syntax must not acquire links to imaginary pages.
    expect(extractWikiLinks("Write `[[Page]]` to link")).toEqual([]);
    expect(extractWikiLinks("```\n[[Page]]\n```")).toEqual([]);
  });

  it("de-duplicates repeated links", () => {
    expect(extractWikiLinks("[[A]] and again [[A]]")).toHaveLength(1);
  });

  it("keeps the same target with different aliases", () => {
    expect(extractWikiLinks("[[A]] and [[A|alias]]")).toHaveLength(2);
  });

  it("ignores an empty link", () => {
    expect(extractWikiLinks("[[]] and [[ ]]")).toEqual([]);
  });
});

/* ── Notes ↔ Markdown ─────────────────────────────────────────────────── */

describe("noteToMarkdown", () => {
  it("writes decision and rationale as sibling headings of equal weight", () => {
    // The specification makes them equal anchors. Neither may become a
    // subheading of the other, and neither may be the title.
    const markdown = noteToMarkdown(note());

    expect(markdown).toContain("## Decision");
    expect(markdown).toContain("## Rationale");
    expect(markdown.indexOf("## Decision")).toBeLessThan(
      markdown.indexOf("## Rationale"),
    );
    expect(markdown).not.toContain("### Rationale");
  });

  it("writes the structured frontmatter Obsidian will show", () => {
    const markdown = noteToMarkdown(note());

    expect(markdown).toContain("type: decision");
    expect(markdown).toContain("owner: Doug");
    expect(markdown).toContain("decided: 2026-08-11");
  });

  it("omits sections that are empty rather than leaving bare headings", () => {
    const markdown = noteToMarkdown(
      note({ context: null, rationale: null, decision: "Just this" }),
    );

    expect(markdown).toContain("## Decision");
    expect(markdown).not.toContain("## Rationale");
    expect(markdown).not.toContain("## Context");
  });

  it("writes follow-ups as Obsidian Tasks checkboxes", () => {
    const markdown = noteToMarkdown(
      note({ followUps: [task({ owner: "Maya", isDraft: true })] }),
    );

    expect(markdown).toContain("## Follow-up actions");
    expect(markdown).toContain("- [ ] Inventory the Okta apps #draft 👤 Maya");
  });

  it("ends with exactly one newline", () => {
    // Obsidian and git both care; a drifting trailing newline is a phantom diff.
    const markdown = noteToMarkdown(note());
    expect(markdown.endsWith("\n")).toBe(true);
    expect(markdown.endsWith("\n\n")).toBe(false);
  });
});

describe("markdownToNote", () => {
  it("reads back what it wrote", () => {
    const original = note({
      body: "Some extra prose.",
      followUps: [task({ id: "t1", owner: "Maya", priority: "high" })],
    });

    const parsed = markdownToNote(noteToMarkdown(original));

    expect(parsed.kind).toBe("decision");
    expect(parsed.title).toBe(original.title);
    expect(parsed.decision).toBe(original.decision);
    expect(parsed.rationale).toBe(original.rationale);
    expect(parsed.context).toBe(original.context);
    expect(parsed.owner).toBe("Doug");
    expect(parsed.decidedOn).toBe("2026-08-11");
    expect(parsed.body).toBe("Some extra prose.");
    expect(parsed.followUps).toEqual(original.followUps);
  });

  it("is stable over a second round trip", () => {
    // The property that matters for sync: writing what we read must produce
    // the same bytes, or every sync sees a change.
    const once = noteToMarkdown(note({ body: "Prose", followUps: [task()] }));
    const twice = noteToMarkdown(markdownToNote(once));

    expect(twice).toBe(once);
  });

  it("reads a hand-written note with no frontmatter", () => {
    // The owner writes these in Obsidian on a phone. It has to work.
    const parsed = markdownToNote(
      "# Vendor renewal\n\n## Decision\n\nRenew for one year.\n",
    );

    expect(parsed.title).toBe("Vendor renewal");
    expect(parsed.decision).toBe("Renew for one year.");
    expect(parsed.kind).toBe("freeform");
  });

  it("falls back to the first line when there is no title anywhere", () => {
    expect(markdownToNote("Just some thoughts\n\nMore.").title).toBe(
      "Just some thoughts",
    );
  });

  it("keeps an unrecognised heading in the body, heading and all", () => {
    // Dropping it would lose the owner's own structure.
    const parsed = markdownToNote(
      "# T\n\n## Decision\n\nD\n\n## Attendees\n\nMaya, Sam\n",
    );

    expect(parsed.decision).toBe("D");
    expect(parsed.body).toContain("## Attendees");
    expect(parsed.body).toContain("Maya, Sam");
  });

  it("preserves frontmatter keys it does not know", () => {
    const parsed = markdownToNote(
      "---\ntype: decision\ntitle: T\ncssclass: wide\ntags: [board]\n---\n\nBody",
    );

    expect(parsed.extraFrontmatter.data).toMatchObject({
      cssclass: "wide",
      tags: ["board"],
    });
    expect(noteToMarkdown(parsed)).toContain("cssclass: wide");
  });

  it("survives an empty file", () => {
    const parsed = markdownToNote("");
    expect(parsed.title).toBe("Untitled");
    expect(parsed.kind).toBe("freeform");
  });

  it("treats an unknown type as freeform rather than failing", () => {
    expect(markdownToNote("---\ntype: nonsense\n---\n\nx").kind).toBe(
      "freeform",
    );
  });
});

/* ── Paths ────────────────────────────────────────────────────────────── */

describe("safeFileName", () => {
  it("strips characters Windows refuses", () => {
    expect(safeFileName('Q3: budget <draft> / "final"')).toBe(
      "Q3 budget draft final",
    );
  });

  it("avoids the reserved device names", () => {
    // A file called CON cannot be created on Windows at all.
    expect(safeFileName("CON")).toBe("CON_");
    expect(safeFileName("nul")).toBe("nul_");
  });

  it("drops trailing dots and spaces", () => {
    expect(safeFileName("Decision.")).toBe("Decision");
  });

  it("never returns an empty name", () => {
    expect(safeFileName("///")).toBe("Untitled");
    expect(safeFileName("   ")).toBe("Untitled");
  });

  it("caps the length", () => {
    expect(safeFileName("x".repeat(400)).length).toBeLessThanOrEqual(120);
  });
});

describe("vaultPathFor", () => {
  it("files each kind in its own folder", () => {
    expect(
      vaultPathFor({ kind: "decision", title: "T", decidedOn: "2026-08-11" }),
    ).toBe("Decisions/2026-08-11 T.md");
    expect(
      vaultPathFor({
        kind: "meeting",
        title: "Standup",
        createdAt: "2026-08-11",
      }),
    ).toBe("Meetings/2026-08-11 Standup.md");
  });

  it("omits the date prefix when there is no date", () => {
    expect(vaultPathFor({ kind: "freeform", title: "Scratch" })).toBe(
      "Notes/Scratch.md",
    );
  });
});
