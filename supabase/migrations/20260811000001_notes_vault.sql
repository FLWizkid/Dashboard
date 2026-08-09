-- 20260811000001_notes_vault.sql
-- Phase 3 — Kanban, notes and the Obsidian-compatible vault.
--
--   notes             decision-log-first notes, and the other four kinds
--   note_links        wiki-links between notes, and note → task / event links
--   vault_files       what the vault sync last saw on disk, per file
--   tasks.is_draft    follow-up actions arrive as drafts, not as live tasks
--
-- ── Two shapes worth understanding before changing anything ─────────────
--
-- 1. DECISION AND RATIONALE ARE EQUAL ANCHORS.
--    The specification is explicit. They are two separate `not null`-able
--    columns with the same status, not a title and a body — a decision log
--    whose reasoning is an optional afterthought is a list of edicts, and is
--    worthless six months later when you need to know *why*.
--    `is_complete_decision` is a generated column: a decision note is only
--    complete when both are present.
--
-- 2. THE VAULT IS THE SECOND COPY, NOT THE SOURCE OF TRUTH.
--    The app is the system of record. `vault_files` records what sync last
--    observed — path, content hash, file mtime — so reconciliation is a
--    three-way comparison (last-synced / on disk / in database) rather than a
--    guess. Concurrent edits produce a conflict copy; nothing is overwritten
--    silently. See docs/vault.md.

-- ─────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────

-- decision  the decision log: decision + rationale as equal anchors
-- meeting   notes taken in a meeting, usually linked to an event
-- follow_up a note that exists to carry actions out of something else
-- action    a single action item captured on its own
-- freeform  everything else
do $$
begin
  create type public.note_kind as enum (
    'decision', 'meeting', 'follow_up', 'action', 'freeform'
  );
exception
  when duplicate_object then null;
end
$$;

-- What a note points at. `note` is a wiki-link; the rest mirror
-- task_link_kind so the two link tables read the same way.
do $$
begin
  create type public.note_link_kind as enum ('note', 'task', 'event', 'message');
exception
  when duplicate_object then null;
end
$$;

-- How the app and the file on disk last compared.
--   synced     identical, nothing to do
--   app_ahead  the app changed since the last sync
--   file_ahead the file changed since the last sync
--   conflict   both changed; a conflict copy has been written
--   missing    the file is gone from the vault
do $$
begin
  create type public.vault_state as enum (
    'synced', 'app_ahead', 'file_ahead', 'conflict', 'missing'
  );
