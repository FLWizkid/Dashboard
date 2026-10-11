/*
# Tighten mail/calendar table privileges

1. Security
- Removes TRUNCATE, TRIGGER and REFERENCES from signed-in users on `cc_mail_accounts`,
  `cc_mail_messages` and `cc_calendar_events`. TRUNCATE ignores row level security, so it must not be granted.
- Row-level policies are unchanged.
*/
REVOKE TRUNCATE, TRIGGER, REFERENCES ON cc_mail_accounts, cc_mail_messages, cc_calendar_events FROM authenticated;
