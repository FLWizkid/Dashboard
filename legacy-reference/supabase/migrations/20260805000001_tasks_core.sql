-- 20260805000001_tasks_core.sql
-- Phase 1 — operational core.
--
-- Introduces the three tables the whole product hangs off:
--   activity_categories  the editable CIO activity taxonomy (8 seeded defaults)
--   tasks                the single task record used by Tasks, Kanban, Reports
--   task_links           polymorphic links to messages / events / notes / cards
--
-- Every table is user-owned and protected by RLS with the same
-- `auth.uid() = user_id` shape established in 20260704000001_init.sql.
--
-- Design notes live in docs/data-model.md — read that before changing columns.

-- ─────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────

-- Four manual levels. Deliberately NULLABLE on tasks: a task with no priority
-- is untriaged, which is what keeps it out of the Ready state.
do $$
begin
  create type public.task_priority as enum ('critical', 'high', 'normal', 'low');
exception
  when duplicate_object then null;
end
$$;

-- The Kanban lanes from the product spec, in order. Phase 1 only writes
-- 'inbox' / 'in_progress' / 'done'; Phase 3 adds the board that uses the rest.
do $$
begin
  create type public.task_status as enum (
    'inbox', 'ready', 'in_progress', 'waiting', 'done'
  );
exception
  when duplicate_object then null;
end
$$;

-- What a task can be linked to. 'event' and 'message' resolve to real provider
-- records in Phase 2; 'note' and 'kanban' in Phase 3.
do $$
begin
  create type public.task_link_kind as enum ('message', 'event', 'note', 'kanban');
exception
  when duplicate_object then null;
end
$$;

-- How the linked thing relates to the task. Drives the prep/follow-up flows.
do $$
begin
  create type public.task_link_relation as enum (
    'source', 'prep', 'follow_up', 'related'
  );
exception
  when duplicate_object then null;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Activity categories — the CIO taxonomy
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.activity_categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid()
                references auth.users (id) on delete cascade,
  slug        text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  description text,
  -- Token name from the design system, not a hex value, so themes stay honest.
  color       text not null default 'primary',
  position    integer not null default 0,
  -- Seeded rows are editable and archivable but flagged so the app can tell
  -- "the default taxonomy" from "categories the owner invented".
  is_default  boolean not null default false,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, slug)
);

create index if not exists activity_categories_user_position_idx
  on public.activity_categories (user_id, position);

alter table public.activity_categories enable row level security;

drop policy if exists "Users can view their own categories" on public.activity_categories;
create policy "Users can view their own categories"
  on public.activity_categories for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own categories" on public.activity_categories;
create policy "Users can insert their own categories"
  on public.activity_categories for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own categories" on public.activity_categories;
create policy "Users can update their own categories"
  on public.activity_categories for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own categories" on public.activity_categories;
create policy "Users can delete their own categories"
  on public.activity_categories for delete
  using (auth.uid() = user_id);

drop trigger if exists activity_categories_set_updated_at on public.activity_categories;
create trigger activity_categories_set_updated_at
  before update on public.activity_categories
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Tasks
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid()
                 references auth.users (id) on delete cascade,

  title        text not null check (char_length(btrim(title)) between 1 and 500),
  notes        text,

  -- NULL = untriaged. See the enum comment above.
  priority     public.task_priority,
  due_at       timestamptz,

  category_id  uuid references public.activity_categories (id) on delete set null,
  status       public.task_status not null default 'inbox',
  pinned       boolean not null default false,

  -- Free-form provenance ("where did this come from?"). Structured links live
  -- in task_links; this is for the one-off URL that has no record behind it.
  source_link  text,

  -- Optional in personal mode; required once teammate mode lands (post-v1).
  owner        text,

  -- Ready state = title + priority + due date. Generated rather than written
  -- so it can never drift from the fields it describes, and so the Kanban
  -- promote-to-Ready check in Phase 3 is a plain indexed predicate.
  --
  -- NOTE: `is_ready` (minimum fields present) is NOT the same thing as
  -- `status = 'ready'` (the lane the card sits in). See docs/data-model.md.
  is_ready     boolean generated always as (
                 due_at is not null
                 and priority is not null
                 and char_length(btrim(title)) > 0
               ) stored,

  completed_at timestamptz,

  -- Phase 2 gives email full-text search; tasks get it here for free and the
  -- Reports/command-palette work in later phases builds on the same index.
  search_vector tsvector generated always as (
                  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                  setweight(to_tsvector('english', coalesce(notes, '')), 'B')
                ) stored,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- A done task must record when, and an open task must not claim it did.
  constraint tasks_completed_at_matches_status check (
    (status = 'done' and completed_at is not null)
    or (status <> 'done' and completed_at is null)
  )
);

-- The dashboard's "top priorities" query: open tasks for one user, ordered by
-- pin then priority then due date.
create index if not exists tasks_user_open_idx
  on public.tasks (user_id, pinned desc, priority, due_at)
  where status <> 'done';

create index if not exists tasks_user_due_idx
  on public.tasks (user_id, due_at)
  where status <> 'done' and due_at is not null;

create index if not exists tasks_user_status_idx on public.tasks (user_id, status);
create index if not exists tasks_category_idx on public.tasks (category_id);
create index if not exists tasks_search_idx on public.tasks using gin (search_vector);

alter table public.tasks enable row level security;

