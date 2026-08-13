import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  markdownToNote,
  noteToMarkdown,
  vaultPathFor,
  type NoteDocument,
} from "@/lib/notes/markdown";
import {
  deleteVaultFile,
  ensureVault,
  readVault,
  readVaultFile,
  resolveInVault,
  VaultPathError,
  writeVaultFile,
} from "@/lib/vault/fs";
import {
  hashContent,
  reconcile,
  type NoteState,
  type SyncedState,
} from "@/lib/vault/reconcile";

/**
 * The vault, against a real filesystem.
 *
 * The gate for this phase is "the vault round-trips cleanly", and that is not
 * something a mocked filesystem can tell you: atomic renames, path escapes and
 * line-ending drift are all properties of the disk.
 */

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cio-vault-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const decision = (over: Partial<NoteDocument> = {}): NoteDocument => ({
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

/* ── Layout ───────────────────────────────────────────────────────────── */

describe("vault layout", () => {
  it("creates a folder Obsidian can open", async () => {
    await ensureVault(root);

    for (const folder of [
      "Decisions",
      "Meetings",
      "Follow-ups",
      "Actions",
      "Notes",
      "Conflicts",
    ]) {
      await expect(stat(join(root, folder))).resolves.toBeDefined();
    }

    const readme = await readFile(join(root, "README.md"), "utf8");
    expect(readme).toContain("Obsidian");
    expect(readme).toContain("Decision and Rationale are equal anchors");
  });

  it("does not create .obsidian — Obsidian writes its own", async () => {
    // Pre-empting it with a partial configuration is how you get a vault with
    // broken settings.
    await ensureVault(root);
    await expect(stat(join(root, ".obsidian"))).rejects.toThrow();
  });

  it("does not overwrite a README the owner has edited", async () => {
    await ensureVault(root);
    await writeFile(
      join(root, "README.md"),
      "My own notes about this folder",
      "utf8",
    );
    await ensureVault(root);

    expect(await readFile(join(root, "README.md"), "utf8")).toBe(
      "My own notes about this folder",
    );
  });

  it("is idempotent", async () => {
    await ensureVault(root);
    await expect(ensureVault(root)).resolves.toBeUndefined();
  });
});

/* ── Path safety ──────────────────────────────────────────────────────── */

describe("path safety", () => {
  it("refuses to escape the vault", async () => {
    // A note title is user input and it becomes a filename.
    for (const path of [
      "../outside.md",
      "Decisions/../../outside.md",
      "/etc/passwd",
      "..",
    ]) {
      expect(() => resolveInVault(root, path), path).toThrow(VaultPathError);
    }
  });

  it("refuses a null byte", () => {
    expect(() => resolveInVault(root, "Notes/a\0b.md")).toThrow(VaultPathError);
  });

  it("allows an ordinary path", () => {
    expect(resolveInVault(root, "Decisions/A.md")).toBe(
      join(root, "Decisions/A.md"),
    );
  });

  it("blocks an escaping write before it touches the disk", async () => {
    await ensureVault(root);
    await expect(writeVaultFile(root, "../escaped.md", "x")).rejects.toThrow(
      VaultPathError,
    );
  });
});

/* ── Round trip ───────────────────────────────────────────────────────── */

describe("round trip", () => {
  it("a decision note survives a full trip through the disk unchanged", async () => {
    await ensureVault(root);

    const original = decision({
      body: "Some extra prose the owner added.",
      followUps: [
        {
          id: "task-1",
          title: "Inventory the Okta apps",
          done: false,
          priority: "high",
          dueAt: "2026-09-01T12:00:00.000Z",
          doneAt: null,
          owner: "Maya",
          isDraft: true,
        },
      ],
    });

    const path = vaultPathFor(original);
    const rendered = noteToMarkdown(original);

    await writeVaultFile(root, path, rendered);

    const onDisk = await readVaultFile(root, path);
    expect(onDisk).not.toBeNull();

    const parsed = markdownToNote(onDisk!.content);

    expect(parsed.kind).toBe(original.kind);
    expect(parsed.title).toBe(original.title);
    expect(parsed.decision).toBe(original.decision);
    expect(parsed.rationale).toBe(original.rationale);
    expect(parsed.context).toBe(original.context);
    expect(parsed.owner).toBe(original.owner);
    expect(parsed.decidedOn).toBe(original.decidedOn);
    expect(parsed.body).toBe(original.body);
    expect(parsed.followUps).toEqual(original.followUps);

    // And re-rendering produces identical bytes, which is what stops the sync
    // seeing a phantom edit on every pass.
    expect(noteToMarkdown(parsed)).toBe(rendered);
  });

  it("files each kind in its own folder and finds them all again", async () => {
    await ensureVault(root);

    const notes: NoteDocument[] = [
      decision({ title: "A decision" }),
      decision({
        kind: "meeting",
        title: "Standup",
        decision: null,
        rationale: null,
      }),
      decision({
        kind: "freeform",
        title: "Scratch",
        decision: null,
        rationale: null,
        decidedOn: null,
      }),
    ];

    for (const note of notes) {
      await writeVaultFile(root, vaultPathFor(note), noteToMarkdown(note));
    }

    const files = await readVault(root);
    expect(files.map((file) => file.path)).toEqual([
      "Decisions/2026-08-11 A decision.md",
      "Meetings/2026-08-11 Standup.md",
      "Notes/Scratch.md",
    ]);
  });

  it("ignores folders it does not manage", async () => {
    // The owner's own folders are none of our business.
    await ensureVault(root);
    await writeVaultFile(root, "Notes/mine.md", "# Mine\n");
    await writeFile(join(root, "README.md"), "# Readme\n", "utf8");

    const paths = (await readVault(root)).map((file) => file.path);
    expect(paths).toEqual(["Notes/mine.md"]);
  });

  it("ignores non-Markdown files", async () => {
    await ensureVault(root);
    await writeFile(join(root, "Notes", "image.png"), "not markdown", "utf8");
    await writeVaultFile(root, "Notes/real.md", "# Real\n");

    expect((await readVault(root)).map((f) => f.path)).toEqual([
      "Notes/real.md",
    ]);
  });

  it("reads a note a person wrote by hand in Obsidian", async () => {
    // The owner writes these on a phone. No frontmatter, headings in their
    // own order — it still has to come back as a note.
    await ensureVault(root);
    await writeFile(
      join(root, "Decisions", "Hand written.md"),
      "# Renew the SOW\n\n## Rationale\n\nCheaper than switching.\n\n## Decision\n\nRenew for a year.\n",
      "utf8",
    );

    const file = await readVaultFile(root, "Decisions/Hand written.md");
    const parsed = markdownToNote(file!.content);

    expect(parsed.title).toBe("Renew the SOW");
    expect(parsed.decision).toBe("Renew for a year.");
    expect(parsed.rationale).toBe("Cheaper than switching.");
  });

  it("normalises CRLF so a Windows round trip is not an edit", async () => {
    await ensureVault(root);
    await writeFile(
      join(root, "Notes", "windows.md"),
      "---\r\ntype: freeform\r\ntitle: Windows\r\n---\r\n\r\n# Windows\r\n\r\n## Notes\r\n\r\nText\r\n",
      "utf8",
    );

    const file = await readVaultFile(root, "Notes/windows.md");
    const parsed = markdownToNote(file!.content);

    expect(parsed.title).toBe("Windows");
    expect(parsed.body).toBe("Text");
    // The hash ignores line endings, so this is not seen as a change.
    expect(hashContent(file!.content)).toBe(
      hashContent(file!.content.replace(/\r\n/g, "\n")),
    );
  });
});

/* ── Writing ──────────────────────────────────────────────────────────── */

describe("writing", () => {
  it("leaves no temporary files behind", async () => {
    await ensureVault(root);
    await writeVaultFile(root, "Notes/a.md", "# A\n");

    const paths = (await readVault(root)).map((file) => file.path);
    expect(paths.some((path) => path.endsWith(".tmp"))).toBe(false);
    expect(paths).toEqual(["Notes/a.md"]);
  });

  it("creates missing directories", async () => {
    await writeVaultFile(root, "Decisions/deep.md", "# Deep\n");
    expect((await readVaultFile(root, "Decisions/deep.md"))?.content).toBe(
      "# Deep\n",
    );
  });

  it("overwrites cleanly", async () => {
    await writeVaultFile(root, "Notes/a.md", "first");
    await writeVaultFile(root, "Notes/a.md", "second");

    expect((await readVaultFile(root, "Notes/a.md"))?.content).toBe("second");
  });

  it("treats deleting a missing file as success", async () => {
    // The desired state is "not there", and it already is.
    await expect(
      deleteVaultFile(root, "Notes/never.md"),
    ).resolves.toBeUndefined();
  });

  it("returns null for a file that is not there", async () => {
    await ensureVault(root);
    expect(await readVaultFile(root, "Notes/missing.md")).toBeNull();
  });
});

/* ── Reconciliation against the real disk ─────────────────────────────── */

describe("reconciliation end to end", () => {
  const NOW = new Date("2026-08-11T14:30:00.000Z");

  async function sync(
    path: string,
    synced: SyncedState | null,
    note: NoteState | null,
  ) {
    const file = await readVaultFile(root, path);
    const action = reconcile(
      synced,
      file
        ? { path: file.path, content: file.content, mtime: file.mtime }
        : null,
      note,
      NOW,
    );

    if (action.type === "write_file") {
      await writeVaultFile(root, action.path, action.content);
    } else if (action.type === "delete_file") {
      await deleteVaultFile(root, action.path);
    } else if (action.type === "conflict") {
      await writeVaultFile(root, action.conflictPath, action.conflictContent);
      await writeVaultFile(root, action.path, action.content);
    }

    return action;
  }

  it("writes a new note out, then does nothing on the next pass", async () => {
    await ensureVault(root);

    const note = decision();
    const path = vaultPathFor(note);
    const content = noteToMarkdown(note);

    const first = await sync(path, null, { path, content, version: 1 });
    expect(first.type).toBe("write_file");

    const second = await sync(
      path,
      { path, syncedHash: hashContent(content), syncedVersion: 1 },
      { path, content, version: 1 },
    );
    expect(second.type).toBe("none");
  });

  it("preserves both copies when the same note is edited in two places", async () => {
    await ensureVault(root);

    const note = decision();
    const path = vaultPathFor(note);
    const original = noteToMarkdown(note);

    await writeVaultFile(root, path, original);
    const synced = {
      path,
      syncedHash: hashContent(original),
      syncedVersion: 1,
    };

    // Edited in Obsidian…
    const fileEdit = original.replace("Move everything", "Move most things");
    await writeVaultFile(root, path, fileEdit);

    // …and edited in the app.
    const appEdit = noteToMarkdown(
      decision({ decision: "Move everything to Entra ID by Q2." }),
    );

    const action = await sync(path, synced, {
      path,
      content: appEdit,
      version: 2,
    });
    expect(action.type).toBe("conflict");
    if (action.type !== "conflict") return;

    // The app's version keeps the filename…
    expect((await readVaultFile(root, path))?.content).toBe(appEdit);
    // …and the vault's bytes are preserved, unaltered.
    expect((await readVaultFile(root, action.conflictPath))?.content).toBe(
      fileEdit,
    );
  });

  it("archives rather than destroys when a file is deleted in the vault", async () => {
    await ensureVault(root);

    const note = decision();
    const path = vaultPathFor(note);
    const content = noteToMarkdown(note);

    await writeVaultFile(root, path, content);
    await deleteVaultFile(root, path);

    const action = await sync(
      path,
      { path, syncedHash: hashContent(content), syncedVersion: 1 },
      { path, content, version: 1 },
    );

    expect(action.type).toBe("archive_note");
  });

  it("removes the file when the note is deleted in the app", async () => {
    await ensureVault(root);

    const note = decision();
    const path = vaultPathFor(note);
    const content = noteToMarkdown(note);
    await writeVaultFile(root, path, content);

    const action = await sync(
      path,
      { path, syncedHash: hashContent(content), syncedVersion: 1 },
      null,
    );

    expect(action.type).toBe("delete_file");
    expect(await readVaultFile(root, path)).toBeNull();
  });

  it("takes an Obsidian edit into the app", async () => {
    await ensureVault(root);

    const note = decision();
    const path = vaultPathFor(note);
    const content = noteToMarkdown(note);
    await writeVaultFile(root, path, content);

    const edited = content.replace("Move everything", "Move most things");
    await writeVaultFile(root, path, edited);

    const action = await sync(
      path,
      { path, syncedHash: hashContent(content), syncedVersion: 1 },
      { path, content, version: 1 },
    );

    expect(action.type).toBe("update_app");
    if (action.type !== "update_app") return;
    expect(markdownToNote(action.content).decision).toBe(
      "Move most things to Entra ID by Q1.",
    );
  });
});
