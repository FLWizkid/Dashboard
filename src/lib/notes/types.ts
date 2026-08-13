/**
 * Domain types for the notes module.
 *
 * The shapes the API and the UI speak, separate from both the row shapes and
 * from `NoteDocument` (which is the *file* shape, in `markdown.ts`). Three
 * representations sounds like two too many until you need to change one — a
 * column rename shouldn't alter what Obsidian sees on disk, and adding a UI
 * field shouldn't change the file format.
 */

import type { NoteKind } from "./markdown";

export const NOTE_LINK_KINDS = ["note", "task", "event", "message"] as const;
export type NoteLinkKind = (typeof NOTE_LINK_KINDS)[number];

export const NOTE_LINK_KIND_LABELS: Record<NoteLinkKind, string> = {
  note: "Note",
  task: "Task",
  event: "Event",
  message: "Email",
};

export interface NoteLink {
  id: string;
  noteId: string;
  kind: NoteLinkKind;
  /** The resolved note, for wiki-links. `null` while the page doesn't exist. */
  targetNoteId: string | null;
  /** The task, event or message this points at. */
  targetId: string | null;
  /** Exactly as written between the brackets, so the file round-trips. */
  targetLabel: string;
  createdAt: string;
}

export interface Note {
  id: string;
  kind: NoteKind;
  title: string;

  /** The two decision-log anchors, of equal standing. */
  decision: string | null;
  rationale: string | null;

  context: string | null;
  owner: string | null;
  decidedOn: string | null;
  body: string;

  /** Relative to the vault root. `null` until it has been written out. */
  vaultPath: string | null;
  /** Bumped on every application-side edit; the reconciler compares it. */
  version: number;
  isArchived: boolean;

  /** Server-computed: a decision note has both anchors filled in. */
  isCompleteDecision: boolean;

  createdAt: string;
  updatedAt: string;

  links: NoteLink[];
}

/** A note as it appears in a list — without the body, which can be long. */
export interface NoteSummary {
  id: string;
  kind: NoteKind;
  title: string;
  decision: string | null;
  owner: string | null;
  decidedOn: string | null;
  isCompleteDecision: boolean;
  isArchived: boolean;
  updatedAt: string;
  /** How many notes link here. Cheap to compute, and the useful signal. */
  backlinkCount: number;
}

/** One inbound link, for the backlinks pane. */
export interface Backlink {
  noteId: string;
  title: string;
  kind: NoteKind;
  /** The line the link appears on, so the pane can show context. */
  excerpt: string | null;
}
