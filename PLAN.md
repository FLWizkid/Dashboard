# CIO Executive Dashboard — plan & roadmap

> **Why this file exists:** Claude Code sessions don't share memory. Anything
> not written into this repo is lost when a session ends. This document is the
> durable source of truth. **Keep it updated as decisions land.**

> **History note.** Phases 0–1 were first attempted by sessions working
> _without_ the product specification, and produced placeholder `priorities`,
> `time_entries` and Notion modules that were guesses. The full spec has since
> landed and is captured below. Those placeholder modules have been removed —
> see [Retired](#retired).

---

## The product

A balanced, all-in-one executive dashboard for a technical CIO. Personal
single-user first, teammate expansion later. **The app is the system of
record** — mail, calendar and Markdown notes are linked into it, never the
reverse.

Eight modules, all cross-linked:

Executive Dashboard · Unified Email · Tasks · Kanban · Calendar · Notes ·
Pomodoro · Reports

---

## Locked decisions

| Area                | Decision                                                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Framework**       | Next.js 15 (App Router) + TypeScript (strict)                                                                                                                        |
| **UI**              | Tailwind, shadcn-style primitives on Radix, Framer Motion, TanStack Query                                                                                            |
| **Backend**         | **Self-hosted Supabase** (Postgres + GoTrue + PostgREST + Realtime + Storage + Kong) in Docker                                                                       |
| **Host**            | Windows box, Docker Desktop + WSL2, behind Caddy (auto-TLS)                                                                                                          |
| **Network**         | **Tailscale/WireGuard only.** Never public. OAuth redirect URIs use the tailnet HTTPS hostname (browser-side redirect, so tailnet-only is fine)                      |
| **Auth**            | Supabase email/password, single user, MFA-ready                                                                                                                      |
| **Clients**         | Responsive PWA (installable, offline time-logging) + flat-in-headset VR view; front-end architected so an immersive WebXR layer can be added later without a rewrite |
| **Data protection** | Postgres RLS, encryption at rest, field-encrypted email bodies (AES-256-GCM, AAD-bound), Postgres FTS, audit logging, configurable retention (default 24 months)     |
| **Backups**         | 3-2-1: local second disk/NAS plus client-side-encrypted offsite, with tested restores                                                                                |
| **Knowledge layer** | **Local-first Markdown** (Obsidian-compatible vault) with two-way file sync. **No Notion, no cloud knowledge tool.**                                                 |
| **Repo visibility** | **Public** — so no secret may ever be committed. `.gitignore` + `.env.example` names only; all keys live on the box                                                  |

### Integrations

- **Gmail + Google Calendar** first, **Microsoft Graph** registered later
  (kept in the plan), both via direct OAuth APIs.
- **ProtonMail via Proton Bridge** (paid, on the same box) through an
  IMAP/SMTP adapter — treated as **constrained**; Proton Calendar is
  read-visibility first.
- All providers sit behind **shared normalized internal mail/calendar models**;
  provider logic is isolated in adapters.
- Full email cache/sync gated by a **per-mailbox caching policy**
  (Off / Metadata / Full). Corporate accounts default to Off with an
  admin-consent path; personal accounts Full.
- **Post-v1, phaseable:** Slack + Zoom, Google Drive + OneDrive/SharePoint,
  GitHub — as linkable, searchable context.

### Key behaviours

- **Dashboard:** today's meetings, next-2-days preview, top priorities, hours
  this week. One "needs attention" card (count + top 1–3 critical unread,
  expandable) that never dominates when nothing is critical.
- **Priority model:** hybrid auto + always-available manual override.
  Importance 35% / overdue 25% / due-proximity 20% / calendar-proximity 15% /
  manual 5%. Importance inferred from linked calendar context — events within
  48h boost; leadership/external/decision meetings boost more; linked
  prep/follow-up inherit part.
- **Sender importance:** manual four levels (Critical/High/Normal/Low).
  Critical → highlight, pin near top, surface in the attention card if unread,
  **suggest** (never force) a task.
- **Quick-add:** single-line fast add with smart parsing; all suggestions
  editable; **confirm before linking** any guessed event; optional prep note
  (before) and follow-up note (after). Ready-state minimum is title, priority
  and due date. Owner optional in personal mode.
- **Email → task:** create task, link the source email, suggest due date and
  priority (explicit deadline language strongest, then related meeting timing,
  then sender importance) — always with the reason shown and editable.
- **Hours:** Pomodoro sessions (focused) + selected work-category calendar
  blocks (scheduled), shown separately and combined, weekly/monthly, with a
  visible running weekly total. Manual adjustments allowed and clearly
  labelled. Work-category classification from source calendar + keywords +
  attendee cues + manual override (override always wins); visible and
  editable.
- **Kanban lanes:** Inbox → Ready → In Progress → Waiting → Done. New captures
  land in Inbox; one-click promote to Ready when the minimum fields are
  present.
- **Notes:** decision-log-first. Decision and rationale are **equal anchors**.
  Core structure: decision, rationale, context, owner, date, follow-up
  actions. Follow-ups become **draft** tasks (need owner + due + priority to
  activate).
- **Pomodoro:** 25/5/15, long break every 4, optional task linkage.
- **Reports:** interactive (filters, drill-downs) + print-friendly. First-level
  grouping Overdue / Due Soon / Current / Upcoming. Printable structure:
  executive summary → prioritized tasks → next-two-days preview. Scheduled
  digests (daily brief, weekly/monthly rollups) to in-app inbox + HTML email;
  on-demand PDF via browser print (no server PDF).
- **Activity taxonomy** (editable defaults): Strategic · Operational · People
  & Team · Stakeholder & Board · Vendor & Budget · Security, Risk &
  Compliance · Innovation & R&D · Admin & Inbox.

### Design

Refined executive / calm. Forest green primary, charcoal / warm neutral,
brass accent. Subtle purposeful micro-animations. WCAG-AA contrast.
`prefers-reduced-motion` respected. To-dos extremely easy to add and to mark
done.

### Defaults

Pomodoro 25/5/15 · retention 24 months · work week Mon–Fri · timezone
auto-detected from the browser with a settings override · digest email
`doug@theonefor.ai`.

---

## Phases

Each phase stops at a gate for review.

### P0 — Foundation & infra ✅ complete

- [x] `docker-compose.yml` — Next.js + self-hosted Supabase (Postgres, GoTrue,
      PostgREST, Realtime, Storage, Kong), Caddy, backup sidecar. Studio and
      postgres-meta behind an `admin` profile, off by default
- [x] Caddy auto-TLS on the tailnet hostname, using Tailscale-issued
      certificates (ACME cannot run on a host that is not public)
- [x] **Nothing published beyond the tailnet** — every port binds to
      `BIND_ADDRESS`, defaulting to loopback so a missing value fails closed
- [x] Base schema + RLS, email/password auth with signup disabled, MFA-ready
- [x] Design system + motion tokens, PWA shell _(built during P1)_
- [x] CI: lint, types, unit, integration, E2E, and a deployment-config job
- [x] 3-2-1 backup jobs with a **weekly automated restore drill**
- [x] Sentry-ready error hooks — scrubbed, and inert until a DSN is set
- [x] [Threat model](docs/threat-model.md)
- [x] [Windows/WSL2 runbook](docs/runbook-windows.md) and Tailscale notes

> **History.** The approved P0 predated the specification, so its
> infrastructure deliverables did not exist in the repo. Phase 1 built the
> parts it could not proceed without (design system, motion tokens, PWA
> shell, CI); the rest landed afterwards, on this branch, and are listed
> above.

### P1 — Operational core ✅ this branch

- [x] `tasks`, `activity_categories` (8 CIO defaults, seeded and editable),
      polymorphic `task_links`, all with RLS
- [x] Quick-add with smart parsing; every suggestion inline-editable
- [x] Confirm-before-link for guessed event references
- [x] Ready state (title + priority + due date) as a generated column and a
      client-side twin; badge naming what is missing
- [x] One-tap complete with the completion moment, and undo
- [x] Manual priority and pins
- [x] Dashboard top section: meetings / next-2-days / hours placeholders,
      **top priorities live**
- [x] Real responsive PWA shell; keyboard-first throughout
- [x] Forest/charcoal/brass design system with motion tokens
- [x] Unit + Postgres RLS integration + Playwright E2E + axe, all in CI
- [x] Module README, data-model notes, parser rules, testing guide

### P2 — Email + calendar 🚧 in progress

**Foundation complete and tested; the interface is not yet built.** What is in
the repo today:

- [x] Field encryption: AES-256-GCM envelope, AAD-bound, additive key rotation
- [x] Normalized model — Mailbox / Message / Thread / Calendar / Event — with
      RLS on every table
- [x] **Per-mailbox caching policy enforced by the database**, not only by
      code: Off stores nothing, Metadata refuses a body, corporate + Full
      needs recorded admin consent
- [x] Encrypted bodies, FTS over a vector built before encryption, and a
      retention purge honouring each account's window (24 months by default)
- [x] Adapter contract with a capability descriptor, so constrained providers
      degrade explicitly rather than throwing
- [x] Gmail + Google Calendar adapter, OAuth, MSW-tested
- [x] Microsoft Graph adapter, feature-flagged on the Azure registration
- [x] Proton Bridge IMAP/SMTP adapter, with its constraints declared
- [x] Sync service: policy gating on the write path, stale-but-safe
      degradation, exponential back-off
- [x] Email → task with the specified precedence and a reason for every
      suggestion
- [x] [Provider matrix](docs/providers.md) ·
      [OAuth setup](docs/oauth-setup.md) ·
      [Caching policy](docs/caching-policy.md)

Still to build before the P2 gate:

- [ ] OAuth callback routes and the connect-account flow
- [ ] Mail repository and API routes
- [ ] Email workspace: unified inbox, thread view, compose and reply
- [ ] Needs-attention card, and four-level sender importance in the UI
- [ ] Calendar workspace, and wiring the two dashboard placeholders to real data
- [ ] E2E: connect a mock mailbox → triage → email → task

### P3 — Kanban + notes 🚧 in progress

Done and tested:

- [x] **Kanban board**, live: five lanes, drag **and** keyboard moves, triage
      suggestions, one-click promote. The board is a view of `tasks.status`,
      so a lane move shows on the task list immediately — and the task list
      now has a Status control that moves the card the other way
- [x] Inbox → Ready is gated on the Ready minimum, identically whether the
      card was dragged, keyed or clicked
- [x] `notes` schema, decision-log-first: **decision and rationale are equal
      anchors**, and `is_complete_decision` is a generated column saying so
- [x] `note_links` for wiki-links and cross-module links; unresolved links are
      a supported state
- [x] Draft follow-ups: `is_draft` plus a trigger refusing activation without
      owner, due date and priority — a higher bar than Ready, on purpose
- [x] Markdown (de)serialization: YAML frontmatter with **unknown keys
      preserved verbatim**, wiki-links, and Obsidian Tasks checkboxes
- [x] **Deterministic vault reconciliation** over three values, with a
      conflict copy rather than a merge and no path that loses an edit
- [x] Vault filesystem layer: atomic writes, path-escape refusal, managed
      folders only
- [x] [The vault guide](docs/vault.md) — layout, sync rules, conflicts, and
      opening it in Obsidian including mobile

Still to build before the P3 gate:

- [ ] Notes UI: the decision-log editor, wiki-link autocomplete, backlinks pane
- [ ] Note ↔ task/event linking in the interface
- [ ] The sync job and its routes — the engine is tested, nothing schedules it
- [ ] Kanban cards showing their linked notes and events
- [ ] E2E: note → draft task → activate

### P4 — Hours + Pomodoro

Pomodoro. Work-category classification. Hours rollups (focused + scheduled +
manual). Weekly running total. Offline mobile time-logging with sync.

### P5 — Priority engine + connected views

Full weighted ranking. Calendar-derived importance. Confirm-before-link
prep/follow-up flows. Cross-module linkage polish.

### P6 — Reports + scheduled digests

Interactive report and print mode. Grouping. Cron digests to the in-app inbox
and email.

### P7 — Hardening + v1

Accessibility pass, performance budget, security review, retention/purge,
restore drill, PWA offline depth, flat-VR verification, docs and runbooks.
**v1 ships.**

### Post-v1

Secondary integrations (Slack/Zoom, Drive/SharePoint, GitHub), immersive
WebXR, teammate-mode foundations.

---

## Setup steps only you can do

The stack is complete; three things need values that cannot live in a public
repository. Until the last two are set, every backup log ends with **"NOT yet
a 3-2-1 backup"**, which is the intended behaviour.

- [ ] BitLocker on the volume holding the Docker data root — this is the
      encryption-at-rest control ([runbook § 2.3](docs/runbook-windows.md))
- [ ] `BACKUP_SECONDARY_PATH` pointed at a second physical device
- [ ] `BACKUP_AGE_RECIPIENT` + `BACKUP_RCLONE_REMOTE` for the encrypted
      off-site copy ([backups.md](docs/backups.md))

---

## Retired

Removed on the Phase 1 branch because they were built without the spec and
contradict it:

| Removed                                                        | Why                                                                                |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `/dashboard/notion` + `@notionhq/client` + `NOTION_*` env vars | The spec is explicit: local-first Markdown, **no Notion**, no cloud knowledge tool |
| `/dashboard/priority`                                          | Superseded by the Tasks module                                                     |
| `/dashboard/hours`                                             | A guessed time log; the real hours model arrives in P4                             |

The `priorities` and `time_entries` **tables** are now retired by
`20260809000001_retire_placeholder_tables.sql`, which **moves** them to an
`archive` schema rather than dropping them. That removes them from the API
surface — PostgREST only exposes `public` — while keeping every row
recoverable. Dropping is irreversible, so it stays a separate, deliberate
step; the exact statements are at the bottom of that migration.

---

## Running it

**On the box** — [docs/runbook-windows.md](docs/runbook-windows.md), start to
finish. Roughly:

```powershell
node ops/generate-secrets.mjs --hostname dashboard.<tailnet>.ts.net --bind 100.x.y.z
pwsh ops/windows/Update-TailscaleCert.ps1
docker compose up -d
```

**Locally, for development:**

```bash
cp .env.example .env.local   # fill in from the box; never commit
npm install
npm run dev                  # http://localhost:3000
```

| Command                                                | Does                                                 |
| ------------------------------------------------------ | ---------------------------------------------------- |
| `npm run test`                                         | Unit tests (app + ops)                               |
| `npm run test:integration`                             | Schema + RLS against Postgres (needs `DATABASE_URL`) |
| `npm run test:e2e`                                     | Playwright + axe                                     |
| `npm run lint` / `npm run typecheck` / `npm run build` | The CI gates                                         |

Docs: [runbook](docs/runbook-windows.md) · [threat model](docs/threat-model.md)
· [backups](docs/backups.md) · [data model](docs/data-model.md) ·
[parser rules](docs/parser-rules.md) · [tasks module](docs/modules/tasks.md) ·
[testing](docs/testing.md) · [ops](ops/README.md)

---

## Guardrails

- **Never** commit `.env.local` or any real key. The repository is public.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only — never `NEXT_PUBLIC_`, never
  read in client code.
- Supabase is **self-hosted**; do not provision cloud resources for it.
- RLS is the access control. Application code may add checks; it may never be
  the only one.
- `DASHBOARD_DATA_MODE=memory` is a test-only switch and is inert in a
  production build. Keep it that way.
- **Nothing is published beyond the tailnet.** Host ports bind to
  `BIND_ADDRESS`, which defaults to loopback so a missing value fails closed.
  Docker bypasses the Windows Firewall when it publishes a port, so the bind
  address is the control — not the firewall.
- Nothing leaves the box by default. Error reporting is local until a DSN is
  set; backups are encrypted before they are uploaded.
