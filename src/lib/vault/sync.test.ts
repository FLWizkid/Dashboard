import { describe, expect, it } from "vitest";

import { noteToMarkdown, type NoteDocument } from "@/lib/notes/markdown";

import { hashContent } from "./reconcile";
import {
  syncVault,
  type RecordFileInput,
  type SyncNote,
  type VaultFileOnDisk,
  type VaultFileRecord,
  type VaultSyncPorts,
} from "./sync";

/**
 * The sync job.
 *
 * `reconcile.test.ts` covers what *should* happen to one file. This covers
 * what the job actually does with those answers, and the rule it exists to
 * protect is the same one: **no edit is ever lost.**
 */

const NOW = new Date("2026-08-10T09:00:00.000Z");

function doc(over: Partial<NoteDocument> = {}): NoteDocument {
  return {
    kind: "decision",
    title: "Vendor renewal",
    decision: "Renew for one year",
    rationale: "Migration cost exceeds the saving",
    context: null,
    owner: null,
    decidedOn: "2026-08-01",
    body: "",
    followUps: [],
    extraFrontmatter: { data: {}, unknown: [] },
    ...over,
  };
}

interface WorldOptions {
  files?: VaultFileOnDisk[];
  notes?: SyncNote[];
  records?: VaultFileRecord[];
}

/**
 * An in-memory vault and note store.
 *
 * Every port is recorded, because half of what this suite asserts is about
 * calls that must *not* have happened.
 */
function world(options: WorldOptions = {}) {
  const files = new Map(
    (options.files ?? []).map((file) => [file.path, { ...file }]),
  );
  const notes = new Map(
    (options.notes ?? []).map((note) => [note.id, { ...note }]),
  );
  const records = new Map(
    (options.records ?? []).map((record) => [record.path, { ...record }]),
  );

  const log: string[] = [];
  const recorded: RecordFileInput[] = [];
  let nextId = 1;

  /**
   * What the `notes` table can actually hold.
   *
   * The columns are the structured fields and `body` — there is no place for
   * a parsed follow-up list or for unrecognised frontmatter. A fake that kept
   * them in memory would let the sync appear lossless while the real database
   * quietly discarded them, so this twin discards them too.
   */
  const asStored = (document: NoteDocument): NoteDocument => ({
    ...document,
    followUps: [],
    extraFrontmatter: { data: {}, unknown: [] },
  });

  const ports: VaultSyncPorts = {
    async ensureVault() {},
    async readVault() {
      return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
    },
    async writeFile(path, content) {
      log.push(`write ${path}`);
      files.set(path, { path, content });
    },
    async deleteFile(path) {
      log.push(`delete ${path}`);
      files.delete(path);
    },
    async listNotes() {
      return [...notes.values()];
    },
    async listFileRecords() {
      return [...records.values()];
    },
    async createNote(path, document) {
      const id = `note-${nextId++}`;
      log.push(`create ${id} from ${path}`);
      notes.set(id, {
        id,
        vaultPath: path,
        version: 1,
        isArchived: false,
        document: asStored(document),
      });
      return { id, version: 1 };
    },
    async updateNote(id, document) {
      log.push(`update ${id}`);
      const existing = notes.get(id);
      const version = (existing?.version ?? 0) + 1;
      if (existing) {
        notes.set(id, { ...existing, document: asStored(document), version });
      }
      return { version };
    },
    async archiveNote(id) {
      log.push(`archive ${id}`);
      const existing = notes.get(id);
      if (existing) notes.set(id, { ...existing, isArchived: true });
    },
    async setNotePath(id, path) {
      const existing = notes.get(id);
      if (existing) notes.set(id, { ...existing, vaultPath: path });
    },
    async recordFile(input) {
      recorded.push(input);
      records.set(input.path, {
        path: input.path,
        noteId: input.noteId,
        syncedHash: input.hash,
        syncedVersion: input.version,
      });
    },
    async forgetFile(path) {
      records.delete(path);
    },
  };

  return { ports, files, notes, records, log, recorded };
}

describe("a note that has never been written out", () => {
  it("appears in the vault", async () => {
    const w = world({
      notes: [
        {
          id: "n1",
          vaultPath: null,
          version: 1,
          isArchived: false,
          document: doc(),
        },
      ],
    });

    await syncVault(w.ports, NOW);

    expect([...w.files.keys()]).toEqual([
      "Decisions/2026-08-01 Vendor renewal.md",
    ]);
  });

  it("has its path recorded, so the next pass does not write it again", async () => {
    const w = world({
      notes: [
        {
          id: "n1",
          vaultPath: null,
          version: 1,
          isArchived: false,
          document: doc(),
        },
      ],
    });

    await syncVault(w.ports, NOW);
    const first = w.log.length;
    await syncVault(w.ports, NOW);

    expect(w.log.length).toBe(first);
  });

  it("does not write an archived note at all", async () => {
    const w = world({
      notes: [
        {
          id: "n1",
          vaultPath: null,
          version: 1,
          isArchived: true,
          document: doc(),
        },
      ],
    });

    await syncVault(w.ports, NOW);
    expect(w.files.size).toBe(0);
  });

  it("suffixes rather than colliding when two notes share a title", async () => {
    // The database's unique index on vault_path would reject the second, and
    // "the sync stopped working" is a poor way to learn you reused a title.
    const w = world({
      notes: [
        {
          id: "n1",
          vaultPath: null,
          version: 1,
          isArchived: false,
          document: doc({ title: "Weekly sync", kind: "meeting" }),
        },
        {
          id: "n2",
          vaultPath: null,
          version: 1,
          isArchived: false,
          document: doc({ title: "Weekly sync", kind: "meeting" }),
        },
      ],
    });

    await syncVault(w.ports, NOW);
    expect(w.files.size).toBe(2);
  });
});

