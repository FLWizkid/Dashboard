/*
# Report Library, agent email choices and Runbooks & Notes

## Plain-English summary
1. Agents can now send their whole report into the console. Each report is kept as its own record
   so it can be opened, searched and compared with the agent's previous run.
2. Each agent gets two new choices: when to email a short "report is ready" note with a link
   (never / only on failure / always), and how often it is expected to run, so the console can warn
   when an agent goes quiet.
3. Settings remember the console's web address so emailed links open the right page.
4. A notes table holds free-form notes and step-by-step runbooks.
5. The outbound email log can now record report notifications as well as tests and alerts.

## New tables
- `cc_reports`
  - `id` uuid primary key, `user_id` owner (defaults to the signed-in user)
  - `agent_id` uuid, the agent that sent it (set to null if the agent is removed)
  - `agent_name` text, kept so the report still shows its source after the agent is removed
  - `title` text 1-200, `status` succeeded | failed
  - `summary` text up to 500, `body` text up to 200,000 (Markdown or plain text)
  - `source_url` text up to 2000, where the original lives (for example a Drive or Notion link)
  - `received_at` timestamptz, `read_at` timestamptz (null = unread), `created_at`
- `cc_notes`
  - `id`, `user_id` owner, `title` 1-200, `body` up to 100,000, `kind` note | runbook,
    `company_id` optional, `pinned` boolean, `created_at`, `updated_at`

## Modified tables
- `cc_agents`: `email_on` (never | failure | always, default failure), `expected_every_hours`
  (1-720, optional), `last_report_id` (latest report)
- `cc_settings`: `console_url` text up to 300
- `cc_outbound_email_log`: kind now also allows `report`

## Security
1. RLS enabled on both new tables with four owner-only policies each (authenticated only).
2. Reports from agents are written by the check-in service after it verifies the agent's key.
*/

CREATE TABLE IF NOT EXISTS cc_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES cc_agents(id) ON DELETE SET NULL,
  agent_name text NOT NULL CHECK (char_length(trim(agent_name)) BETWEEN 1 AND 120),
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'succeeded' CHECK (status IN ('succeeded', 'failed')),
  summary text CHECK (summary IS NULL OR char_length(summary) <= 500),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 200000),
  source_url text CHECK (source_url IS NULL OR (char_length(source_url) <= 2000 AND source_url ~* '^https?://')),
  received_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cc_reports_user_received_idx ON cc_reports (user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS cc_reports_user_agent_idx ON cc_reports (user_id, agent_name, received_at DESC);

ALTER TABLE cc_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_reports" ON cc_reports;
CREATE POLICY "select_own_reports" ON cc_reports FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_reports" ON cc_reports;
CREATE POLICY "insert_own_reports" ON cc_reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_reports" ON cc_reports;
CREATE POLICY "update_own_reports" ON cc_reports FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_reports" ON cc_reports;
CREATE POLICY "delete_own_reports" ON cc_reports FOR DELETE TO authenticated USING (auth.uid() = user_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cc_agents' AND column_name='email_on') THEN
    ALTER TABLE cc_agents ADD COLUMN email_on text NOT NULL DEFAULT 'failure' CHECK (email_on IN ('never','failure','always'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cc_agents' AND column_name='expected_every_hours') THEN
    ALTER TABLE cc_agents ADD COLUMN expected_every_hours integer CHECK (expected_every_hours IS NULL OR expected_every_hours BETWEEN 1 AND 720);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cc_agents' AND column_name='last_report_id') THEN
    ALTER TABLE cc_agents ADD COLUMN last_report_id uuid REFERENCES cc_reports(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cc_settings' AND column_name='console_url') THEN
    ALTER TABLE cc_settings ADD COLUMN console_url text CHECK (console_url IS NULL OR (char_length(console_url) <= 300 AND console_url ~* '^https?://'));
  END IF;
END $$;

ALTER TABLE cc_outbound_email_log DROP CONSTRAINT IF EXISTS cc_outbound_email_log_kind_check;
ALTER TABLE cc_outbound_email_log ADD CONSTRAINT cc_outbound_email_log_kind_check CHECK (kind IN ('test','alert','report'));

CREATE TABLE IF NOT EXISTS cc_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 200),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 100000),
  kind text NOT NULL DEFAULT 'note' CHECK (kind IN ('note','runbook')),
  company_id uuid REFERENCES cc_companies(id) ON DELETE SET NULL,
  pinned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cc_notes_user_updated_idx ON cc_notes (user_id, updated_at DESC);

DROP TRIGGER IF EXISTS cc_notes_touch ON cc_notes;
CREATE TRIGGER cc_notes_touch BEFORE UPDATE ON cc_notes FOR EACH ROW EXECUTE FUNCTION cc_touch_updated_at();

ALTER TABLE cc_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_notes" ON cc_notes;
CREATE POLICY "select_own_notes" ON cc_notes FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_notes" ON cc_notes;
CREATE POLICY "insert_own_notes" ON cc_notes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_notes" ON cc_notes;
CREATE POLICY "update_own_notes" ON cc_notes FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_notes" ON cc_notes;
CREATE POLICY "delete_own_notes" ON cc_notes FOR DELETE TO authenticated USING (auth.uid() = user_id);
