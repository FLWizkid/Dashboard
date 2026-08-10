import { createClient } from "@/lib/supabase/server";

import {
  dueForRefresh,
  type ExternalAccount,
  type ExternalLink,
  type ExternalLinkRelation,
  type ExternalProvider,
  type ExternalRef,
  type ExternalRefKind,
  type ExternalRefState,
  type LinkedRef,
} from "./model";
import {
  AlreadyLinkedError,
  LinkNotFoundError,
  RefNotFoundError,
  type ConnectorRepository,
} from "./repository";
import type { ResolvedRef } from "./types";

/**
 * Supabase-backed repository.
 *
 * Access control is Row Level Security: every statement runs as the signed-in
 * user through the request's cookie, so a query that forgot a `user_id` filter
 * still cannot see anyone else's rows. `user_id` is never sent — the column
 * defaults to `auth.uid()`.
 */

const UNIQUE_VIOLATION = "23505";

const REF_COLUMNS =
  "id, provider, kind, remote_id, url, title, subtitle, state, state_detail, author, remote_updated_at, fetched_at, fetch_error, created_at, updated_at";

const LINK_COLUMNS =
  "id, ref_id, task_id, note_id, relation, confirmed_at, created_at";

interface RefRow {
  id: string;
  provider: ExternalProvider;
  kind: ExternalRefKind;
  remote_id: string;
  url: string;
  title: string;
  subtitle: string | null;
  state: ExternalRefState;
  state_detail: string | null;
  author: string | null;
  remote_updated_at: string | null;
  fetched_at: string | null;
  fetch_error: string | null;
  created_at: string;
  updated_at: string;
}

interface LinkRow {
  id: string;
  ref_id: string;
  task_id: string | null;
  note_id: string | null;
  relation: ExternalLinkRelation;
  confirmed_at: string | null;
  created_at: string;
}

interface AccountRow {
  id: string;
  provider: ExternalProvider;
  account_label: string;
  base_url: string | null;
  is_enabled: boolean;
  last_synced_at: string | null;
  last_error: string | null;
}