drop policy if exists "Users can view their own tasks" on public.tasks;
create policy "Users can view their own tasks"
  on public.tasks for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own tasks" on public.tasks;
create policy "Users can insert their own tasks"
  on public.tasks for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own tasks" on public.tasks;
create policy "Users can update their own tasks"
  on public.tasks for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own tasks" on public.tasks;
create policy "Users can delete their own tasks"
  on public.tasks for delete
  using (auth.uid() = user_id);

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- A category may only be attached to a task by the user who owns both. RLS
-- alone can't express this (the FK is checked with the table owner's rights),
-- so it is enforced as a trigger.
create or replace function public.tasks_check_category_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.category_id is not null then
    if not exists (
      select 1 from public.activity_categories c
      where c.id = new.category_id and c.user_id = new.user_id
    ) then
      raise exception 'category % does not belong to user %',
        new.category_id, new.user_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_category_owner on public.tasks;
create trigger tasks_category_owner
  before insert or update of category_id, user_id on public.tasks
  for each row execute function public.tasks_check_category_owner();

-- ─────────────────────────────────────────────────────────────────────────
-- Task links (polymorphic)
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.task_links (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid()
                 references auth.users (id) on delete cascade,
  task_id      uuid not null references public.tasks (id) on delete cascade,

  kind         public.task_link_kind not null,
  relation     public.task_link_relation not null default 'related',

  -- Provider/record identifier. NULL while the link is still unresolved — the
  -- quick-add parser can detect "before the board review" long before Phase 2
  -- can say which calendar event that is.
  target_id    text,
  target_label text not null check (char_length(btrim(target_label)) between 1 and 300),
  target_url   text,

  -- Confirm-before-link, enforced in the schema rather than only in the UI:
  -- a suggested link has confirmed_at IS NULL and must never be treated as
  -- established. Nothing in the product may auto-set this.
  confirmed_at timestamptz,

  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One link per (task, kind, target, relation) once the target is known.
-- Unresolved links (target_id IS NULL) are exempt: Postgres treats NULLs as
-- distinct, which is the behaviour we want while they're still suggestions.
create unique index if not exists task_links_unique_target_idx
  on public.task_links (task_id, kind, target_id, relation)
  where target_id is not null;

create index if not exists task_links_task_idx on public.task_links (task_id);
create index if not exists task_links_user_kind_idx on public.task_links (user_id, kind);
create index if not exists task_links_unconfirmed_idx
  on public.task_links (user_id) where confirmed_at is null;

alter table public.task_links enable row level security;

drop policy if exists "Users can view their own task links" on public.task_links;
create policy "Users can view their own task links"
  on public.task_links for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own task links" on public.task_links;
create policy "Users can insert their own task links"
  on public.task_links for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own task links" on public.task_links;
create policy "Users can update their own task links"
  on public.task_links for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own task links" on public.task_links;
create policy "Users can delete their own task links"
  on public.task_links for delete
  using (auth.uid() = user_id);

drop trigger if exists task_links_set_updated_at on public.task_links;
create trigger task_links_set_updated_at
  before update on public.task_links
  for each row execute function public.set_updated_at();

-- Same ownership guard as categories: a link may only point at your own task.
create or replace function public.task_links_check_task_owner()
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
  return new;
end;
$$;

drop trigger if exists task_links_task_owner on public.task_links;
create trigger task_links_task_owner
  before insert or update of task_id, user_id on public.task_links
  for each row execute function public.task_links_check_task_owner();

-- ─────────────────────────────────────────────────────────────────────────
-- Seeding the default taxonomy
-- ─────────────────────────────────────────────────────────────────────────

-- The eight CIO defaults. Editable and archivable by the owner after seeding —
-- this only guarantees a sensible starting point. Mirrored in TypeScript at
-- src/lib/categories/defaults.ts; change both together.
create or replace function public.seed_default_activity_categories(target_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_categories
    (user_id, slug, name, description, color, position, is_default)
  values
    (target_user, 'strategic', 'Strategic',
     'Roadmap, architecture direction, multi-quarter bets.', 'primary', 1, true),
    (target_user, 'operational', 'Operational',
     'Run-the-business: incidents, service health, delivery.', 'primary', 2, true),
    (target_user, 'people-team', 'People & Team',
     '1:1s, hiring, performance, org design.', 'accent', 3, true),
    (target_user, 'stakeholder-board', 'Stakeholder & Board',
     'Exec peers, board prep, investor and customer exposure.', 'accent', 4, true),
    (target_user, 'vendor-budget', 'Vendor & Budget',
     'Contracts, renewals, spend, procurement.', 'accent', 5, true),
    (target_user, 'security-risk-compliance', 'Security, Risk & Compliance',
     'Security posture, audits, regulatory obligations.', 'danger', 6, true),
    (target_user, 'innovation-rd', 'Innovation & R&D',
     'Experiments, evaluations, emerging technology.', 'primary', 7, true),
    (target_user, 'admin-inbox', 'Admin & Inbox',
     'Approvals, expenses, correspondence, everything else.', 'muted', 8, true)
  on conflict (user_id, slug) do nothing;
end;
$$;

-- Extend the existing signup hook so a new account starts with the taxonomy.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  perform public.seed_default_activity_categories(new.id);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill anyone who signed up before this migration.
do $$
declare
  existing_user uuid;
begin
  for existing_user in select id from auth.users loop
    perform public.seed_default_activity_categories(existing_user);
  end loop;
end
$$;
