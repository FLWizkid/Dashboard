/*
# Email and calendar connections (read-only)

Lets Doug connect Outlook (Microsoft 365) and Google Workspace accounts so the console
can show recent inbox mail and upcoming calendar events, each labelled with its source.

1. New Tables
- `cc_mail_accounts`: one row per connected mailbox.
  - provider ('microsoft' | 'google'), email (the receiving address), identity (which hat it belongs to, unset by default),
    label, status ('connected' | 'error'), last_synced_at, last_error (friendly text only), scopes, created_at.
- `cc_mail_tokens`: encrypted access/refresh tokens for an account. Server-only.
- `cc_oauth_states`: short-lived sign-in handshakes (state, PKCE verifier, return address). Server-only.
- `cc_mail_messages`: cached inbox messages (sender, subject, preview, received time, unread/important, link back to the mail app).
- `cc_calendar_events`: cached calendar events (title, start/end, location, organizer, link back).

2. Security
- RLS on every table.
- Accounts: owner can read, change only identity/label (column grant), and delete (disconnect). Only the server creates accounts.
- Tokens and sign-in handshakes: no policies and no grants to signed-in users; only the server (service role) can touch them.
- Messages and events: owner can read only; only the server writes them.
- Deleting an account cascades to its tokens, messages and events.

3. Notes
1. Access to Microsoft/Google is read-only (Mail.Read, Calendars.Read, gmail.readonly, calendar.readonly).
2. Tokens are encrypted on the server before storage and never sent to the browser.
*/

CREATE TABLE IF NOT EXISTS cc_mail_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('microsoft','google')),
  email text NOT NULL,
  identity text CHECK (identity IN ('encountive','doug_it','krewe_kin','personal')),
  label text CHECK (label IS NULL OR char_length(label) <= 60),
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','error')),
  last_synced_at timestamptz,
  last_error text,
  scopes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, email)
);

CREATE TABLE IF NOT EXISTS cc_mail_tokens (
  account_id uuid PRIMARY KEY REFERENCES cc_mail_accounts(id) ON DELETE CASCADE,
  access_token_enc text NOT NULL,
  refresh_token_enc text,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cc_oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('microsoft','google')),
  code_verifier text NOT NULL,
  return_to text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cc_mail_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES cc_mail_accounts(id) ON DELETE CASCADE,
  provider_id text NOT NULL,
  thread_id text,
  from_name text,
  from_email text,
  subject text,
  snippet text,
  received_at timestamptz NOT NULL,
  is_unread boolean NOT NULL DEFAULT false,
  is_important boolean NOT NULL DEFAULT false,
  web_link text,
  UNIQUE (account_id, provider_id)
);
CREATE INDEX IF NOT EXISTS cc_mail_messages_user_received_idx ON cc_mail_messages (user_id, received_at DESC);

CREATE TABLE IF NOT EXISTS cc_calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES cc_mail_accounts(id) ON DELETE CASCADE,
  provider_id text NOT NULL,
  title text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  location text,
  organizer text,
  web_link text,
  is_cancelled boolean NOT NULL DEFAULT false,
  UNIQUE (account_id, provider_id)
);
CREATE INDEX IF NOT EXISTS cc_calendar_events_user_start_idx ON cc_calendar_events (user_id, starts_at);

ALTER TABLE cc_mail_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_mail_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_mail_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE cc_calendar_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON cc_mail_tokens FROM anon, authenticated;
REVOKE ALL ON cc_oauth_states FROM anon, authenticated;
REVOKE ALL ON cc_mail_accounts FROM anon;
REVOKE INSERT, UPDATE ON cc_mail_accounts FROM authenticated;
GRANT SELECT, DELETE ON cc_mail_accounts TO authenticated;
GRANT UPDATE (identity, label) ON cc_mail_accounts TO authenticated;
REVOKE ALL ON cc_mail_messages FROM anon;
REVOKE INSERT, UPDATE, DELETE ON cc_mail_messages FROM authenticated;
GRANT SELECT ON cc_mail_messages TO authenticated;
REVOKE ALL ON cc_calendar_events FROM anon;
REVOKE INSERT, UPDATE, DELETE ON cc_calendar_events FROM authenticated;
GRANT SELECT ON cc_calendar_events TO authenticated;

DROP POLICY IF EXISTS "select_own_mail_accounts" ON cc_mail_accounts;
CREATE POLICY "select_own_mail_accounts" ON cc_mail_accounts FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_mail_accounts" ON cc_mail_accounts;
CREATE POLICY "update_own_mail_accounts" ON cc_mail_accounts FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_mail_accounts" ON cc_mail_accounts;
CREATE POLICY "delete_own_mail_accounts" ON cc_mail_accounts FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "select_own_mail_messages" ON cc_mail_messages;
CREATE POLICY "select_own_mail_messages" ON cc_mail_messages FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "select_own_calendar_events" ON cc_calendar_events;
CREATE POLICY "select_own_calendar_events" ON cc_calendar_events FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
