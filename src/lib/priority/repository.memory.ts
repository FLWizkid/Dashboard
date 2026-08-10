import { randomUUID } from "node:crypto";

import { memoryTaskRepository } from "@/lib/tasks/repository.memory";

import type { EventContext } from "./importance";
import {
  SuggestionNotFoundError,
  type AcceptResult,
  type AcceptSuggestionInput,
  type PriorityRepository,
  type StoredSuggestion,
} from "./repository";
import type { LinkSuggestion } from "./suggest";

/**
 * In-process priority repository, for end-to-end tests.
 *
 * It enforces the rule the whole feature rests on: **accepting a suggestion is
 * the only way an event link becomes confirmed.** Nothing else here writes
 * `confirmedAt` on an event link, exactly as the database trigger enforces in
 * a real deployment.
 */

interface MemoryPriorityStore {
  events: EventContext[];
  suggestions: StoredSuggestion[];
}

const STORE_KEY = Symbol.for("dashboard.memoryPriorityStore");

function getStore(): MemoryPriorityStore {
  const globalStore = globalThis as typeof globalThis & {
    [STORE_KEY]?: MemoryPriorityStore;
  };
  globalStore[STORE_KEY] ??= { events: [], suggestions: [] };
  return globalStore[STORE_KEY];
}

/** Test-only reset hook, exposed through the E2E route handler. */
export function resetMemoryPriorityStore(): void {
  const store = getStore();
  store.events = [];
  store.suggestions = [];
}

/**
 * Test-only seeding hook.
 *
 * The calendar has no live feed until Phase 2's sync lands, so this is how the
 * E2E suite exercises the half of the engine that reads meetings.
 */
export function seedPriorityEvents(events: EventContext[]): void {
  getStore().events = events;
}

export const memoryPriorityRepository: PriorityRepository = {
  async eventsInWindow({ from, to }) {
    const inWindow = getStore().events.filter((event) => {
      const starts = Date.parse(event.startsAt);
      if (!Number.isFinite(starts)) return false;
      return starts >= from.getTime() && starts <= to.getTime();
    });

    return new Map(inWindow.map((event) => [event.id, event] as const));
  },

  async listSuggestions() {
    return getStore()
      .suggestions.slice()
      .sort(
        (a, b) =>
          b.confidence - a.confidence || a.taskId.localeCompare(b.taskId),
      );
  },

  async recordSuggestions(suggestions: LinkSuggestion[]) {
    const store = getStore();
    const created: StoredSuggestion[] = [];

    for (const suggestion of suggestions) {
      // One live question per task/event/kind. Re-running detection must not
      // pile up duplicates of something already asked.
      const existing = store.suggestions.find(
        (item) =>
          item.taskId === suggestion.taskId &&
          item.eventId === suggestion.eventId &&
          item.kind === suggestion.kind,
      );
      if (existing) continue;

      const stored: StoredSuggestion = {
        ...suggestion,
        id: randomUUID(),
        state: "pending",
        createdAt: new Date().toISOString(),
        createdNoteId: null,
      };

      store.suggestions.push(stored);
      created.push(stored);
    }

    return created;
  },

  async acceptSuggestion(id: string, input: AcceptSuggestionInput) {
    const store = getStore();
    const index = store.suggestions.findIndex((item) => item.id === id);
    if (index === -1) throw new SuggestionNotFoundError(id);

    const suggestion = store.suggestions[index];
    const event = store.events.find((e) => e.id === suggestion.eventId);
    const now = new Date().toISOString();

    // The confirmation happens *here*, on the owner's explicit act, and
    // nowhere else.
    const task = await memoryTaskRepository.getTask(suggestion.taskId);
    if (!task) throw new SuggestionNotFoundError(id);

    const linkId = randomUUID();
    task.links.push({
      id: linkId,
      taskId: task.id,
      kind: "event",
      relation: suggestion.kind === "related" ? "related" : suggestion.kind,
      targetId: suggestion.eventId,
      targetLabel: event?.title ?? "A meeting",
      targetUrl: null,
      confirmedAt: now,
      createdAt: now,
    });

    let noteId: string | null = null;
    if (input.withNote && suggestion.offeredNote) {
      const { memoryNoteRepository } =
        await import("@/lib/notes/repository.memory");
      const note = await memoryNoteRepository.createNote({
        kind:
          suggestion.offeredNote.kind === "meeting" ? "meeting" : "follow_up",
        title: suggestion.offeredNote.title,
        decision: null,
        rationale: null,
        context: suggestion.offeredNote.context,
        owner: null,
        decidedOn: null,
        body: "",
        links: [],
      });
      noteId = note.id;
    }

    const updated: StoredSuggestion = {
      ...suggestion,
      state: "accepted",
      createdNoteId: noteId,
    };
    store.suggestions[index] = updated;

    return { suggestion: updated, linkId, noteId };
  },

  async dismissSuggestion(id: string) {
    const store = getStore();
    const index = store.suggestions.findIndex((item) => item.id === id);
    if (index === -1) throw new SuggestionNotFoundError(id);

    // Dismissed, not deleted: the record is what stops the question being
    // asked again the next time detection runs.
    const updated: StoredSuggestion = {
      ...store.suggestions[index],
      state: "dismissed",
    };
    store.suggestions[index] = updated;

    return updated;
  },
};
