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

Interface, also done:

- [x] Notes page: capture in one field, a list beside an editor, full-text
      search and a kind filter
- [x] **Decision and reasoning as sibling fields** — same size, same weight,
      side by side. The third place the product says they are equals, after
      the generated column and the two `##` headings in the Markdown
- [x] **Incomplete is a state, not an error.** A decision saves without its
      reasoning; the editor says what is missing and the list marks it, so the
      gaps are findable without opening every note
- [x] Wiki-link autocomplete on `[[`, keyboard-driven, and a link to a page
      that doesn't exist yet is **accepted** — it resolves by itself the
      moment that page is written
- [x] Backlinks pane showing the line each link appears on
- [x] Links rebuilt from the prose on every save, because the text is the
      truth and an index that can drift from it is worse than none
- [x] E2E for both deliberate-looking-wrong behaviours, plus two axe scans

Still to build before the P3 gate:

- [ ] The vault sync **job** and its routes — the reconciliation engine is
      tested against a real filesystem, but nothing schedules it, so notes
      live in Postgres and not yet on disk
- [ ] Note ↔ task/event linking in the interface (the schema and the link
      kinds exist; only wiki-links are wired to the editor)
- [ ] Kanban cards showing their linked notes and events
- [ ] E2E: note → draft task → activate

Two things the interface work surfaced:

- Changing the kind filter **closed the note being edited**, because the
  selection was cleared whenever the list stopped containing it. A filter
  narrows the list; the editor is not part of the list.
- The `[[` menu carried `aria-expanded` / `aria-controls` /
  `aria-autocomplete` on a bare textarea, which is a combobox's vocabulary and
  invalid without the role. Taking the role would make a screen reader
  announce a long-form note body as a combo box, so the attributes went and
  the live region now names the highlighted option instead.

### P4 — Hours + Pomodoro ✅

Done and tested:

- [x] Schema: `pomodoro_sessions`, `time_entries` as the focused+manual ledger,
      `work_category_rules`, and per-event classification columns
- [x] **Scheduled hours are derived from the calendar, never stored** — a
      moved or cancelled meeting can't leave a stale ledger row. A check
      constraint refuses `source = 'scheduled'`
- [x] **Combined total counts overlap once**: a Pomodoro run during a meeting
      is one hour, not two. Per-source totals stay plain sums, and the overlap
      is reported
- [x] Classifier with the specified precedence — **manual override always
      wins**, enforced by a trigger because the classifier re-runs on every
      sync. Every result explains itself
- [x] Include/exclude toggles per event (tri-state) and per calendar
- [x] Pomodoro state machine holding **instants, not remaining seconds**, so it
      survives a reload, a locked phone and a sleeping laptop. Overruns capped;
      abandoned sessions still count the time spent; breaks never count
- [x] One running session at a time, enforced by a partial unique index
- [x] Offline outbox: local write first, client-key idempotency, nothing
      deleted until the server confirms, silence treated as "keep"
- [x] Weekly (Mon-start) and monthly rollups that add up, with midnight-
      crossing spans split across both days
- [x] [The hours guide](docs/hours.md)

Interface, also done:

- [x] Pomodoro page: the dial, keyboard-first controls (space / `s` / `n`),
      optional task linkage, session history
- [x] The persistent "currently focusing" indicator, in the shell so it
      follows you into every module
- [x] Hours view: three sources split, combined with the overlap **stated**,
      daily breakdown, week stepping
- [x] One-tap quick-log and the manual entry form, both on the outbox — the
      network is never between pressing the button and the time being safe
- [x] Rule editor with reorderable, first-match-wins rules; per-event
      override with the tri-state toggle and the reason on every block
- [x] Dashboard "hours this week" card, reading the same endpoint the hours
      view does so the two cannot disagree
- [x] E2E: log offline → reconnect → sync, plus a queued entry surviving a
      reload and a retried flush that does not double-count
- [x] Axe scans on the hours view, the rule editor and the timer

Three bugs the interface work surfaced, all fixed:

- Every component calling `useOutbox` got **its own queue**. They shared
  IndexedDB but not the state derived from it, so quick-log queued into one
  copy and the banner rendered another. Now one provider, and the hook throws
  outside it.
- Two copies of the Pomodoro machine — the page and the shell indicator —
  both wrote the same `localStorage` key, and the idle one **reset the running
  one** on reload. Same fix.
- The restore effect could overwrite a session started before React flushed
  it, so a click landing in that window did nothing. The restore now refuses
  to clobber a state that has moved, and controls stay disabled until it runs.

