/**
 * Vault reconciliation.
 *
 * Deciding, for one file, what should happen — and doing it deterministically,
 * with no case in which an edit is lost.
 *
 * ── Why three values and not two ─────────────────────────────────────────
 * Comparing "the file" with "the app" cannot tell you *which* changed. Both
 * differ from each other in every interesting case. So each file also carries
 * the hash of what sync last wrote, and the note version that hash
 * corresponded to. With that third value the question becomes answerable:
 *
 *     file hash ≠ synced hash   →  the file changed
 *     note version ≠ synced version →  the app changed
 *
 * Content hashes rather than timestamps, because mtime lies. Sync clients
 * rewrite files unchanged, filesystems differ in granularity, phones have
 * their own opinion of the clock, and "touched" is not "edited".
 *
 * ── What happens when both changed ───────────────────────────────────────
 * The app is the system of record — the specification says so — and so the
 * app's version takes the canonical path. **The file's bytes are written,
 * unaltered, to a conflict copy** in `Conflicts/`, where Obsidian will show
 * them next to everything else. Nothing is merged, because a wrong merge of a
 * decision log is worse than two files; nothing is discarded, because that is
 * the one outcome there is no recovering from.
 *
 * ── Deletion is not symmetric, on purpose ────────────────────────────────
 * Deleting a *note in the app* deletes the file. Deleting a *file in the
 * vault* archives the note rather than destroying it: sync clients and phones
 * delete files by accident far more often than people delete decisions on
 * purpose, and an archived note is recoverable while a deleted one is not.
 */

import { createHash } from "node:crypto";

export type ReconcileReason =
  | "unchanged"
  | "app_changed"
  | "file_changed"
  | "both_changed"
  | "new_in_app"
  | "new_in_vault"
  | "deleted_in_app"
  | "deleted_in_vault";

export type ReconcileAction =
  /** Nothing to do. */
  | { type: "none"; reason: ReconcileReason }
  /** Write the app's rendering to the canonical path. */
  | {
      type: "write_file";
      path: string;
      content: string;
      reason: ReconcileReason;
    }
  /** Take the file's content into the app. */
  | {
      type: "update_app";
      path: string;
      content: string;
      reason: ReconcileReason;
    }
  /** A file we have never seen. Create a note from it. */
  | {
      type: "create_note";
      path: string;
      content: string;
      reason: ReconcileReason;
    }
  /** The note was deleted in the app; remove its file. */
  | { type: "delete_file"; path: string; reason: ReconcileReason }
  /** The file is gone; archive the note rather than destroy it. */
  | { type: "archive_note"; path: string; reason: ReconcileReason }
  /**
   * Both changed. The app's version goes to `path`; the file's bytes are
   * preserved verbatim at `conflictPath`.
   */
  | {
      type: "conflict";
      path: string;
      content: string;
      conflictPath: string;
      conflictContent: string;
      reason: ReconcileReason;
    };

/** What sync recorded the last time it agreed with the disk. */
export interface SyncedState {
  path: string;
  syncedHash: string | null;
  syncedVersion: number | null;
}

/** The file as it is on disk right now. `null` when it is not there. */
export interface FileState {
  path: string;
  content: string;
  /** Only a cheap pre-filter; the hash is what decides. */
  mtime?: Date;
}

/** The note as the app holds it right now. `null` when it has been deleted. */
export interface NoteState {
  path: string;
  /** The app's rendering of the note, ready to write. */
  content: string;
  version: number;
  isArchived?: boolean;
}

export function hashContent(content: string): string {
  // Line endings are normalised first: a vault synced to Windows and back
  // would otherwise look edited on every pass.
  return createHash("sha256")
    .update(content.replace(/\r\n/g, "\n"), "utf8")
    .digest("hex");
}

/**
 * Where a conflict copy goes.
 *
 * In its own folder, named for where it came from and when, so the vault does
 * not fill with mysterious near-duplicates sitting next to the originals.
 */
export function conflictPathFor(path: string, now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const name = path.replace(/\.md$/i, "").split("/").pop() ?? "note";
  return `Conflicts/${name} (from Obsidian ${stamp}).md`;
}

/**
 * Decides what should happen to one file.
 *
 * Pure, and exhaustive over the eight reachable combinations of
 * (synced state, file present/changed, note present/changed). Every branch
 * either does nothing or preserves both sides.
 */
