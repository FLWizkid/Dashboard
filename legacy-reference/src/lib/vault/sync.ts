/**
 * The vault sync job.
 *
 * `reconcile.ts` decides what should happen to one file. This decides *which*
 * files to ask about, applies the answers, and records what it did — the part
 * that turns a tested pure function into notes actually appearing on disk.
 *
 * ── Ports, not imports ───────────────────────────────────────────────────
 * Everything that touches the world arrives as a parameter: the filesystem,
 * the note store, the record of what sync last saw. That is not ceremony. A
 * sync job's failure modes are "it deleted something" and "it lost an edit",
 * and neither is testable against a real database and a real disk in CI at the
 * fidelity that matters. With ports, every branch below is reachable from a
 * test in milliseconds, including the ones that only happen when two things
 * change at once.
 *
 * ── Order of work ────────────────────────────────────────────────────────
 *
 *   1. Build the set of paths anyone has an opinion about — files on disk,
 *      notes in the app, and rows recording what sync last saw. A path known
 *      only to one of the three is exactly the interesting case.
 *   2. Reconcile each path independently.
 *   3. Apply, recording state after each action rather than at the end. A
 *      crash halfway through then leaves the finished half recorded, and the
 *      next pass has less to do rather than the same amount.
 *
 * ── Renames ──────────────────────────────────────────────────────────────
 * A note's filename comes from its title, so renaming a note moves its file.
 * A move is a delete and a create, and doing them in the wrong order against
 * an edited file loses the edit. So a rename is only performed when the old
 * path has nothing outstanding: if the file at the old path has unread
 * changes, they are taken first and the move waits for the next pass. One
 * extra pass is a much better cost than one lost edit.
 */

import {
  markdownToNote,
  noteToMarkdown,
  vaultPathFor,
  type NoteDocument,
} from "@/lib/notes/markdown";

import {
  hashContent,
  nextSyncedState,
  reconcile,
  type FileState,
  type NoteState,
  type ReconcileAction,
  type SyncedState,
} from "./reconcile";

/** A note, as the sync needs it. */
export interface SyncNote {
  id: string;
  /** Where its file is now. Null when it has never been written out. */
  vaultPath: string | null;
  version: number;
  isArchived: boolean;
  /** Everything `noteToMarkdown` needs. */
  document: NoteDocument;
}

/** What sync recorded for one file last time. */
export interface VaultFileRecord {
  path: string;
  noteId: string | null;
  syncedHash: string | null;
  syncedVersion: number | null;
}

export interface VaultFileOnDisk {
  path: string;
  content: string;
  mtime?: Date;
}

export interface RecordFileInput {
  path: string;
  noteId: string | null;
  hash: string | null;
  version: number | null;
  state: string;
  conflictPath: string | null;
  error: string | null;
}

export interface VaultSyncPorts {
  ensureVault(): Promise<void>;
  readVault(): Promise<VaultFileOnDisk[]>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;

  listNotes(): Promise<SyncNote[]>;
  listFileRecords(): Promise<VaultFileRecord[]>;

  createNote(
    path: string,
    document: NoteDocument,
  ): Promise<{ id: string; version: number }>;
  updateNote(id: string, document: NoteDocument): Promise<{ version: number }>;
  archiveNote(id: string): Promise<void>;
  setNotePath(id: string, path: string): Promise<void>;

  recordFile(input: RecordFileInput): Promise<void>;
  forgetFile(path: string): Promise<void>;
}

export interface SyncEntry {
  path: string;
  action: ReconcileAction["type"];
  reason: string;
  detail?: string;
}

export interface SyncReport {
  startedAt: string;
  finishedAt: string;
  scanned: number;
  changed: number;
  conflicts: number;
  entries: SyncEntry[];
  errors: { path: string; message: string }[];
}

export async function syncVault(
  ports: VaultSyncPorts,
  now: Date = new Date(),
): Promise<SyncReport> {
  const startedAt = now.toISOString();

  await ports.ensureVault();

  const [files, notes, records] = await Promise.all([
    ports.readVault(),
    ports.listNotes(),
    ports.listFileRecords(),
  ]);

  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const recordByPath = new Map(records.map((record) => [record.path, record]));
  const noteByPath = new Map<string, SyncNote>();
  const pending: SyncNote[] = [];

  for (const note of notes) {
    if (note.vaultPath) noteByPath.set(note.vaultPath, note);
    // A note that has never been written out has no path to reconcile at, so
    // it is handled separately rather than pretending it has one.
    else if (!note.isArchived) pending.push(note);
  }

  const entries: SyncEntry[] = [];
  const errors: { path: string; message: string }[] = [];
  let changed = 0;
  let conflicts = 0;

  const paths = [
    ...new Set([
      ...fileByPath.keys(),
      ...noteByPath.keys(),
      ...recordByPath.keys(),
    ]),
  ].sort();

  for (const path of paths) {
    const note = noteByPath.get(path) ?? null;
    const file = fileByPath.get(path) ?? null;
    const record = recordByPath.get(path) ?? null;

    try {
      const action = reconcile(
        toSyncedState(record),
        toFileState(file),
        toNoteState(note),
        now,
      );

      const applied = await apply(ports, action, note, file, path, now);
      entries.push(applied.entry);
      if (applied.entry.action !== "none") changed += 1;
      if (action.type === "conflict") conflicts += 1;

      // A rename is considered only once the path is settled — see the header.
      if (note && applied.settled) {
        const moved = await maybeRename(ports, note, path, now);
        if (moved) {
          entries.push(moved);
          changed += 1;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ path, message });
      await ports
        .recordFile({
          path,
          noteId: note?.id ?? record?.noteId ?? null,
          hash: null,
          version: null,
          state: "error",
          conflictPath: null,
          error: message,
        })
        .catch(() => undefined);
    }
  }

  // Notes that have never been written out. Doing these last means a new note
  // whose title collides with an existing file is decided by the file, which
  // already exists and which the owner can see.
  for (const note of pending) {
    const path = uniquePath(vaultPathFor(note.document), fileByPath);
    try {
      const content = noteToMarkdown(note.document);
      await ports.writeFile(path, content);
      await ports.setNotePath(note.id, path);
      await ports.recordFile({
        path,
        noteId: note.id,
        hash: hashContent(content),
        version: note.version,
        state: "synced",
        conflictPath: null,
        error: null,
      });
      fileByPath.set(path, { path, content });
      entries.push({ path, action: "write_file", reason: "new_in_app" });
      changed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ path, message });
    }
  }

  return {
    startedAt,
    finishedAt: new Date(now.getTime()).toISOString(),
    scanned: paths.length + pending.length,
    changed,
    conflicts,
    entries,
    errors,
  };
}

