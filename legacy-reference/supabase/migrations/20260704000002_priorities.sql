-- 20260704000002_priorities.sql
-- First data module: a per-user priority list.
--
-- NOTE: this schema is a FIRST-PASS reconstruction made without the detailed
-- module spec. The pattern (user-owned rows + RLS + updated_at trigger) is what
-- every module will reuse; the exact columns should be refined once the real
-- design is available. See ../../PLAN.md.

create table if not exists public.priorities (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 200),
  note       text,
  level      smallint not null default 2 check (level between 1 and 3), -- 1=high, 2=medium, 3=low
  is_done    boolean not null default false,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists priorities_user_id_idx on public.priorities (user_id);

alter table public.priorities enable row level security;

drop policy if exists "Users can view their own priorities" on public.priorities;
create policy "Users can view their own priorities"
  on public.priorities for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own priorities" on public.priorities;
create policy "Users can insert their own priorities"
  on public.priorities for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own priorities" on public.priorities;
create policy "Users can update their own priorities"
  on public.priorities for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own priorities" on public.priorities;
create policy "Users can delete their own priorities"
  on public.priorities for delete
  using (auth.uid() = user_id);

drop trigger if exists priorities_set_updated_at on public.priorities;
create trigger priorities_set_updated_at
  before update on public.priorities
  for each row execute function public.set_updated_at();
