-- ─────────────────────────────────────────────────────────────────────────
-- External context
-- ─────────────────────────────────────────────────────────────────────────
--
-- A task that says "review the auth migration PR" is missing the PR. The
-- point of this table is that the work item and the thing it is about stop
-- living in two places you have to hold in your head at once.
--
-- ── Provider-agnostic on purpose ─────────────────────────────────────────
-- GitHub is the first connector, not the shape of the design. A pull request,
-- a Slack thread, a Zoom recording and a Drive document are the same thing to
-- this product: something outside the app, with a URL, a title, a state that
-- changes, and an owner who wants to see it next to their work. Anything a
-- connector knows that this model does not is kept in `snapshot`.
--
-- ── Why the snapshot is stored, not fetched on render ────────────────────
-- Three reasons, in order of how much they matter:
--
--   1. **The provider is not always reachable.** A dashboard that shows
--      nothing when GitHub is slow is a dashboard nobody trusts. The stored
--      title and state render immediately; freshness is a separate question
--      with its own indicator.
--   2. **The browser must never talk to a provider.** `connect-src 'self'`
--      forbids it, and that is deliberate — it is what keeps tokens on the
--      server. Every fetch here is server-side, and the browser only ever
--      sees rows from this table.
--   3. **Search has to work over what is linked**, including while offline,
--      and a full-text index over stored titles is the only way to do that.
--
-- ── Retention ────────────────────────────────────────────────────────────
-- Unlike mail, references are *not* purged on a window. A link is an
-- assertion the owner made — "this task is about that PR" — and deleting it
-- because it is old would be deleting their judgement. What ages out is the
-- cached snapshot of a reference nothing points at any more; see
-- `purge_orphaned_refs` at the bottom.

-- ─────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────

do $$
begin
  -- Named for the service, not the vendor's product line, so a rename does
  -- not become a migration.
  create type public.external_provider as enum ('github');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  -- What the reference *is*. Deliberately coarse: the interface groups by
  -- this, and a taxonomy with thirty entries groups into thirty piles of one.
  create type public.external_ref_kind as enum (
    'issue',
    'pull_request',
    'release',
    'repository',
    'commit',
    'discussion',
    'document',
    'message',
    'recording',
    'other'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  -- Normalised across providers. A GitHub PR is 'open' | 'merged' | 'closed';
  -- a Slack thread has no state at all, which is what 'none' is for.
  create type public.external_ref_state as enum (
    'none',
    'open',
    'in_progress',
    'blocked',
    'merged',
    'closed',
    'archived'
  );
exception
  when duplicate_object then null;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- References
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.external_refs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid()
                   references auth.users (id) on delete cascade,

  provider       public.external_provider not null,
  kind           public.external_ref_kind not null default 'other',

  -- The provider's own identifier, stable across renames. For GitHub this is
  -- the node id or `owner/repo#number` — whatever survives the title changing.
  remote_id      text not null check (char_length(remote_id) between 1 and 400),

  -- The canonical URL. Always present: a reference nobody can open is not
  -- context, it is a note to self.
  url            text not null check (
                   url ~ '^https?://' and char_length(url) <= 2000
                 ),

  title          text not null check (char_length(title) between 1 and 500),
  -- "owner/repo#482", "#general", the folder path. What tells two similar
  -- titles apart at a glance.
  subtitle       text check (subtitle is null or char_length(subtitle) <= 300),

  state          public.external_ref_state not null default 'none',
  -- Free text from the provider when `state` cannot capture it: a review
  -- decision, a CI conclusion, a document's sharing mode.
  state_detail   text check (state_detail is null or char_length(state_detail) <= 200),

  author         text check (author is null or char_length(author) <= 200),

  -- When the *provider* last saw a change. Drives "what moved since the last
  -- brief", and is not the same as when we last looked.
  remote_updated_at timestamptz,

  -- When we last looked. Null means never successfully fetched — the row was
  -- created from a pasted URL and has not been resolved yet.
  fetched_at     timestamptz,
  -- The last fetch failure, so the interface can say "stale because …"
  -- rather than showing an old title with no explanation.
  fetch_error    text check (fetch_error is null or char_length(fetch_error) <= 500),

  -- Anything the connector knows that this model does not. Never rendered
  -- blindly; the interface reads named fields or nothing.
  snapshot       jsonb not null default '{}'::jsonb,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- A successful fetch cannot also be a failure.
  constraint external_refs_fetch_shape check (
    fetch_error is null or fetched_at is not null
  )
);

