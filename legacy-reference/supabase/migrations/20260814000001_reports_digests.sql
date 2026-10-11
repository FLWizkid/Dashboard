-- ─────────────────────────────────────────────────────────────────────────
-- Phase 6 — reports and digests
--
-- Three tables and a schedule.
--
-- The composing and rendering happen in TypeScript (`src/lib/reports/`),
-- because the digest has to agree with the on-screen report and there is only
-- one sane way to guarantee that: one implementation. What Postgres owns is
-- the timetable, the delivered copies, and the record of what was sent.
-- ─────────────────────────────────────────────────────────────────────────

do $$ begin
  create type public.digest_kind as enum ('daily', 'weekly', 'monthly');
exception
  when duplicate_object then null;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- The in-app inbox
-- ─────────────────────────────────────────────────────────────────────────
--
-- Written first and unconditionally on every digest run, before any email is
-- attempted. That ordering is the whole reliability story: an SMTP outage on
-- Monday morning costs you the email, never the brief.

create table if not exists public.inbox_messages (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid()
                 references auth.users (id) on delete cascade,

  kind         public.digest_kind not null,
  subject      text not null check (char_length(btrim(subject)) between 1 and 300),
  -- One line for the list. Stored rather than derived so the list query never
  -- has to parse a body to render a row.
  preview      text not null default '' check (char_length(preview) <= 500),

  -- The text rendering. This is what the in-app reader shows, and what a
  -- text-only mail client received.
  body         text not null,
  -- The HTML rendering, kept so "view the email as sent" is answerable.
  html         text,

  read_at      timestamptz,
  -- Digests age out with everything else; see the retention job.
  generated_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists inbox_messages_unread_idx
  on public.inbox_messages (user_id, generated_at desc)
  where read_at is null;

create index if not exists inbox_messages_recent_idx
  on public.inbox_messages (user_id, generated_at desc);

alter table public.inbox_messages enable row level security;

drop policy if exists "Users can view their own inbox" on public.inbox_messages;
create policy "Users can view their own inbox"
  on public.inbox_messages for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own inbox" on public.inbox_messages;
create policy "Users can insert their own inbox"
  on public.inbox_messages for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own inbox" on public.inbox_messages;
create policy "Users can update their own inbox"
  on public.inbox_messages for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own inbox" on public.inbox_messages;
create policy "Users can delete their own inbox"
  on public.inbox_messages for delete using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Digest settings
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.digest_settings (
  user_id        uuid primary key default auth.uid()
                   references auth.users (id) on delete cascade,

  daily_enabled  boolean not null default true,
  weekly_enabled boolean not null default true,
  monthly_enabled boolean not null default false,

  -- Local wall-clock time the brief should land, in the owner's zone. Stored
  -- as an integer hour rather than a `time` because that is the whole
  -- resolution anyone wants, and it makes the cron comparison trivial.
  daily_hour     integer not null default 7 check (daily_hour between 0 and 23),
  -- 1 = Monday, matching the work-week default.
  weekly_dow     integer not null default 1 check (weekly_dow between 0 and 6),

  time_zone      text not null default 'UTC',

  -- Where the email goes. Null means in-app only, which is a valid
  -- configuration rather than a broken one.
  email_to       text check (email_to is null
                             or char_length(email_to) between 3 and 320),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.digest_settings enable row level security;

drop policy if exists "Users can view their own digest settings" on public.digest_settings;
create policy "Users can view their own digest settings"
  on public.digest_settings for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own digest settings" on public.digest_settings;
create policy "Users can insert their own digest settings"
  on public.digest_settings for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own digest settings" on public.digest_settings;
create policy "Users can update their own digest settings"
  on public.digest_settings for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists digest_settings_set_updated_at on public.digest_settings;
create trigger digest_settings_set_updated_at
  before update on public.digest_settings
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- The run log
-- ─────────────────────────────────────────────────────────────────────────
--
-- What was generated, when, and what happened to the email. Two jobs:
--
--   1. **Not sending twice.** The unique index below is the guard — a cron
--      that fires late, or twice, or after a restart, cannot produce two
--      morning briefs for the same day.
--   2. Telling the owner why they didn't get an email, which is otherwise a
--      silent failure with no thread to pull.

create table if not exists public.digest_runs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid()
                     references auth.users (id) on delete cascade,

  kind             public.digest_kind not null,
  -- The local date the digest is *for*, not when it ran. A brief that fires at
  -- 07:00 and a retry at 07:05 are the same brief.
  period_date      date not null,

  inbox_message_id uuid references public.inbox_messages (id) on delete set null,

  email_attempted  boolean not null default false,
  email_ok         boolean not null default false,
  email_error      text,
  channel          text not null default 'none',

  created_at       timestamptz not null default now(),

  -- An attempt that succeeded has no error; one that failed must say why.
  constraint digest_runs_error_shape check (
    (email_ok and email_error is null) or not email_ok
  )
);

-- One digest per kind per period, per owner. This is what makes the schedule
-- idempotent.
create unique index if not exists digest_runs_period_idx
  on public.digest_runs (user_id, kind, period_date);

create index if not exists digest_runs_recent_idx
  on public.digest_runs (user_id, created_at desc);

alter table public.digest_runs enable row level security;

drop policy if exists "Users can view their own digest runs" on public.digest_runs;
create policy "Users can view their own digest runs"
  on public.digest_runs for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own digest runs" on public.digest_runs;
create policy "Users can insert their own digest runs"
  on public.digest_runs for insert with check (auth.uid() = user_id);

create or replace function public.digest_runs_check_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.inbox_message_id is not null and not exists (
    select 1 from public.inbox_messages m
     where m.id = new.inbox_message_id and m.user_id = new.user_id
  ) then
    raise exception 'inbox message % does not belong to user %',
      new.inbox_message_id, new.user_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists digest_runs_message_owner on public.digest_runs;
create trigger digest_runs_message_owner
  before insert or update of inbox_message_id, user_id on public.digest_runs
  for each row execute function public.digest_runs_check_message();

-- ─────────────────────────────────────────────────────────────────────────
-- Retention
-- ─────────────────────────────────────────────────────────────────────────
--
-- Digests age out like everything else. The default is the same 24 months the
-- specification sets for mail, read from `digest_settings` is overkill — a
-- brief from two years ago has no value, so this is a fixed, generous window.

create or replace function public.purge_old_digests(older_than interval default interval '24 months')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.inbox_messages
   where generated_at < now() - older_than;
  get diagnostics removed = row_count;

  delete from public.digest_runs
   where created_at < now() - older_than;

  return removed;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- The schedule
-- ─────────────────────────────────────────────────────────────────────────
--
-- pg_cron fires an HTTP call into the application, which does the composing
-- and the sending. Postgres is the *timer*, not the renderer.
--
-- Why not compose in SQL: the digest has to say exactly what the on-screen
-- report says, and two implementations of "how many tasks are overdue" will
-- disagree eventually. One implementation, called from two places.
--
-- Everything below is wrapped in an availability check. **pg_cron is an
-- extension, and a stock Postgres — including the one the integration tests
-- run against — does not have it.** Failing the whole migration because a
-- scheduling extension is absent would make the schema un-testable, so the
-- tables above always apply and only the schedule is conditional.
-- `ops/README.md` documents enabling it on the box.

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available; digest schedule not installed. See docs/reports.md.';
    return;
  end if;

  create extension if not exists pg_cron;

  -- Hourly, not daily. The job asks the application "is it 07:00 for anyone
  -- yet?", which is the only way one schedule can serve owners in different
  -- time zones — and it makes a missed hour recoverable rather than lost
  -- until tomorrow.
  perform cron.unschedule('dashboard-digest-hourly')
    where exists (
      select 1 from cron.job where jobname = 'dashboard-digest-hourly'
    );

  perform cron.schedule(
    'dashboard-digest-hourly',
    '5 * * * *',
    $cron$
      select net.http_post(
        url := current_setting('app.digest_endpoint', true),
        headers := jsonb_build_object(
          'content-type', 'application/json',
          'authorization',
            'Bearer ' || coalesce(current_setting('app.digest_token', true), '')
        ),
        body := '{}'::jsonb
      );
    $cron$
  );

  perform cron.unschedule('dashboard-digest-purge')
    where exists (
      select 1 from cron.job where jobname = 'dashboard-digest-purge'
    );

  perform cron.schedule(
    'dashboard-digest-purge',
    '30 3 * * 0',
    'select public.purge_old_digests();'
  );
exception
  when others then
    -- A scheduling problem must not take the schema with it.
    raise notice 'digest schedule not installed: %', sqlerrm;
end $$;

comment on table public.inbox_messages is
  'Delivered digests. Written before any email is attempted, so a send failure never loses the brief.';

comment on table public.digest_runs is
  'One row per digest per period. The unique index is what stops a late or repeated cron firing sending twice.';
