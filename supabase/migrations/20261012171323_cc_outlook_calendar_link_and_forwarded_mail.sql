/*
# Outlook calendar link and forwarded-mail identity

## Plain-English summary
Doug does not use the Microsoft Azure portal, so the theonefor.ai mailbox cannot be
connected with a Microsoft app. Two no-Azure paths are added instead:
1. Outlook calendar link: Doug publishes his Outlook calendar (inside Outlook on the web)
   and pastes the private link into the console. The server reads it on each sync.
2. Forwarded mail: theonefor.ai mail is forwarded into the connected Gmail inbox. Each
   message now records who it was addressed to, and the identity that matches that
   address (for example theonefor.ai -> Doug IT), so it is labelled correctly.

## Modified tables
- `cc_mail_accounts.provider` now also allows `outlook_ics` (a calendar-only link).
- `cc_mail_messages` gains:
  - `to_email` (text, nullable): the company address the message was sent to.
  - `identity` (text, nullable): identity for this message when it differs from the
    inbox it arrived in. Null means "use the inbox's identity".

## Security
1. The private calendar link is stored encrypted in the existing server-only
   `cc_mail_tokens` table (no access for signed-in users or visitors).
2. Signed-in users may only read the new message columns; the server writes them.
3. No policies change; existing owner-only policies still apply.
*/

ALTER TABLE cc_mail_accounts DROP CONSTRAINT IF EXISTS cc_mail_accounts_provider_check;
ALTER TABLE cc_mail_accounts ADD CONSTRAINT cc_mail_accounts_provider_check
  CHECK (provider = ANY (ARRAY['microsoft', 'google', 'outlook_ics']));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cc_mail_messages' AND column_name = 'to_email') THEN
    ALTER TABLE cc_mail_messages ADD COLUMN to_email text CHECK (to_email IS NULL OR char_length(to_email) <= 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cc_mail_messages' AND column_name = 'identity') THEN
    ALTER TABLE cc_mail_messages ADD COLUMN identity text
      CHECK (identity IS NULL OR identity = ANY (ARRAY['encountive', 'doug_it', 'krewe_kin', 'personal']));
  END IF;
END $$;

REVOKE INSERT, UPDATE, DELETE ON cc_mail_messages FROM authenticated;
GRANT SELECT ON cc_mail_messages TO authenticated;
