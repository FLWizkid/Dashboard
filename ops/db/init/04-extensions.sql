-- Extensions the product relies on.
--
-- pgcrypto is the one that matters beyond convenience: Phase 2 field-encrypts
-- e-mail bodies, and this is what does it. Installing it now means that
-- migration is a schema change rather than a change to the database's
-- installed extensions on a box holding live data.
--
-- They live in a dedicated `extensions` schema rather than `public` so the
-- application's own tables stay the only thing in the API-exposed schema.

create schema if not exists extensions;

create extension if not exists pgcrypto      with schema extensions;
create extension if not exists "uuid-ossp"   with schema extensions;
create extension if not exists pg_stat_statements with schema extensions;

-- Unaccented full-text search, so "Munoz" finds "Muñoz".
create extension if not exists unaccent with schema extensions;

grant usage on schema extensions to anon, authenticated, service_role;
