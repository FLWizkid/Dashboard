/*
# Phase 6: inbox VIP senders, Superhuman preference, 30-day mail purge

## Plain-English summary
Lets Doug mark certain senders as VIPs so they get their own inbox tab, choose to
open each inbox's messages in Superhuman instead of Gmail/Outlook, and makes the
console automatically forget email previews older than 30 days.

## 1. Modified tables
- `cc_settings`
  - `vip_senders` (text[], default empty): email addresses (lower case) treated as VIPs. Max 200.
- `cc_mail_accounts`
  - `open_in` (text, default 'provider'): 'provider' opens messages in Gmail/Outlook,
    'superhuman' opens Superhuman instead.

## 2. Security
- RLS on both tables is unchanged (owner-only).
- `cc_mail_accounts` uses column-level update privileges; `open_in` is added to the
  columns the signed-in owner may change. Tokens and status remain server-only.

## 3. Scheduled job
- `cc-purge-old-mail` runs daily at 04:10 UTC and removes cached message previews
  (`cc_mail_messages`) received more than 30 days ago. The real mail stays in Gmail/Outlook.
*/

ALTER TABLE cc_settings ADD COLUMN IF NOT EXISTS vip_senders text[] NOT NULL DEFAULT '{}';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cc_settings_vip_senders_max') THEN
    ALTER TABLE cc_settings ADD CONSTRAINT cc_settings_vip_senders_max CHECK (cardinality(vip_senders) <= 200);
  END IF;
END $$;
GRANT UPDATE (vip_senders) ON cc_settings TO authenticated;

ALTER TABLE cc_mail_accounts ADD COLUMN IF NOT EXISTS open_in text NOT NULL DEFAULT 'provider';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cc_mail_accounts_open_in_check') THEN
    ALTER TABLE cc_mail_accounts ADD CONSTRAINT cc_mail_accounts_open_in_check CHECK (open_in IN ('provider','superhuman'));
  END IF;
END $$;
GRANT UPDATE (open_in) ON cc_mail_accounts TO authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cc-purge-old-mail') THEN
    PERFORM cron.unschedule('cc-purge-old-mail');
  END IF;
  PERFORM cron.schedule('cc-purge-old-mail', '10 4 * * *', $job$DELETE FROM public.cc_mail_messages WHERE received_at < now() - interval '30 days'$job$);
END $$;