describe("a file the app has never seen", () => {
  it("becomes a note", async () => {
    const w = world({
      files: [
        {
          path: "Notes/From Obsidian.md",
          content: "# From Obsidian\n\nWritten on the phone.\n",
        },
      ],
    });

    await syncVault(w.ports, NOW);

    expect(w.log).toContain("create note-1 from Notes/From Obsidian.md");
  });

  it("is not imported twice on the next pass", async () => {
    const w = world({
      files: [{ path: "Notes/From Obsidian.md", content: "# Hello\n" }],
    });

    await syncVault(w.ports, NOW);
    await syncVault(w.ports, NOW);

    expect(w.notes.size).toBe(1);
  });
});

describe("follow-up checkboxes", () => {
  const withFollowUps = [
    "# Inventory",
    "",
    "Some prose.",
    "",
    "- [ ] Inventory the Okta apps 👤 Maya ⏫ 📅 2026-09-01",
    "",
  ].join("\n");

  it("survives an import and a re-render", async () => {
    // These lines stay in the note's body rather than being lifted into a
    // structured list, which is what makes the round trip lossless: `tasks`
    // carries no reference to the note it came from, so anything lifted out
    // would have nowhere to come back from and would quietly vanish from the
    // vault the first time the app rewrote the file.
    const w = world({
      files: [{ path: "Notes/Inventory.md", content: withFollowUps }],
    });

    await syncVault(w.ports, NOW);

    const created = [...w.notes.values()][0];
    expect(noteToMarkdown(created.document)).toContain(
      "- [ ] Inventory the Okta apps",
    );
  });

  it("is still there after the app edits the note", async () => {
    const w = world({
      files: [{ path: "Notes/Inventory.md", content: withFollowUps }],
    });

    await syncVault(w.ports, NOW);

    // The app touches the note; the next pass writes the app's rendering out.
    const note = [...w.notes.values()][0];
    w.notes.set(note.id, { ...note, version: note.version + 1 });
    await syncVault(w.ports, NOW);

    const file = [...w.files.values()].find((f) => f.path.startsWith("Notes/"));
    expect(file?.content).toContain("- [ ] Inventory the Okta apps");
  });
});

