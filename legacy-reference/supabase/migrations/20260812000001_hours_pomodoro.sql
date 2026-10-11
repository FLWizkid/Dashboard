-- 20260812000001_hours_pomodoro.sql
-- Phase 4 — hours and Pomodoro.
--
--   pomodoro_sessions      every focus and break interval, completed or not
--   time_entries           the focused + manual ledger
--   work_category_rules    user-editable keyword rules for classifying events
--   calendars.*            source-calendar level defaults
--   calendar_events.*      per-event classification, visible and editable
--
-- ── Where the three kinds of hours come from ─────────────────────────────
--
--   focused    a completed Pomodoro focus session → a `time_entries` row
--   scheduled  a work-category calendar event, computed from the event itself
--   manual     a `time_entries` row the owner typed
--
-- Scheduled hours are **derived, not materialised**. An event can move, be
-- cancelled or be reclassified at any time, and a copied-out ledger row would
-- then be quietly wrong. Deriving them means the number is always the truth
-- about the calendar as it stands. See src/lib/hours/aggregate.ts.
--
-- ── The rule that matters most ───────────────────────────────────────────
-- **A manual override always wins.** `calendar_events.category_source` records
-- how a classification was arrived at, and once it is `'manual'` no automatic
-- rule may change it. That is enforced by a trigger, not by convention,
-- because the classifier runs on every sync and would otherwise reassert
-- itself the moment the owner looked away.

-- ─────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────

do $$
begin
  create type public.pomodoro_kind as enum ('focus', 'short_break', 'long_break');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.hours_source as enum ('focused', 'scheduled', 'manual');
exception
  when duplicate_object then null;
end
$$;

-- How an event's work category was decided, in precedence order. `manual`
-- outranks everything and is never overwritten.
do $$
begin
  create type public.classification_source as enum (
    'manual', 'rule', 'attendees', 'calendar', 'unclassified'
  );
exception
  when duplicate_object then null;
end
$$;

-- Which part of an event a keyword rule looks at.
do $$
begin
  create type public.rule_field as enum (
    'title', 'location', 'organizer', 'attendee'
  );
exception
  when duplicate_object then null;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Pomodoro sessions
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.pomodoro_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid()
                   references auth.users (id) on delete cascade,

  kind           public.pomodoro_kind not null default 'focus',
  -- Optional, as specified. A focus session with no task is still focus.
  task_id        uuid references public.tasks (id) on delete set null,

  planned_minutes integer not null check (planned_minutes between 1 and 240),
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,

  -- Ran to its planned length rather than being stopped early. An abandoned
  -- session still counts the time actually spent — the alternative is a
  -- product that punishes you for being interrupted.
  completed      boolean not null default false,

  -- Seconds actually elapsed, generated so it cannot disagree with the
  -- timestamps. Null while the session is still running.
  seconds        integer generated always as (
                   case
                     when ended_at is null then null
                     else greatest(0, extract(epoch from (ended_at - started_at))::integer)
                   end
                 ) stored,

  note           text check (note is null or char_length(note) <= 500),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint pomodoro_ends_after_starts check (ended_at is null or ended_at >= started_at)
);

create index if not exists pomodoro_sessions_user_idx
  on public.pomodoro_sessions (user_id, started_at desc);

create index if not exists pomodoro_sessions_task_idx
  on public.pomodoro_sessions (task_id)
  where task_id is not null;

-- At most one session running at a time. A second running timer means two
-- overlapping claims on the same hour, and the totals stop meaning anything.
create unique index if not exists pomodoro_sessions_one_running_idx
  on public.pomodoro_sessions (user_id)
  where ended_at is null;

alter table public.pomodoro_sessions enable row level security;

drop policy if exists "Users can view their own sessions" on public.pomodoro_sessions;
create policy "Users can view their own sessions"
  on public.pomodoro_sessions for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own sessions" on public.pomodoro_sessions;
create policy "Users can insert their own sessions"
  on public.pomodoro_sessions for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own sessions" on public.pomodoro_sessions;
create policy "Users can update their own sessions"
  on public.pomodoro_sessions for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own sessions" on public.pomodoro_sessions;
create policy "Users can delete their own sessions"
  on public.pomodoro_sessions for delete using (auth.uid() = user_id);

