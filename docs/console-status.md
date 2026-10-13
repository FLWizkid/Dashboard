# CIO Command Console — status

- **Spec version:** v5 (received 2026-10-12)
- **Resumed from:** Step 0 addendum for v5. A full Step 0 was delivered for the original spec on 2026-10-11, so v5 needs only an addendum.
- **Current gate:** v5 Step 0 addendum, awaiting Doug's approval. No code has changed for v5.

## Phase status

The earlier work used its own phase numbers. It is mapped to v5 numbers below.

| v5 phase | Scope | Status | Approved |
|---|---|---|---|
| 1 Audit and plan | Step 0, now plus the v5 addendum | Awaiting my approval (addendum) | Original Step 0: 2026-10-11 |
| 2 Shell and core | Auth, layout, design system, Today, Tasks/Projects, Time & Focus, Settings, demo data | Approved, with gaps (see G-list) | 2026-10-11 |
| 3 IT Ops lights + console email | RDAP, DNS, uptime, manual systems, history, Health strip; Resend "Send test" | Built 2026-10-13: console email (Resend, from doug@encountive.com), approved destinations, notification address, Send test, alert emails when a light turns red, checks every 15 minutes (pg_cron + pg_net, shared secret). Waiting on Doug: RESEND_API_KEY in Bolt Secrets. | Awaiting my approval |
| 4 Assets, Access, Renewals, Security, logs, requests, identity audit, migration tracker | | Built 2026-10-13: Assets & Access (software, hardware, access reviews every 90 days, onboarding/offboarding checklists), Renewals & Spend (monthly/yearly totals, by company, 90-day timeline with 30/14/7-day alerts, unused after 60 days), Security (starter checklist incl. customer readiness and agent governance, incident log, change log with required undo steps), Partner Requests (helpdesk-lite + printable plain-English status at /requests/status). Not built: Identity audit (A3), Migration tracker (A4), Report Library, Runbooks & Notes. | Awaiting my approval |
| 5 Agent Operations (Claude) | | Not started | |
| 6 Email and calendar | Graph, Google, Open in Superhuman, local relay | Built early (read-only Graph + Gmail, not yet connected). Awaiting my approval. Superhuman links and local relay not built. | |
| 7 GitHub/Vercel/Resend status, Weekly report, polish | | Not started | |

## Step 0 addendum (v5)

### Inventory

- **Framework:** Vite 5, React 18 and TypeScript (strict), with Tailwind, Radix and cva (shadcn-style parts), lucide-react, TanStack Query v5, React Router 6, Zod and date-fns. The earlier Next.js 15 app is kept read-only in `legacy-reference/`.
- **Routes:** `/` Today, `/tasks`, `/projects`, `/time`, `/inbox`, `/calendar`, `/ops`, `/setup`, `/settings`. Later-phase pages show a "Not built yet" screen.
- **Supabase:** hosted cloud project, connected through Bolt's Supabase integration and reachable. The project ref, region and plan are not visible from inside the workspace; check them in the Bolt database panel.
  - pg_cron 1.6.4, pgcrypto and supabase_vault are installed. pg_net is available but not installed.
- **Edge functions:** `ops-check` (signed-in users only) and `mail-connect` (OAuth callback is public; every other action checks the sign-in).
- **Edge function secrets set:** only the built-in Supabase ones. Still needed: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, RESEND_API_KEY. No Microsoft keys are used.
- **Git:** this workspace has no git access. Bolt syncs to whichever GitHub branch is connected in Bolt's GitHub settings. A `console-v5` branch cannot be created from inside this workspace; see decision D1.
- **Hosting:** no Vercel or Netlify project is linked from this workspace.

### Existing data (row counts, 2026-10-12)

| Table group | Rows |
|---|---|
| Legacy tables from the old app (tasks, messages, notes, time_entries and 22 others) | All 0, except `profiles` 1 and `activity_categories` 8 |
| cc_companies / cc_projects | 3 / 5 (real, not demo) |
| cc_tasks | 11 (all demo) |
| cc_time_entries | 8 (6 demo, 2 real) |
| cc_monitors / cc_check_results | 3 / 7 |
| cc_settings / cc_priorities / cc_audit_log | 1 / 1 / 19 |
| cc_mail_* / cc_calendar_events | 0 (nothing connected) |

No legacy rows need mapping: the legacy tables are empty apart from the profile and 8 category rows. Legacy tables are left in place, not dropped.

### What v5 changes, and the impact on built work

