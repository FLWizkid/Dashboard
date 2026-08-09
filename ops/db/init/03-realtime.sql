-- Realtime keeps its own tenant/state tables in `_realtime` and reads the
-- write-ahead log through the `realtime` schema. Neither is exposed through
-- PostgREST (see PGRST_DB_SCHEMAS in docker-compose.yml).

create schema if not exists _realtime;
create schema if not exists realtime;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute 'alter schema _realtime owner to supabase_admin';
    execute 'alter schema realtime owner to supabase_admin';
    execute 'grant all on schema _realtime to supabase_admin';
    execute 'grant all on schema realtime to supabase_admin';
  end if;
end
$$;