describe("when both sides changed", () => {
  it("keeps the vault's bytes verbatim in a conflict copy", async () => {
    const document = doc();
    const appContent = noteToMarkdown(document);
    const path = "Decisions/2026-08-01 Vendor renewal.md";

    const w = world({
      notes: [
        { id: "n1", vaultPath: path, version: 3, isArchived: false, document },
      ],
      files: [{ path, content: "# Edited on the phone\n\nDifferent.\n" }],
      records: [
        {
          path,
          noteId: "n1",
          // Neither side matches what sync last saw.
          syncedHash: hashContent("something else entirely"),
          syncedVersion: 2,
        },
      ],
    });

    await syncVault(w.ports, NOW);

    const conflict = [...w.files.keys()].find((p) =>
      p.startsWith("Conflicts/"),
    );
    expect(conflict).toBeDefined();
    expect(w.files.get(conflict!)?.content).toBe(
      "# Edited on the phone\n\nDifferent.\n",
    );
    // And the app's version holds the original filename.
    expect(w.files.get(path)?.content).toBe(appContent);
  });

  it("writes the losing copy before overwriting the original", async () => {
    // If the process dies between the two writes, the vault should have an
    // extra file rather than a missing one.
    const document = doc();
    const path = "Decisions/2026-08-01 Vendor renewal.md";

    const w = world({
      notes: [
        { id: "n1", vaultPath: path, version: 3, isArchived: false, document },
      ],
      files: [{ path, content: "phone edit\n" }],
      records: [
        {
          path,
          noteId: "n1",
          syncedHash: hashContent("old"),
          syncedVersion: 2,
        },
      ],
    });

    await syncVault(w.ports, NOW);

    const writes = w.log.filter((line) => line.startsWith("write "));
    expect(writes[0]).toMatch(/^write Conflicts\//);
  });
});

describe("deletion is not symmetric", () => {
  it("deleting the note removes the file", async () => {
    const path = "Notes/Gone.md";
    const w = world({
      files: [{ path, content: "# Gone\n" }],
      records: [
        {
          path,
          noteId: "n1",
          syncedHash: hashContent("# Gone\n"),
          syncedVersion: 1,
        },
      ],
    });

    await syncVault(w.ports, NOW);

    expect(w.files.has(path)).toBe(false);
  });

  it("deleting the file archives the note instead of destroying it", async () => {
    // Sync clients delete files by accident far more often than people delete
    // decisions on purpose.
    const document = doc();
    const path = "Decisions/2026-08-01 Vendor renewal.md";
    const content = noteToMarkdown(document);

    const w = world({
      notes: [
        { id: "n1", vaultPath: path, version: 1, isArchived: false, document },
      ],
      records: [
        {
          path,
          noteId: "n1",
          syncedHash: hashContent(content),
          syncedVersion: 1,
        },
      ],
    });

    await syncVault(w.ports, NOW);

    expect(w.log).toContain("archive n1");
    expect(w.notes.get("n1")?.isArchived).toBe(true);
  });

  it("restores the file when the app moved on since it was written", async () => {
    const document = doc();
    const path = "Decisions/2026-08-01 Vendor renewal.md";

    const w = world({
      notes: [
        { id: "n1", vaultPath: path, version: 5, isArchived: false, document },
      ],
      records: [
        {
          path,
          noteId: "n1",
          syncedHash: hashContent("old"),
          syncedVersion: 1,
        },
      ],
    });

    await syncVault(w.ports, NOW);

    expect(w.files.has(path)).toBe(true);
    expect(w.log).not.toContain("archive n1");
  });
});

describe("renaming a note", () => {
  it("moves the file and leaves nothing behind", async () => {
    const oldPath = "Decisions/2026-08-01 Vendor renewal.md";
    const document = doc({ title: "Vendor renewal (revised)" });
    const w = world({
      notes: [
        {
          id: "n1",
          vaultPath: oldPath,
          version: 2,
          isArchived: false,
          document,
        },
      ],
      files: [{ path: oldPath, content: noteToMarkdown(document) }],
      records: [
        {
          path: oldPath,
          noteId: "n1",
          syncedHash: hashContent(noteToMarkdown(document)),
          syncedVersion: 2,
        },
      ],
    });

    await syncVault(w.ports, NOW);

    expect(w.files.has(oldPath)).toBe(false);
    expect(
      w.files.has("Decisions/2026-08-01 Vendor renewal (revised).md"),
    ).toBe(true);
  });

  it("waits rather than moving a file that has unread changes", async () => {
    // The move is a delete and a create. Doing it before taking the file's
    // edit would throw the edit away.
    const oldPath = "Decisions/2026-08-01 Vendor renewal.md";
    const document = doc({ title: "Vendor renewal (revised)" });

    const w = world({
      notes: [
        {
          id: "n1",
          vaultPath: oldPath,
          version: 2,
          isArchived: false,
          document,
        },
      ],
      files: [
        { path: oldPath, content: "# Edited in Obsidian\n\nNew text.\n" },
      ],
      records: [
        {
          path: oldPath,
          noteId: "n1",
          syncedHash: hashContent("whatever was there before"),
          syncedVersion: 2,
        },
      ],
    });

    await syncVault(w.ports, NOW);

    expect(w.log).toContain("update n1");
    expect(w.log).not.toContain(`delete ${oldPath}`);
  });
});

describe("the report", () => {
  it("says nothing changed when nothing changed", async () => {
    const document = doc();
    const path = "Decisions/2026-08-01 Vendor renewal.md";
    const content = noteToMarkdown(document);

    const w = world({
      notes: [
        { id: "n1", vaultPath: path, version: 1, isArchived: false, document },
      ],
      files: [{ path, content }],
      records: [
        {
          path,
          noteId: "n1",
          syncedHash: hashContent(content),
          syncedVersion: 1,
        },
      ],
    });

    const report = await syncVault(w.ports, NOW);

    expect(report.changed).toBe(0);
    expect(report.conflicts).toBe(0);
    expect(report.errors).toEqual([]);
  });

  it("records a failure against the path instead of abandoning the run", async () => {
    // One unwritable file must not stop the other forty from syncing.
    const w = world({
      notes: [
        {
          id: "n1",
          vaultPath: "Notes/Locked.md",
          version: 2,
          isArchived: false,
          document: doc({ title: "Locked", kind: "freeform" }),
        },
        {
          id: "n2",
          vaultPath: null,
          version: 1,
          isArchived: false,
          document: doc({ title: "Fine", kind: "freeform" }),
        },
      ],
    });

    const write = w.ports.writeFile;
    w.ports.writeFile = async (path, content) => {
      if (path === "Notes/Locked.md") throw new Error("EACCES");
      return write(path, content);
    };

    const report = await syncVault(w.ports, NOW);

    expect(report.errors).toEqual([
      { path: "Notes/Locked.md", message: "EACCES" },
    ]);
    expect(w.files.has("Notes/2026-08-01 Fine.md")).toBe(true);
  });
});
