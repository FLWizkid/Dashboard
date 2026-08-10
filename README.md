# CIO Executive Dashboard

A private, self-hosted executive command center for a technical CIO. Eight
cross-linked modules — dashboard, email, tasks, kanban, calendar, notes,
pomodoro, reports — running on your own box and reachable only over your
tailnet.

Next.js 15 (App Router) · TypeScript · Tailwind + Radix · Framer Motion ·
TanStack Query · self-hosted Supabase.

> 📋 The specification, locked decisions and phase roadmap live in
> **[`PLAN.md`](./PLAN.md)** — read it first.

**Status:** Phases 0–7 built. Six of the eight modules are live end to end —
dashboard, tasks, kanban, notes, pomodoro/hours and reports. **Email and
calendar have their whole foundation but no interface yet**, so this is not a
finished v1; see [`PLAN.md`](./PLAN.md) for exactly what is missing.

---

## Running it on your box

The whole stack — Next.js, Postgres, GoTrue, PostgREST, Realtime, Storage,
Kong, Caddy and a backup sidecar — is one compose file.

```powershell
node ops/generate-secrets.mjs --hostname dashboard.<tailnet>.ts.net --bind 100.x.y.z
pwsh ops/windows/Update-TailscaleCert.ps1
docker compose up -d
```

**[Full runbook →](./docs/runbook-windows.md)** — WSL2, Docker Desktop,
BitLocker, Tailscale HTTPS, migrations, creating your account, and the check
that proves it is not reachable from the internet.

## Developing locally

Requires **Node 22** (see `.nvmrc`).

```bash
cp .env.example .env.local   # values come from your self-hosted Supabase box
npm install
npm run dev                  # http://localhost:3000
```

Apply the migrations to your instance before first run — see
[`supabase/README.md`](./supabase/README.md).

Unauthenticated visitors are redirected to `/login`. After signing in with a
Supabase email/password account, `/dashboard` becomes available.

---

## What works today

- **Quick capture.** One line in, task out: due date, priority, category,
  owner and event references are parsed and shown as editable chips.
  [Full grammar →](./docs/parser-rules.md)
- **Confirm before linking.** A guessed event link is always a question, never
  a silent action — enforced in the schema, not just the UI.
- **Ready state.** Title + priority + due date. Anything short of it is badged
  with exactly what it needs.
- **One tap to complete, with undo** — mouse, touch or <kbd>X</kbd>.
- **Weighted, explainable ranking**, with a manual override that always wins.
  [The formula →](./docs/priority.md)
- **A board, notes with wiki-links, a Pomodoro timer and an hours ledger** —
  each with its own module doc.
- **Reports that print.** The same page you read is the page that prints; no
  server PDF. [Definitions →](./docs/reports.md)
- **Scheduled digests** to an in-app inbox and, optionally, email.
- **Offline capture.** A task typed with no connection is kept on the device
  and sent when the network returns — exactly once.
- **Installable PWA** with an offline page, on a shell that becomes a bottom
  bar on a phone and holds up in a headset browser. [Headset notes →](./docs/vr.md)

---

## Scripts

| Command                              | What it does                                         |
| ------------------------------------ | ---------------------------------------------------- |
| `npm run dev`                        | Dev server                                           |
| `npm run build` / `npm run start`    | Production build and serve                           |
| `npm run lint` / `npm run typecheck` | Static checks                                        |
| `npm run test`                       | Unit tests                                           |
| `npm run test:integration`           | Schema + RLS against Postgres (needs `DATABASE_URL`) |
| `npm run test:e2e`                   | Playwright end-to-end + axe accessibility            |
| `npm run test:all`                   | All three tiers                                      |
| `npm run check:csp`                  | CSP against a real browser and a production build    |
| `npm run check:bundle`               | The performance budget                               |
| `npm run check:pwa`                  | Installability, service worker, offline page         |
| `npm run format`                     | Prettier                                             |
| `npm run icons`                      | Regenerate the PWA raster icons                      |

[Testing guide →](./docs/testing.md)

---

## Security

- **Tailscale-only, never public.** Every host port binds to `BIND_ADDRESS`,
  which defaults to loopback — a missing value makes the stack unreachable
  rather than exposed. Only Caddy listens at all.
