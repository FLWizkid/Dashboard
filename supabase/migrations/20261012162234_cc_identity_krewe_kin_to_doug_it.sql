/*
  # Retire the "Krewe & Kin" identity (v5 decision D4, approved 2026-10-12)

  Krewe & Kin stays a Company; as an Identity it maps to Doug IT (theonefor.ai).
  1. Logs each affected row id in cc_audit_log (action 'identity_krewe_kin_to_doug_it') so it can be reversed.
  2. Sets identity = 'doug_it' where identity = 'krewe_kin' on companies, projects, tasks, monitors and mail accounts.
  Rollback: UPDATE <table> SET identity = 'krewe_kin' WHERE id IN (SELECT entity_id FROM cc_audit_log WHERE action = 'identity_krewe_kin_to_doug_it' AND entity = '<table>').
*/
INSERT INTO cc_audit_log (user_id, action, entity, entity_id)
SELECT user_id, 'identity_krewe_kin_to_doug_it', 'cc_companies', id FROM cc_companies WHERE identity = 'krewe_kin'
UNION ALL SELECT user_id, 'identity_krewe_kin_to_doug_it', 'cc_projects', id FROM cc_projects WHERE identity = 'krewe_kin'
UNION ALL SELECT user_id, 'identity_krewe_kin_to_doug_it', 'cc_tasks', id FROM cc_tasks WHERE identity = 'krewe_kin'
UNION ALL SELECT user_id, 'identity_krewe_kin_to_doug_it', 'cc_monitors', id FROM cc_monitors WHERE identity = 'krewe_kin'
UNION ALL SELECT user_id, 'identity_krewe_kin_to_doug_it', 'cc_mail_accounts', id FROM cc_mail_accounts WHERE identity = 'krewe_kin';

UPDATE cc_companies SET identity = 'doug_it' WHERE identity = 'krewe_kin';
UPDATE cc_projects SET identity = 'doug_it' WHERE identity = 'krewe_kin';
UPDATE cc_tasks SET identity = 'doug_it' WHERE identity = 'krewe_kin';
UPDATE cc_monitors SET identity = 'doug_it' WHERE identity = 'krewe_kin';
UPDATE cc_mail_accounts SET identity = 'doug_it' WHERE identity = 'krewe_kin';
