# Supabase (self-hosted)

Database migrations for the **self-hosted** Supabase instance (Windows/WSL2,
reachable over Tailscale). Nothing here targets a cloud project — apply these
against your own instance.

## Apply migrations

Apply in filename order (they're timestamp-prefixed).

**Option A — psql**

```bash
psql "$DATABASE_URL" -f migrations/20260704000001_init.sql
psql "$DATABASE_URL" -f migrations/20260704000002_priorities.sql
psql "$DATABASE_URL" -f migrations/20260704000003_hours.sql
```

**Option B — Supabase CLI** (if you manage this instance with it)

```bash
supabase db push
```

## What the migrations set up

- `set_updated_at()` — trigger to keep `updated_at` current.
- `profiles` — one row per auth user; `handle_new_user()` auto-creates it on signup.
- `priorities` — the Priority module (per-user list).
- `time_entries` — the Hours module (per-user time log).
- **Row Level Security is enabled on every table**; users can only read/write
  their own rows (`auth.uid() = user_id`).

## Note

The `priorities` and `time_entries` schemas are first-pass reconstructions.
Refine the columns when the detailed module design lands — see
[`../PLAN.md`](../PLAN.md).
