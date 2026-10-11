import { beforeEach, describe, expect, it } from "vitest";

import { excerptAround, linkableText } from "./repository";
import {
  memoryNoteRepository as repo,
  resetMemoryNoteStore,
} from "./repository.memory";
import type { CreateNotePayload } from "./schema";

/**
 * The two behaviours that look like bugs until you know why they are there:
 *
 *   A **decision note saves without its rationale.** You capture the decision
 *   in the meeting and write down why afterwards; refusing the save would lose
 *   the decision entirely. Incomplete is a marked state, not an error.
 *
 *   A **wiki-link to a page that does not exist is valid**, and resolves by
 *   itself the moment that page is written. Obsidian works this way and so
 *   does thinking — the unresolved link is a note you have decided you owe
 *   yourself.
 *
 * Both are exactly what a later refactor would "tidy up", so both are pinned
 * here as well as in the E2E suite.
 */

const LIST = { includeArchived: false, limit: 100 } as const;

function note(partial: Partial<CreateNotePayload> = {}): CreateNotePayload {
  return {
    kind: "freeform",
    title: "Untitled",
    decision: null,
    rationale: null,
    context: null,
    owner: null,
    decidedOn: null,
    body: "",
    links: [],
    ...partial,
  };
}

beforeEach(() => {
  resetMemoryNoteStore();
});

describe("decision completeness", () => {
  it("saves a decision note that has no rationale, and marks it incomplete", async () => {
    const saved = await repo.createNote(
      note({
        kind: "decision",
        title: "Retire the legacy VPN",
        decision: "We retire it at the end of Q3.",
      }),
    );

    expect(saved.id).toBeTruthy();
    expect(saved.isCompleteDecision).toBe(false);
  });

  it("becomes complete once the reasoning is filled in", async () => {
    const saved = await repo.createNote(
      note({ kind: "decision", title: "Adopt Tailscale", decision: "Yes." }),
    );

    const updated = await repo.updateNote(saved.id, {
      rationale: "Nothing is exposed publicly and the ACLs are auditable.",
    });

    expect(updated.isCompleteDecision).toBe(true);
  });

  it("treats whitespace as absent", async () => {
    const saved = await repo.createNote(
      note({
        kind: "decision",
        title: "Whitespace",
        decision: "Something.",
        rationale: "   \n  ",
      }),
    );

    expect(saved.isCompleteDecision).toBe(false);
  });

  it("does not mark a non-decision note incomplete for lacking a decision", async () => {
    const saved = await repo.createNote(
      note({ kind: "meeting", title: "Weekly sync" }),
    );

    expect(saved.isCompleteDecision).toBe(true);
  });
});

describe("wiki-links", () => {
  it("records a link to a page that does not exist as unresolved", async () => {
    const saved = await repo.createNote(
      note({ title: "Q3 planning", body: "Superseded by [[Q4 planning]]." }),
    );

    expect(saved.links).toHaveLength(1);
    expect(saved.links[0]).toMatchObject({
      kind: "note",
      targetLabel: "Q4 planning",
      targetNoteId: null,
    });
  });

  it("resolves that link when the page is finally written", async () => {
    const source = await repo.createNote(
      note({ title: "Q3 planning", body: "Superseded by [[Q4 planning]]." }),
    );

    const target = await repo.createNote(note({ title: "Q4 planning" }));

    const reloaded = await repo.getNote(source.id);
    expect(reloaded?.links[0].targetNoteId).toBe(target.id);
  });

  it("matches titles case- and punctuation-insensitively", async () => {
    await repo.createNote(note({ title: "Vendor Renewal" }));
    const source = await repo.createNote(
      note({ title: "Board pack", body: "See [[vendor renewal]]." }),
    );

    expect(source.links[0].targetNoteId).not.toBeNull();
  });

  it("does not link a note to itself", async () => {
    const saved = await repo.createNote(
      note({ title: "Self", body: "A reference to [[Self]]." }),
    );

    expect(saved.links[0].targetNoteId).toBeNull();
  });

  it("unresolves inbound links when the target is deleted, rather than dropping them", async () => {
    const target = await repo.createNote(note({ title: "Doomed" }));
    const source = await repo.createNote(
      note({ title: "Survivor", body: "Refers to [[Doomed]]." }),
    );
    expect(source.links[0].targetNoteId).toBe(target.id);

    await repo.deleteNote(target.id);

    // The prose still says `[[Doomed]]`. Removing the link would make the
    // index disagree with the file, which is the one state worth avoiding.
    const reloaded = await repo.getNote(source.id);
    expect(reloaded?.links).toHaveLength(1);
    expect(reloaded?.links[0].targetNoteId).toBeNull();
  });

  it("rebuilds links from the text on every save", async () => {
    const saved = await repo.createNote(
      note({ title: "Moving target", body: "Links to [[One]]." }),
    );
    expect(saved.links.map((l) => l.targetLabel)).toEqual(["One"]);

    const updated = await repo.updateNote(saved.id, {
      body: "Links to [[Two]] now.",
    });

    // Not additive: the prose is the truth, and a link table that only ever
    // grows would keep claiming links the note no longer makes.
    expect(updated.links.map((l) => l.targetLabel)).toEqual(["Two"]);
  });

  it("ignores links inside code, so a note about the syntax is not a link", async () => {
    const saved = await repo.createNote(
      note({ title: "Syntax", body: "Write `[[Page]]` to link a page." }),
    );

    expect(saved.links).toHaveLength(0);
  });
});

