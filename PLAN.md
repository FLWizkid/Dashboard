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
| **Data protection** | Postgres RLS, encryption at rest, field-encrypted email bodies, Postgres FTS, audit logging, configurable retention (default 24 months)                              |
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

### P0 — Foundation & infra ✅ gate approved

Docker compose (Next.js + self-hosted Supabase), Caddy auto-TLS, Tailscale
notes, base schema + RLS, email/password auth, design system + motion tokens,
PWA shell, CI, 3-2-1 backup jobs, Sentry-ready hooks, threat model and
Windows/WSL2 runbook.

> **Carried forward.** The approved P0 predates the specification, so several
> of its deliverables do not yet exist in the repo: **Docker compose, Caddy
> config, Tailscale notes, backup jobs, Sentry hooks, threat model and the
> Windows/WSL2 runbook.** The pieces Phase 1 could not proceed without — the
> design system, motion tokens, PWA shell and CI — were built as part of
> Phase 1. The infrastructure items are outstanding and are the first thing to
> schedule; see [Outstanding from P0](#outstanding-from-p0).

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

### P2 — Email + calendar

Gmail, then Microsoft Graph, plus the Proton Bridge adapter. Per-mailbox
caching policy. Encrypted bodies + FTS. Needs-attention card. Four-level
sender importance. Email → task. Two-day rollup with due and overdue tasks.

### P3 — Kanban + notes

Lanes and promotion. Decision-log notes. Draft follow-up tasks. Local
Markdown/Obsidian vault sync.

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

## Outstanding from P0

Not blockers for P1, but needed before the app actually runs on the box:

- [ ] `docker-compose.yml` for Next.js + the self-hosted Supabase stack
- [ ] Caddyfile with auto-TLS for the tailnet hostname
- [ ] Tailscale setup notes and the Windows/WSL2 runbook
- [ ] 3-2-1 backup jobs (local + client-side-encrypted offsite) and a tested
      restore
- [ ] Sentry-ready hooks
- [ ] Threat model

---

## Retired

Removed on the Phase 1 branch because they were built without the spec and
contradict it:

| Removed                                                        | Why                                                                                |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `/dashboard/notion` + `@notionhq/client` + `NOTION_*` env vars | The spec is explicit: local-first Markdown, **no Notion**, no cloud knowledge tool |
| `/dashboard/priority`                                          | Superseded by the Tasks module                                                     |
| `/dashboard/hours`                                             | A guessed time log; the real hours model arrives in P4                             |

The `priorities` and `time_entries` **tables** are intentionally left in place.
Dropping tables destroys data and should be a separate, explicitly reviewed
migration — not a side effect of a feature branch. Neither is referenced by
any code.

---

## Local development

```bash
cp .env.example .env.local   # fill in from the box; never commit
npm install
npm run dev                  # http://localhost:3000
```

| Command                                                | Does                                                 |
| ------------------------------------------------------ | ---------------------------------------------------- |
| `npm run test`                                         | Unit tests                                           |
| `npm run test:integration`                             | Schema + RLS against Postgres (needs `DATABASE_URL`) |
| `npm run test:e2e`                                     | Playwright + axe                                     |
| `npm run lint` / `npm run typecheck` / `npm run build` | The CI gates                                         |

Docs: [data model](docs/data-model.md) · [parser rules](docs/parser-rules.md)
· [tasks module](docs/modules/tasks.md) · [testing](docs/testing.md)

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