export function reconcile(
  synced: SyncedState | null,
  file: FileState | null,
  note: NoteState | null,
  now: Date = new Date(),
): ReconcileAction {
  /* ── Neither side has anything ─────────────────────────────────────── */
  if (!file && !note) {
    return { type: "none", reason: "unchanged" };
  }

  /* ── A file we have never seen ─────────────────────────────────────── */
  if (file && !note && !synced) {
    return {
      type: "create_note",
      path: file.path,
      content: file.content,
      reason: "new_in_vault",
    };
  }

  /* ── A note that has never been written out ────────────────────────── */
  if (note && !file && !synced) {
    // An archived note is not written to the vault at all.
    if (note.isArchived) return { type: "none", reason: "unchanged" };

    return {
      type: "write_file",
      path: note.path,
      content: note.content,
      reason: "new_in_app",
    };
  }

  /* ── The note is gone from the app ─────────────────────────────────── */
  if (!note && file) {
    return { type: "delete_file", path: file.path, reason: "deleted_in_app" };
  }

  /* ── The file is gone from the vault ───────────────────────────────── */
  if (note && !file) {
    if (note.isArchived) {
      // Already archived and already absent: consistent.
      return { type: "none", reason: "unchanged" };
    }

    const appChanged =
      synced?.syncedVersion !== null && synced?.syncedVersion !== undefined
        ? note.version !== synced.syncedVersion
        : true;

    if (appChanged) {
      // The app has moved on since the file was written. Restoring the file is
      // the lossless answer — the deletion may well have been a sync client
      // being clumsy, and the app's copy is newer than anything that was there.
      return {
        type: "write_file",
        path: note.path,
        content: note.content,
        reason: "app_changed",
      };
    }

    // The app has not touched it, so the deletion was deliberate. Archive
    // rather than delete: recoverable beats irreversible.
    return {
      type: "archive_note",
      path: note.path,
      reason: "deleted_in_vault",
    };
  }

  /* ── Both exist ────────────────────────────────────────────────────── */
  if (!file || !note) {
    // Unreachable; every combination above returns. Kept so the compiler can
    // narrow, and so a future edit that breaks the exhaustiveness is loud.
    return { type: "none", reason: "unchanged" };
  }

  const fileHash = hashContent(file.content);
  const appHash = hashContent(note.content);

  // With no synced record we cannot tell which side moved. Identical content
  // means nothing happened; different content is a genuine conflict.
  if (!synced || synced.syncedHash === null) {
    if (fileHash === appHash) {
      return { type: "none", reason: "unchanged" };
    }
    return conflict(note, file, now);
  }

  const fileChanged = fileHash !== synced.syncedHash;
  const appChanged =
    synced.syncedVersion === null || note.version !== synced.syncedVersion;

  if (!fileChanged && !appChanged) {
    return { type: "none", reason: "unchanged" };
  }

  if (appChanged && !fileChanged) {
    // Writing identical bytes is not a change worth making; it would churn the
    // mtime and make the next pass think the file moved.
    if (fileHash === appHash) return { type: "none", reason: "unchanged" };

    return {
      type: "write_file",
      path: note.path,
      content: note.content,
      reason: "app_changed",
    };
  }

  if (fileChanged && !appChanged) {
    return {
      type: "update_app",
      path: file.path,
      content: file.content,
      reason: "file_changed",
    };
  }

  // Both changed. If they happen to agree, there is nothing to reconcile —
  // this is common when the same edit was made twice, or when a round trip
  // normalised whitespace.
  if (fileHash === appHash) {
    return { type: "none", reason: "unchanged" };
  }

  return conflict(note, file, now);
}

function conflict(
  note: NoteState,
  file: FileState,
  now: Date,
): ReconcileAction {
  return {
    type: "conflict",
    path: note.path,
    content: note.content,
    conflictPath: conflictPathFor(file.path, now),
    // Verbatim. Not re-rendered, not normalised — whatever was on disk is
    // what the owner will open, and any transformation here is a small loss.
    conflictContent: file.content,
    reason: "both_changed",
  };
}

/** Human-readable, for the sync log and the UI. */
export function describeAction(action: ReconcileAction): string {
  switch (action.type) {
    case "none":
      return "up to date";
    case "write_file":
      return `wrote ${action.path}`;
    case "update_app":
      return `took changes from ${action.path}`;
    case "create_note":
      return `imported ${action.path}`;
    case "delete_file":
      return `removed ${action.path}`;
    case "archive_note":
      return `archived the note for ${action.path} (its file was deleted)`;
    case "conflict":
      return `conflict on ${action.path}: the vault's copy was kept at ${action.conflictPath}`;
  }
}

/** The state to record after an action succeeds. */
export function nextSyncedState(
  action: ReconcileAction,
  note: NoteState | null,
  file: FileState | null,
): { hash: string | null; version: number | null; state: string } {
  switch (action.type) {
    case "write_file":
      return {
        hash: hashContent(action.content),
        version: note?.version ?? null,
        state: "synced",
      };
    case "update_app":
    case "create_note":
      return {
        hash: hashContent(action.content),
        // The app version is bumped by the write that follows; recording it
        // here would claim a version that does not exist yet.
        version: null,
        state: "synced",
      };
    case "conflict":
      return {
        hash: hashContent(action.content),
        version: note?.version ?? null,
        state: "conflict",
      };
    case "delete_file":
    case "archive_note":
      return { hash: null, version: null, state: "missing" };
    case "none":
      return {
        hash: file ? hashContent(file.content) : null,
        version: note?.version ?? null,
        state: "synced",
      };
  }
}
