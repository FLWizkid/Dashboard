import { isMemoryMode } from "@/lib/data-mode";

import type {
  CreateNotePayload,
  ListNotesQuery,
  UpdateNotePayload,
} from "./schema";
import type { Backlink, Note, NoteSummary } from "./types";

/**
 * The seam every note read and write goes through.
 *
 * Same contract shape as tasks and hours. The one addition worth noting is
 * `resolveLinks`: a wiki-link is written as text and resolves to a note *later*
 * — possibly much later, when the page it names is finally created. That is
 * Obsidian's behaviour and it is the right one, so link resolution is a
 * first-class operation rather than something that happens once on save.
 */
export interface NoteRepository {
  listNotes(query: ListNotesQuery): Promise<NoteSummary[]>;
  getNote(id: string): Promise<Note | null>;
  createNote(input: CreateNotePayload): Promise<Note>;
  updateNote(id: string, patch: UpdateNotePayload): Promise<Note>;
  deleteNote(id: string): Promise<void>;

  /** Notes that link *to* this one. */
  backlinksFor(id: string): Promise<Backlink[]>;

  /**
   * Point every unresolved wiki-link whose label matches an existing note at
   * that note. Run after a create, because the new note may be the page a
   * dozen older ones have been waiting for.
   */
  resolveLinks(): Promise<number>;

  /** Titles, for the wiki-link autocomplete. */
  titles(): Promise<{ id: string; title: string; kind: string }[]>;
}

export class NoteNotFoundError extends Error {
  constructor(id: string) {
    super(`Note ${id} was not found`);
    this.name = "NoteNotFoundError";
  }
}

export async function getNoteRepository(): Promise<NoteRepository> {
  if (isMemoryMode()) {
    const { memoryNoteRepository } = await import("./repository.memory");
    return memoryNoteRepository;
  }
  const { createSupabaseNoteRepository } =
    await import("./repository.supabase");
  return createSupabaseNoteRepository();
}

/**
 * The searchable text of a note, in the order the reader would scan it.
 *
 * Used to build the wiki-link set and the backlink excerpts. Deliberately
 * excludes the frontmatter: a link written in a plugin's metadata is that
 * plugin's business, not a backlink the owner authored.
 */
export function linkableText(note: {
  decision?: string | null;
  rationale?: string | null;
  context?: string | null;
  body?: string | null;
}): string {
  return [note.decision, note.rationale, note.context, note.body]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

/** The line a link appears on, trimmed, for the backlinks pane. */
export function excerptAround(text: string, label: string): string | null {
  const needle = `[[${label}`;
  for (const line of text.split("\n")) {
    if (line.includes(needle)) {
      const trimmed = line.trim();
      return trimmed.length > 240 ? `${trimmed.slice(0, 237)}…` : trimmed;
    }
  }
  return null;
}
