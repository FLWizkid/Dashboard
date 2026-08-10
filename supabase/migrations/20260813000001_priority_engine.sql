-- ─────────────────────────────────────────────────────────────────────────
-- Phase 5 — the priority engine
--
-- Two additions to `tasks`, and one table.
--
-- The design decision worth stating up front: **the score is not stored.**
--
-- A score is a function of the task, its links, and *what time it is*. Storing
-- it would mean every row is stale the moment the clock moves — a task that
-- becomes overdue at midnight would keep yesterday's score until something
-- happened to rewrite it, and "something happened to rewrite it" is exactly
-- the sort of background job that fails silently and leaves a dashboard
-- confidently showing the wrong order.
--
-- So the score is computed at read time from `src/lib/priority/score.ts`,
-- which is pure and fast. What IS stored is the thing the clock cannot
-- derive: the owner's manual override.
-- ─────────────────────────────────────────────────────────────────────────

-- ── The manual override ──────────────────────────────────────────────────
--
-- Sticky by construction: nothing in the automatic path writes this column,
-- so no rescore can clear it. Only an explicit act by the owner sets or
-- removes it. Lower sorts first; null means "let the engine decide".
alter table public.tasks
  add column if not exists manual_rank integer
    check (manual_rank is null or manual_rank between 0 and 9999);

-- When they last placed it by hand. Shown in the explanation ("you moved this
-- on Tuesday"), and the tie-break when two tasks somehow share a rank.
alter table public.tasks
  add column if not exists manual_rank_set_at timestamptz;

create index if not exists tasks_manual_rank_idx
  on public.tasks (user_id, manual_rank)
  where manual_rank is not null;

-- Keeps the timestamp honest without the application having to remember.
create or replace function public.tasks_touch_manual_rank()
returns trigger
language plpgsql
as $$
begin
  if new.manual_rank is distinct from old.manual_rank then
    new.manual_rank_set_at := case
      when new.manual_rank is null then null
      else now()
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_manual_rank_stamp on public.tasks;
create trigger tasks_manual_rank_stamp
  before update of manual_rank on public.tasks
  for each row execute function public.tasks_touch_manual_rank();

-- ─────────────────────────────────────────────────────────────────────────
-- Suggested links
-- ─────────────────────────────────────────────────────────────────────────
--
-- The specification is unambiguous: *never auto-link silently.* So a detected
-- relationship lands here, as a **suggestion**, and only becomes a real
-- `task_links` row when the owner says yes.
--
-- Keeping suggestions in their own table rather than as unconfirmed
-- `task_links` rows is deliberate. A suggestion is not a weak link; it is a
-- question. Storing it alongside real links means every consumer has to
-- remember to filter, and the first one that forgets shows a relationship the
-- owner never agreed to.

do $$ begin
  create type public.suggestion_kind as enum ('prep', 'follow_up', 'related');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.suggestion_state as enum (
    'pending', 'accepted', 'dismissed'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.link_suggestions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid()
                  references auth.users (id) on delete cascade,

  task_id       uuid not null references public.tasks (id) on delete cascade,
  event_id      uuid references public.calendar_events (id) on delete cascade,

  kind          public.suggestion_kind not null,
  state         public.suggestion_state not null default 'pending',

  -- Why we think these are related, in a sentence. The owner is being asked
  -- to confirm something, and "we noticed X" is the only honest way to ask.
  reason        text not null check (char_length(btrim(reason)) between 1 and 400),
  -- 0–1. Shown as wording, never as a number: "this looks like prep for" reads
  -- better than "0.72 confidence".
  confidence    numeric(3, 2) not null default 0.5
                  check (confidence >= 0 and confidence <= 1),

  -- When accepted, the note we offered to create alongside the link.
  created_note_id uuid references public.notes (id) on delete set null,

  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A decided suggestion records when. An undecided one must not pretend to.
  constraint link_suggestions_decided_shape check (
    (state = 'pending' and decided_at is null)
    or (state <> 'pending' and decided_at is not null)
  )
);

-- One live suggestion per task/event/kind. Re-running detection must not pile
-- up duplicates of a question the owner has already been asked.
create unique index if not exists link_suggestions_unique_idx
  on public.link_suggestions (task_id, event_id, kind)
  where event_id is not null;

create index if not exists link_suggestions_pending_idx
  on public.link_suggestions (user_id, created_at desc)
  where state = 'pending';

alter table public.link_suggestions enable row level security;

drop policy if exists "Users can view their own suggestions" on public.link_suggestions;
create policy "Users can view their own suggestions"
  on public.link_suggestions for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own suggestions" on public.link_suggestions;
create policy "Users can insert their own suggestions"
  on public.link_suggestions for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own suggestions" on public.link_suggestions;
create policy "Users can update their own suggestions"
  on public.link_suggestions for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own suggestions" on public.link_suggestions;
create policy "Users can delete their own suggestions"
  on public.link_suggestions for delete using (auth.uid() = user_id);

drop trigger if exists link_suggestions_set_updated_at on public.link_suggestions;
create trigger link_suggestions_set_updated_at
  before update on public.link_suggestions
  for each row execute function public.set_updated_at();

create or replace function public.link_suggestions_check_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.tasks t
     where t.id = new.task_id and t.user_id = new.user_id
  ) then
    raise exception 'task % does not belong to user %', new.task_id, new.user_id
      using errcode = 'check_violation';
  end if;

  if new.event_id is not null and not exists (
    select 1 from public.calendar_events e
     where e.id = new.event_id and e.user_id = new.user_id
  ) then
    raise exception 'event % does not belong to user %', new.event_id, new.user_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists link_suggestions_owner on public.link_suggestions;
create trigger link_suggestions_owner
  before insert or update of task_id, event_id, user_id
  on public.link_suggestions
  for each row execute function public.link_suggestions_check_owner();

-- ─────────────────────────────────────────────────────────────────────────
-- The guard that makes "never auto-link silently" a database rule
-- ─────────────────────────────────────────────────────────────────────────
--
-- `task_links.confirmed_at` already distinguishes a confirmed link from a
-- suggested one. What was missing is the rule that a link to a calendar event
-- cannot be born confirmed unless someone confirmed it *now* — which is what
-- an accepted suggestion does.
--
-- Without this, a future sync job could insert `confirmed_at = now()` on a
-- guess and the owner would find relationships in their data they never
-- agreed to. The whole point of confirm-before-link is that it survives the
-- next person who writes an import script.
create or replace function public.task_links_guard_event_confirmation()
returns trigger
language plpgsql
as $$
begin
  if new.kind = 'event' and new.confirmed_at is not null then
    -- Backdating a confirmation is the shape a silent auto-link would take:
    -- it makes the row look like the owner agreed at some point in the past.
    if new.confirmed_at < now() - interval '1 minute' then
      raise exception
        'an event link cannot be created already-confirmed; ask the owner first'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists task_links_event_confirmation on public.task_links;
create trigger task_links_event_confirmation
  before insert on public.task_links
  for each row execute function public.task_links_guard_event_confirmation();

comment on column public.tasks.manual_rank is
  'Manual override. Nothing automatic writes this, so a rescore cannot clear it. Lower sorts first.';

comment on table public.link_suggestions is
  'Detected task/event relationships awaiting the owner''s answer. A suggestion is a question, not a weak link.';
