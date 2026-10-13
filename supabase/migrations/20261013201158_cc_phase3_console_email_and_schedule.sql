/*
# Phase 3: console email and scheduled health checks

## Plain-English summary
1. The console can send email (alerts and a "Send test" message) through Resend, but only to
   addresses Doug lists as approved destinations. Every attempt is recorded in a log (no bodies).
2. Health checks now run every 15 minutes on a schedule, not only when the IT Operations page is open.

## Modified tables
- `cc_settings`
  - `approved_destinations` (text[]): the only addresses the console may email.
    Defaults to doug@theonefor.ai and doug@encountive.com.
  - `alert_emails` (boolean, default true): email Doug when a check turns red.

## New tables
- `cc_outbound_email_log`: id, user_id, recipient, subject, kind (test / alert), status
  (sent / failed / blocked), error, created_at. No message bodies are stored.
- `cc_cron_secrets`: name, secret. A random value the scheduler sends so the health-check
  service knows the call came from the schedule. Server-only.

## Security
1. RLS on both new tables.
2. `cc_outbound_email_log`: signed-in users can only read their own rows. Only the server
   writes rows (no insert/update/delete policies, deny by default).
3. `cc_cron_secrets`: no policies and no grants for anon or signed-in users; server-only.

## Notes
1. Installs pg_net so the database schedule can call the health-check service.
2. The schedule job is named `cc-ops-check-15min`; it is replaced if it already exists.
3. Rollback: `select cron.unschedule('cc-ops-check-15min')`, then drop the two tables and two columns.
*/

CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cc_settings' AND column_name='approved_destinations') THEN
    ALTER TABLE cc_settings ADD COLUMN approved_destinations text[] NOT NULL DEFAULT ARRAY['doug@theonefor.ai','doug@encountive.com'];
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='cc_settings' AND column_name='alert_emails') THEN
    ALTER TABLE cc_settings ADD COLUMN alert_emails boolean NOT NULL DEFAULT true;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='cc_settings_approved_destinations_len') THEN
    ALTER TABLE cc_settings ADD CONSTRAINT cc_settings_approved_destinations_len CHECK (cardinality(approved_destinations) <= 20);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS cc_outbound_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  subject text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('test','alert')),
  status text NOT NULL CHECK (status IN ('sent','failed','blocked')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cc_outbound_email_log_user_created ON cc_outbound_email_log (user_id, created_at DESC);
ALTER TABLE cc_outbound_email_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_outbound_email" ON cc_outbound_email_log;
CREATE POLICY "select_own_outbound_email" ON cc_outbound_email_log FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
REVOKE INSERT, UPDATE, DELETE ON cc_outbound_email_log FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS cc_cron_secrets (
  name text PRIMARY KEY,
  secret text NOT NULL
);
ALTER TABLE cc_cron_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cc_cron_secrets FROM anon, authenticated;
INSERT INTO cc_cron_secrets (name, secret)
  VALUES ('ops-check', encode(gen_random_bytes(32), 'hex'))
  ON CONFLICT (name) DO NOTHING;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cc-ops-check-15min') THEN
    PERFORM cron.unschedule('cc-ops-check-15min');
  END IF;
END $$;

SELECT cron.schedule(
  'cc-ops-check-15min',
  '*/15 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://qsbvgzeocntxmmcqcbbh.supabase.co/functions/v1/ops-check',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(SELECT secret FROM public.cc_cron_secrets WHERE name = 'ops-check')),
    body := '{"action":"scheduled"}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);