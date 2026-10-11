import "server-only";

import { ownerFilter, owned, type DataScope } from "@/lib/db/scope";

import { dueForRefresh, type ExternalRef } from "./model";
import type { RefreshStore } from "./refresh";
import type { ResolvedRef } from "./types";

/**
 * The three operations the background refresh needs, for a scope that may be
 * the service role.
 *
 * ── Why this exists rather than a flag on the main repository ────────────
 * `repository.supabase.ts` has twenty-odd queries and relies on RLS to decide
 * whose rows they touch. That is correct and it is the right default: a
 * forgotten filter there is an empty result, not a leak.
 *
 * Under the service role the polarity flips — a forgotten filter *is* the
 * leak. Rather than adding an owner clause to twenty queries and hoping none
 * was missed, the one job that runs elevated gets three functions that each
 * carry theirs, visibly, on the line above the query.
 */

interface RefRow {
  id: string;
  provider: ExternalRef["provider"];
  kind: ExternalRef["kind"];
  remote_id: string;
  url: string;
  title: string;
  subtitle: string | null;
  state: ExternalRef["state"];
  state_detail: string | null;
  author: string | null;
  remote_updated_at: string | null;
  fetched_at: string | null;
  fetch_error: string | null;
  created_at: string;
  updated_at: string;
}

const REF_COLUMNS =
  "id, provider, kind, remote_id, url, title, subtitle, state, state_detail, " +
  "author, remote_updated_at, fetched_at, fetch_error, created_at, updated_at";

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

export function createRefreshStore(scope: DataScope): RefreshStore {
  return {
    async staleRefs(limit: number) {
      const supabase = await scope.client();

      // Only references something still points at. An orphan is on its way to
      // being purged, and refreshing it would keep resetting the clock that
      // decides when.
      const { data, error } = await supabase
        .from("external_refs")
        .select(`${REF_COLUMNS}, external_links!inner(id)`)
        .match(ownerFilter(scope))
        .order("fetched_at", { ascending: true, nullsFirst: true })
        .limit(limit * 4)
        .returns<RefRow[]>();

      if (error) throw new Error(error.message);

      const now = new Date();
      const seen = new Set<string>();

      return (
        (data ?? [])
          .map(toRef)
          // An inner join emits one row per link, and a reference attached to
          // three tasks is still one reference to re-fetch.
          .filter((ref) =>
            seen.has(ref.id) ? false : seen.add(ref.id) && true,
          )
          .filter((ref) => dueForRefresh(ref, now))
          .slice(0, limit)
      );
    },

    async upsertRef(resolved: ResolvedRef) {
      const supabase = await scope.client();
      const now = new Date().toISOString();

      const { data, error } = await supabase
        .from("external_refs")
        .upsert(
          owned(scope, {
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
            // would keep saying "out of date" about something just checked.
            fetch_error: null,
          }),
          { onConflict: "user_id,provider,remote_id" },
        )
        .select(REF_COLUMNS)
        .single<RefRow>();

      if (error) throw new Error(error.message);
      return toRef(data);
    },

    async recordRefFailure(id: string, message: string) {
      const supabase = await scope.client();

      const { error } = await supabase
        .from("external_refs")
        .update({ fetch_error: message, fetched_at: new Date().toISOString() })
        .match({ ...ownerFilter(scope), id });

      if (error) throw new Error(error.message);
    },
  };
}
