# Testing

Three tiers, all run in CI on every push and pull request, plus a fourth job
that checks the deployment configuration.

| Command                    | Covers                                                                            | Needs               |
| -------------------------- | --------------------------------------------------------------------------------- | ------------------- |
| `npm run test`             | Unit — parser, Ready state, sort, timezone maths, taxonomy, redaction, ops config | nothing             |
| `npm run test:integration` | Schema, **RLS isolation** and the retirement migration, against real Postgres     | `DATABASE_URL`      |
| `npm run test:e2e`         | The real UI end to end, plus axe accessibility scans                              | Playwright Chromium |

`npm run test:all` runs all three.

CI's **Deployment configuration** job additionally resolves `docker compose
config`, validates the Caddyfile, parses the shell and PowerShell scripts, and
fails if an environment file or certificate is ever tracked. See
[`ops/README.md`](../ops/README.md).

---

## Unit

Plain Vitest, no environment. The parser suite is the largest: every rule in
[`parser-rules.md`](./parser-rules.md) has a case, pinned to a fixed reference
instant (Wednesday 5 August 2026, 10:00 America/New_York — daylight time on
purpose, so a timezone mistake shows up as a one-hour drift rather than
hiding behind a zero offset).

Two groups sit outside `src/`:

- **`src/lib/observability/`** — the redaction layer. These assert on what
  must _not_ appear in a log: JWTs, connection-string passwords, `apikey=`
  parameters, mail bodies. A weakened scrubber fails here.
- **`ops/lib/`** — the deployment configuration. The secret generator's JWTs
  are verified rather than assumed, and `compose.test.mts` asserts the
  exposure invariants: every published port binds to `BIND_ADDRESS` or
  loopback, the default fails closed, and the service-role key is never a
  build argument. It also fails if `docker-compose.yml` gains a required
  variable the generator doesn't write — the quiet failure that would
  otherwise surface only on the box.

---

## Integration — schema and RLS

These apply **every migration file** to a throwaway database and then try to
break in. They skip cleanly when `DATABASE_URL` is unset.

```bash
# CI uses a postgres:16 service container. Locally, any scratch database:
DATABASE_URL=postgres://postgres:postgres@localhost:5432/scratch \
  npm run test:integration
```

> **Point this at a scratch database only.** The harness runs
> `drop schema public cascade` before each run.

[`bootstrap.sql`](../tests/integration/bootstrap.sql) supplies the minimum
Supabase surface the migrations need: the `auth` schema, `auth.users`,
`auth.uid()` reading the JWT claim, and the `anon` / `authenticated` roles.

### Why they are real tests

Every statement runs inside a transaction as the `authenticated` role with a
JWT claim set — exactly how PostgREST connects on the box. As the owning
superuser, RLS would be bypassed and every assertion would pass whether or not
the policies worked. The harness's `asUser()` helper is the only way these
tests touch data, so that can't happen by accident.

What they assert, beyond CRUD:

- One user's tasks, categories and search results are invisible to another
- Updates and deletes across users affect **zero rows** rather than erroring
- An insert that forges someone else's `user_id` is rejected (`42501`)
- A task cannot be handed to another user by updating `user_id`
- Someone else's category cannot be attached to your task (`23514`)
- A link cannot be attached to someone else's task
- `is_ready` is generated and cannot be written directly
- `status` and `completed_at` cannot disagree
- Unresolved links can coexist; resolved duplicates cannot

---

## End to end and accessibility

Playwright drives the real interface against the in-memory repository, so CI
needs no database and no auth server.

```bash
npm run test:e2e
npm run test:e2e:ui   # interactive
```

The server runs `next dev`, not a production build — deliberately. Memory mode
refuses to activate when `NODE_ENV` is production, which is the guard that
makes it impossible to enable on the box; running the E2E server in dev is
what keeps that guard unconditional.

Two projects: `desktop-chromium` and `mobile-chromium` (Pixel 7), the latter
covering the bottom-bar shell and checking nothing scrolls sideways.

### Accessibility

`@axe-core/playwright` scans against `wcag2a`, `wcag2aa`, `wcag21a` and
`wcag21aa` on:

- the dashboard
- the task list, with a mix of ready and untriaged tasks
- an expanded task's edit panel
- the quick-add suggestion chips and the event-link prompt
- the shortcut dialog
- the sign-in page
- the whole list again under `prefers-reduced-motion: reduce`

A violation fails the build with the offending selector. These scans have
already caught a real contrast failure in the sidebar phase badges.

There is also a keyboard-only test that tabs from the top of the document to
the quick-add box and captures a task without a single click.

---

## Local Postgres without Docker

If Docker isn't available:

```bash
initdb -D /tmp/pgdata -U postgres --auth=trust
pg_ctl -D /tmp/pgdata -o "-p 5433" -l /tmp/pgdata/server.log start
DATABASE_URL=postgres://postgres@localhost:5433/postgres npm run test:integration
```

---

## What isn't covered yet

- **Component-level tests.** Behaviour is covered end to end instead; the
  seams worth unit-testing are pure functions and already are.
- **Visual regression.** Deferred to Phase 7's polish pass.
- **Load and performance budgets.** Phase 7.
- **The Supabase repository against a live instance.** The RLS tests cover the
  policies it relies on; the query-building layer is exercised by hand on the
  box until an integration environment exists for it.
