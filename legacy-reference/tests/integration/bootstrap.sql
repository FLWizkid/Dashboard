-- Minimal stand-in for the parts of self-hosted Supabase the migrations
-- depend on, so the schema and its Row Level Security policies can be tested
-- against a throwaway Postgres in CI.
--
-- This is NOT a Supabase replacement. It provides exactly three things:
--   • the `auth` schema and an `auth.users` table for the foreign keys
--   • `auth.uid()` reading the request's JWT claim, matching GoTrue/PostgREST
--   • the `anon` and `authenticated` roles PostgREST connects as
--
-- Tests then `set local role authenticated` and set the claim, which is what
-- makes the RLS assertions real rather than theatre: as a superuser every
-- policy would be bypassed and every test would pass.

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

-- Mirrors Supabase's own definition, including the two claim spellings.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

do $$
begin
  create role anon nologin;
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create role authenticated nologin;
exception
  when duplicate_object then null;
end
$$;

grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
grant select on auth.users to authenticated;