/* ── Applying one decision ──────────────────────────────────────────────── */

async function apply(
  ports: VaultSyncPorts,
  action: ReconcileAction,
  note: SyncNote | null,
  file: VaultFileOnDisk | null,
  path: string,
  now: Date,
): Promise<{ entry: SyncEntry; settled: boolean }> {
  const entry: SyncEntry = {
    path,
    action: action.type,
    reason: action.reason,
  };

  switch (action.type) {
    case "none":
      break;

    case "write_file":
      await ports.writeFile(action.path, action.content);
      break;

    case "update_app": {
      if (!note) break;
      const document = markdownToNote(action.content);
      const { version } = await ports.updateNote(note.id, document);
      // The version the write produced, not the one read before it: recording
      // the old version would make the next pass think the app had moved on.
      note.version = version;
      break;
    }

    case "create_note": {
      const document = markdownToNote(action.content);
      const created = await ports.createNote(action.path, document);
      await ports.recordFile({
        path: action.path,
        noteId: created.id,
        hash: hashContent(action.content),
        version: created.version,
        state: "synced",
        conflictPath: null,
        error: null,
      });
      entry.detail = created.id;
      return { entry, settled: false };
    }

    case "delete_file":
      await ports.deleteFile(action.path);
      await ports.forgetFile(action.path);
      return { entry, settled: false };

    case "archive_note":
      if (note) await ports.archiveNote(note.id);
      await ports.forgetFile(action.path);
      return { entry, settled: false };

    case "conflict":
      // The losing copy first. If the process dies between these two writes,
      // the vault has an extra file rather than a missing one.
      await ports.writeFile(action.conflictPath, action.conflictContent);
      await ports.writeFile(action.path, action.content);
      entry.detail = action.conflictPath;
      break;
  }

  const next = nextSyncedState(
    action,
    note ? toNoteState(note) : null,
    toFileState(file),
  );

  await ports.recordFile({
    path,
    noteId: note?.id ?? null,
    hash: next.hash,
    version: next.version,
    state: next.state,
    conflictPath: action.type === "conflict" ? action.conflictPath : null,
    error: null,
  });

  void now;
  return {
    entry,
    // A conflict is not settled: the owner has two copies to look at, and
    // renaming the file out from under them while they do would be unkind.
    settled: action.type === "none" || action.type === "write_file",
  };
}

/* ── Renames ────────────────────────────────────────────────────────────── */

async function maybeRename(
  ports: VaultSyncPorts,
  note: SyncNote,
  currentPath: string,
  now: Date,
): Promise<SyncEntry | null> {
  const desired = vaultPathFor(note.document);
  if (desired === currentPath) return null;

  const content = noteToMarkdown(note.document);

  await ports.writeFile(desired, content);
  await ports.deleteFile(currentPath);
  await ports.setNotePath(note.id, desired);
  await ports.forgetFile(currentPath);
  await ports.recordFile({
    path: desired,
    noteId: note.id,
    hash: hashContent(content),
    version: note.version,
    state: "synced",
    conflictPath: null,
    error: null,
  });

  void now;
  return {
    path: desired,
    action: "write_file",
    reason: "app_changed",
    detail: `renamed from ${currentPath}`,
  };
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

/**
 * A path nothing else is using.
 *
 * Two notes can legitimately share a title — "Weekly sync" is not a unique
 * name — and the database's unique index on `vault_path` would reject the
 * second. Suffixing is what Obsidian itself does.
 */
function uniquePath(path: string, taken: ReadonlyMap<string, unknown>): string {
  if (!taken.has(path)) return path;

  const base = path.replace(/\.md$/i, "");
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base} ${n}.md`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}.md`;
}

function toSyncedState(record: VaultFileRecord | null): SyncedState | null {
  return record
    ? {
        path: record.path,
        syncedHash: record.syncedHash,
        syncedVersion: record.syncedVersion,
      }
    : null;
}

function toFileState(file: VaultFileOnDisk | null): FileState | null {
  return file
    ? { path: file.path, content: file.content, mtime: file.mtime }
    : null;
}

function toNoteState(note: SyncNote | null): NoteState | null {
  return note
    ? {
        path: note.vaultPath ?? vaultPathFor(note.document),
        content: noteToMarkdown(note.document),
        version: note.version,
        isArchived: note.isArchived,
      }
    : null;
}