-- One row per external thing, per owner. Pasting the same PR onto a second
-- task reuses the reference rather than creating a parallel copy that then
-- drifts — which is the whole reason state is stored once.
create unique index if not exists external_refs_identity_idx
  on public.external_refs (user_id, provider, remote_id);

create index if not exists external_refs_recent_idx
  on public.external_refs (user_id, remote_updated_at desc nulls last);

-- Refresh picks the least recently fetched first, so a large set catches up
-- evenly instead of the same few rows being re-fetched forever.
create index if not exists external_refs_staleness_idx
  on public.external_refs (user_id, fetched_at asc nulls first);

-- Search over what is linked. Titles and subtitles only: the body of a PR is
-- not ours to store, and a search that returns things the owner never linked
-- is a search engine, not a dashboard.
alter table public.external_refs
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(subtitle, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(author, '')), 'C')
  ) stored;

create index if not exists external_refs_search_idx
  on public.external_refs using gin (search_vector);

alter table public.external_refs enable row level security;

drop policy if exists "Owners read their references" on public.external_refs;
create policy "Owners read their references"
  on public.external_refs for select using (auth.uid() = user_id);

drop policy if exists "Owners create their references" on public.external_refs;
create policy "Owners create their references"
  on public.external_refs for insert with check (auth.uid() = user_id);

drop policy if exists "Owners update their references" on public.external_refs;
create policy "Owners update their references"
  on public.external_refs for update using (auth.uid() = user_id);

drop policy if exists "Owners delete their references" on public.external_refs;
create policy "Owners delete their references"
  on public.external_refs for delete using (auth.uid() = user_id);

drop trigger if exists external_refs_set_updated_at on public.external_refs;
create trigger external_refs_set_updated_at
  before update on public.external_refs
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Links
-- ─────────────────────────────────────────────────────────────────────────
--
-- ── Why two nullable columns and not a polymorphic id ────────────────────
-- `subject_type` + `subject_id` would be one column pair for any number of
-- subjects, and would give up referential integrity to get there: nothing
-- would stop a link pointing at a task that no longer exists, and no cascade
-- would clean it up. Real foreign keys with a check constraint keep the
-- database able to enforce what it is for.
--
-- Kanban cards are tasks, so `task_id` covers the board as well.

create table if not exists public.external_links (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid()
                 references auth.users (id) on delete cascade,

  ref_id       uuid not null references public.external_refs (id) on delete cascade,

  task_id      uuid references public.tasks (id) on delete cascade,
  note_id      uuid references public.notes (id) on delete cascade,

  -- Why the owner attached it. `about` is the default and means "this work is
  -- about that thing"; the others exist because a task can reference a PR it
  -- is *blocked by* rather than about.
  relation     text not null default 'about' check (
                 relation in ('about', 'blocked_by', 'produced', 'related')
               ),

  -- ── Confirm before link ──────────────────────────────────────────────
  -- Same rule as event links, for the same reason. A suggestion is a
  -- question. `null` means suggested-but-unconfirmed and the interface must
  -- render it as an offer, never as a fact.
  --
  -- Pasting a URL *is* a confirmation — the owner did it deliberately — so
  -- that path sets this at creation. Detection never may, and the trigger
  -- below refuses a backdated confirmation, which is the shape an
  -- auto-linking import script would take.
  confirmed_at timestamptz,

  created_at   timestamptz not null default now(),

  constraint external_links_one_subject check (
    (task_id is not null and note_id is null)
    or (task_id is null and note_id is not null)
  )
);

