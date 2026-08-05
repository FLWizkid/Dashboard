# Supabase (self-hosted)

Database migrations for the **self-hosted** Supabase instance (Windows/WSL2,
reachable over Tailscale). Nothing here targets a cloud project — apply these
against your own instance.

## Apply migrations

In filename order (they're timestamp-prefixed).

**Option A — psql**

```bash
for f in migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

**Option B — Supabase CLI**, if you manage the instance with it:

```bash
supabase db push
```

Every migration is idempotent (`create ... if not exists`, `drop policy if
exists`, enum creation guarded against `duplicate_object`), so re-running is
safe.

## What they set up

| Migration                   | Adds                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `20260704000001_init`       | `set_updated_at()`, `profiles`, and the signup trigger                                                          |
| `20260704000002_priorities` | ⚠️ retired — see below                                                                                          |
| `20260704000003_hours`      | ⚠️ retired — see below                                                                                          |
| `20260805000001_tasks_core` | The Phase 1 core: `activity_categories` (8 CIO defaults, seeded per user), `tasks`, `task_links`, and their RLS |

**Row Level Security is enabled on every table**, with `user_id` defaulting to
`auth.uid()` so the client never sends it. Read the reasoning in
[`../docs/data-model.md`](../docs/data-model.md).

## Retired tables

`priorities` and `time_entries` were created by earlier sessions working
without the product specification. Their UI has been removed; `priorities` is
superseded by `tasks`, and `time_entries` will be superseded by the Phase 4
hours model.

The migrations are left in place and the tables are **not** dropped. Dropping
a table destroys data and belongs in its own reviewed migration, not as a side
effect of a feature branch. Neither table is referenced by any code.

## Verifying the policies

The RLS policies these migrations create are tested — the suite applies every
file in this directory to a throwaway database and then tries to read across
users. See [`../docs/testing.md`](../docs/testing.md).

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/scratch \
  npm run test:integration
```

> Point that at a scratch database only: the harness drops the schema first.
