# Dashboard

**God's Master Dashboard** — a private executive command center.

Next.js 15 (App Router) · TypeScript · Tailwind CSS · self-hosted Supabase
(email/password auth), reachable over Tailscale only.

> 📋 The plan, locked decisions, and phase roadmap live in
> **[`PLAN.md`](./PLAN.md)** — read it first.

## Getting started

Requires **Node 22** (see `.nvmrc`).

```bash
# 1. Configure environment (values come from your self-hosted Supabase box)
cp .env.example .env.local
#    then edit .env.local — NEVER commit it

# 2. Install and run
npm install
npm run dev            # http://localhost:3000
```

Unauthenticated visitors are redirected to `/login`. After signing in with a
Supabase email/password account, `/dashboard` becomes available.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint (next/core-web-vitals) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run format` | Prettier write |

## Security

- **Self-hosted Supabase** on a Windows/WSL2 box; **Tailscale-only** access.
- Secrets live only on that box as environment variables. The repo contains
  **no** real keys — only `.env.example` with variable names.
- `.gitignore` excludes every `.env*` file except `.env.example`.

## Project structure

```
src/
  app/
    layout.tsx            Root layout
    page.tsx              Redirects based on auth state
    login/page.tsx        Email/password sign-in
    dashboard/            Protected area (layout guards auth)
  components/             UI (module cards, sign-out)
  lib/supabase/           Browser / server / middleware clients
  middleware.ts           Session refresh + route protection
```