### P5 — Priority engine + connected views 🚧

Done and tested:

- [x] **Weighted scoring** — importance 35 / overdue 25 / due-proximity 20 /
      calendar-proximity 15 / manual 5, each factor normalised to 0–1 so a
      weight change alters that factor and nothing else
- [x] **Deterministic**: same inputs and same `now` give the same score, and
      the comparator is a total order, so the list never shuffles itself
- [x] Overdue **saturates at a fortnight** — one task forgotten in March must
      not own the list forever
- [x] Due-proximity and overdue never both fire, so lateness isn't counted
      at 45% of the total
- [x] **Prep and follow-up run in opposite directions** around the meeting: a
      follow-up ranked highly the day before is the engine telling you to do
      something you cannot yet do
- [x] Importance inference from meetings — imminence, external party,
      decision words, leadership, organiser — every signal checkable by
      looking at the meeting
- [x] Linked work inherits **part** of the meeting's importance (prep 70%,
      follow-up 50%), and several meetings take the strongest, not the sum
- [x] **Manual rank wins outright and is sticky** — nothing automatic writes
      the column, a trigger stamps when it was set, and an ordinary edit
      leaves it alone
- [x] **Confirm before link**: suggestions live in their own table, detection
      requires shared significant words (never timing alone), the offered
      note is a separate yes, and declining means never asking again
- [x] A database trigger refuses a backdated already-confirmed event link —
      "never auto-link silently" survives the next import script
- [x] **Explainable**: a one-line reason on every row and a panel naming each
      contributing factor, with the number shown last and quietly
- [x] The score is **never stored** — it is a function of the clock, and a
      stored copy goes stale at midnight with no visible symptom
- [x] [The scoring guide](docs/priority.md), with worked examples asserted in
      the test suite so the two cannot drift

Still to build before the P5 gate:

- [ ] Drag-to-place in the interface — manual rank is settable through the
      API and honoured everywhere, but the only way to set it today is a
      PATCH, not a gesture
- [ ] Connected-views polish: the linkage surface is consistent for
      task ↔ event ↔ note, but email ↔ task and kanban ↔ note are not yet
      shown, and there are no deep links between modules
- [ ] The calendar half has **no live feed** until P2's sync lands, so
      proximity, inference and detection are exercised against seeded and
      stored events rather than a real calendar

### P6 — Reports + scheduled digests 🚧

Done and tested:

- [x] **Interactive report workspace** — search, priority, category and
      incomplete-only filters, over the four-way grouping
- [x] **Overdue / Due soon / Current / Upcoming**, with the mapping from the
      task module's five due-buckets stated rather than inferred. **Current
      holds the undated work** — a fifth "no due date" section at the bottom
      is where undated work goes to be forgotten
- [x] Every group renders, **including the empty ones**: an absent "Overdue"
      heading and an empty one say opposite things
- [x] Due-date ordering within each group, tie-broken to a total order so the
      printed page and the emailed brief list things identically
- [x] **Filters narrow the list and never the summary** — a headline figure
      that moves when you change a dropdown is one nobody can quote. The
      panel says how many rows are hidden
- [x] An empty filter means **everything**, never nothing
- [x] **A number that cannot be computed is `null`, never `0`** — unread mail
      with no account connected renders "—" with its reason, not a confident
      zero
- [x] Activity splits per category with shares; the two-day rollup puts
      **overdue work on today's slot**, because that is what today absorbs
- [x] **Print is the same markup**, not a second route — `@media print` hides
      the controls, flattens the palette to ink on white, sets page breaks,
      prints link URLs, and adds an `<h1>` that only exists on paper
- [x] Printed structure is the specification's: summary → prioritised tasks →
      next two days. Section 3 is `break-before-page`, so the standalone
      two-day report is "print pages 3-on" rather than a second codepath
- [x] **Digests**: daily brief, weekly and monthly rollups, composed from the
      same `buildReport()` the screen uses so the two cannot disagree
- [x] HTML written by hand — tables and inline styles, the subset email
      clients actually honour — with a text alternative written to be read,
      which is what the in-app inbox renders
- [x] **The cron fires hourly, not daily**, and asks "is it 07:00 in _their_
      zone yet?". One schedule serves any timezone and a missed hour is
      recoverable instead of lost until tomorrow
- [x] **Claim the period before composing.** A unique index on
      `(user_id, kind, period_date)` is the guard; weekly collapses to its
      Monday and monthly to the first, so a retry lands on the same key
- [x] **The in-app inbox is written first, unconditionally** — an SMTP outage
      records `email_ok = false` with the reason and never costs the brief
