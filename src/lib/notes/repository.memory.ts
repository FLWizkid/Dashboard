import { randomUUID } from "node:crypto";

import { titleKey } from "./backlinks";
import { extractWikiLinks, vaultPathFor } from "./markdown";
import {
  excerptAround,
  linkableText,
  NoteNotFoundError,
  type NoteRepository,
} from "./repository";
import type {
  CreateNotePayload,
  ListNotesQuery,
  NoteLinkInput,
  UpdateNotePayload,
} from "./schema";
import type { Note, NoteLink, NoteSummary } from "./types";

/**
 * In-process note repository, used by end-to-end tests.
 *
 * It re-implements the two rules that matter rather than skipping them: a
 * decision note is incomplete-but-saved without its rationale, and a wiki-link
 * to a page that does not exist is an unresolved link rather than an error.
 * A fake that rejects either would make the E2E suite agree with itself and
 * disagree with the deployment.
 */

interface MemoryNoteStore {
  notes: Note[];
}

const STORE_KEY = Symbol.for("dashboard.memoryNoteStore");

function getStore(): MemoryNoteStore {
  const globalStore = globalThis as typeof globalThis & {
    [STORE_KEY]?: MemoryNoteStore;
  };
  globalStore[STORE_KEY] ??= { notes: [] };
  return globalStore[STORE_KEY];
}

/** Seeds notes wholesale, for the demo week. */
export function seedMemoryNotes(notes: Note[]): void {
  getStore().notes = [...notes];
}

/** Test-only reset hook, exposed through the E2E route handler. */
export function resetMemoryNoteStore(): void {
  getStore().notes = [];
}

function isCompleteDecision(note: {
  kind: string;
  decision: string | null;
  rationale: string | null;
}): boolean {
  if (note.kind !== "decision") return true;
  return Boolean(note.decision?.trim() && note.rationale?.trim());
}

/**
 * The links a note's own text implies, merged with any explicit ones.
 *
 * Wiki-links are derived from the text on every write rather than tracked
 * incrementally: the text is the truth, and a link table that drifts from the
 * prose is worse than no link table.
 */
