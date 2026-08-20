-- ─────────────────────────────────────────────────────────────────────────
-- Sync wiring
-- ─────────────────────────────────────────────────────────────────────────
--
-- Two gaps this closes, both of which made a green test suite look like a
-- working product:
--
--   1. Nothing could write `messages.search_vector`. The vector has to be
--      built from plaintext the application must not store, so there was no
--      way to do it from the client without sending the body to the database
--      as a column value. This adds a function that takes the text, keeps the
--      vector, and returns nothing.
--
--   2. `purge_expired_messages()` existed and was tested, but no schedule
--      ever called it. Cached bodies therefore aged out only in the test
--      suite. Retention that never runs is not retention.

-- ── Search vector ────────────────────────────────────────────────────────
--
-- `security definer` so the scheduled sync can index a row it is allowed to
-- write; the owner check below is what keeps that from becoming a way to
-- touch somebody else's mail. `search_path` is pinned because a definer
-- function that resolves names through the caller's path is a well-known
-- escalation route.

create or replace function public.set_message_search_vector(
  p_message_id uuid,
  p_text text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.messages
     set search_vector = to_tsvector('english', coalesce(p_text, '')),
         updated_at    = now()
   where id = p_message_id
     -- Service-role callers have no auth.uid(); RLS is not in play for them,
     -- so the scope they were constructed with is the boundary. For a session
     -- caller this clause is what stops one account indexing another's row.
     and (auth.uid() is null or user_id = auth.uid());
end;
$$;

comment on function public.set_message_search_vector(uuid, text) is
  'Builds a message search vector from plaintext without storing the plaintext.';

-- Least privilege, but only where the roles exist. The Supabase roles are
-- created by the platform image; a plain Postgres (the integration harness)
-- has neither, and an unguarded grant would fail the whole migration there.
revoke all on function public.set_message_search_vector(uuid, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.set_message_search_vector(uuid, text)
      to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.set_message_search_vector(uuid, text)
      to service_role;
  end if;
end;
$$;

-- ── Retention purge, actually scheduled ──────────────────────────────────
--
-- Hourly rather than daily: the purge is cheap, and an hourly cadence means a
-- shortened retention window takes effect within the hour instead of at some
-- point tomorrow. Guarded so the migration still applies on a database
-- without pg_cron (the test harness, for one).

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-expired-messages')
      where exists (
        select 1 from cron.job where jobname = 'purge-expired-messages'
      );

    perform cron.schedule(
      'purge-expired-messages',
      '20 * * * *',
      $job$select public.purge_expired_messages()$job$
    );
  else
    raise notice 'pg_cron not installed; schedule purge_expired_messages() externally';
  end if;
end;
$$;
