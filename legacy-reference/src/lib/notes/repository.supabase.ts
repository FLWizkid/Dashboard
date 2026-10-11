import { createClient } from "@/lib/supabase/server";

import { titleKey } from "./backlinks";
import { extractWikiLinks, vaultPathFor, type NoteKind } from "./markdown";
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
import type {
  Backlink,
  Note,
  NoteLink,
  NoteLinkKind,
  NoteSummary,
} from "./types";

/**
 * Supabase-backed note repository.
 *
 * RLS does the access control; `user_id` is never sent because the column
 * defaults to `auth.uid()`.
 *
 * Links are **rewritten from the note's text on every save** rather than
 * maintained incrementally. The prose is the truth — it is what round-trips to
 * the vault and what a person edits in Obsidian — and an index that can drift
 * from it is worse than no index. Rewriting is a delete-and-insert of a
 * handful of rows.
 */

interface NoteRow {
  id: string;
  kind: NoteKind;
  title: string;
  decision: string | null;
  rationale: string | null;
  context: string | null;
  owner: string | null;
  decided_on: string | null;
  body: string;
  vault_path: string | null;
  version: number;
  is_archived: boolean;
  is_complete_decision: boolean;
  created_at: string;
  updated_at: string;
}

interface LinkRow {
  id: string;
  note_id: string;
  kind: NoteLinkKind;
  target_note_id: string | null;
  target_id: string | null;
  target_label: string;
  created_at: string;
}

const NOTE_COLUMNS =
  "id, kind, title, decision, rationale, context, owner, decided_on, body, vault_path, version, is_archived, is_complete_decision, created_at, updated_at";

const LINK_COLUMNS =
  "id, note_id, kind, target_note_id, target_id, target_label, created_at";

function toLink(row: LinkRow): NoteLink {
  return {
    id: row.id,
    noteId: row.note_id,
    kind: row.kind,
    targetNoteId: row.target_note_id,
    targetId: row.target_id,
    targetLabel: row.target_label,
    createdAt: row.created_at,
  };
}

function toNote(row: NoteRow, links: LinkRow[]): Note {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    decision: row.decision,
    rationale: row.rationale,
    context: row.context,
    owner: row.owner,
    decidedOn: row.decided_on,
    body: row.body,
    vaultPath: row.vault_path,
    version: row.version,
    isArchived: row.is_archived,
    isCompleteDecision: row.is_complete_decision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    links: links.map(toLink),
  };
}

