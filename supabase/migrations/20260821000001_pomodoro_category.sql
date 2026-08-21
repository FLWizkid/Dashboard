-- ─────────────────────────────────────────────────────────────────────────
-- A category on the focus session
-- ─────────────────────────────────────────────────────────────────────────
--
-- Focused hours arrived with no category. Scheduled ones inherit theirs from
-- the calendar event and manual ones are picked at entry, so a Pomodoro was
-- the only source that landed in the weekly split as "unfiled" — and it is
-- the source most likely to be the actual work.
--
-- Asked once, when starting: the moment you know what the next 25 minutes
-- are for. The entry written when the session ends inherits it.

alter table public.pomodoro_sessions
  add column if not exists category_id uuid
    references public.activity_categories (id) on delete set null;

create index if not exists pomodoro_sessions_category_idx
  on public.pomodoro_sessions (user_id, category_id);

comment on column public.pomodoro_sessions.category_id is
  'What the focus block was for. Copied onto the focused time entry at stop.';
