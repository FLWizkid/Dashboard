/*
# Usage counts for "most used first" dropdowns

1. New Functions
- `cc_usage_counts()` returns one row per (kind, key) with:
  - `kind` text: 'project', 'company' or 'time_category'
  - `key` text: the project id, company id or time category value
  - `uses` integer: how many tasks + time entries reference it
  - `last_used` timestamptz: most recent use
  Projects and companies are counted from both tasks and time entries. Time
  categories are counted from time entries.

2. Security
- SECURITY INVOKER: runs as the caller, so existing row level security on
  cc_tasks and cc_time_entries limits counts to the caller's own rows. It also
  filters on auth.uid() explicitly.
- EXECUTE revoked from PUBLIC and anon; granted to authenticated only.

3. Notes
- Read-only; no tables or data are changed.
*/

CREATE OR REPLACE FUNCTION public.cc_usage_counts()
RETURNS TABLE (kind text, key text, uses integer, last_used timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH refs AS (
    SELECT 'project'::text AS kind, project_id::text AS key, coalesce(updated_at, created_at) AS at
      FROM cc_tasks WHERE project_id IS NOT NULL AND user_id = auth.uid()
    UNION ALL
    SELECT 'project', project_id::text, started_at
      FROM cc_time_entries WHERE project_id IS NOT NULL AND user_id = auth.uid()
    UNION ALL
    SELECT 'company', company_id::text, coalesce(updated_at, created_at)
      FROM cc_tasks WHERE company_id IS NOT NULL AND user_id = auth.uid()
    UNION ALL
    SELECT 'company', company_id::text, started_at
      FROM cc_time_entries WHERE company_id IS NOT NULL AND user_id = auth.uid()
    UNION ALL
    SELECT 'time_category', category, started_at
      FROM cc_time_entries WHERE user_id = auth.uid()
  )
  SELECT kind, key, count(*)::integer, max(at) FROM refs GROUP BY kind, key;
$$;

REVOKE ALL ON FUNCTION public.cc_usage_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cc_usage_counts() FROM anon;
GRANT EXECUTE ON FUNCTION public.cc_usage_counts() TO authenticated;