function linksFor(
  noteId: string,
  text: string,
  explicit: NoteLinkInput[],
  notes: Note[],
): NoteLink[] {
  const byTitle = new Map(notes.map((n) => [titleKey(n.title), n] as const));
  const now = new Date().toISOString();
  const links: NoteLink[] = [];
  const seen = new Set<string>();

  for (const wiki of extractWikiLinks(text)) {
    const key = `note:${wiki.target.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const target = byTitle.get(titleKey(wiki.target));
    links.push({
      id: randomUUID(),
      noteId,
      kind: "note",
      // An unresolved link is a real state, not an error — Obsidian lets you
      // link a page before you write it, and so do we.
      targetNoteId: target && target.id !== noteId ? target.id : null,
      targetId: null,
      targetLabel: wiki.target,
      createdAt: now,
    });
  }

  for (const link of explicit) {
    const key = `${link.kind}:${link.targetLabel.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    links.push({
      id: randomUUID(),
      noteId,
      kind: link.kind,
      targetNoteId: link.kind === "note" ? link.targetNoteId : null,
      targetId: link.kind === "note" ? null : link.targetId,
      targetLabel: link.targetLabel,
      createdAt: now,
    });
  }

  return links;
}

function summarise(note: Note, all: Note[]): NoteSummary {
  return {
    id: note.id,
    kind: note.kind,
    title: note.title,
    decision: note.decision,
    owner: note.owner,
    decidedOn: note.decidedOn,
    isCompleteDecision: note.isCompleteDecision,
    isArchived: note.isArchived,
    updatedAt: note.updatedAt,
    backlinkCount: all.filter((other) =>
      other.links.some((link) => link.targetNoteId === note.id),
    ).length,
  };
}

export const memoryNoteRepository: NoteRepository = {
  async listNotes(query: ListNotesQuery) {
    const { notes } = getStore();
    const needle = query.q?.toLowerCase();

    return notes
      .filter((note) => {
        if (!query.includeArchived && note.isArchived) return false;
        if (query.kind && note.kind !== query.kind) return false;
        if (!needle) return true;
        // Substring rather than Postgres FTS. Different engine, same job; the
        // integration tests cover the real ranking.
        return `${note.title} ${linkableText(note)}`
          .toLowerCase()
          .includes(needle);
      })
      .slice()
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, query.limit)
      .map((note) => summarise(note, notes));
  },

  async getNote(id: string) {
    return getStore().notes.find((note) => note.id === id) ?? null;
  },

  async createNote(input: CreateNotePayload) {
    const store = getStore();
    const now = new Date().toISOString();
    const id = randomUUID();

    const note: Note = {
      id,
      kind: input.kind,
      title: input.title,
      decision: input.decision,
      rationale: input.rationale,
      context: input.context,
      owner: input.owner,
      decidedOn: input.decidedOn,
      body: input.body,
      vaultPath: vaultPathFor({
        kind: input.kind,
        title: input.title,
        decidedOn: input.decidedOn,
        createdAt: now,
      }),
      version: 1,
      isArchived: false,
      isCompleteDecision: isCompleteDecision(input),
      createdAt: now,
      updatedAt: now,
      links: [],
    };

    note.links = linksFor(id, linkableText(note), input.links, store.notes);
    store.notes.push(note);

    // The new note may be the page older links have been waiting for.
    await memoryNoteRepository.resolveLinks();

    return store.notes.find((n) => n.id === id)!;
  },

  async updateNote(id: string, patch: UpdateNotePayload) {
    const store = getStore();
    const index = store.notes.findIndex((note) => note.id === id);
    if (index === -1) throw new NoteNotFoundError(id);

    const existing = store.notes[index];
    const merged: Note = {
      ...existing,
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.decision !== undefined ? { decision: patch.decision } : {}),
      ...(patch.rationale !== undefined ? { rationale: patch.rationale } : {}),
      ...(patch.context !== undefined ? { context: patch.context } : {}),
      ...(patch.owner !== undefined ? { owner: patch.owner } : {}),
      ...(patch.decidedOn !== undefined ? { decidedOn: patch.decidedOn } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.isArchived !== undefined
        ? { isArchived: patch.isArchived }
        : {}),
      // Every application-side edit bumps the version. This is half of what
      // makes "the app changed" detectable without trusting file timestamps.
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };

    merged.isCompleteDecision = isCompleteDecision(merged);
    merged.links = linksFor(
      id,
      linkableText(merged),
      patch.links ??
        existing.links
          .filter((link) => link.kind !== "note")
          .map((link) => ({
            kind: link.kind,
            targetNoteId: link.targetNoteId,
            targetId: link.targetId,
            targetLabel: link.targetLabel,
          })),
      store.notes,
    );

    store.notes[index] = merged;
    return merged;
  },

  async deleteNote(id: string) {
    const store = getStore();
    store.notes = store.notes.filter((note) => note.id !== id);

    // A link to a deleted note becomes unresolved rather than disappearing —
    // the prose still says `[[Whatever]]`, and pretending otherwise would make
    // the file and the index disagree.
    for (const note of store.notes) {
      for (const link of note.links) {
        if (link.targetNoteId === id) link.targetNoteId = null;
      }
    }
  },

  async backlinksFor(id: string) {
    const { notes } = getStore();
    const target = notes.find((note) => note.id === id);
    if (!target) return [];

    return notes
      .filter((note) => note.links.some((link) => link.targetNoteId === id))
      .map((note) => ({
        noteId: note.id,
        title: note.title,
        kind: note.kind,
        excerpt: excerptAround(linkableText(note), target.title),
      }));
  },

  async resolveLinks() {
    const { notes } = getStore();
    const byTitle = new Map(notes.map((n) => [titleKey(n.title), n] as const));
    let resolved = 0;

    for (const note of notes) {
      for (const link of note.links) {
        if (link.kind !== "note" || link.targetNoteId) continue;

        const target = byTitle.get(titleKey(link.targetLabel));
        if (target && target.id !== note.id) {
          link.targetNoteId = target.id;
          resolved += 1;
        }
      }
    }

    return resolved;
  },

  async titles() {
    return getStore()
      .notes.filter((note) => !note.isArchived)
      .map((note) => ({ id: note.id, title: note.title, kind: note.kind }));
  },
};