| # | v5 change | Impact | Proposed action |
|---|---|---|---|
| C1 | Supabase is the hosted cloud service | Already true | Add `docs/self-hosting-notes.md` |
| C2 | All agents are in Claude; Perplexity is history only | Nothing built yet | Phase 5 as specified |
| C3 | Superhuman is the client for Outlook + Gmail; no REST API | Inbox already uses Graph and Gmail directly (correct) | Add an "Open in" setting per account (Superhuman / native) in Phase 6 |
| C4 | Dashboard relays agent results by email | Needs Resend (Phase 3 gap) and an ingest endpoint (Phase 5) | Build in phase order |
| C5 | Identities are Encountive, Doug IT and Personal, plus Retired addresses; Krewe & Kin is a Company, not an identity | **Conflict:** the built identity list includes `krewe_kin` | Map `krewe_kin` to `doug_it` on existing rows (a data change, needs approval) and remove it from pickers |
| C6 | Gmail = doug@encountive.com (Encountive), Outlook = doug@theonefor.ai (Doug IT); Internal Google app; no Azure | Outlook calendar comes in through a published ICS link; theonefor.ai mail is not read (kept separate, no Azure) | Done in code; Doug's step 1 |
| C7 | Email and calendar is Phase 6, after agents | Built early as read-only and unconnected | Keep, mark "Built early", finish Phase 6 items later |
| C8 | Shortcuts G then A and G then R | Not present | Add with the Agents and Reports pages |
| C9 | Magic-link sign-in; MFA before email integrations go live | **Conflict:** sign-in is email + password, with no MFA | Add an authenticator-app MFA requirement before any mailbox is connected; magic link optional (D3) |
| C10 | Mail snippet at most 200 characters; purge after 30 days | **Gap:** snippets are kept up to 300 characters; no purge job | Cut to 200 and add a daily purge (pg_cron) |
| C11 | Approved destinations list + console notification address | Not built | Phase 3 (with Resend) |
| C12 | `docs/console-status.md` as source of truth | Did not exist | Created (this file) |

### Gap list (built work vs v5)

- **G1:** Recurring tasks are not built.
- **G2:** "Where does this belong?" guide and identity tooltips are not built.
- **G3:** Identity addresses, approved-destinations list and console notification address are not in Settings.
- **G4:** Resend sender (doug@encountive.com) and "Send test" are not built.
- **G5:** Uptime runs when you open IT Ops or press refresh, not every 15 minutes on a schedule.
- **G6:** VIP senders, IT-signal tagging rules and the "suggest identity" hint in the inbox are not built.
- **G7:** Inbox filters "Encountive only / Doug IT only / Personal only" are partly covered by source chips; a filter by identity is still needed.
- **G8:** Items C9 and C10 above.

### Keep / Refactor / Replace

- **Keep:** all approved Phase 1–2 screens and data, IT Ops checks, and the mail and calendar sync code (read-only, server-side, encrypted tokens).
- **Refactor:** the identity list (C5), the mail snippet limit and purge (C10), and Settings (G3).
- **Replace:** nothing.
- **Legacy app:** stays reference-only. Its screens are not reused.

### Database plan (all additive; one item needs approval)

1. `cc_identity_addresses`: address, identity, status (approved / available / personal / retired), approved_at. Seeded with the addresses in the spec. Additive.
2. `cc_settings`: add a nullable `notify_address` column (default doug@theonefor.ai). Additive.
3. `cc_outbound_email_log`: recipient, subject, status. No bodies. Additive.
4. `cc_task_recurrence`, or nullable recurrence columns on `cc_tasks`. Additive.
5. A daily pg_cron job to purge mail metadata older than 30 days. Deletes only synced mail older than 30 days, as the spec requires.
6. **Needs approval (data change):** set identity `krewe_kin` to `doug_it` on companies, projects, tasks, monitors and mail accounts. This is reversible: the affected row IDs are logged in cc_audit_log first.

Rollback note per migration: drop the new table or column. For item 6, restore from the audit-log row IDs.

### Plan restatement (v5)

- Finish Phase 3: Resend console email, approved destinations, notification address, Send test, scheduled uptime.
- Fix the Phase 2 gaps: identity guide, identity cleanup (C5), recurring tasks, MFA before mail.
- Phase 4: Assets/Access, Renewals/Spend, Security, Change and Incident logs, Partner requests, Identity audit, Migration tracker.
- Phase 5: Agent Operations, including the registry, Import my agents, run log, ingest endpoints, relay email, Report Library, Locations, Notification Routes, cost, controls and "Run now".
- Phase 6: finish email and calendar, including Open in Superhuman, the local relay (Proton, Claude Code hook, watch-folder), and drift detection.
- Phase 7: GitHub, Vercel and Resend status lights, Weekly CIO Report, exports, accessibility pass, production-readiness checklist.

