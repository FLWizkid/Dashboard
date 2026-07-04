# God's Master Dashboard — Plan & Roadmap

> **Why this file exists:** Claude Code sessions don't share memory. Anything
> not written into this repo is lost when a session ends. This document is the
> durable source of truth for the plan so any future session can pick up
> exactly where the last one left off. **Keep it updated as decisions land.**

---

## Vision

An executive command center — a single private dashboard that pulls together
the signals the owner cares about (priorities, hours/capacity, Notion content,
and more to come) behind authenticated, network-restricted access.

---

## Locked architecture decisions

These were decided in planning and carry over verbatim:

| Area | Decision |
| --- | --- |
| **Framework** | Next.js 15 (App Router) + TypeScript (strict) |
| **Styling** | Tailwind CSS |
| **Backend / DB / Auth** | **Self-hosted Supabase** on the owner's Windows/WSL2 box |
| **Auth method** | Email + password (Supabase Auth) |
| **Network** | **Tailscale-only** access — the app + Supabase are reachable only over the tailnet, not the public internet |
| **Secrets** | Live **only** on the Windows box as env vars. Never committed. `.gitignore` + `.env.example` enforce this. |
| **Repo visibility** | Currently **Public**. Code-only is fine as long as no secrets are ever committed. Flipping to **Private** is the more conservative default for an executive tool — owner's call. |
| **Data locality** | Email cache and personal data stay on the private box; a public code repo does not expose them. |

---

## Phased plan

### Phase 0 — Foundation (this PR)  ✅ in review

The walking skeleton everything else builds on:

- [x] Next.js 15 + TypeScript (strict) + Tailwind scaffold
- [x] Supabase client layer (`browser`, `server`, `middleware`) wired through
      **env vars only** — no provisioning, no secrets in the repo
- [x] Email/password **login** page + **sign-out**
- [x] **Protected** `/dashboard` route (middleware + server-side guard →
      redirect to `/login` when unauthenticated)
- [x] Dashboard shell with placeholder module cards (Priority / Hours / Notion)
- [x] Secrets hygiene: `.gitignore`, `.env.example` (names only)
- [x] Tooling: ESLint, Prettier, `tsc --noEmit`
- [x] CI (GitHub Actions): install → lint → typecheck → build
- [x] This `PLAN.md` committed so context survives across sessions

**Gate:** merge Phase 0 only after review. Nothing else proceeds until then.

### Phase 1 — Data layer + first module (in review)

> ⚠️ Still reconstructed **without** the detailed module spec. The data
> foundation below is low-regret (every module reuses it), but the `priorities`
> columns and the Hours/Notion modules are assumptions. **Paste the real design
> here** to lock them in.

Done in this pass:

- [x] Supabase migrations: `set_updated_at`, `profiles` + auto-create trigger,
      RLS on every table (`supabase/migrations`)
- [x] **Priority** module — end-to-end proof of the data path: `priorities`
      table + RLS, typed data layer, server actions (add / toggle / delete),
      server-rendered UI at `/dashboard/priority`
- [x] Hand-written DB types (`src/lib/supabase/database.types.ts`) kept in sync
      with the migrations, since the self-hosted DB isn't reachable from CI
- [x] Dashboard navigation (Overview / Priority)

Assumptions to confirm against the real spec:

- A priority record = `{ title, note, level (1–3), is_done, position }`. Likely
  wrong in detail — refine the columns + migration when the design lands.

Still pending design:

- [ ] **Hours** module — real data + interactions
- [ ] **Notion** module — Notion integration + sync (Notion MCP is available)
- [ ] Refine the Priority model against the real spec
- [ ] Lint migration: `next lint` → ESLint CLI (deprecated in Next 16)

### Phase 2+ — TBD

Captured from the full plan once it's pasted in.

---

## Local development

```bash
cp .env.example .env.local   # then fill in from the Windows box (never commit)
npm install
npm run dev                  # http://localhost:3000
```

Other scripts: `npm run lint`, `npm run typecheck`, `npm run build`,
`npm run format`.

---

## Guardrails

- **Never** commit `.env.local` or any real key. Only `.env.example` (names,
  no values) belongs in git.
- The `SUPABASE_SERVICE_ROLE_KEY` is server-only — never prefix it with
  `NEXT_PUBLIC_` and never read it in client code.
- Supabase is **self-hosted**; do not provision cloud resources for it.
