import { createClient } from "@/lib/supabase/server";

import type { EventContext } from "./importance";
import {
  SuggestionNotFoundError,
  type AcceptSuggestionInput,
  type PriorityRepository,
  type StoredSuggestion,
} from "./repository";
import type { LinkSuggestion, SuggestionKind } from "./suggest";

/**
 * Supabase-backed priority repository.
 *
 * RLS does the access control. The rule this file is responsible for keeping
 * is the one the database also enforces with a trigger: **an event link
 * becomes confirmed only when the owner accepts a suggestion.** Belt and
 * braces, because "never auto-link silently" has to survive the next person
 * who writes an import script.
 */

interface EventRow {
  id: string;
  title: string | null;
  starts_at: string;
  ends_at: string;
  attendee_count: number;
  is_external: boolean;
  is_cancelled: boolean;
  organizer_address: string | null;
}

interface SuggestionRow {
  id: string;
  task_id: string;
  event_id: string | null;
  kind: SuggestionKind;
  state: "pending" | "accepted" | "dismissed";
  reason: string;
  confidence: number;
  created_note_id: string | null;
  created_at: string;
}

const EVENT_COLUMNS =
  "id, title, starts_at, ends_at, attendee_count, is_external, is_cancelled, organizer_address";

const SUGGESTION_COLUMNS =
  "id, task_id, event_id, kind, state, reason, confidence, created_note_id, created_at";

function toEvent(row: EventRow, ownerAddresses: Set<string>): EventContext {
  return {
    id: row.id,
    title: row.title ?? "(no title)",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    attendeeCount: row.attendee_count,
    isExternal: row.is_external,
    isCancelled: row.is_cancelled,
    organizerAddress: row.organizer_address,
    isOwnerOrganiser: row.organizer_address
      ? ownerAddresses.has(row.organizer_address.toLowerCase())
      : false,
  };
}

function toSuggestion(row: SuggestionRow): StoredSuggestion {
  return {
    id: row.id,
    taskId: row.task_id,
    eventId: row.event_id ?? "",
    kind: row.kind,
    state: row.state,
    confidence: Number(row.confidence),
    reason: row.reason,
    // Rebuilt on read rather than stored: what we would offer to create is a
    // function of the current titles, and a stored copy would go stale the
    // moment a meeting is renamed.
    offeredNote: null,
    createdAt: row.created_at,
    createdNoteId: row.created_note_id,
  };
}

export function createSupabasePriorityRepository(): PriorityRepository {
  return {
    async eventsInWindow({ from, to }) {
      const supabase = await createClient();

      const [events, accounts] = await Promise.all([
        supabase
          .from("calendar_events")
          .select(EVENT_COLUMNS)
          .gte("starts_at", from.toISOString())
          .lte("starts_at", to.toISOString())
          .eq("is_cancelled", false)
          .returns<EventRow[]>(),
        // The owner's own addresses, so "did you organise this?" is answerable
        // without guessing from the domain.
        supabase
          .from("mail_accounts")
          .select("email_address")
          .returns<{ email_address: string }[]>(),
      ]);

      if (events.error) throw new Error(events.error.message);

      const ownerAddresses = new Set(
        (accounts.data ?? []).map((row) => row.email_address.toLowerCase()),
      );

      return new Map(
        (events.data ?? []).map(
          (row) => [row.id, toEvent(row, ownerAddresses)] as const,
        ),
      );
    },

    async listSuggestions() {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("link_suggestions")
        .select(SUGGESTION_COLUMNS)
        .order("confidence", { ascending: false })
        .returns<SuggestionRow[]>();

      if (error) throw new Error(error.message);
      return (data ?? []).map(toSuggestion);
    },

    async recordSuggestions(suggestions: LinkSuggestion[]) {
      if (suggestions.length === 0) return [];

      const supabase = await createClient();

      // `ignoreDuplicates` against the unique index: re-running detection must
      // not resurrect a question the owner has already answered, and must not
      // stack duplicates of one still pending.
      const { data, error } = await supabase
        .from("link_suggestions")
        .upsert(
          suggestions.map((suggestion) => ({
            task_id: suggestion.taskId,
            event_id: suggestion.eventId,
            kind: suggestion.kind,
            reason: suggestion.reason,
            confidence: suggestion.confidence,
          })),
          { onConflict: "task_id,event_id,kind", ignoreDuplicates: true },
        )
        .select(SUGGESTION_COLUMNS)
        .returns<SuggestionRow[]>();

      if (error) throw new Error(error.message);
      return (data ?? []).map(toSuggestion);
    },

    async acceptSuggestion(id: string, input: AcceptSuggestionInput) {
      const supabase = await createClient();

      const { data: row, error } = await supabase
        .from("link_suggestions")
        .select(SUGGESTION_COLUMNS)
        .eq("id", id)
        .maybeSingle<SuggestionRow>();

      if (error) throw new Error(error.message);
      if (!row) throw new SuggestionNotFoundError(id);

      const { data: event } = await supabase
        .from("calendar_events")
        .select("id, title")
        .eq("id", row.event_id ?? "")
        .maybeSingle<{ id: string; title: string | null }>();

      const now = new Date().toISOString();

      // The one place an event link is created already-confirmed. The trigger
      // in the migration rejects any other attempt, including a backdated one.
      const { data: link, error: linkError } = await supabase
        .from("task_links")
        .insert({
          task_id: row.task_id,
          kind: "event",
          relation: row.kind === "related" ? "related" : row.kind,
          target_id: row.event_id,
          target_label: event?.title ?? "A meeting",
          confirmed_at: now,
        })
        .select("id")
        .single<{ id: string }>();

      if (linkError) throw new Error(linkError.message);

      let noteId: string | null = null;
      if (input.withNote && row.event_id) {
        const isPrep = row.kind === "prep";
        const title = event?.title ?? "Meeting";

        const { data: note, error: noteError } = await supabase
          .from("notes")
          .insert({
            kind: isPrep ? "meeting" : "follow_up",
            title: isPrep ? title : `${title} — follow-up`,
            context: isPrep ? `Prep for ${title}.` : `Follow-up from ${title}.`,
          })
          .select("id")
          .single<{ id: string }>();

        if (noteError) throw new Error(noteError.message);
        noteId = note.id;
      }

      const { data: updated, error: updateError } = await supabase
        .from("link_suggestions")
        .update({
          state: "accepted",
          decided_at: now,
          created_note_id: noteId,
        })
        .eq("id", id)
        .select(SUGGESTION_COLUMNS)
        .single<SuggestionRow>();

      if (updateError) throw new Error(updateError.message);

      return {
        suggestion: toSuggestion(updated),
        linkId: link.id,
        noteId,
      };
    },

    async dismissSuggestion(id: string) {
      const supabase = await createClient();

      // Dismissed, not deleted. The row is what stops the question being asked
      // again on the next detection run.
      const { data, error } = await supabase
        .from("link_suggestions")
        .update({ state: "dismissed", decided_at: new Date().toISOString() })
        .eq("id", id)
        .select(SUGGESTION_COLUMNS)
        .maybeSingle<SuggestionRow>();

      if (error) throw new Error(error.message);
      if (!data) throw new SuggestionNotFoundError(id);

      return toSuggestion(data);
    },
  };
}