### Decisions (answered by Doug)

- **D1 Branch:** work on main. The app is in development and QA only; nothing is rolled out.
- **D2 Framework:** keep Vite + React 18.
- **D3 Sign-in:** password stays, and Windows Hello (passkey) sign-in is added. The sign-in page and Settings > Account are built. Doug still needs to do this: in the Supabase dashboard, go to Authentication > Passkeys, enable passkeys, set the RP ID to the stable deployed domain (bare domain, no https), and add the deployed URL as an RP origin. Changing the RP ID later invalidates saved passkeys.
- **D4 Identities:** done. Migration `cc_identity_krewe_kin_to_doug_it` moved 1 company, 1 project and 1 task to doug_it, with audit rows; the rollback is in the migration comment.
- **D5 Data export:** not needed, because there is no live data yet.
- **D6 Mail and calendar:** Doug does not use Azure, so there is no Microsoft app. Outlook calendar: Doug publishes it in Outlook on the web and pastes the ICS link on Setup > Connectors; the link is stored encrypted on the server and only outlook.office365.com / outlook.office.com / outlook.live.com links are fetched. theonefor.ai mail is NOT forwarded: Encountive and theonefor.ai are separate entities, so only the Gmail inbox (doug@encountive.com) is read. Alerts go from and to doug@encountive.com. Personal = dougtully@protonmail.com. Only GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are needed in Bolt Secrets. Krewe of Shamrock: kreweofshamrock.com (GoDaddy DNS, Vercel site, ImprovMX mail, no DMARC), 3 monitors added.

### Session 2026-10-12 (afternoon)

- Companies gained website, my role and key contact (migration `cc_company_profile_fields`). Krewe & Kin: kreweandkin.com, Doug is co-founder for IT only, Melissa (Missy) is co-founder and CEO. Added Krewe of Shamrock (Doug IT, IT support only; website not yet known).
- Monitors: the 3 website checks were relabelled and linked to their companies. Added domain-renewal and email-security checks for encountive.com (SiteGround DNS, Google Workspace), theonefor.ai (GoDaddy DNS, Microsoft 365 via GoDaddy, Proofpoint) and kreweandkin.com (Cloudflare, Email Routing).
- DNS findings: theonefor.ai has no DKIM and no DMARC; kreweandkin.com has no DMARC; encountive.com has no Google DKIM (its Resend DKIM and DMARC exist).
- Sign-up limited to doug@theonefor.ai and doug@encountive.com (migration `cc_signup_allowlist`).
- Passkeys are disabled on the auth server and Bolt's auth settings have no passkey switch. Turning them on means claiming the database into Supabase. The Windows Hello button stays hidden until passkeys are enabled.
- The OAuth return now lands on Setup > Connectors.
- Setup now has a "Your steps" tab, which is the single checklist for everything Doug has to do.

### Session 2026-10-13

- **D7 Mail inside the console:** set aside (Doug chose option 3). Only the Outlook calendar link stays. Proton Bridge runs on Doug's PC (127.0.0.1) and cannot be reached from the cloud.
- Phase 3 finished (see table). Migration `cc_phase3_console_email_and_schedule`; edge functions `ops-check` (cron + alerts) and `console-email`.
- Phase 4 core built. Migrations `cc_phase4_assets_access` and `cc_phase4_security_and_requests`: 8 new tables, owner-only RLS (4 policies each), user_id defaults to auth.uid().
- Renewal alerts show in the app only; they do not send email yet.

## Acceptance checklist

| # | Status |
|---|---|
| A1 Console email only to approved destinations; Send test | Built; works once RESEND_API_KEY is added |
| A2 Identity on every record, nagging, guide | Partial: identity and nagging exist; guide missing |
| A3 Identity audit view | Not built (Phase 4) |
| A4 Migration tracker | Not built (Phase 4) |
| A5 Report screens, library, series, diff | Not built (Phase 5) |
| A6 Report Locations manager | Not built (Phase 5) |
| A7 Notification Routes | Not built (Phase 5) |
| A8 Drift detection | Not built (Phase 5/6) |
| A9 Seeded Claude agents, Import, no kill-switch claims | Not built (Phase 5) |
| A10 Data preserved, branch only, no production | Data preserved (identity change audited). Work stays on main by decision D1. No production deploy made. |
| A11 Graph + Gmail sync; Open in Superhuman; Proton on relay | Partial: sync built, not connected; Superhuman links and relay missing |
| A12 Hosted Supabase; schema in migrations; self-hosting notes | Partial: notes file missing |
| A13 This file current | Done |