drop trigger if exists pomodoro_sessions_set_updated_at on public.pomodoro_sessions;
create trigger pomodoro_sessions_set_updated_at
  before update on public.pomodoro_sessions
  for each row execute function public.set_updated_at();

create or replace function public.pomodoro_check_task_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.task_id is not null and not exists (
    select 1 from public.tasks t where t.id = new.task_id and t.user_id = new.user_id
  ) then
    raise exception 'task % does not belong to user %', new.task_id, new.user_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists pomodoro_task_owner on public.pomodoro_sessions;
create trigger pomodoro_task_owner
  before insert or update of task_id, user_id on public.pomodoro_sessions
  for each row execute function public.pomodoro_check_task_owner();

-- ─────────────────────────────────────────────────────────────────────────
-- Time entries — the focused + manual ledger
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.time_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid()
                  references auth.users (id) on delete cascade,

  -- Only 'focused' and 'manual' are stored. 'scheduled' is derived from the
  -- calendar; a check keeps a future writer honest about that.
  source        public.hours_source not null,

  task_id       uuid references public.tasks (id) on delete set null,
  category_id   uuid references public.activity_categories (id) on delete set null,
  session_id    uuid references public.pomodoro_sessions (id) on delete cascade,

  started_at    timestamptz not null,
  ended_at      timestamptz not null,

  minutes       integer generated always as (
                  greatest(0, (extract(epoch from (ended_at - started_at)) / 60)::integer)
                ) stored,

  -- Shown against the entry. Manual time is always labelled as such in the
  -- interface; this is where the owner says why.
  note          text check (note is null or char_length(note) <= 500),

  -- Set by the offline outbox so a replayed flush cannot double-count.
  client_key    text check (client_key is null or char_length(client_key) between 8 and 100),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint time_entries_ends_after_starts check (ended_at >= started_at),
  constraint time_entries_source_is_stored check (source in ('focused', 'manual')),
  -- A focused entry comes from a session; a manual one never does.
  constraint time_entries_focused_has_session check (
    (source = 'focused' and session_id is not null)
    or (source = 'manual' and session_id is null)
  )
);

create index if not exists time_entries_window_idx
  on public.time_entries (user_id, started_at);

create index if not exists time_entries_source_idx
  on public.time_entries (user_id, source, started_at);

create index if not exists time_entries_task_idx
  on public.time_entries (task_id)
  where task_id is not null;

-- Idempotency for the offline outbox: the same client key never lands twice,
-- however many times a flaky connection replays it.
create unique index if not exists time_entries_client_key_idx
  on public.time_entries (user_id, client_key)
  where client_key is not null;

alter table public.time_entries enable row level security;

drop policy if exists "Users can view their own time entries" on public.time_entries;
create policy "Users can view their own time entries"
  on public.time_entries for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own time entries" on public.time_entries;
create policy "Users can insert their own time entries"
  on public.time_entries for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own time entries" on public.time_entries;
create policy "Users can update their own time entries"
  on public.time_entries for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own time entries" on public.time_entries;
create policy "Users can delete their own time entries"
  on public.time_entries for delete using (auth.uid() = user_id);

drop trigger if exists time_entries_set_updated_at on public.time_entries;
create trigger time_entries_set_updated_at
  before update on public.time_entries
  for each row execute function public.set_updated_at();

create or replace function public.time_entries_check_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.task_id is not null and not exists (
    select 1 from public.tasks t where t.id = new.task_id and t.user_id = new.user_id
  ) then
    raise exception 'task % does not belong to user %', new.task_id, new.user_id
      using errcode = 'check_violation';
  end if;

  if new.category_id is not null and not exists (
    select 1 from public.activity_categories c
     where c.id = new.category_id and c.user_id = new.user_id
  ) then
    raise exception 'category % does not belong to user %', new.category_id, new.user_id
      using errcode = 'check_violation';
  end if;

  if new.session_id is not null and not exists (
    select 1 from public.pomodoro_sessions s
     where s.id = new.session_id and s.user_id = new.user_id
  ) then
    raise exception 'session % does not belong to user %', new.session_id, new.user_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists time_entries_relations on public.time_entries;
create trigger time_entries_relations
  before insert or update of task_id, category_id, session_id, user_id
  on public.time_entries
  for each row execute function public.time_entries_check_relations();

