-- 20260809000001_retire_placeholder_tables.sql
--
-- Retires `priorities` and `time_entries`.
--
-- Both were created by earlier sessions working without the product
-- specification. `priorities` is superseded by `tasks`; `time_entries` will be
-- superseded by the Phase 4 hours model, which is a different shape. Their UI
-- was removed on the Phase 1 branch and no code references either table.
--
-- ── Why this moves them instead of dropping them ─────────────────────────
-- Dropping is irreversible, and these tables may hold rows you typed. Moving
-- them out of `public` achieves the thing that actually matters — they are no
-- longer part of the API surface, because PostgREST only exposes the schemas
-- named in PGRST_DB_SCHEMAS — while keeping every row recoverable with a
-- single command. If they turn out to be empty, or you have confirmed you
-- don't want the data, the drop is at the bottom of this file: run it
-- deliberately, once, after a backup.
--
-- Idempotent, like every migration here: re-running is a no-op.

create schema if not exists archive;

comment on schema archive is
  'Retired tables kept out of the API surface. Nothing here is read by the '
  'application. Safe to drop once the data is confirmed unwanted.';

do $$
declare
  retired text;
  rows_kept bigint;
begin
  foreach retired in array array['priorities', 'time_entries']
  loop
    if exists (
      select 1
        from information_schema.tables
       where table_schema = 'public'
         and table_name = retired
    ) then
      execute format('select count(*) from public.%I', retired) into rows_kept;
      execute format('alter table public.%I set schema archive', retired);

      raise notice 'moved public.% to archive.% (% row(s) preserved)',
        retired, retired, rows_kept;
    else
      raise notice 'public.% is already retired; nothing to do', retired;
    end if;
  end loop;
end
$$;

-- Belt and braces. Row Level Security stays enabled on the archived tables,
-- but the API roles lose the schema entirely: even if `archive` were ever
-- added to PGRST_DB_SCHEMAS by accident, there is nothing to select.
revoke all on schema archive from anon, authenticated;
revoke all on all tables in schema archive from anon, authenticated;

-- The triggers referenced public.set_updated_at(), which still exists and is
-- still used by the live tables, so nothing needs re-pointing.

-- ─────────────────────────────────────────────────────────────────────────
-- The final drop. NOT run by this migration.
--
-- Take a backup first (`docker compose exec backup backup.sh`), confirm the
-- row counts are what you expect, then run these two statements by hand:
--
--   select count(*) from archive.priorities;
--   select count(*) from archive.time_entries;
--
--   drop table if exists archive.priorities;
--   drop table if exists archive.time_entries;
--   drop schema if exists archive;
--
-- Once that is done, the two 20260704 migrations can be deleted from this
-- directory in a follow-up commit — they only exist to keep the history
-- replayable on a fresh database.
-- ─────────────────────────────────────────────────────────────────────────
