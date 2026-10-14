# Self-hosting notes

The console is a static Vite + React site backed by one Supabase project.

## Pieces
- **Frontend:** `npm run build` produces `dist/`. Host anywhere static (Vercel, Netlify, any web server). Needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` at build time.
- **Database:** all schema lives in Supabase migrations (`cc_*` tables, owner-only RLS). Apply them in order to a new project.
- **Scheduled jobs (pg_cron):** `cc-ops-check-15min` (health checks), `cc-purge-old-mail` (daily, removes mail previews older than 30 days).
- **Edge functions:** `ops-check`, `console-email`, `mail-connect`, `agent-report`, `dev-status`. JWT verification per `supabase/config.toml`.

## Secrets (edge functions)
| Name | Used by | Required |
|---|---|---|
| RESEND_API_KEY | console-email, agent-report, ops-check alerts, dev-status | For any email |
| GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | mail-connect | For Gmail |
| MICROSOFT_CLIENT_ID / MICROSOFT_TENANT_ID / MICROSOFT_CLIENT_SECRET | mail-connect | For Outlook mail |
| GITHUB_TOKEN | dev-status | Optional |
| VERCEL_TOKEN / VERCEL_TEAM_ID | dev-status | Optional |

## Auth
- Email/password sign-in. Two-step sign-in is not used yet; consider adding it once the build is finished.
- Set the console web address under Settings, Email so emailed report links open the right site.

## Moving to a new host
1. Create the Supabase project, run migrations, add secrets, deploy functions.
2. Re-create the pg_cron jobs (they reference the project URL).
3. Update OAuth redirect URIs in Google Cloud and Microsoft Entra to the new `mail-connect/callback` address.
4. Rotate the agent check-in key and update each agent's instructions.
