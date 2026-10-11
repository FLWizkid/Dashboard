import { isMemoryMode } from "@/lib/data-mode";

import type { EventContext } from "./importance";
import type { LinkSuggestion, SuggestionKind } from "./suggest";

/**
 * The seam for the priority engine's stored state.
 *
 * Almost everything about a ranking is computed, so this is a small surface:
 * the meetings the scorer needs to read, and the suggestions awaiting an
 * answer. The score itself is never stored — see the migration for why.
 */

export interface StoredSuggestion extends LinkSuggestion {
  id: string;
  state: "pending" | "accepted" | "dismissed";
  createdAt: string;
  /** Filled in when the owner accepted and asked for a note. */
  createdNoteId: string | null;
}

export interface AcceptSuggestionInput {
  /** Also create the offered note and link it to the task. */
  withNote: boolean;
}

export interface AcceptResult {
  suggestion: StoredSuggestion;
  /** The confirmed link that now exists. */
  linkId: string;
  /** The note, when one was asked for. */
  noteId: string | null;
}

export interface PriorityRepository {
  /** Events in the window the scorer cares about, keyed by id. */
  eventsInWindow(options: {
    from: Date;
    to: Date;
  }): Promise<Map<string, EventContext>>;

  listSuggestions(): Promise<StoredSuggestion[]>;

  /** Records freshly detected suggestions, skipping any already decided. */
  recordSuggestions(suggestions: LinkSuggestion[]): Promise<StoredSuggestion[]>;

  /**
   * Accepts a suggestion: creates the **confirmed** link, optionally the note,
   * and marks the suggestion accepted. One operation, because a link created
   * without the suggestion being closed would be asked about again.
   */
  acceptSuggestion(
    id: string,
    input: AcceptSuggestionInput,
  ): Promise<AcceptResult>;

  dismissSuggestion(id: string): Promise<StoredSuggestion>;
}

export class SuggestionNotFoundError extends Error {
  constructor(id: string) {
    super(`Suggestion ${id} was not found`);
    this.name = "SuggestionNotFoundError";
  }
}

export async function getPriorityRepository(): Promise<PriorityRepository> {
  if (isMemoryMode()) {
    const { memoryPriorityRepository } = await import("./repository.memory");
    return memoryPriorityRepository;
  }
  const { createSupabasePriorityRepository } =
    await import("./repository.supabase");
  return createSupabasePriorityRepository();
}

/**
 * The window of calendar the scorer needs.
 *
 * Wide enough to cover both the prep look-ahead and the follow-up look-back,
 * with a margin. Bounding it matters: without a window this would read the
 * entire calendar history on every ranking request.
 */
export function scoringWindow(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() - 7 * 24 * 3_600_000),
    to: new Date(now.getTime() + 14 * 24 * 3_600_000),
  };
}

/** The key used to remember an answered question. */
export function decidedKeys(
  suggestions: readonly StoredSuggestion[],
): Set<string> {
  return new Set(
    suggestions
      .filter((suggestion) => suggestion.state !== "pending")
      .map(
        (suggestion) =>
          `${suggestion.taskId}:${suggestion.eventId}:${suggestion.kind satisfies SuggestionKind}`,
      ),
  );
}
