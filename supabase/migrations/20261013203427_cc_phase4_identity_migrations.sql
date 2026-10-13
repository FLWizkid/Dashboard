/*
# Phase 4: Identity migration tracker

Plain English: tracks moving a tool or account from one email address (identity) to another,
for example moving a vendor login from doug@theonefor.ai to doug@encountive.com, with a
step-by-step checklist for each move.

1. New Tables
- `cc_identity_migrations`
  - title (what is being moved), tool_id (optional link to cc_saas_tools, set null on delete)
  - from_address, to_address, to_identity (encountive | doug_it | personal)
  - status (planned | in_progress | blocked | done), due_date
  - steps (jsonb list of {label, done}, at most 40), notes, completed_at

2. Security
- RLS enabled; four separate owner-only policies (TO authenticated, auth.uid() = user_id).
- user_id defaults to auth.uid().

3. Notes
1. updated_at maintained by the existing cc_touch_updated_at trigger.
*/

CREATE TABLE IF NOT EXISTS cc_identity_migrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  tool_id uuid REFERENCES cc_saas_tools(id) ON DELETE SET NULL,
  from_address text CHECK (from_address IS NULL OR char_length(from_address) <= 200),
  to_address text CHECK (to_address IS NULL OR char_length(to_address) <= 200),
  to_identity text CHECK (to_identity IS NULL OR to_identity IN ('encountive','doug_it','personal')),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','blocked','done')),
  due_date date,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) <= 40),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 4000),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cc_identity_migrations_user_idx ON cc_identity_migrations(user_id, status);
CREATE INDEX IF NOT EXISTS cc_identity_migrations_tool_idx ON cc_identity_migrations(tool_id);

ALTER TABLE cc_identity_migrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own" ON cc_identity_migrations;
CREATE POLICY "select_own" ON cc_identity_migrations FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own" ON cc_identity_migrations;
CREATE POLICY "insert_own" ON cc_identity_migrations FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own" ON cc_identity_migrations;
CREATE POLICY "update_own" ON cc_identity_migrations FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own" ON cc_identity_migrations;
CREATE POLICY "delete_own" ON cc_identity_migrations FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS cc_identity_migrations_touch ON cc_identity_migrations;
CREATE TRIGGER cc_identity_migrations_touch BEFORE UPDATE ON cc_identity_migrations FOR EACH ROW EXECUTE FUNCTION cc_touch_updated_at();