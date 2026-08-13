-- ─────────────────────────────────────────────────────────────────────────
-- Offline task capture
-- ─────────────────────────────────────────────────────────────────────────
--
-- Phase 4 made logged time survive a dead network: write locally first, carry
-- a device-generated key, and let a unique index make a replayed flush a
-- no-op. Capture never got the same treatment, so a task typed on a phone in
-- a lift was simply lost — the one thing a capture box must never do.
--
-- This is the server half, and it is deliberately the *same* mechanism rather
-- than a second one. `client_key` is generated on the device before any
-- request is attempted. The unique index below is what makes a retry safe:
-- the normal failure is a connection that dies after the row was written and
-- before the response arrived, so the client cannot know whether it succeeded
-- and will send it again.
--
-- Partial, on `client_key is not null`, because the overwhelming majority of
-- tasks are created while online and have no key at all. A plain unique index
-- would treat every one of those NULLs as distinct in Postgres — which works
-- — but the partial index is smaller and says out loud that the constraint
-- only concerns queued captures.

alter table public.tasks
  add column if not exists client_key text
    check (client_key is null or char_length(client_key) between 8 and 128);

create unique index if not exists tasks_user_client_key_idx
  on public.tasks (user_id, client_key)
  where client_key is not null;

comment on column public.tasks.client_key is
  'Idempotency key generated on the device for a capture made offline. A '
  'replayed flush hits the unique index and is answered with the existing '
  'row rather than creating a second task.';

-- ─────────────────────────────────────────────────────────────────────────
-- Nothing may reassign a key
-- ─────────────────────────────────────────────────────────────────────────
--
-- The key identifies *one* capture. Letting an update move it to another task
-- would turn the idempotency guarantee into a way of quietly overwriting
-- someone's work: a flush replayed after an edit would find the key on a
-- different row and report success for a task that no longer exists.
--
-- Clearing it is allowed — that is how a settled capture stops occupying the
-- namespace — but changing one non-null key to another is refused.

create or replace function public.tasks_client_key_is_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.client_key is not null
     and new.client_key is not null
     and new.client_key is distinct from old.client_key then
    raise exception
      'client_key identifies one capture and cannot be reassigned'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_client_key_immutable on public.tasks;
create trigger tasks_client_key_immutable
  before update on public.tasks
  for each row
  execute function public.tasks_client_key_is_immutable();
