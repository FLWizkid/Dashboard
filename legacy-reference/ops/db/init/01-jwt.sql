-- Publish the JWT secret to the database so PostgREST-side helpers and any
-- SQL that needs to mint or verify a token can reach it.
--
-- Runs once, on an empty data directory. Rotating the secret later is a
-- deliberate operation — see docs/runbook-windows.md → "Rotating secrets".

\getenv jwt_secret JWT_SECRET
\getenv jwt_exp JWT_EXP
\getenv db_name POSTGRES_DB

\if :{?db_name}
\else
\set db_name postgres
\endif

select format(
  'alter database %I set "app.settings.jwt_secret" to %L',
  :'db_name', :'jwt_secret'
) \gexec

select format(
  'alter database %I set "app.settings.jwt_exp" to %L',
  :'db_name', :'jwt_exp'
) \gexec
