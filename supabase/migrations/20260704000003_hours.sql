-- 20260704000003_hours.sql
-- First-pass "Hours" module: a per-user time log.
--
-- NOTE: provisional schema reconstructed without the detailed spec. Refine the
-- columns when the real module design lands. See ../../PLAN.md.

create table if not exists public.time_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  label      text not null check (char_length(label) between 1 and 120),
  hours      numeric(5, 2) not null check (hours > 0 and hours <= 24),
  logged_on  date not null default current_date,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists time_entries_user_logged_idx
  on public.time_entries (user_id, logged_on desc);

alter table public.time_entries enable row level security;

drop policy if exists "Users can view their own time entries" on public.time_entries;
create policy "Users can view their own time entries"
  on public.time_entries for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own time entries" on public.time_entries;
create policy "Users can insert their own time entries"
  on public.time_entries for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own time entries" on public.time_entries;
create policy "Users can update their own time entries"
  on public.time_entries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own time entries" on public.time_entries;
create policy "Users can delete their own time entries"
  on public.time_entries for delete
  using (auth.uid() = user_id);

drop trigger if exists time_entries_set_updated_at on public.time_entries;
create trigger time_entries_set_updated_at
  before update on public.time_entries
  for each row execute function public.set_updated_at();