- **Row Level Security is the access control**, not application code. Every
  table is user-owned and policy-protected, and the integration suite proves
  a second user cannot read, update or delete the first user's rows.
- **Nothing leaves the box by default.** Error reports are scrubbed and stay
  local unless a DSN is configured; the off-site backup is `age`-encrypted
  before upload, to a key whose private half is kept elsewhere.
- **A strict Content Security Policy**, with a per-request nonce and no
  `unsafe-inline` for script. Verified by driving a real browser at a
  production build and failing on a single violation.
- **Backups are tested, not assumed.** A drill restores the newest archive —
  including the encrypted off-site copy — into a throwaway database and checks
  that the schema, the data and RLS all survived.
  [Transcript →](./docs/restore-drill-evidence.md)
- Secrets live only on that box. **This repository is public**: it contains no
  real keys, only `.env.example` with names, and CI fails if an environment
  file or certificate is ever tracked.

[Threat model →](./docs/threat-model.md)

---

## Project structure

```
src/
  app/
    dashboard/            Protected area — home + tasks
    api/                  Route handlers (tasks, categories)
    login/  offline/      Sign-in and the PWA offline page
  components/
    shell/                Responsive app shell (sidebar / bottom bar)
    tasks/                Quick-add, rows, complete animation, shortcuts
    dashboard/            Top-section cards
    ui/                   Button, field, card, dialog, badge, toast
  lib/
    tasks/                Types, ready state, sort, schemas, repositories
    quick-add/            The parser
    time/                 Timezone-aware arithmetic and formatting
    categories/           The CIO taxonomy defaults
    observability/        Error reporting and the redaction layer
supabase/migrations/      SQL — the source of truth for the schema
ops/                      Everything that makes it run on the box
  caddy/  kong/  db/      Reverse proxy, gateway, database bootstrap
  backup/                 Backup, restore, weekly restore drill
  windows/                Certificate renewal and scheduled tasks
tests/
  integration/            Schema + RLS against real Postgres
  e2e/                    Playwright specs and axe scans
docs/                     Runbook, threat model, backups, data model, testing
```

---

## Documentation

| Document                                                             | Covers                                                |
| -------------------------------------------------------------------- | ----------------------------------------------------- |
| [`PLAN.md`](./PLAN.md)                                               | The specification, locked decisions, phase roadmap    |
| [`docs/runbook-windows.md`](./docs/runbook-windows.md)               | Fresh machine → working dashboard, and day-to-day ops |
| [`docs/threat-model.md`](./docs/threat-model.md)                     | Assets, boundaries, mitigations, residual risks       |
| [`docs/backups.md`](./docs/backups.md)                               | 3-2-1, the restore drill, and how to actually restore |
| [`docs/data-model.md`](./docs/data-model.md)                         | Schema, RLS, and the reasoning behind it              |
| [`docs/parser-rules.md`](./docs/parser-rules.md)                     | Everything quick-add understands                      |
| [`docs/priority.md`](./docs/priority.md)                             | The scoring formula, worked examples, overrides       |
| [`docs/hours.md`](./docs/hours.md)                                   | The hours model, Pomodoro, offline logging            |
| [`docs/reports.md`](./docs/reports.md)                               | Report definitions, digest schedule, email setup      |
| [`docs/security-review.md`](./docs/security-review.md)               | The Phase 7 review: findings, fixes, what is open     |
| [`docs/performance.md`](./docs/performance.md)                       | The budget, what it measures and what it does not     |
| [`docs/vr.md`](./docs/vr.md)                                         | The headset view and the manual checklist             |
| [`docs/restore-drill-evidence.md`](./docs/restore-drill-evidence.md) | A real backup and restore, transcript                 |
| [`docs/vault.md`](./docs/vault.md)                                   | The Obsidian vault, sync rules, conflicts             |
| [`docs/providers.md`](./docs/providers.md)                           | Mail and calendar adapters, capabilities              |
| [`docs/caching-policy.md`](./docs/caching-policy.md)                 | What is cached, and what refuses to be                |
| [`docs/modules/tasks.md`](./docs/modules/tasks.md)                   | The tasks module                                      |
| [`docs/testing.md`](./docs/testing.md)                               | How to run and extend the three test tiers            |
| [`ops/README.md`](./ops/README.md)                                   | What is in the operations directory and why           |
