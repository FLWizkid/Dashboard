import { describe, expect, it } from "vitest";

import {
  backlinksFor,
  buildBacklinkIndex,
  forwardLinksFor,
  titleKey,
  unresolvedLinks,
  type IndexedNote,
} from "./backlinks";

const note = (id: string, title: string, text = ""): IndexedNote => ({
  id,
  title,
  searchableText: text,
});

describe("titleKey", () => {
  it("ignores case and surrounding whitespace", () => {
    expect(titleKey("  Vendor Renewal ")).toBe(titleKey("vendor renewal"));
  });

  it("ignores a date prefix from the filename", () => {
    expect(titleKey("2026-08-11 Vendor renewal")).toBe(
      titleKey("Vendor renewal"),
    );
  });

  it("ignores the .md extension", () => {
    expect(titleKey("Vendor renewal.md")).toBe(titleKey("Vendor renewal"));
  });

  it("collapses internal whitespace", () => {
    expect(titleKey("Vendor   renewal")).toBe(titleKey("Vendor renewal"));
  });
});

describe("buildBacklinkIndex", () => {
  it("resolves a link and records it at both ends", () => {
    const index = buildBacklinkIndex([
      note("a", "Q3 planning", "See [[Vendor renewal]] for detail"),
      note("b", "Vendor renewal"),
    ]);

    expect(forwardLinksFor(index, "a")).toEqual(["b"]);
    expect(backlinksFor(index, "b")).toEqual(["a"]);
  });

  it("records a link to a page that does not exist yet", () => {
    // Obsidian lets you link before you write, and that is how people think:
    // mention the thing, create it later.
    const index = buildBacklinkIndex([
      note("a", "Q3 planning", "Blocked on [[Board approval]]"),
    ]);

    expect(index.links[0].toNoteId).toBeNull();
    expect(unresolvedLinks(index)).toEqual([
      { label: "board approval", mentionedBy: ["a"] },
    ]);
  });

  it("resolves the moment the target appears", () => {
    const before = buildBacklinkIndex([note("a", "Q3", "[[Vendor renewal]]")]);
    expect(before.links[0].toNoteId).toBeNull();

    const after = buildBacklinkIndex([
      note("a", "Q3", "[[Vendor renewal]]"),
      note("b", "Vendor renewal"),
    ]);
    expect(after.links[0].toNoteId).toBe("b");
    expect(after.unresolved.size).toBe(0);
  });

  it("matches titles the way a person means them", () => {
    const index = buildBacklinkIndex([
      note("a", "Q3", "[[vendor   RENEWAL]]"),
      note("b", "2026-08-11 Vendor renewal"),
    ]);

    expect(forwardLinksFor(index, "a")).toEqual(["b"]);
  });

  it("resolves through an alias", () => {
    const index = buildBacklinkIndex([
      note("a", "Q3", "[[The renewal]]"),
      { ...note("b", "Vendor renewal"), aliases: ["The renewal"] },
    ]);

    expect(forwardLinksFor(index, "a")).toEqual(["b"]);
  });

  it("keeps a display alias without changing the target", () => {
    const index = buildBacklinkIndex([
      note("a", "Q3", "[[Vendor renewal|that thing]]"),
      note("b", "Vendor renewal"),
    ]);

    expect(index.links[0]).toMatchObject({
      label: "Vendor renewal",
      alias: "that thing",
      toNoteId: "b",
    });
  });

  it("does not record a note linking to itself", () => {
    // Self-links are noise, not backlinks.
    const index = buildBacklinkIndex([note("a", "Q3", "See [[Q3]]")]);

    expect(index.links).toEqual([]);
    expect(backlinksFor(index, "a")).toEqual([]);
  });

  it("does not follow links inside code", () => {
    const index = buildBacklinkIndex([
      note("a", "Syntax", "Write `[[Page]]` to link"),
      note("b", "Page"),
    ]);

    expect(index.links).toEqual([]);
  });

  it("de-duplicates a backlink from the same note", () => {
    const index = buildBacklinkIndex([
      note("a", "Q3", "[[Vendor renewal]] and again [[Vendor renewal]]"),
      note("b", "Vendor renewal"),
    ]);

    expect(backlinksFor(index, "b")).toEqual(["a"]);
  });

  it("collects several notes linking to the same target", () => {
    const index = buildBacklinkIndex([
      note("a", "Q3", "[[Vendor renewal]]"),
      note("b", "Board prep", "[[Vendor renewal]]"),
      note("c", "Vendor renewal"),
    ]);

    expect(backlinksFor(index, "c").sort()).toEqual(["a", "b"]);
  });

  it("does not let a duplicate title steal existing links", () => {
    // First writer wins, so adding a second note called the same thing does
    // not silently redirect every link that already resolved.
    const index = buildBacklinkIndex([
      note("first", "Vendor renewal"),
      note("second", "Vendor renewal"),
      note("c", "Q3", "[[Vendor renewal]]"),
    ]);

    expect(forwardLinksFor(index, "c")).toEqual(["first"]);
  });

  it("handles an empty vault", () => {
    const index = buildBacklinkIndex([]);
    expect(index.links).toEqual([]);
    expect(backlinksFor(index, "missing")).toEqual([]);
    expect(forwardLinksFor(index, "missing")).toEqual([]);
  });

  it("is deterministic", () => {
    const notes = [
      note("a", "Q3", "[[B]] [[C]]"),
      note("b", "B"),
      note("c", "C"),
    ];

    expect(buildBacklinkIndex(notes).links).toEqual(
      buildBacklinkIndex(notes).links,
    );
  });
});