function toRef(row: RefRow): ExternalRef {
  return {
    id: row.id,
    provider: row.provider,
    kind: row.kind,
    remoteId: row.remote_id,
    url: row.url,
    title: row.title,
    subtitle: row.subtitle,
    state: row.state,
    stateDetail: row.state_detail,
    author: row.author,
    remoteUpdatedAt: row.remote_updated_at,
    fetchedAt: row.fetched_at,
    fetchError: row.fetch_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toLink(row: LinkRow): ExternalLink {
  return {
    id: row.id,
    refId: row.ref_id,
    taskId: row.task_id,
    noteId: row.note_id,
    relation: row.relation,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
  };
}

function toAccount(row: AccountRow): ExternalAccount {
  return {
    id: row.id,
    provider: row.provider,
    accountLabel: row.account_label,
    baseUrl: row.base_url,
    isEnabled: row.is_enabled,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
  };
}

export function createSupabaseConnectorRepository(): ConnectorRepository {
  /** Links with their references, in one round trip rather than N+1. */
  async function hydrate(rows: LinkRow[]): Promise<LinkedRef[]> {
    if (rows.length === 0) return [];

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("external_refs")
      .select(REF_COLUMNS)
      .in("id", [...new Set(rows.map((row) => row.ref_id))])
      .returns<RefRow[]>();

    if (error) throw new Error(error.message);

    const byId = new Map((data ?? []).map((row) => [row.id, toRef(row)]));

    return rows
      .map((row) => {
        const ref = byId.get(row.ref_id);
        // A link whose reference is invisible is not an error to shout about
        // — RLS could hide it — but it must not be rendered as a link to
        // nothing. Dropped, quietly.
        return ref ? { ...toLink(row), ref } : null;
      })
      .filter((link): link is LinkedRef => link !== null);
  }

  return {
    /* ── Accounts ───────────────────────────────────────────────────── */

    async listAccounts() {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("external_accounts")
        .select(
          "id, provider, account_label, base_url, is_enabled, last_synced_at, last_error",
        )
        .order("provider")
        .returns<AccountRow[]>();

      if (error) throw new Error(error.message);
      return (data ?? []).map(toAccount);
    },

    async getAccount(provider) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("external_accounts")
        .select(
          "id, provider, account_label, base_url, is_enabled, last_synced_at, last_error",
        )
        .eq("provider", provider)
        .maybeSingle<AccountRow>();

      if (error) throw new Error(error.message);
      return data ? toAccount(data) : null;
    },

    async saveAccount(input) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("external_accounts")
        .upsert(
          {
            provider: input.provider,
            account_label: input.accountLabel,
            base_url: input.baseUrl ?? null,
            is_enabled: input.isEnabled ?? true,
          },
          { onConflict: "user_id,provider" },
        )
        .select(
          "id, provider, account_label, base_url, is_enabled, last_synced_at, last_error",
        )
        .single<AccountRow>();

      if (error) throw new Error(error.message);
      return toAccount(data);
    },

    async recordAccountResult(provider, result) {
      const supabase = await createClient();
      const { error } = await supabase
        .from("external_accounts")
        .update({
          last_synced_at: new Date().toISOString(),
          last_error: result.error,
        })
        .eq("provider", provider);

      if (error) throw new Error(error.message);
    },

    async removeAccount(provider) {
      const supabase = await createClient();
      const { error } = await supabase
        .from("external_accounts")
        .delete()
        .eq("provider", provider);

      if (error) throw new Error(error.message);
    },

    /* ── References ─────────────────────────────────────────────────── */

    async upsertRef(resolved: ResolvedRef) {
      const supabase = await createClient();
      const now = new Date().toISOString();

      const { data, error } = await supabase
        .from("external_refs")
        .upsert(
          {
            provider: resolved.provider,
            kind: resolved.kind,
            remote_id: resolved.remoteId,
            url: resolved.url,
            title: resolved.title,
            subtitle: resolved.subtitle,
            state: resolved.state,
            state_detail: resolved.stateDetail,
            author: resolved.author,
            remote_updated_at: resolved.remoteUpdatedAt,
            fetched_at: now,
            // A successful fetch clears the previous failure, or the interface
            // keeps explaining a problem that has gone away.
            fetch_error: null,
            snapshot: resolved.snapshot,
          },
          { onConflict: "user_id,provider,remote_id" },
        )
        .select(REF_COLUMNS)
        .single<RefRow>();

      if (error) throw new Error(error.message);
      return toRef(data);
    },

    async recordRefFailure(id, message) {
      const supabase = await createClient();
      const { error } = await supabase
        .from("external_refs")
        .update({
          // Title and state are deliberately left alone. Yesterday's answer
          // beats none, as long as it is labelled as yesterday's.
          fetched_at: new Date().toISOString(),
          fetch_error: message,
        })
        .eq("id", id);

      if (error) throw new Error(error.message);
    },

    async getRef(id) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("external_refs")
        .select(REF_COLUMNS)
        .eq("id", id)
        .maybeSingle<RefRow>();

      if (error) throw new Error(error.message);
      return data ? toRef(data) : null;
    },

    async staleRefs(limit) {
      const supabase = await createClient();

      // Oldest-fetched first, so a large set catches up evenly instead of the
      // same few rows being re-fetched forever. The staleness *rule* stays in
      // one place — `dueForRefresh` — rather than being re-expressed as SQL
      // here and drifting from it.
      const { data, error } = await supabase
        .from("external_refs")
        .select(REF_COLUMNS)
        .order("fetched_at", { ascending: true, nullsFirst: true })
        .limit(limit * 4)
        .returns<RefRow[]>();

      if (error) throw new Error(error.message);

      const now = new Date();
      return (data ?? [])
        .map(toRef)
        .filter((ref) => dueForRefresh(ref, now))
        .slice(0, limit);
    },

    async searchRefs(query, limit) {
      const trimmed = query.trim();
      if (!trimmed) return [];

      const supabase = await createClient();
      const { data, error } = await supabase
        .from("external_refs")
        .select(REF_COLUMNS)
        .textSearch("search_vector", trimmed, {
          type: "plain",
          config: "english",
        })
        .limit(limit)
        .returns<RefRow[]>();

      if (error) throw new Error(error.message);
      return (data ?? []).map(toRef);
    },

    /* ── Links ──────────────────────────────────────────────────────── */

    async linksForTask(taskId) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("external_links")
        .select(LINK_COLUMNS)
        .eq("task_id", taskId)
        .order("created_at", { ascending: true })
        .returns<LinkRow[]>();

      if (error) throw new Error(error.message);
      return hydrate(data ?? []);
    },

    async linksForNote(noteId) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("external_links")
        .select(LINK_COLUMNS)
        .eq("note_id", noteId)
        .order("created_at", { ascending: true })
        .returns<LinkRow[]>();

      if (error) throw new Error(error.message);
      return hydrate(data ?? []);
    },

    async allLinks(limit) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("external_links")
        .select(LINK_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(limit)
        .returns<LinkRow[]>();

      if (error) throw new Error(error.message);
      return hydrate(data ?? []);
    },

    async linkRef(input) {
      const supabase = await createClient();

      const { data, error } = await supabase
        .from("external_links")
        .insert({
          ref_id: input.refId,
          task_id: input.taskId ?? null,
          note_id: input.noteId ?? null,
          relation: input.relation ?? "about",
          confirmed_at: input.confirmed ? new Date().toISOString() : null,
        })
        .select(LINK_COLUMNS)
        .single<LinkRow>();

      if (error) {
        // Already attached is a success from the caller's point of view.
        if (error.code === UNIQUE_VIOLATION) {
          const existing = await findLink(input);
          if (existing) throw new AlreadyLinkedError(existing);
        }
        throw new Error(error.message);
      }

      const [link] = await hydrate([data]);
      if (!link) throw new RefNotFoundError(input.refId);
      return link;
    },

    async confirmLink(id) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("external_links")
        .update({ confirmed_at: new Date().toISOString() })
        .eq("id", id)
        .is("confirmed_at", null)
        .select(LINK_COLUMNS)
        .maybeSingle<LinkRow>();

      if (error) throw new Error(error.message);

      if (!data) {
        // Either it does not exist, or it was already confirmed. Confirming
        // twice is harmless, so read it back rather than failing.
        const { data: existing } = await supabase
          .from("external_links")
          .select(LINK_COLUMNS)
          .eq("id", id)
          .maybeSingle<LinkRow>();

        if (!existing) throw new LinkNotFoundError(id);
        const [link] = await hydrate([existing]);
        if (!link) throw new LinkNotFoundError(id);
        return link;
      }

      const [link] = await hydrate([data]);
      if (!link) throw new LinkNotFoundError(id);
      return link;
    },

    async unlink(id) {
      const supabase = await createClient();
      const { error } = await supabase
        .from("external_links")
        .delete()
        .eq("id", id);

      if (error) throw new Error(error.message);
    },

    async changedSince(since, limit) {
      const supabase = await createClient();

      const { data: refRows, error: refError } = await supabase
        .from("external_refs")
        .select("id")
        .gt("remote_updated_at", since.toISOString())
        .order("remote_updated_at", { ascending: false })
        .limit(limit)
        .returns<{ id: string }[]>();

      if (refError) throw new Error(refError.message);
      if (!refRows || refRows.length === 0) return [];

      const { data, error } = await supabase
        .from("external_links")
        .select(LINK_COLUMNS)
        .in(
          "ref_id",
          refRows.map((row) => row.id),
        )
        .returns<LinkRow[]>();

      if (error) throw new Error(error.message);

      const hydrated = await hydrate(data ?? []);
      return hydrated
        .sort((a, b) =>
          (b.ref.remoteUpdatedAt ?? "").localeCompare(
            a.ref.remoteUpdatedAt ?? "",
          ),
        )
        .slice(0, limit);
    },
  };

  /** The link that already exists for this subject and reference. */
  async function findLink(input: {
    refId: string;
    taskId?: string | null;
    noteId?: string | null;
  }): Promise<LinkedRef | null> {
    const supabase = await createClient();

    let builder = supabase
      .from("external_links")
      .select(LINK_COLUMNS)
      .eq("ref_id", input.refId);

    builder = input.taskId
      ? builder.eq("task_id", input.taskId)
      : builder.eq("note_id", input.noteId ?? "");

    const { data } = await builder.maybeSingle<LinkRow>();
    if (!data) return null;

    const [link] = await hydrate([data]);
    return link ?? null;
  }
}