export function createSupabaseNoteRepository(): NoteRepository {
  return {
    async listNotes(query: ListNotesQuery) {
      const supabase = await createClient();

      let builder = supabase.from("notes").select(NOTE_COLUMNS);

      if (!query.includeArchived) builder = builder.eq("is_archived", false);
      if (query.kind) builder = builder.eq("kind", query.kind);
      if (query.q) {
        // Postgres full-text search over the generated, weighted vector —
        // title and decision rank above context and body, which is the order
        // someone scanning a decision log actually wants.
        builder = builder.textSearch("search_vector", query.q, {
          type: "websearch",
          config: "english",
        });
      }

      const { data, error } = await builder
        .order("updated_at", { ascending: false })
        .limit(query.limit)
        .returns<NoteRow[]>();

      if (error) throw new Error(error.message);

      const rows = data ?? [];
      if (rows.length === 0) return [];

      const { data: linkRows, error: linkError } = await supabase
        .from("note_links")
        .select("target_note_id")
        .in(
          "target_note_id",
          rows.map((row) => row.id),
        )
        .returns<{ target_note_id: string | null }[]>();

      if (linkError) throw new Error(linkError.message);

      const counts = new Map<string, number>();
      for (const link of linkRows ?? []) {
        if (!link.target_note_id) continue;
        counts.set(
          link.target_note_id,
          (counts.get(link.target_note_id) ?? 0) + 1,
        );
      }

      return rows.map<NoteSummary>((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        decision: row.decision,
        owner: row.owner,
        decidedOn: row.decided_on,
        isCompleteDecision: row.is_complete_decision,
        isArchived: row.is_archived,
        updatedAt: row.updated_at,
        backlinkCount: counts.get(row.id) ?? 0,
      }));
    },

    async getNote(id: string) {
      const supabase = await createClient();

      const { data, error } = await supabase
        .from("notes")
        .select(NOTE_COLUMNS)
        .eq("id", id)
        .maybeSingle<NoteRow>();

      if (error) throw new Error(error.message);
      if (!data) return null;

      const { data: links, error: linkError } = await supabase
        .from("note_links")
        .select(LINK_COLUMNS)
        .eq("note_id", id)
        .returns<LinkRow[]>();

      if (linkError) throw new Error(linkError.message);
      return toNote(data, links ?? []);
    },

    async createNote(input: CreateNotePayload) {
      const supabase = await createClient();
      const now = new Date().toISOString();

      const { data, error } = await supabase
        .from("notes")
        .insert({
          kind: input.kind,
          title: input.title,
          decision: input.decision,
          rationale: input.rationale,
          context: input.context,
          owner: input.owner,
          decided_on: input.decidedOn,
          body: input.body,
          vault_path: vaultPathFor({
            kind: input.kind,
            title: input.title,
            decidedOn: input.decidedOn,
            createdAt: now,
          }),
        })
        .select(NOTE_COLUMNS)
        .single<NoteRow>();

      if (error) throw new Error(error.message);

      await writeLinks(data.id, linkableText(input), input.links);
      // The new page may be the target a dozen older links have been waiting
      // for; Obsidian resolves them the moment the file appears, and so do we.
      await this.resolveLinks();

      return (await this.getNote(data.id))!;
    },

    async updateNote(id: string, patch: UpdateNotePayload) {
      const supabase = await createClient();

      const existing = await this.getNote(id);
      if (!existing) throw new NoteNotFoundError(id);

      const merged = { ...existing, ...patch };

      const { data, error } = await supabase
        .from("notes")
        .update({
          ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.decision !== undefined ? { decision: patch.decision } : {}),
          ...(patch.rationale !== undefined
            ? { rationale: patch.rationale }
            : {}),
          ...(patch.context !== undefined ? { context: patch.context } : {}),
          ...(patch.owner !== undefined ? { owner: patch.owner } : {}),
          ...(patch.decidedOn !== undefined
            ? { decided_on: patch.decidedOn }
            : {}),
          ...(patch.body !== undefined ? { body: patch.body } : {}),
          ...(patch.isArchived !== undefined
            ? { is_archived: patch.isArchived }
            : {}),
          // Half of the three-way reconciliation: the reconciler compares this
          // against the version recorded when file and app last agreed.
          version: existing.version + 1,
        })
        .eq("id", id)
        .select(NOTE_COLUMNS)
        .maybeSingle<NoteRow>();

      if (error) throw new Error(error.message);
      if (!data) throw new NoteNotFoundError(id);

      await writeLinks(
        id,
        linkableText(merged),
        patch.links ??
          existing.links
            .filter((link) => link.kind !== "note")
            .map<NoteLinkInput>((link) => ({
              kind: link.kind,
              targetNoteId: link.targetNoteId,
              targetId: link.targetId,
              targetLabel: link.targetLabel,
            })),
      );

      return (await this.getNote(id))!;
    },

    async deleteNote(id: string) {
      const supabase = await createClient();
      // `target_note_id` is `on delete set null`, so inbound links become
      // unresolved rather than vanishing — the prose still says `[[…]]`.
      const { error } = await supabase.from("notes").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },

    async backlinksFor(id: string) {
      const supabase = await createClient();

      const target = await this.getNote(id);
      if (!target) return [];

      const { data: links, error } = await supabase
        .from("note_links")
        .select("note_id")
        .eq("target_note_id", id)
        .returns<{ note_id: string }[]>();

      if (error) throw new Error(error.message);

      const ids = [...new Set((links ?? []).map((link) => link.note_id))];
      if (ids.length === 0) return [];

      const { data: rows, error: noteError } = await supabase
        .from("notes")
        .select(NOTE_COLUMNS)
        .in("id", ids)
        .returns<NoteRow[]>();

      if (noteError) throw new Error(noteError.message);

      return (rows ?? []).map<Backlink>((row) => ({
        noteId: row.id,
        title: row.title,
        kind: row.kind,
        excerpt: excerptAround(
          linkableText({
            decision: row.decision,
            rationale: row.rationale,
            context: row.context,
            body: row.body,
          }),
          target.title,
        ),
      }));
    },

    async resolveLinks() {
      const supabase = await createClient();

      const [{ data: notes }, { data: links }] = await Promise.all([
        supabase
          .from("notes")
          .select("id, title")
          .returns<{ id: string; title: string }[]>(),
        supabase
          .from("note_links")
          .select("id, note_id, target_label")
          .eq("kind", "note")
          .is("target_note_id", null)
          .returns<{ id: string; note_id: string; target_label: string }[]>(),
      ]);

      const byTitle = new Map(
        (notes ?? []).map((note) => [titleKey(note.title), note] as const),
      );

      let resolved = 0;
      for (const link of links ?? []) {
        const target = byTitle.get(titleKey(link.target_label));
        if (!target || target.id === link.note_id) continue;

        const { error } = await supabase
          .from("note_links")
          .update({ target_note_id: target.id })
          .eq("id", link.id);

        if (!error) resolved += 1;
      }

      return resolved;
    },

    async titles() {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("notes")
        .select("id, title, kind")
        .eq("is_archived", false)
        .order("title", { ascending: true })
        .returns<{ id: string; title: string; kind: string }[]>();

      if (error) throw new Error(error.message);
      return data ?? [];
    },
  };
}

/**
 * Replaces a note's links with the ones its text implies.
 *
 * Delete-then-insert rather than a diff: the set is small, the unique index
 * makes a partial update fiddly, and "what the prose says" is the only state
 * worth preserving.
 */
async function writeLinks(
  noteId: string,
  text: string,
  explicit: NoteLinkInput[],
): Promise<void> {
  const supabase = await createClient();

  await supabase.from("note_links").delete().eq("note_id", noteId);

  const { data: notes } = await supabase
    .from("notes")
    .select("id, title")
    .returns<{ id: string; title: string }[]>();

  const byTitle = new Map(
    (notes ?? []).map((note) => [titleKey(note.title), note] as const),
  );

  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const wiki of extractWikiLinks(text)) {
    const key = `note:${wiki.target.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const target = byTitle.get(titleKey(wiki.target));
    rows.push({
      note_id: noteId,
      kind: "note",
      target_note_id: target && target.id !== noteId ? target.id : null,
      target_id: null,
      target_label: wiki.target,
    });
  }

  for (const link of explicit) {
    const key = `${link.kind}:${link.targetLabel.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      note_id: noteId,
      kind: link.kind,
      target_note_id: link.kind === "note" ? link.targetNoteId : null,
      target_id: link.kind === "note" ? null : link.targetId,
      target_label: link.targetLabel,
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("note_links").insert(rows);
    if (error) throw new Error(error.message);
  }
}
