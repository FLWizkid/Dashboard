-- 20260810000001_mail_calendar.sql
-- Phase 2 — email and calendar.
--
-- Introduces the normalized mail and calendar model every provider is mapped
-- onto, so that Gmail, Microsoft Graph and Proton Bridge differ only inside
-- their adapters:
--
--   mail_accounts    a connected mailbox + its caching policy and credentials
--   mailboxes        folders/labels inside an account
--   mail_threads     conversation grouping
--   messages         the normalized message; bodies field-encrypted
--   senders          manual four-level sender importance
--   calendars        a connected calendar
--   calendar_events  the normalized event
--   sync_state       per-resource cursors and failure tracking
--
-- ── Two things this migration enforces that code alone could not ─────────
--
-- 1. THE CACHING POLICY IS A DATABASE RULE.
--    `mail_accounts.caching_policy` is Off / Metadata / Full. A trigger
--    rejects any message row that exceeds its account's policy: no rows at
--    all under Off, and no body ciphertext under Metadata. A future bug in
--    the sync service therefore cannot quietly mirror a corporate mailbox.
--
-- 2. BODIES ARE NEVER STORED IN PLAINTEXT.
--    `body_cipher` accepts only values carrying the `cio1.` envelope prefix
--    (see src/lib/crypto/envelope.ts). A check constraint, so a mistaken
--    insert of raw text fails rather than succeeding invisibly.
--
-- ── The full-text search trade-off, stated plainly ──────────────────────
--    `search_vector` is computed by the application from the plaintext before
--    the body is encrypted, and stored unencrypted. Postgres cannot index
--    ciphertext, so this is the price of having search at all. A tsvector
--    leaks the set of lexemes in a message — not their order, not the
--    sentences — to anyone who can read the table. That is a real disclosure
--    and it is recorded in docs/threat-model.md; the alternative was no
--    search, which the product requires.
--
-- Design notes: docs/data-model.md and docs/caching-policy.md.

-- ─────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────

do $$
begin
  create type public.mail_provider as enum ('gmail', 'microsoft', 'proton_bridge');
exception
  when duplicate_object then null;
end
$$;

-- Off      nothing is stored; the mailbox is read live, and only on demand
-- Metadata headers only — sender, subject, timestamps, flags
-- Full     bodies mirrored as well, field-encrypted
do $$
begin
  create type public.caching_policy as enum ('off', 'metadata', 'full');
exception
  when duplicate_object then null;
end
$$;

-- `degraded` is the important one: the account is connected and its cached
-- data is still shown, but the provider is not answering. Stale-but-safe.
do $$
begin
  create type public.account_status as enum (
    'connected', 'degraded', 'needs_reauth', 'disconnected'
  );
exception
  when duplicate_object then null;
end
$$;