-- ─────────────────────────────────────────────────────────────────────────
-- Work-category classification
-- ─────────────────────────────────────────────────────────────────────────

-- Source-calendar level defaults. A personal calendar can be excluded wholesale
-- rather than event by event.
alter table public.calendars
  add column if not exists counts_toward_hours boolean not null default true;

alter table public.calendars
  add column if not exists default_category_id uuid
    references public.activity_categories (id) on delete set null;

-- Per-event classification, visible and editable.
alter table public.calendar_events
  add column if not exists category_id uuid
    references public.activity_categories (id) on delete set null;

alter table public.calendar_events
  add column if not exists category_source public.classification_source
    not null default 'unclassified';

-- Tri-state on purpose:
--   null   inherit whatever the classification decided
--   true   count this event, whatever the classification decided
--   false  exclude this event, whatever the classification decided
-- The event-level toggle the specification asks for, and it survives a resync
-- because it is not something the classifier writes.
alter table public.calendar_events
  add column if not exists hours_include boolean;

-- What the classifier concluded, in a sentence, so the reasoning is visible
-- rather than a mysterious category appearing on a meeting.
alter table public.calendar_events
  add column if not exists category_reason text;

create index if not exists calendar_events_hours_idx
  on public.calendar_events (user_id, starts_at)
  where is_cancelled = false and category_id is not null;

-- A manual override is never overwritten by an automatic classification.
-- The classifier runs on every sync; without this it would reassert itself
-- the moment the owner looked away.
create or replace function public.calendar_events_protect_override()
returns trigger
language plpgsql
as $$
begin
  if old.category_source = 'manual' and new.category_source <> 'manual' then
    raise exception
      'this event''s category was set manually; an automatic rule may not change it'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists calendar_events_override_guard on public.calendar_events;
create trigger calendar_events_override_guard
  before update of category_source on public.calendar_events
  for each row execute function public.calendar_events_protect_override();

-- ─────────────────────────────────────────────────────────────────────────
-- Keyword rules
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.work_category_rules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid()
                 references auth.users (id) on delete cascade,

  -- Plain substring matching, case-insensitive. Deliberately not a regular
  -- expression: these are edited in a text box by someone who wants "board"
  -- to match "Board review", and a regex is a footgun with no upside here.
  pattern      text not null check (char_length(btrim(pattern)) between 2 and 200),
  field        public.rule_field not null default 'title',

  category_id  uuid references public.activity_categories (id) on delete cascade,
  -- A rule can also be purely an exclusion: "anything with 'lunch' in it
  -- doesn't count", with no category at all.
  counts_toward_hours boolean not null default true,

  -- Lower runs first. First match wins, so order is meaningful and editable.
  position     integer not null default 0,
  is_enabled   boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists work_category_rules_order_idx
  on public.work_category_rules (user_id, position)
  where is_enabled = true;

alter table public.work_category_rules enable row level security;

drop policy if exists "Users can view their own rules" on public.work_category_rules;
create policy "Users can view their own rules"
  on public.work_category_rules for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own rules" on public.work_category_rules;
create policy "Users can insert their own rules"
  on public.work_category_rules for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own rules" on public.work_category_rules;
create policy "Users can update their own rules"
  on public.work_category_rules for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own rules" on public.work_category_rules;
create policy "Users can delete their own rules"
  on public.work_category_rules for delete using (auth.uid() = user_id);

drop trigger if exists work_category_rules_set_updated_at on public.work_category_rules;
create trigger work_category_rules_set_updated_at
  before update on public.work_category_rules
  for each row execute function public.set_updated_at();

create or replace function public.work_category_rules_check_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.activity_categories c
     where c.id = new.category_id and c.user_id = new.user_id
  ) then
    raise exception 'category % does not belong to user %', new.category_id, new.user_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists work_category_rules_owner on public.work_category_rules;
create trigger work_category_rules_owner
  before insert or update of category_id, user_id on public.work_category_rules
  for each row execute function public.work_category_rules_check_owner();

comment on table public.time_entries is
  'Focused (Pomodoro) and manual hours. Scheduled hours are derived from '
  'calendar_events rather than stored here, so a moved or cancelled meeting '
  'cannot leave a stale ledger row behind. See docs/hours.md.';