exception
  when duplicate_object then null;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Notes
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.notes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid()
                  references auth.users (id) on delete cascade,

  kind          public.note_kind not null default 'freeform',
  title         text not null check (char_length(btrim(title)) between 1 and 300),

  -- ── The decision-log anchors. Equal status, by design. ──
  decision      text,
  rationale     text,
  -- The rest of the specified structure.
  context       text,
  owner         text check (owner is null or char_length(owner) <= 120),
  decided_on    date,

  -- Freeform Markdown beneath the structured fields. This is what round-trips
  -- to the vault verbatim.
  body          text not null default '',

  -- ── Vault identity ──
  -- Relative to the vault root, e.g. "Decisions/2026-08-11 Vendor renewal.md".
  -- Unique per user so two notes cannot claim one file.
  vault_path    text check (vault_path is null or char_length(vault_path) <= 400),

  -- Bumped on every application-side edit. Reconciliation compares this with
  -- what sync last wrote, which is what makes "the app changed" detectable
  -- without trusting clocks.
  version       integer not null default 1 check (version > 0),

  is_archived   boolean not null default false,

  -- A decision note needs both anchors to be worth anything.
  is_complete_decision boolean generated always as (
    kind <> 'decision'
    or (
      decision is not null and char_length(btrim(decision)) > 0
      and rationale is not null and char_length(btrim(rationale)) > 0
    )
  ) stored,

  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(decision, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(rationale, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(context, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'D')
  ) stored,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists notes_vault_path_idx
  on public.notes (user_id, vault_path)
  where vault_path is not null;

create index if not exists notes_kind_idx
  on public.notes (user_id, kind, updated_at desc)
  where is_archived = false;

create index if not exists notes_decided_idx
  on public.notes (user_id, decided_on desc)
  where kind = 'decision';

create index if not exists notes_search_idx
  on public.notes using gin (search_vector);

alter table public.notes enable row level security;

drop policy if exists "Users can view their own notes" on public.notes;
create policy "Users can view their own notes"
  on public.notes for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own notes" on public.notes;
create policy "Users can insert their own notes"
  on public.notes for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own notes" on public.notes;
create policy "Users can update their own notes"
  on public.notes for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own notes" on public.notes;
create policy "Users can delete their own notes"
  on public.notes for delete using (auth.uid() = user_id);

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Note links — wiki-links and cross-module links
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.note_links (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid()
                references auth.users (id) on delete cascade,

  note_id     uuid not null references public.notes (id) on delete cascade,
  kind        public.note_link_kind not null,

  -- For a wiki-link this is the resolved note; null while the target does not
  -- exist yet. Obsidian allows links to pages that have not been written, and
  -- so do we — an unresolved link is a real state, not an error.
  target_note_id uuid references public.notes (id) on delete set null,
  -- For task/event/message links.
  target_id   uuid,

  -- Exactly as written between the brackets, so the file round-trips even
  -- when the link does not resolve.
  target_label text not null check (char_length(target_label) between 1 and 300),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- A wiki-link resolves to a note; everything else carries a target_id.
  constraint note_links_target_shape check (
    (kind = 'note' and target_id is null)
    or (kind <> 'note' and target_note_id is null)
  )
);

create unique index if not exists note_links_unique_idx
  on public.note_links (note_id, kind, target_label);

create index if not exists note_links_backlink_idx
  on public.note_links (target_note_id)
  where target_note_id is not null;

create index if not exists note_links_target_idx
  on public.note_links (user_id, kind, target_id)
  where target_id is not null;

alter table public.note_links enable row level security;

drop policy if exists "Users can view their own note links" on public.note_links;
create policy "Users can view their own note links"
  on public.note_links for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own note links" on public.note_links;
create policy "Users can insert their own note links"
  on public.note_links for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own note links" on public.note_links;
create policy "Users can update their own note links"
  on public.note_links for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own note links" on public.note_links;
create policy "Users can delete their own note links"
  on public.note_links for delete using (auth.uid() = user_id);

drop trigger if exists note_links_set_updated_at on public.note_links;
create trigger note_links_set_updated_at
  before update on public.note_links
  for each row execute function public.set_updated_at();

-- Both ends of a link must belong to the caller. RLS cannot express this,
-- because the foreign key is checked with the table owner's rights.
create or replace function public.note_links_check_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.notes n
     where n.id = new.note_id and n.user_id = new.user_id
  ) then
    raise exception 'note % does not belong to user %', new.note_id, new.user_id
      using errcode = 'check_violation';
  end if;

  if new.target_note_id is not null and not exists (
    select 1 from public.notes n
     where n.id = new.target_note_id and n.user_id = new.user_id
  ) then
    raise exception 'linked note % does not belong to user %',
      new.target_note_id, new.user_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists note_links_owner on public.note_links;
create trigger note_links_owner
  before insert or update of note_id, target_note_id, user_id on public.note_links
  for each row execute function public.note_links_check_owner();

-- ─────────────────────────────────────────────────────────────────────────
-- Draft tasks
-- ─────────────────────────────────────────────────────────────────────────
--
-- A follow-up action captured in a note becomes a DRAFT task, not a live one.
-- Drafts stay out of the board, the dashboard and the counts until they are
-- activated, which requires owner, due date and priority — the specification's
-- rule, and a deliberately higher bar than Ready state (title + priority +
-- due), because a follow-up with no owner is a wish.