describe("backlinks", () => {
  it("reports who links here, with the line the link is on", async () => {
    const target = await repo.createNote(
      note({ title: "Vendor consolidation" }),
    );
    await repo.createNote(
      note({
        title: "Renewal decision",
        body: "Part of [[Vendor consolidation]] — three contracts become one.",
      }),
    );

    const backlinks = await repo.backlinksFor(target.id);

    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].title).toBe("Renewal decision");
    expect(backlinks[0].excerpt).toContain("three contracts become one");
  });

  it("counts inbound links in the list, so gaps are visible without opening each note", async () => {
    const target = await repo.createNote(note({ title: "Hub" }));
    await repo.createNote(note({ title: "A", body: "[[Hub]]" }));
    await repo.createNote(note({ title: "B", body: "[[Hub]]" }));

    const list = await repo.listNotes(LIST);
    const hub = list.find((item) => item.id === target.id);

    expect(hub?.backlinkCount).toBe(2);
  });
});

describe("versioning", () => {
  it("bumps the version on every application-side edit", async () => {
    const saved = await repo.createNote(note({ title: "Versioned" }));
    expect(saved.version).toBe(1);

    const once = await repo.updateNote(saved.id, { body: "one" });
    const twice = await repo.updateNote(saved.id, { body: "two" });

    // The reconciler compares this against the version recorded when the file
    // and the app last agreed; without it, "the app changed" is unanswerable
    // without trusting timestamps.
    expect(once.version).toBe(2);
    expect(twice.version).toBe(3);
  });

  it("gives every note a vault path under its kind's folder", async () => {
    const saved = await repo.createNote(
      note({
        kind: "decision",
        title: "Vendor renewal",
        decidedOn: "2026-08-11",
      }),
    );

    expect(saved.vaultPath).toBe("Decisions/2026-08-11 Vendor renewal.md");
  });
});

describe("listing", () => {
  it("hides archived notes unless asked", async () => {
    const saved = await repo.createNote(note({ title: "Old business" }));
    await repo.updateNote(saved.id, { isArchived: true });

    expect(await repo.listNotes(LIST)).toHaveLength(0);
    expect(
      await repo.listNotes({ ...LIST, includeArchived: true }),
    ).toHaveLength(1);
  });

  it("keeps archived notes out of the autocomplete", async () => {
    const saved = await repo.createNote(note({ title: "Retired page" }));
    await repo.updateNote(saved.id, { isArchived: true });

    expect(await repo.titles()).toHaveLength(0);
  });

  it("filters by kind", async () => {
    await repo.createNote(note({ kind: "decision", title: "A decision" }));
    await repo.createNote(note({ kind: "meeting", title: "A meeting" }));

    const decisions = await repo.listNotes({ ...LIST, kind: "decision" });
    expect(decisions.map((item) => item.title)).toEqual(["A decision"]);
  });
});

describe("helpers", () => {
  it("linkableText excludes nothing the reader would call content", () => {
    const text = linkableText({
      decision: "D",
      rationale: "R",
      context: "C",
      body: "B",
    });

    expect(text).toContain("D");
    expect(text).toContain("R");
    expect(text).toContain("C");
    expect(text).toContain("B");
  });

  it("excerptAround returns null when the label isn't in the text", () => {
    expect(excerptAround("nothing here", "Missing")).toBeNull();
  });

  it("excerptAround truncates a very long line", () => {
    const line = `Start ${"x".repeat(400)} [[Target]] end`;
    const excerpt = excerptAround(line, "Target");

    expect(excerpt).not.toBeNull();
    expect(excerpt!.length).toBeLessThanOrEqual(240);
    expect(excerpt!.endsWith("…")).toBe(true);
  });
});
