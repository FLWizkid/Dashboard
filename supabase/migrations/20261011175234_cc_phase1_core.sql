/*
# CIO Command Console - Phase 1 core tables

Plain English: creates the private storage for the new console's settings, companies,
projects, tasks, time entries, focus sessions, daily top priorities and an append-only
audit log. All tables are prefixed `cc_` so they never collide with the earlier
Dashboard app's (empty) tables, which are left untouched.

1. New Tables
- `cc_settings` - one row per user: console notification address (default doug@theonefor.ai),
  demo data visibility, last time-log description (carried over), focus timer lengths.
- `cc_companies` - Encountive, Krewe & Kin, Doug IT, etc. with an identity.
- `cc_projects` - status, owner, next milestone, company, identity.
- `cc_tasks` - title, status (backlog/ready/in_progress/waiting/done), priority, due date,
  category, company, project, identity, recurrence, completed_at, snoozed_until.
- `cc_time_entries` - minutes logged by category and company, optional task/project.
- `cc_focus_sessions` - running/completed focus timers linked to a task; at most one running.
- `cc_priorities` - the three tasks picked as top priorities for a given day.
- `cc_audit_log` - append-only list of identifiers and actions (no content).

2. Security
- RLS enabled on every table; each user only sees and changes their own rows.
- `user_id` defaults to auth.uid().
- `cc_audit_log` has only SELECT and INSERT policies (append-only by design).

3. Important notes
1. A task can only be in "ready" when it has a priority and a due date (database check).
2. Identity values: encountive, doug_it, krewe_kin, personal (null = not yet chosen).
3. `is_demo` marks seeded demo rows so they can be badged, hidden or removed.
*/

CREATE OR REPLACE FUNCTION cc_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TABLE IF NOT EXISTS cc_settings (
  user_id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_address text NOT NULL DEFAULT 'doug@theonefor.ai',
  show_demo boolean NOT NULL DEFAULT true,
  demo_seeded boolean NOT NULL DEFAULT false,
  last_time_description text,
  last_time_category text,
  last_time_company_id uuid,
  focus_minutes int NOT NULL DEFAULT 25 CHECK (focus_minutes BETWEEN 5 AND 180),
  break_minutes int NOT NULL DEFAULT 5 CHECK (break_minutes BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cc_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  slug text NOT NULL,
  identity text CHECK (identity IN ('encountive','doug_it','krewe_kin','personal')),
  color text NOT NULL DEFAULT 'sky',
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);

CREATE TABLE IF NOT EXISTS cc_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('planned','active','on_hold','done')),
  owner text NOT NULL DEFAULT 'Doug',
  next_milestone text,
  milestone_date date,
  company_id uuid REFERENCES cc_companies(id) ON DELETE SET NULL,
  identity text CHECK (identity IN ('encountive','doug_it','krewe_kin','personal')),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cc_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
  notes text,
  status text NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog','ready','in_progress','waiting','done')),
  priority text CHECK (priority IN ('low','medium','high','urgent')),
  due_date date,
  snoozed_until date,
  category text,
  company_id uuid REFERENCES cc_companies(id) ON DELETE SET NULL,
  project_id uuid REFERENCES cc_projects(id) ON DELETE SET NULL,
  identity text CHECK (identity IN ('encountive','doug_it','krewe_kin','personal')),
  recurrence text NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','daily','weekly','monthly','annually')),
  completed_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cc_tasks_ready_requirements CHECK (status <> 'ready' OR (priority IS NOT NULL AND due_date IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS cc_tasks_user_status_idx ON cc_tasks (user_id, status);
CREATE INDEX IF NOT EXISTS cc_tasks_user_due_idx ON cc_tasks (user_id, due_date);

CREATE TABLE IF NOT EXISTS cc_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  minutes int NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
  category text NOT NULL CHECK (category IN ('infrastructure','security','development','vendor_admin','meetings','krewe_kin')),
  company_id uuid REFERENCES cc_companies(id) ON DELETE SET NULL,
  project_id uuid REFERENCES cc_projects(id) ON DELETE SET NULL,
  task_id uuid REFERENCES cc_tasks(id) ON DELETE SET NULL,
  description text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','focus')),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cc_time_entries_user_started_idx ON cc_time_entries (user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS cc_focus_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id uuid REFERENCES cc_tasks(id) ON DELETE SET NULL,
  label text,
  category text NOT NULL DEFAULT 'development' CHECK (category IN ('infrastructure','security','development','vendor_admin','meetings','krewe_kin')),
  company_id uuid REFERENCES cc_companies(id) ON DELETE SET NULL,
  planned_minutes int NOT NULL CHECK (planned_minutes BETWEEN 1 AND 180),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','cancelled')),
  time_entry_id uuid REFERENCES cc_time_entries(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cc_focus_one_running ON cc_focus_sessions (user_id) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS cc_priorities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL,
  task_id uuid NOT NULL REFERENCES cc_tasks(id) ON DELETE CASCADE,
  rank int NOT NULL CHECK (rank BETWEEN 1 AND 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day, rank),
  UNIQUE (user_id, day, task_id)
);

CREATE TABLE IF NOT EXISTS cc_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (char_length(action) <= 80),
  entity text NOT NULL CHECK (char_length(entity) <= 40),
  entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cc_audit_user_idx ON cc_audit_log (user_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cc_settings','cc_companies','cc_projects','cc_tasks','cc_time_entries','cc_focus_sessions','cc_priorities'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_touch ON %I', t, t);
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION cc_touch_updated_at()', t, t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "select_own" ON %I', t);
    EXECUTE format('CREATE POLICY "select_own" ON %I FOR SELECT TO authenticated USING (auth.uid() = user_id)', t);
    EXECUTE format('DROP POLICY IF EXISTS "insert_own" ON %I', t);
    EXECUTE format('CREATE POLICY "insert_own" ON %I FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)', t);
    EXECUTE format('DROP POLICY IF EXISTS "update_own" ON %I', t);
    EXECUTE format('CREATE POLICY "update_own" ON %I FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', t);
    EXECUTE format('DROP POLICY IF EXISTS "delete_own" ON %I', t);
    EXECUTE format('CREATE POLICY "delete_own" ON %I FOR DELETE TO authenticated USING (auth.uid() = user_id)', t);
  END LOOP;
END $$;

ALTER TABLE cc_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own" ON cc_audit_log;
CREATE POLICY "select_own" ON cc_audit_log FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own" ON cc_audit_log;
CREATE POLICY "insert_own" ON cc_audit_log FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