- [x] Email behind an adapter; **no relay configured is a valid setting**, not
      a failure, and the endpoint's bearer token path is _closed_ when the
      token is unset rather than open to everyone
- [x] Retention: `purge_old_digests()` on the same 24-month window
- [x] 80 unit tests, 13 integration tests through real Postgres, 13 E2E specs,
      and axe scans of the workspace, the inbox and **the printed rendering**
- [x] [The reports guide](docs/reports.md) — definitions, schedule, email setup

Known gaps, both inherited rather than introduced:

- [ ] The two-day preview's **calendar half reads an empty table** until P2's
      calendar sync lands. Tasks show; events say "nothing scheduled"
- [ ] **pg_cron is not on a stock Postgres**, so the migration's schedule
      block raises a notice and skips in the test environment. The tables,
      policies and purge function all install; the box's Supabase image ships
      the extension. `docs/reports.md § 5.4` covers driving the endpoint from
      an external scheduler instead

### P7 — Hardening 🚧

Done and verified:

- [x] **The CSP gap is closed.** Per-request nonce from middleware,
      `strict-dynamic`, no `unsafe-inline` for script; Caddy no longer sets the
      header at all because its directive _replaces_ and would discard the
      nonce. `ops/check-csp.mjs` drives Chromium at a production build and
      fails on one violation — then types into the sign-in form to prove React
      actually mounted
- [x] **Two real bugs that only a browser could find**: the sign-in redirect
      pointed at the container's bind address (`localhost:3000`, a dead
      address on your laptop — every first sign-in would have dead-ended), and
      `upgrade-insecure-requests` blocked same-origin prefetches on any
      non-TLS hop
- [x] **RLS is a property of the schema, not of who remembered a test.** All
      22 tables have it on, all have policies, every policy names the current
      user, and every `security definer` function pins a `search_path`
- [x] **The three npm advisories are resolved, not waved at.** `sharp` is
      deleted from the runtime output by `postbuild` and the bundle check
      fails if it returns; `postcss` is build-time only over our own CSS. Both
      assessed in [the review](docs/security-review.md)
- [x] **A performance budget that fails the build** — measured from the build
      manifest, not scraped from a log. `LazyMotion` took 77 kB off every
      dashboard route, and the Supabase client is now imported on demand,
      taking `/login` from 618 kB to 377 kB
- [x] **Accessibility across every module**, not whichever surfaces each phase
      added: 44 scans including a reduced-motion pass per route, the 404 and
      offline pages, keyboard reachability of every module, and keyboard
      operation of the board and the timer
- [x] **Offline task capture.** Same mechanism as the hours outbox — write to
      IndexedDB first, carry a device key, settle only on confirmation — with
      a partial unique index and an immutability trigger behind it, and E2E
      specs that take the network away for real
- [x] **PWA depth verified against production**, because the service worker
      only registers there and the E2E suite runs `next dev`.
      `ops/check-pwa.mjs` checks installability, registration, control, and
      the offline page with the network off
- [x] **A real backup and restore drill**, including — for the first time —
      the encrypted off-site copy. It found two bugs.
      [Transcript](docs/restore-drill-evidence.md)
- [x] **Retention proved per module**, including what must _never_ be purged:
      tasks, notes and hours have no purge function, because the app is the
      system of record and there is no upstream to re-sync from
- [x] **Flat-in-headset verified at headset viewports** — three window shapes,
      a 12px type floor, a 24px target floor, no-hover reachability — plus the
      WebXR seam and an honest [manual checklist](docs/vr.md) for the things
      no machine can check
- [x] Docs: [security review](docs/security-review.md),
      [performance](docs/performance.md), [headset](docs/vr.md),
      [restore evidence](docs/restore-drill-evidence.md)

**The v1 gate is not claimed.** Everything on the P7 list is done, and the
product is materially harder to break than it was — but "production-ready v1"
means the thing the specification describes, and two of its eight modules have
no interface:

- [ ] **Email workspace** — unified inbox, thread view, compose and reply.
      The schema, encryption, adapters and sync service all exist; nothing
      renders them
- [ ] **Calendar workspace**, and the sync that feeds it. Its absence is also
      why the two-day report preview shows tasks only, and why the priority
      engine runs on three of its five factors
- [ ] **The vault sync job.** Reconciliation is tested against a real
      filesystem; nothing schedules it, so notes live in Postgres and not on
      disk
- [ ] **Drag-to-place** for manual rank, and cross-module deep links

A release that shipped without those would be a release that quietly redefined
what was asked for.

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
