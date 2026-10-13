/*
# Agent Operations and before/after change history

## Plain-English summary
1. Adds a simple list of your Claude agents. Each agent has a name and its latest status
   (running, succeeded or failed) plus when it last started and finished. Agents add themselves
   the first time they check in, or can be added by hand.
2. Adds a private "check-in key" per user. Only a fingerprint (hash) of the key is stored, never
   the key itself. Claude agents present the key to the check-in service to report a run.
3. The activity log now records, for every edit to a task, project, company, time entry, setting
   or monitor, which fields changed and what the value was before and after.

## New tables
- `cc_agents`
  - `id` uuid primary key
  - `user_id` uuid owner (defaults to the signed-in user)
  - `name` text, 1-120 chars, unique per user
  - `notes` text, optional
  - `last_status` text: running | succeeded | failed (null = never ran)
  - `last_started_at`, `last_finished_at` timestamptz
  - `last_message` text, optional short note from the agent (max 500)
  - `created_at`, `updated_at`
- `cc_agent_keys`
  - `user_id` uuid primary key (one key per user)
  - `key_hash` text, SHA-256 hex of the check-in key (unique)
  - `key_hint` text, last 4 characters for display
  - `created_at`

## Modified tables
- `cc_audit_log`: new nullable column `changes` jsonb, an array of
  { field, before, after }. Long text values are trimmed to 300 characters.

## Security
1. RLS enabled on both new tables, four owner-scoped policies each (authenticated only).
2. The check-in service uses the server key to look up the key hash; the browser never sees other users' rows.
3. The change-history trigger runs with the caller's rights and only logs edits made by a signed-in
   user (server-side updates such as automated checks are not logged).

## Notes
1. Bookkeeping columns (id, user_id, created_at, updated_at) and internal flags
   (demo_seeded, ops_seeded, last_time_*) are not logged to keep the history readable.
*/

CREATE TABLE IF NOT EXISTS cc_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  last_status text CHECK (last_status IN ('running', 'succeeded', 'failed')),
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_message text CHECK (last_message IS NULL OR char_length(last_message) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

DROP TRIGGER IF EXISTS cc_agents_touch ON cc_agents;
CREATE TRIGGER cc_agents_touch BEFORE UPDATE ON cc_agents FOR EACH ROW EXECUTE FUNCTION cc_touch_updated_at();

ALTER TABLE cc_agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_agents" ON cc_agents;
CREATE POLICY "select_own_agents" ON cc_agents FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_agents" ON cc_agents;
CREATE POLICY "insert_own_agents" ON cc_agents FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_agents" ON cc_agents;
CREATE POLICY "update_own_agents" ON cc_agents FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_agents" ON cc_agents;
CREATE POLICY "delete_own_agents" ON cc_agents FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS cc_agent_keys (
  user_id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  key_hint text NOT NULL CHECK (char_length(key_hint) <= 8),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cc_agent_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_agent_key" ON cc_agent_keys;
CREATE POLICY "select_own_agent_key" ON cc_agent_keys FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_agent_key" ON cc_agent_keys;
CREATE POLICY "insert_own_agent_key" ON cc_agent_keys FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_agent_key" ON cc_agent_keys;
CREATE POLICY "update_own_agent_key" ON cc_agent_keys FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_agent_key" ON cc_agent_keys;
CREATE POLICY "delete_own_agent_key" ON cc_agent_keys FOR DELETE TO authenticated USING (auth.uid() = user_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cc_audit_log' AND column_name = 'changes') THEN
    ALTER TABLE cc_audit_log ADD COLUMN changes jsonb;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION cc_audit_trim(v jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN jsonb_typeof(v) = 'string' AND char_length(v #>> '{}') > 300
    THEN to_jsonb(left(v #>> '{}', 300) || '...') ELSE v END
$$;

CREATE OR REPLACE FUNCTION cc_audit_changes() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  o jsonb := to_jsonb(OLD);
  n jsonb := to_jsonb(NEW);
  diff jsonb := '[]'::jsonb;
  k text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  FOR k IN SELECT jsonb_object_keys(n) LOOP
    CONTINUE WHEN k IN ('id', 'user_id', 'created_at', 'updated_at', 'demo_seeded', 'ops_seeded',
                        'last_time_description', 'last_time_category', 'last_time_company_id');
    IF (o -> k) IS DISTINCT FROM (n -> k) THEN
      diff := diff || jsonb_build_array(jsonb_build_object('field', k, 'before', cc_audit_trim(o -> k), 'after', cc_audit_trim(n -> k)));
    END IF;
  END LOOP;
  IF jsonb_array_length(diff) = 0 THEN RETURN NEW; END IF;
  INSERT INTO cc_audit_log (user_id, action, entity, entity_id, changes)
  VALUES (auth.uid(), TG_ARGV[0], TG_ARGV[1], CASE WHEN n ? 'id' THEN (n ->> 'id')::uuid END, diff);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cc_tasks_audit ON cc_tasks;
CREATE TRIGGER cc_tasks_audit AFTER UPDATE ON cc_tasks FOR EACH ROW EXECUTE FUNCTION cc_audit_changes('task.update', 'task');
DROP TRIGGER IF EXISTS cc_projects_audit ON cc_projects;
CREATE TRIGGER cc_projects_audit AFTER UPDATE ON cc_projects FOR EACH ROW EXECUTE FUNCTION cc_audit_changes('project.update', 'project');
DROP TRIGGER IF EXISTS cc_companies_audit ON cc_companies;
CREATE TRIGGER cc_companies_audit AFTER UPDATE ON cc_companies FOR EACH ROW EXECUTE FUNCTION cc_audit_changes('company.update', 'company');
DROP TRIGGER IF EXISTS cc_time_entries_audit ON cc_time_entries;
CREATE TRIGGER cc_time_entries_audit AFTER UPDATE ON cc_time_entries FOR EACH ROW EXECUTE FUNCTION cc_audit_changes('time.update', 'time_entry');
DROP TRIGGER IF EXISTS cc_settings_audit ON cc_settings;
CREATE TRIGGER cc_settings_audit AFTER UPDATE ON cc_settings FOR EACH ROW EXECUTE FUNCTION cc_audit_changes('settings.update', 'settings');
DROP TRIGGER IF EXISTS cc_monitors_audit ON cc_monitors;
CREATE TRIGGER cc_monitors_audit AFTER UPDATE ON cc_monitors FOR EACH ROW EXECUTE FUNCTION cc_audit_changes('monitor.update', 'monitor');
