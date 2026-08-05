# CIO Executive Dashboard

A private, self-hosted executive command center for a technical CIO. Eight
cross-linked modules — dashboard, email, tasks, kanban, calendar, notes,
pomodoro, reports — running on your own box and reachable only over your
tailnet.

Next.js 15 (App Router) · TypeScript · Tailwind + Radix · Framer Motion ·
TanStack Query · self-hosted Supabase.

> 📋 The specification, locked decisions and phase roadmap live in
> **[`PLAN.md`](./PLAN.md)** — read it first.

**Status:** Phase 1 (operational core). Tasks are live end to end; email,
calendar, kanban, notes, pomodoro and reports are scaffolded in the shell and
arrive in later phases.

---

## Getting started

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
- **Manual priority and pins.** Automatic weighted ranking lands in Phase 5.
- **Live dashboard.** Top priorities is real; the meeting, two-day and hours
  cards hold their place and say which phase fills them.
- **Installable PWA** with an offline page, on a shell that becomes a bottom
  bar on a phone.

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
| `npm run format`                     | Prettier                                             |
| `npm run icons`                      | Regenerate the PWA raster icons                      |

[Testing guide →](./docs/testing.md)

---

## Security

- **Self-hosted Supabase** on a Windows/WSL2 box; **Tailscale-only** access,
  never public.
- **Row Level Security is the access control**, not application code. Every
  table is user-owned and policy-protected, and the integration suite proves
  a second user cannot read, update or delete the first user's rows.
- Secrets live only on that box as environment variables. **This repository is
  public**: it contains no real keys, only `.env.example` with names.
- `.gitignore` excludes every `.env*` file except `.env.example`.

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
supabase/migrations/      SQL — the source of truth for the schema
tests/
  integration/            Schema + RLS against real Postgres
  e2e/                    Playwright specs and axe scans
docs/                     Data model, parser rules, module notes, testing
```

---

## Documentation

| Document                                           | Covers                                             |
| -------------------------------------------------- | -------------------------------------------------- |
| [`PLAN.md`](./PLAN.md)                             | The specification, locked decisions, phase roadmap |
| [`docs/data-model.md`](./docs/data-model.md)       | Schema, RLS, and the reasoning behind it           |
| [`docs/parser-rules.md`](./docs/parser-rules.md)   | Everything quick-add understands                   |
| [`docs/modules/tasks.md`](./docs/modules/tasks.md) | The tasks module                                   |
| [`docs/testing.md`](./docs/testing.md)             | How to run and extend the three test tiers         |
