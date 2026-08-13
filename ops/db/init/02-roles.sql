-- Give the service roles their passwords.
--
-- The supabase/postgres image already creates these roles; what it cannot
-- know is the password this box generated. Every service connects as its own
-- least-privilege role — GoTrue as supabase_auth_admin, PostgREST as
-- authenticator, Storage as supabase_storage_admin — so a compromise of one
-- service is not automatically a compromise of the database.
--
-- Roles are altered, never created here. On this image they already exist,
-- and inventing a missing one with guessed grants would be worse than
-- failing: if a role really is absent the stack fails loudly at connect
-- time, which is the right way to find out.

\getenv pg_password POSTGRES_PASSWORD

-- Hand the password to PL/pgSQL through a session GUC rather than
-- interpolating it into the function body, so it never appears in a
-- statement that could be logged verbatim.
select set_config('cio.bootstrap_password', :'pg_password', false);

do $$
declare
  target text;
  secret text := current_setting('cio.bootstrap_password', true);
begin
  if secret is null or secret = '' then
    raise exception 'POSTGRES_PASSWORD was empty at bootstrap';
  end if;

  foreach target in array array[
    'supabase_admin',
    'authenticator',
    'supabase_auth_admin',
    'supabase_storage_admin',
    'supabase_functions_admin',
    'supabase_replication_admin',
    'supabase_read_only_user',
    'pgbouncer',
    'dashboard_user'
  ]
  loop
    if exists (select 1 from pg_roles where rolname = target) then
      execute format('alter role %I with password %L', target, secret);
    else
      raise notice 'role % not present on this image; skipped', target;
    end if;
  end loop;
end
$$;

select set_config('cio.bootstrap_password', '', false);
