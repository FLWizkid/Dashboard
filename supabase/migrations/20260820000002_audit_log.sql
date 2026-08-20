-- ─────────────────────────────────────────────────────────────────────────
-- Audit log
-- ─────────────────────────────────────────────────────────────────────────
--
-- A locked decision that was never built: the threat model carries it as an
-- accepted residual risk, while the plan lists it as delivered. This closes
-- the gap.
--
-- ── What it is for ───────────────────────────────────────────────────────
-- This box holds a full copy of an executive's mail. The question an audit
-- log answers is not "who logged in" — there is one account — but "what was
-- read, and when, and by which path". After a lost laptop or a suspected
-- token compromise, the difference between "some mail may have been read"
-- and "these threads were opened, at these times, from this session" is the
-- difference between guessing and knowing.
--
-- ── What it deliberately does not hold ───────────────────────────────────
-- No subjects, no bodies, no addresses. An audit log that quotes the mail it
-- is protecting becomes a second, unencrypted copy of the mailbox — the
-- classic own-goal. Identifiers and verbs only; join to the real tables when
-- a row needs explaining, and if the row is gone the log honestly cannot say
-- what it was.

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid()
                references auth.users (id) on delete cascade,

  -- Verb, in the past tense: 'message.read', 'credentials.written',
  -- 'account.policy_changed', 'export.printed'.
  action      text not null check (char_length(action) between 3 and 100),

  -- What it happened to. Free-form rather than a foreign key: the log has to
  -- survive the deletion of the thing it describes, which is exactly when it
  -- matters most.
  subject_type text check (subject_type is null or char_length(subject_type) <= 60),
  subject_id   text check (subject_id is null or char_length(subject_id) <= 200),

  -- 'session' when a person did it, 'scheduler' when a job did. Worth
  -- separating: a read at 04:00 is unremarkable from the scheduler and worth
  -- a second look from a session.
  actor       text not null default 'session'
                check (actor in ('session', 'scheduler', 'system')),

  -- Small, non-sensitive context: counts, policy names, provider names.
  -- Constrained in size because an unbounded jsonb column is where sensitive
  -- data eventually gets put "just this once".
  detail      jsonb not null default '{}'::jsonb
                check (pg_column_size(detail) <= 2000),

  created_at  timestamptz not null default now()
);

create index if not exists audit_log_user_time_idx
  on public.audit_log (user_id, created_at desc);
create index if not exists audit_log_action_idx
  on public.audit_log (user_id, action, created_at desc);

alter table public.audit_log enable row level security;

-- ── Append-only, by policy ───────────────────────────────────────────────
--
-- Select and insert, deliberately no update and no delete. A log the
-- application can rewrite is not evidence of anything. Ageing out is handled
-- by the retention function below, which runs as the definer.

drop policy if exists "Users can view their own audit log" on public.audit_log;
create policy "Users can view their own audit log"
  on public.audit_log for select using (auth.uid() = user_id);

drop policy if exists "Users can append to their own audit log" on public.audit_log;
create policy "Users can append to their own audit log"
  on public.audit_log for insert with check (auth.uid() = user_id);

comment on table public.audit_log is
  'Append-only record of access to sensitive data. Identifiers only, never content.';

-- ── Retention ────────────────────────────────────────────────────────────
--
-- Kept for 24 months, matching the mail it describes. A log that outlives its
-- subject is just a list of things you can no longer look up.

create or replace function public.purge_old_audit_log()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed integer;
begin
  delete from public.audit_log
   where created_at < now() - interval '24 months';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_old_audit_log() from public;
grant execute on function public.purge_old_audit_log() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-old-audit-log')
      where exists (
        select 1 from cron.job where jobname = 'purge-old-audit-log'
      );

    perform cron.schedule(
      'purge-old-audit-log',
      '40 3 * * *',
      $job$select public.purge_old_audit_log()$job$
    );
  else
    raise notice 'pg_cron not installed; schedule purge_old_audit_log() externally';
  end if;
end;
$$;