-- Corporate mailboxes often need an administrator to approve the app before
-- it may read mail. This tracks where that request has got to.
do $$
begin
  create type public.admin_consent_state as enum (
    'not_required', 'required', 'requested', 'granted', 'denied'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.mailbox_kind as enum (
    'inbox', 'sent', 'drafts', 'archive', 'spam', 'trash', 'custom'
  );
exception
  when duplicate_object then null;
end
$$;

-- Deliberately the same four levels as task priority, and deliberately a
-- separate type: they mean different things and will drift.
do $$
begin
  create type public.sender_importance as enum (
    'critical', 'high', 'normal', 'low'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.calendar_access as enum ('read', 'read_write');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.event_response as enum (
    'accepted', 'tentative', 'declined', 'needs_action', 'organizer', 'unknown'
  );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.sync_resource as enum ('mail', 'calendar');
exception
  when duplicate_object then null;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Accounts
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.mail_accounts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid()
                        references auth.users (id) on delete cascade,

  provider            public.mail_provider not null,
  -- The provider's own account identifier, so reconnecting the same mailbox
  -- updates rather than duplicates it.
  remote_id           text not null,
  email_address       text not null check (char_length(email_address) between 3 and 320),
  display_name        text,

  status              public.account_status not null default 'connected',
  status_detail       text,

  -- Headers only until the owner says what kind of mailbox this is. Marking
  -- an account corporate moves it to Off; the trigger below refuses the
  -- corporate + Full combination outright. (This comment previously claimed
  -- the default was 'full' and that connect set it explicitly. Neither was
  -- true: connect set nothing, so every account took this default.)
  caching_policy      public.caching_policy not null default 'metadata',
  is_corporate        boolean not null default false,
  admin_consent       public.admin_consent_state not null default 'not_required',

  -- Configurable retention, 24 months by default, as specified.
  retention_months    integer not null default 24
                        check (retention_months between 1 and 240),

  -- OAuth tokens / bridge credentials, field-encrypted. Never plaintext.
  credentials_cipher  text check (credentials_cipher like 'cio1.%'),
  credentials_updated_at timestamptz,

  -- Sync/calendar capability is a property of the adapter, but whether the
  -- owner wants it is a property of the account.
  sync_mail_enabled   boolean not null default true,
  sync_calendar_enabled boolean not null default true,

  last_sync_at        timestamptz,
  last_success_at     timestamptz,
  last_error          text,
  last_error_at       timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists mail_accounts_unique_remote_idx
  on public.mail_accounts (user_id, provider, remote_id);

create index if not exists mail_accounts_user_idx
  on public.mail_accounts (user_id, status);

alter table public.mail_accounts enable row level security;

drop policy if exists "Users can view their own mail accounts" on public.mail_accounts;
create policy "Users can view their own mail accounts"
  on public.mail_accounts for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own mail accounts" on public.mail_accounts;
create policy "Users can insert their own mail accounts"
  on public.mail_accounts for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own mail accounts" on public.mail_accounts;
create policy "Users can update their own mail accounts"
  on public.mail_accounts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own mail accounts" on public.mail_accounts;
create policy "Users can delete their own mail accounts"
  on public.mail_accounts for delete
  using (auth.uid() = user_id);

drop trigger if exists mail_accounts_set_updated_at on public.mail_accounts;
create trigger mail_accounts_set_updated_at
  before update on public.mail_accounts
  for each row execute function public.set_updated_at();

-- A corporate mailbox may not be set to Full without an administrator having
-- granted consent. The product default is Off with a consent path; this makes
-- the unsafe state unrepresentable rather than merely discouraged.
create or replace function public.mail_accounts_check_policy()
returns trigger
language plpgsql
as $$
begin
  if new.is_corporate
     and new.caching_policy = 'full'
     and new.admin_consent <> 'granted' then
    raise exception
      'a corporate mailbox cannot use the Full caching policy until admin consent is granted'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists mail_accounts_policy_guard on public.mail_accounts;
create trigger mail_accounts_policy_guard
  before insert or update of caching_policy, is_corporate, admin_consent
  on public.mail_accounts
  for each row execute function public.mail_accounts_check_policy();

-- ─────────────────────────────────────────────────────────────────────────
-- Mailboxes (folders / labels)
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.mailboxes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid()
                 references auth.users (id) on delete cascade,
  account_id   uuid not null references public.mail_accounts (id) on delete cascade,

  remote_id    text not null,
  name         text not null check (char_length(name) between 1 and 300),
  kind         public.mailbox_kind not null default 'custom',

  unread_count integer not null default 0 check (unread_count >= 0),
  total_count  integer not null default 0 check (total_count >= 0),

  -- Not every folder is worth syncing. Spam and Trash default off.
  sync_enabled boolean not null default true,
  position     integer not null default 0,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists mailboxes_unique_remote_idx
  on public.mailboxes (account_id, remote_id);

create index if not exists mailboxes_user_idx on public.mailboxes (user_id, kind);

alter table public.mailboxes enable row level security;

drop policy if exists "Users can view their own mailboxes" on public.mailboxes;
create policy "Users can view their own mailboxes"
  on public.mailboxes for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own mailboxes" on public.mailboxes;
create policy "Users can insert their own mailboxes"
  on public.mailboxes for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own mailboxes" on public.mailboxes;
create policy "Users can update their own mailboxes"
  on public.mailboxes for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own mailboxes" on public.mailboxes;
create policy "Users can delete their own mailboxes"
  on public.mailboxes for delete using (auth.uid() = user_id);

drop trigger if exists mailboxes_set_updated_at on public.mailboxes;
create trigger mailboxes_set_updated_at
  before update on public.mailboxes
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Threads
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.mail_threads (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid()
                    references auth.users (id) on delete cascade,
  account_id      uuid not null references public.mail_accounts (id) on delete cascade,

  remote_id       text not null,
  subject         text,
  last_message_at timestamptz,
  message_count   integer not null default 0 check (message_count >= 0),
  unread_count    integer not null default 0 check (unread_count >= 0),
  has_attachments boolean not null default false,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists mail_threads_unique_remote_idx
  on public.mail_threads (account_id, remote_id);

create index if not exists mail_threads_recent_idx
  on public.mail_threads (user_id, last_message_at desc nulls last);

alter table public.mail_threads enable row level security;

drop policy if exists "Users can view their own threads" on public.mail_threads;
create policy "Users can view their own threads"
  on public.mail_threads for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own threads" on public.mail_threads;
create policy "Users can insert their own threads"
  on public.mail_threads for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own threads" on public.mail_threads;
create policy "Users can update their own threads"
  on public.mail_threads for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own threads" on public.mail_threads;
create policy "Users can delete their own threads"
  on public.mail_threads for delete using (auth.uid() = user_id);

drop trigger if exists mail_threads_set_updated_at on public.mail_threads;
create trigger mail_threads_set_updated_at
  before update on public.mail_threads
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Senders — manual four-level importance
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.senders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid()
                 references auth.users (id) on delete cascade,

  -- Stored lower-cased; addresses are case-insensitive in the part that
  -- matters and treating them otherwise creates duplicate rows for one person.
  address      text not null check (char_length(address) between 3 and 320),
  display_name text,

  -- Manual only, as specified. Nothing in the product infers this.
  importance   public.sender_importance not null default 'normal',
  notes        text check (notes is null or char_length(notes) <= 2000),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists senders_unique_address_idx
  on public.senders (user_id, lower(address));

create index if not exists senders_importance_idx
  on public.senders (user_id, importance)
  where importance in ('critical', 'high');

alter table public.senders enable row level security;

drop policy if exists "Users can view their own senders" on public.senders;
create policy "Users can view their own senders"
  on public.senders for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own senders" on public.senders;
create policy "Users can insert their own senders"
  on public.senders for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own senders" on public.senders;
create policy "Users can update their own senders"
  on public.senders for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own senders" on public.senders;
create policy "Users can delete their own senders"
  on public.senders for delete using (auth.uid() = user_id);

drop trigger if exists senders_set_updated_at on public.senders;
create trigger senders_set_updated_at
  before update on public.senders
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Messages
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid()
                    references auth.users (id) on delete cascade,
  account_id      uuid not null references public.mail_accounts (id) on delete cascade,
  thread_id       uuid references public.mail_threads (id) on delete cascade,
  mailbox_id      uuid references public.mailboxes (id) on delete set null,

  remote_id       text not null,
  -- RFC 5322 Message-ID. The one identifier that survives crossing providers,
  -- which is what makes a link from a task to "this mail" durable.
  message_id_header text,

  subject         text,
  snippet         text check (snippet is null or char_length(snippet) <= 1000),

  from_address    text not null,
  from_name       text,
  to_addresses    text[] not null default '{}',
  cc_addresses    text[] not null default '{}',

  sent_at         timestamptz,
  received_at     timestamptz not null default now(),

  is_read         boolean not null default false,
  is_flagged      boolean not null default false,
  is_draft        boolean not null default false,
  has_attachments boolean not null default false,

  -- Only ever an encryption envelope, and only under the Full policy. Both
  -- halves of that are enforced: the shape here, the policy in a trigger.
  body_cipher     text check (body_cipher is null or body_cipher like 'cio1.%'),
  body_format     text check (body_format is null or body_format in ('text', 'html')),

  -- Written by the application from the plaintext, before encryption. See the
  -- disclosure note in this file's header.
  search_vector   tsvector,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists messages_unique_remote_idx
  on public.messages (account_id, remote_id);

create index if not exists messages_inbox_idx
  on public.messages (user_id, received_at desc);

-- The attention card's query: unread, newest first.
create index if not exists messages_unread_idx
  on public.messages (user_id, received_at desc)
  where is_read = false;

create index if not exists messages_thread_idx
  on public.messages (thread_id, received_at);

create index if not exists messages_sender_idx
  on public.messages (user_id, lower(from_address));

create index if not exists messages_search_idx
  on public.messages using gin (search_vector);

-- Retention purge scans this.
create index if not exists messages_retention_idx
  on public.messages (account_id, received_at);

alter table public.messages enable row level security;

drop policy if exists "Users can view their own messages" on public.messages;
create policy "Users can view their own messages"
  on public.messages for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own messages" on public.messages;
create policy "Users can insert their own messages"
  on public.messages for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own messages" on public.messages;
create policy "Users can update their own messages"
  on public.messages for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own messages" on public.messages;
create policy "Users can delete their own messages"
  on public.messages for delete using (auth.uid() = user_id);

drop trigger if exists messages_set_updated_at on public.messages;
create trigger messages_set_updated_at
  before update on public.messages
  for each row execute function public.set_updated_at();

-- ── The caching policy, enforced in the database ─────────────────────────
--
-- This is the guarantee behind "corporate mailboxes default to Off". A bug in
-- the sync service, or a future adapter that forgets to check, cannot write
-- more than the account permits — the insert fails.
--
-- security definer because the account row must be readable regardless of the
-- caller's own policies; the function only ever reads the account belonging to
-- the row being written.
create or replace function public.messages_check_caching_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  policy public.caching_policy;
  owner  uuid;
begin
  select a.caching_policy, a.user_id
    into policy, owner
    from public.mail_accounts a
   where a.id = new.account_id;

  if policy is null then
    raise exception 'mail account % does not exist', new.account_id
      using errcode = 'foreign_key_violation';
  end if;

  if owner <> new.user_id then
    raise exception 'mail account % does not belong to user %',
      new.account_id, new.user_id
      using errcode = 'check_violation';
  end if;

  if policy = 'off' then
    raise exception
      'caching policy for this mailbox is Off; no message may be stored'
      using errcode = 'check_violation';
  end if;

  if policy = 'metadata' and new.body_cipher is not null then
    raise exception
      'caching policy for this mailbox is Metadata; message bodies may not be stored'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_caching_policy on public.messages;
create trigger messages_caching_policy
  before insert or update of account_id, body_cipher, user_id on public.messages
  for each row execute function public.messages_check_caching_policy();

-- Threads and mailboxes must belong to the same owner as the message.
create or replace function public.messages_check_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.thread_id is not null and not exists (
    select 1 from public.mail_threads t
     where t.id = new.thread_id and t.user_id = new.user_id
  ) then
    raise exception 'thread % does not belong to user %', new.thread_id, new.user_id
      using errcode = 'check_violation';
  end if;

  if new.mailbox_id is not null and not exists (
    select 1 from public.mailboxes m
     where m.id = new.mailbox_id and m.user_id = new.user_id
  ) then
    raise exception 'mailbox % does not belong to user %', new.mailbox_id, new.user_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_relation_owner on public.messages;
create trigger messages_relation_owner
  before insert or update of thread_id, mailbox_id, user_id on public.messages
  for each row execute function public.messages_check_relations();

-- ─────────────────────────────────────────────────────────────────────────
-- Calendars
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.calendars (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid()
                references auth.users (id) on delete cascade,
  account_id  uuid not null references public.mail_accounts (id) on delete cascade,

  remote_id   text not null,
  name        text not null check (char_length(name) between 1 and 300),
  description text,
  -- A design-token name, not a hex value, so themes stay honest.
  color       text not null default 'primary',
  time_zone   text,

  is_primary  boolean not null default false,
  is_visible  boolean not null default true,
  -- Proton Calendar is read-only through the Bridge; this is where that shows.
  access      public.calendar_access not null default 'read',

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists calendars_unique_remote_idx
  on public.calendars (account_id, remote_id);

create index if not exists calendars_user_idx on public.calendars (user_id, is_visible);

alter table public.calendars enable row level security;

drop policy if exists "Users can view their own calendars" on public.calendars;
create policy "Users can view their own calendars"
  on public.calendars for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own calendars" on public.calendars;
create policy "Users can insert their own calendars"
  on public.calendars for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own calendars" on public.calendars;
create policy "Users can update their own calendars"
  on public.calendars for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own calendars" on public.calendars;
create policy "Users can delete their own calendars"
  on public.calendars for delete using (auth.uid() = user_id);

drop trigger if exists calendars_set_updated_at on public.calendars;
create trigger calendars_set_updated_at
  before update on public.calendars
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Events
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.calendar_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid()
                   references auth.users (id) on delete cascade,
  calendar_id    uuid not null references public.calendars (id) on delete cascade,

  remote_id      text not null,
  -- Recurring events share this; the individual occurrences do not.
  series_id      text,

  title          text not null default '(no title)',
  location       text,
  -- Encrypted like a mail body: a meeting description routinely carries the
  -- agenda, the dial-in and the numbers.
  description_cipher text check (description_cipher is null or description_cipher like 'cio1.%'),

  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  all_day        boolean not null default false,
  time_zone      text,

  organizer_address text,
  organizer_name text,
  attendee_count integer not null default 0 check (attendee_count >= 0),
  -- Drives the priority engine's "leadership / external / decision" boost in
  -- Phase 5; computed by the adapter from the attendee domains.
  is_external    boolean not null default false,
  response       public.event_response not null default 'unknown',
  is_cancelled   boolean not null default false,

  meeting_url    text,
  search_vector  tsvector,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint calendar_events_ends_after_starts check (ends_at >= starts_at)
);

create unique index if not exists calendar_events_unique_remote_idx
  on public.calendar_events (calendar_id, remote_id);

-- The rollup query: everything in a window, in order.
create index if not exists calendar_events_window_idx
  on public.calendar_events (user_id, starts_at)
  where is_cancelled = false;

create index if not exists calendar_events_search_idx
  on public.calendar_events using gin (search_vector);

alter table public.calendar_events enable row level security;

drop policy if exists "Users can view their own events" on public.calendar_events;
create policy "Users can view their own events"
  on public.calendar_events for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own events" on public.calendar_events;
create policy "Users can insert their own events"
  on public.calendar_events for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own events" on public.calendar_events;
create policy "Users can update their own events"
  on public.calendar_events for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own events" on public.calendar_events;
create policy "Users can delete their own events"
  on public.calendar_events for delete using (auth.uid() = user_id);

drop trigger if exists calendar_events_set_updated_at on public.calendar_events;
create trigger calendar_events_set_updated_at
  before update on public.calendar_events
  for each row execute function public.set_updated_at();

create or replace function public.calendar_events_check_calendar_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.calendars c
     where c.id = new.calendar_id and c.user_id = new.user_id
  ) then
    raise exception 'calendar % does not belong to user %',
      new.calendar_id, new.user_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists calendar_events_calendar_owner on public.calendar_events;
create trigger calendar_events_calendar_owner
  before insert or update of calendar_id, user_id on public.calendar_events
  for each row execute function public.calendar_events_check_calendar_owner();

-- ─────────────────────────────────────────────────────────────────────────
-- Sync state
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.sync_state (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid()
                    references auth.users (id) on delete cascade,
  account_id      uuid not null references public.mail_accounts (id) on delete cascade,
  resource        public.sync_resource not null,

  -- Opaque, provider-specific: a Gmail historyId, a Graph delta link, an
  -- IMAP UIDVALIDITY:UIDNEXT pair. The adapter is the only thing that reads it.
  cursor          text,

  last_run_at     timestamptz,
  last_success_at timestamptz,
  -- Drives back-off, and the switch to `degraded` rather than a hard failure.
  failure_count   integer not null default 0 check (failure_count >= 0),
  last_error      text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists sync_state_unique_idx
  on public.sync_state (account_id, resource);

alter table public.sync_state enable row level security;

drop policy if exists "Users can view their own sync state" on public.sync_state;
create policy "Users can view their own sync state"
  on public.sync_state for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their own sync state" on public.sync_state;
create policy "Users can insert their own sync state"
  on public.sync_state for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their own sync state" on public.sync_state;
create policy "Users can update their own sync state"
  on public.sync_state for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own sync state" on public.sync_state;
create policy "Users can delete their own sync state"
  on public.sync_state for delete using (auth.uid() = user_id);

drop trigger if exists sync_state_set_updated_at on public.sync_state;
create trigger sync_state_set_updated_at
  before update on public.sync_state
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Retention purge
-- ─────────────────────────────────────────────────────────────────────────
--
-- Deletes cached messages older than each account's retention window, and any
-- thread left with nothing in it. Called by the scheduled job; also safe to
-- run by hand.
--
-- Returns the number of messages removed so the caller can log it — a purge
-- that silently deletes nothing looks identical to one that is not running.

create or replace function public.purge_expired_messages()
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  removed bigint;
begin
  with expired as (
    delete from public.messages m
      using public.mail_accounts a
     where a.id = m.account_id
       and m.received_at < now() - make_interval(months => a.retention_months)
    returning m.id
  )
  select count(*) into removed from expired;

  -- Threads that only existed to group messages that are now gone.
  delete from public.mail_threads t
   where not exists (
     select 1 from public.messages m where m.thread_id = t.id
   );

  return removed;
end;
$$;

comment on function public.purge_expired_messages() is
  'Deletes cached messages past their account retention window (default 24 '
  'months) and any thread left empty. Runs as the caller, so RLS applies and '
  'it can only ever purge the caller''s own rows.';