-- The same reference cannot be attached to the same subject twice. Partial
-- indexes because a null subject column never conflicts.
create unique index if not exists external_links_task_idx
  on public.external_links (task_id, ref_id)
  where task_id is not null;

create unique index if not exists external_links_note_idx
  on public.external_links (note_id, ref_id)
  where note_id is not null;

create index if not exists external_links_ref_idx
  on public.external_links (ref_id);

alter table public.external_links enable row level security;

drop policy if exists "Owners read their links" on public.external_links;
create policy "Owners read their links"
  on public.external_links for select using (auth.uid() = user_id);

drop policy if exists "Owners create their links" on public.external_links;
create policy "Owners create their links"
  on public.external_links for insert with check (auth.uid() = user_id);

drop policy if exists "Owners update their links" on public.external_links;
create policy "Owners update their links"
  on public.external_links for update using (auth.uid() = user_id);

drop policy if exists "Owners delete their links" on public.external_links;
create policy "Owners delete their links"
  on public.external_links for delete using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Never auto-link silently
-- ─────────────────────────────────────────────────────────────────────────
--
-- The application already only sets `confirmed_at` from an explicit act. This
-- makes that a property of the database instead of a promise about today's
-- code, so it survives the next import script — exactly as
-- `task_links_guard_event_confirmation` does for calendar events.

create or replace function public.external_links_guard_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.confirmed_at is not null
     and new.confirmed_at < now() - interval '1 minute' then
    raise exception
      'an external link cannot be created already-confirmed in the past; ask the owner first'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists external_links_confirmation on public.external_links;
create trigger external_links_confirmation
  before insert on public.external_links
  for each row
  execute function public.external_links_guard_confirmation();

-- ─────────────────────────────────────────────────────────────────────────
-- A link may only point at things its owner owns
-- ─────────────────────────────────────────────────────────────────────────
--
-- This is not belt and braces; RLS genuinely does not cover it.
--
-- **Foreign key checks run as the referenced table's owner and ignore row
-- level security.** So `task_id references public.tasks (id)` is satisfied by
-- *any* task in the table, including one belonging to somebody else. The
-- insert policy on this table only checks that the row's `user_id` is the
-- caller — which it is — so nothing refuses it.
--
-- The consequences are small today, with one user, and they are not nothing:
-- a link claiming a relationship to a stranger's task, and an existence
-- oracle (a foreign key violation and a success are distinguishable, so ids
-- could be probed). Both become real the moment teammate mode arrives, which
-- is exactly when nobody will be re-reading this file.
--
-- A check constraint cannot do a subquery, so it has to be a trigger.

create or replace function public.external_links_guard_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  subject_owner uuid;
begin
  -- Shape is the check constraint's job, and BEFORE triggers run first — so
  -- without this, a link with no subject (or two) fails here with "may only
  -- point at something its owner owns", which is both confusing and untrue.
  -- Let the constraint answer for shape; this answers for ownership.
  if (new.task_id is null) = (new.note_id is null) then
    return new;
  end if;

  if new.task_id is not null then
    select user_id into subject_owner
      from public.tasks where id = new.task_id;
  else
    select user_id into subject_owner
      from public.notes where id = new.note_id;
  end if;

  -- The foreign key has already established that the row exists, so a null
  -- here would mean it vanished mid-statement.
  if subject_owner is null or subject_owner is distinct from new.user_id then
    raise exception
      'an external link may only point at something its owner owns'
      using errcode = 'insufficient_privilege';
  end if;

  -- The reference must belong to the same owner too, for the same reason.
  if not exists (
    select 1 from public.external_refs
     where id = new.ref_id and user_id = new.user_id
  ) then
    raise exception
      'an external link may only point at a reference its owner owns'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists external_links_ownership on public.external_links;