alter table public.tasks
  add column if not exists is_draft boolean not null default false;

-- The three fields activation requires, as a generated column so the UI and
-- the API cannot disagree about whether a draft is ready to activate.
alter table public.tasks
  add column if not exists can_activate boolean generated always as (
    owner is not null and char_length(btrim(owner)) > 0
    and due_at is not null
    and priority is not null
  ) stored;

-- An active task can never be a draft with missing fields; enforce the
-- direction that matters — you cannot leave draft without the three.
create or replace function public.tasks_check_draft_activation()
returns trigger
language plpgsql
as $$
begin
  if old.is_draft and not new.is_draft then
    if new.owner is null or char_length(btrim(new.owner)) = 0
       or new.due_at is null
       or new.priority is null then
      raise exception
        'a draft task needs an owner, a due date and a priority before it can be activated'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_draft_activation on public.tasks;
create trigger tasks_draft_activation
  before update of is_draft on public.tasks
  for each row execute function public.tasks_check_draft_activation();

-- Drafts are excluded from every list the product shows by default, so the
-- open-task index should skip them too.
drop index if exists public.tasks_user_open_idx;
create index if not exists tasks_user_open_idx
  on public.tasks (user_id, pinned desc, priority, due_at)
  where status <> 'done' and is_draft = false;

create index if not exists tasks_draft_idx
  on public.tasks (user_id, created_at desc)
  where is_draft = true;

-- ─────────────────────────────────────────────────────────────────────────
-- Vault files
-- ─────────────────────────────────────────────────────────────────────────
--
-- One row per file the sync manages. This is the "last known good" half of the
-- three-way comparison: without it, the only way to tell an app edit from a
-- file edit is to trust two clocks against each other, which loses data.

create table if not exists public.vault_files (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid()
                   references auth.users (id) on delete cascade,

  path           text not null check (char_length(path) between 1 and 400),

  -- What this file represents. A note, or the mirrored task list.
  note_id        uuid references public.notes (id) on delete cascade,

  -- SHA-256 of the file contents as of the last successful sync. Content
  -- addressing rather than timestamps: a file touched but not changed is not
  -- a change, and mtime granularity varies by filesystem.
  synced_hash    text check (synced_hash is null or char_length(synced_hash) = 64),
  -- The note version that hash corresponds to.
  synced_version integer,
  -- mtime observed at that point, used only as a cheap pre-filter.
  synced_mtime   timestamptz,

  state          public.vault_state not null default 'synced',
  -- Set when `state = 'conflict'`: the path the losing copy was written to.
  conflict_path  text,

  last_synced_at timestamptz,
  last_error     text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists vault_files_path_idx
  on public.vault_files (user_id, path);

create unique index if not exists vault_files_note_idx
  on public.vault_files (note_id)
  where note_id is not null;

create index if not exists vault_files_state_idx
  on public.vault_files (user_id, state)
  where state <> 'synced';

alter table public.vault_files enable row level security;

drop policy if exists "Users can view their own vault files" on public.vault_files;
create policy "Users can view their own vault files"
  on public.vault_files for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own vault files" on public.vault_files;
create policy "Users can insert their own vault files"
  on public.vault_files for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own vault files" on public.vault_files;
create policy "Users can update their own vault files"
  on public.vault_files for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own vault files" on public.vault_files;
create policy "Users can delete their own vault files"
  on public.vault_files for delete using (auth.uid() = user_id);

drop trigger if exists vault_files_set_updated_at on public.vault_files;
create trigger vault_files_set_updated_at
  before update on public.vault_files
  for each row execute function public.set_updated_at();

comment on table public.vault_files is
  'What the vault sync last observed for each managed file. The app is the '
  'system of record; this table is what makes reconciliation a three-way '
  'comparison rather than a guess. See docs/vault.md.';
