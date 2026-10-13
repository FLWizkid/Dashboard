/*
# Phase 4: Security and Partner Requests

Plain English: a security checklist (including customer-readiness and agent-governance items),
an incident log, a change log that always records how to undo a change, and a simple
helpdesk where Melissa's requests are tracked and shown on a printable status page.

1. New Tables
- `cc_security_items` - checklist items.
  - title, area (accounts | devices | data | email | customer_readiness | agent_governance | other),
    status (todo | done | not_applicable), company_id, last_checked_on, notes
- `cc_incidents` - security or outage incidents.
  - title, severity (low | medium | high | critical), status (open | resolved),
    occurred_at, summary, resolution, resolved_at
- `cc_changes` - change log.
  - title, system, changed_at, description, rollback_steps (required), outcome (planned | done | rolled_back)
- `cc_requests` - partner requests (helpdesk-lite).
  - title, details, requested_by (default 'Melissa'), priority (low | medium | high | urgent),
    status (new | in_progress | waiting | done), due_date, resolution, company_id, completed_at

2. Security
- RLS enabled on all four tables with four separate owner-only policies each
  (TO authenticated, auth.uid() = user_id). user_id defaults to auth.uid().

3. Notes
1. rollback_steps is mandatory on every change so a change can always be undone.
2. updated_at maintained by the existing cc_touch_updated_at trigger.
*/

CREATE TABLE IF NOT EXISTS cc_security_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  area text NOT NULL DEFAULT 'other' CHECK (area IN ('accounts','devices','data','email','customer_readiness','agent_governance','other')),
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','done','not_applicable')),
  company_id uuid REFERENCES cc_companies(id) ON DELETE SET NULL,
  last_checked_on date,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cc_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  summary text CHECK (summary IS NULL OR char_length(summary) <= 8000),
  resolution text CHECK (resolution IS NULL OR char_length(resolution) <= 8000),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cc_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  system text CHECK (system IS NULL OR char_length(system) <= 120),
  changed_at timestamptz NOT NULL DEFAULT now(),
  description text CHECK (description IS NULL OR char_length(description) <= 8000),
  rollback_steps text NOT NULL CHECK (char_length(rollback_steps) BETWEEN 1 AND 8000),
  outcome text NOT NULL DEFAULT 'done' CHECK (outcome IN ('planned','done','rolled_back')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cc_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  details text CHECK (details IS NULL OR char_length(details) <= 8000),
  requested_by text NOT NULL DEFAULT 'Melissa' CHECK (char_length(requested_by) BETWEEN 1 AND 120),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','waiting','done')),
  due_date date,
  resolution text CHECK (resolution IS NULL OR char_length(resolution) <= 8000),
  company_id uuid REFERENCES cc_companies(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cc_security_items_user_idx ON cc_security_items(user_id);
CREATE INDEX IF NOT EXISTS cc_incidents_user_idx ON cc_incidents(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS cc_changes_user_idx ON cc_changes(user_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS cc_requests_user_idx ON cc_requests(user_id, status);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cc_security_items','cc_incidents','cc_changes','cc_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "select_own" ON %I', t);
    EXECUTE format('CREATE POLICY "select_own" ON %I FOR SELECT TO authenticated USING (auth.uid() = user_id)', t);
    EXECUTE format('DROP POLICY IF EXISTS "insert_own" ON %I', t);
    EXECUTE format('CREATE POLICY "insert_own" ON %I FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)', t);
    EXECUTE format('DROP POLICY IF EXISTS "update_own" ON %I', t);
    EXECUTE format('CREATE POLICY "update_own" ON %I FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', t);
    EXECUTE format('DROP POLICY IF EXISTS "delete_own" ON %I', t);
    EXECUTE format('CREATE POLICY "delete_own" ON %I FOR DELETE TO authenticated USING (auth.uid() = user_id)', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_touch', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION cc_touch_updated_at()', t || '_touch', t);
  END LOOP;
END $$;