create trigger external_links_ownership
  before insert or update on public.external_links
  for each row
  execute function public.external_links_guard_ownership();

-- ─────────────────────────────────────────────────────────────────────────
-- Connector accounts
-- ─────────────────────────────────────────────────────────────────────────
--
-- The credential itself is **not** here. Tokens live in the existing
-- encrypted credential store (`provider_credentials`), the same as mail —
-- one place that is encrypted, audited and purged, rather than a second one
-- that is nearly as good.

create table if not exists public.external_accounts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid()
                  references auth.users (id) on delete cascade,

  provider      public.external_provider not null,

  -- The account this connects as, for the interface to show. Not a secret.
  account_label text not null check (char_length(account_label) between 1 and 200),

  -- Enterprise installs. Null means the public service.
  base_url      text check (
                  base_url is null
                  or (base_url ~ '^https://' and char_length(base_url) <= 500)
                ),

  -- Turned off without being disconnected: refresh stops, links stay, and
  -- everything already fetched still renders.
  is_enabled    boolean not null default true,

  last_synced_at timestamptz,
  last_error     text check (last_error is null or char_length(last_error) <= 500),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists external_accounts_one_per_provider_idx
  on public.external_accounts (user_id, provider);

alter table public.external_accounts enable row level security;

drop policy if exists "Owners read their connectors" on public.external_accounts;
create policy "Owners read their connectors"
  on public.external_accounts for select using (auth.uid() = user_id);

drop policy if exists "Owners create their connectors" on public.external_accounts;
create policy "Owners create their connectors"
  on public.external_accounts for insert with check (auth.uid() = user_id);

drop policy if exists "Owners update their connectors" on public.external_accounts;
create policy "Owners update their connectors"
  on public.external_accounts for update using (auth.uid() = user_id);

drop policy if exists "Owners delete their connectors" on public.external_accounts;
create policy "Owners delete their connectors"
  on public.external_accounts for delete using (auth.uid() = user_id);

drop trigger if exists external_accounts_set_updated_at on public.external_accounts;
create trigger external_accounts_set_updated_at
  before update on public.external_accounts
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Retention
-- ─────────────────────────────────────────────────────────────────────────
--
-- Deliberately narrow, and worth reading before adding to it.
--
-- A link is the owner's judgement — "this task is about that PR" — and a
-- purge that removed it on age would be deleting judgement, not data. So
-- links are never purged, and neither is a reference anything still points
-- at, however old.
--
-- What *is* removed is a reference nothing points at any more, once it has
-- been unreferenced for a grace period. Those appear when the last task or
-- note linking a reference is deleted; keeping them would leave the search
-- index full of context the owner has already discarded.

create or replace function public.purge_orphaned_refs(
  older_than interval default interval '30 days'
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  removed integer;
begin
  with orphaned as (
    delete from public.external_refs r
     where not exists (
       select 1 from public.external_links l where l.ref_id = r.id
     )
       and r.updated_at < now() - older_than
    returning r.id
  )
  select count(*) into removed from orphaned;

  return removed;
end;
$$;

comment on function public.purge_orphaned_refs(interval) is
  'Removes cached references nothing links to any more, after a grace '
  'period. Runs as the caller, so RLS applies and it can only ever purge '
  'the caller''s own rows. Links themselves are never purged: a link is the '
  'owner''s judgement, not cached data.';

comment on table public.external_refs is
  'Cached context from a connected service. Stored rather than fetched on '
  'render so the dashboard works when the provider does not, and so the '
  'browser never talks to a provider directly.';

comment on table public.external_links is
  'Attaches a reference to a task or a note. Exactly one subject; '
  'confirm-before-link is enforced by a trigger, not only by the UI.';
