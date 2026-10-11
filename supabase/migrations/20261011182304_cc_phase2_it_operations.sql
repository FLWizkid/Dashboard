/*
# Phase 2: IT Operations health monitoring

Adds the things the console watches (domains, email security records, websites, the console
database itself, and manually-checked systems) plus a history of every check result.

1. New Tables
- `cc_monitors` - one row per thing being watched
  - `id` (uuid, pk), `user_id` (uuid, owner, defaults to the signed-in user)
  - `kind` (text) - domain | email_auth | website | database | manual
  - `label` (text) - display name, e.g. "encountive.com domain"
  - `target` (text) - domain name or URL (empty for database/manual)
  - `identity` (text) - encountive | doug_it | krewe_kin | personal (null = not yet chosen)
  - `company_id` (uuid, optional link to cc_companies)
  - `warn_days` / `critical_days` (int) - domain-expiry thresholds (default 30 / 7)
  - `slow_ms` (int) - website response time considered slow (default 2000)
  - `dkim_selectors` (text[]) - DKIM selectors to look up for email checks
  - `check_every_days` (int) - how often a manual system should be confirmed (default 7)
  - `enabled` (bool), `notes` (text), `created_at`, `updated_at`
- `cc_check_results` - append-only history of check outcomes
  - `id`, `monitor_id` (cascade delete with its monitor), `user_id`
  - `checked_at`, `status` (healthy | attention | action | unknown), `summary`
  - `details` (jsonb, individual sub-check lines), `duration_ms`, `source` (auto | manual)

2. Modified Tables
- `cc_settings`: new `ops_seeded` flag so the default monitors are created exactly once.

3. Security
- RLS enabled on both tables.
- `cc_monitors`: owner-only select/insert/update/delete for signed-in users.
- `cc_check_results`: owners may only READ. There are no insert/update/delete policies, so
  results can only be written by the server-side checker. This guarantees a green light in the
  console always comes from a real check, never from the browser.

4. Important notes
1. Target formats are validated by the database (bare domain for domain/email checks, http(s) URL
   for websites).
2. Results are pruned by the checker after 180 days.
*/

CREATE TABLE IF NOT EXISTS cc_monitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('domain','email_auth','website','database','manual')),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
  target text,
  identity text CHECK (identity IN ('encountive','doug_it','krewe_kin','personal')),
  company_id uuid REFERENCES cc_companies(id) ON DELETE SET NULL,
  warn_days int NOT NULL DEFAULT 30 CHECK (warn_days BETWEEN 1 AND 365),
  critical_days int NOT NULL DEFAULT 7 CHECK (critical_days BETWEEN 0 AND 365),
  slow_ms int NOT NULL DEFAULT 2000 CHECK (slow_ms BETWEEN 100 AND 30000),
  dkim_selectors text[] NOT NULL DEFAULT '{}',
  check_every_days int NOT NULL DEFAULT 7 CHECK (check_every_days BETWEEN 1 AND 365),
  enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cc_monitors_target_format CHECK (
    (kind IN ('domain','email_auth') AND target ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$')
    OR (kind = 'website' AND target ~ '^https?://[^\s/$.?#].[^\s]*$' AND char_length(target) <= 500)
    OR (kind IN ('database','manual'))
  ),
  CONSTRAINT cc_monitors_thresholds CHECK (critical_days <= warn_days)
);

CREATE INDEX IF NOT EXISTS cc_monitors_user_idx ON cc_monitors(user_id);

CREATE TABLE IF NOT EXISTS cc_check_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id uuid NOT NULL REFERENCES cc_monitors(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('healthy','attention','action','unknown')),
  summary text NOT NULL DEFAULT '',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_ms int,
  source text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto','manual'))
);

CREATE INDEX IF NOT EXISTS cc_check_results_monitor_idx ON cc_check_results(monitor_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS cc_check_results_user_idx ON cc_check_results(user_id, checked_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cc_settings' AND column_name = 'ops_seeded') THEN
    ALTER TABLE cc_settings ADD COLUMN ops_seeded boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DROP TRIGGER IF EXISTS cc_monitors_touch ON cc_monitors;
CREATE TRIGGER cc_monitors_touch BEFORE UPDATE ON cc_monitors FOR EACH ROW EXECUTE FUNCTION cc_touch_updated_at();

ALTER TABLE cc_monitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_check_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_monitors" ON cc_monitors;
CREATE POLICY "select_own_monitors" ON cc_monitors FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_monitors" ON cc_monitors;
CREATE POLICY "insert_own_monitors" ON cc_monitors FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_monitors" ON cc_monitors;
CREATE POLICY "update_own_monitors" ON cc_monitors FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_monitors" ON cc_monitors;
CREATE POLICY "delete_own_monitors" ON cc_monitors FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "select_own_check_results" ON cc_check_results;
CREATE POLICY "select_own_check_results" ON cc_check_results FOR SELECT TO authenticated USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE ON cc_check_results FROM anon, authenticated;
