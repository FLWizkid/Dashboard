# The scheduler

Three jobs that have to happen without anyone pressing anything, and the
identity they run as.

---

## 1. What runs, and why it has to

| Job                       | Default        | Without it                                                         |
| ------------------------- | -------------- | ------------------------------------------------------------------ |
| `/api/digests/run`        | hourly, at :05 | No morning brief, no weekly rollup                                 |
| `/api/vault/sync`         | every 15 min   | Notes stay in Postgres and never appear in Obsidian                |
| `/api/connectors/refresh` | every 15 min   | A merged pull request shows as open forever; the brief never moves |

Each is also a button. The scheduled path and the manual path are the same
code — a "run now" that behaves differently from the real thing is not worth
having.

### Why the digest is hourly and not daily

The job asks the application _"is it 07:00 for anyone yet?"_ rather than being
told when to fire. That is the only way one schedule serves owners in different
time zones, and it makes a missed hour recoverable instead of lost until
tomorrow. Firing more often than necessary is harmless because every digest
claims its period before composing anything.

---

## 2. The thing that was broken

> A scheduled job has no session, so `auth.uid()` is null, so it read nothing
> and wrote nothing — and reported success.

Every table in this schema is `user_id uuid not null default auth.uid()` under
`auth.uid() = user_id`. For a browser request that is complete and correct: the
session supplies the identity, the default fills the column, the policy does
the filtering, and no application code has to remember anything.

The digest endpoint accepted a bearer token and then built its repository from
the request's cookies. A scheduler has no cookies. So the reads matched zero
rows, the settings write violated NOT NULL, and the run returned `200 {"ran":
[]}` — indistinguishable from "nothing was due".

`SUPABASE_SERVICE_ROLE_KEY` had been in `.env.example` since Phase 0 and was
referenced nowhere in the code.

**Authentication and identity are two questions.** The token answers the first
one only. `src/lib/scheduler/request.ts` answers the second.

---

## 3. Whose work is it

```
DASHBOARD_OWNER_USER_ID set?  →  that account
otherwise, exactly one account?  →  that one
otherwise  →  REFUSE
```

Refusing is the point. This is a single-user product and "take the first row"
would work for months — right up until teammate mode adds a second account, at
which point the scheduler would start delivering one person's private brief to
another person's inbox, silently, every morning. That is not a failure you want
to discover from the contents of an email.

The refusal is a **503 with the remedy in the message**, not a 401:

```
More than one account exists, so a scheduled job cannot tell whose work it is.
Set DASHBOARD_OWNER_USER_ID to the account it should act for.
```

503 because a retrying scheduler should keep asking — the situation is fixed by
configuration, not by credentials.

---

## 4. Elevated queries, and keeping that small

A scheduled job runs with the service role, which bypasses RLS. That inverts
the failure mode: in a session a forgotten `user_id` filter returns nothing,
under the service role it returns **everyone's rows**.

Two things keep that contained:

**`src/lib/db/scope.ts`.** A repository takes a scope. In session mode
`userId` is null and `owned()` / `ownerFilter()` are no-ops, so the browser
path is byte-for-byte what it was. In service mode `userId` is set and the same
two helpers put the owner on every write and every read.

**The elevated surface is deliberately tiny.** The connector refresh needs
three operations, so it declares three — `RefreshStore` — and
`refresh-store.supabase.ts` implements exactly those with the owner clause
visible on the line above each query. The twenty-query
`repository.supabase.ts` is never handed a service scope.

`src/lib/supabase/service.ts` is `server-only`, so importing it from a
component fails the build rather than shipping a key that can read everything.

---

## 5. Why a sidecar and not pg_cron

pg_cron is an extension. A stock Postgres does not have it — including the
container the integration tests run against — so the digest schedule installed
itself only where the extension happened to exist, and needed

```sql
alter database postgres set app.digest_endpoint = '…';
alter database postgres set app.digest_token = '…';
```

by hand on top of that. Two ways to be silently unscheduled.

The sidecar is `alpine + curl + crond`. It works everywhere, it puts the
schedule next to the thing being scheduled, and `docker compose logs scheduler`
shows every firing and every failure — which is not true of a job living inside
the database.

**pg_cron still works if it is present.** The migration installs the digest
schedule when it can, and running both is harmless: every digest claims its
period before composing, so the second firing is a no-op. That is the same
guard that makes a restart mid-run safe.

### What the sidecar refuses to do

- **Start without `DASHBOARD_CRON_TOKEN`.** A scheduler that starts and 401s
  every quarter hour looks healthy in `docker ps` and achieves nothing.
- **Start without `DASHBOARD_URL`.**
- **Treat a 500 as success.** `curl` exits 0 on an error status unless told
  otherwise, which would fill the log with successful-looking runs.
- **Put the token on a command line**, where the container's process list would
  show it. It goes in a header file, and the crontab that carries it is `600`.

---

## 6. Setting it up

```dotenv
# Required. Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
DASHBOARD_CRON_TOKEN=…

# Only once a second account exists.
# DASHBOARD_OWNER_USER_ID=

# Optional; defaults shown.
# DIGEST_CRON_SCHEDULE=5 * * * *
# VAULT_CRON_SCHEDULE=*/15 * * * *
# REFRESH_CRON_SCHEDULE=*/15 * * * *
# TZ=America/New_York
```

```powershell
docker compose up -d scheduler
docker compose logs -f scheduler
```

The first lines tell you what it decided:

```
target:          http://app:3000
digests:         5 * * * *
vault sync:      */15 * * * *
context refresh: */15 * * * *
```

### Running one job by hand

```powershell
docker compose exec scheduler run-job.sh digests /api/digests/run
docker compose exec scheduler run-job.sh vault /api/vault/sync
docker compose exec scheduler run-job.sh refresh /api/connectors/refresh
```

### Reading the log

```
[digests] ok 200 {"ran":["daily"],"skipped":[],"actor":"scheduler"}
[vault] ok 200 {"configured":true,"scanned":31,"changed":2,"conflicts":0,...}
[refresh] ok 200 {"considered":6,"refreshed":4,"skipped":{"settled":2,...}}
```

`actor` is the single most useful field when a brief does not arrive: it says
whether the run was authenticated as the scheduler or as a person.

`configured: false` from the vault job is **not** a failure — it means
`DASHBOARD_VAULT_PATH` is unset, which is a valid way to run this product.

---

## 7. Not configured is not an error

Two of the three jobs are optional features:

| State                     | Response                             |
| ------------------------- | ------------------------------------ |
| No `DASHBOARD_VAULT_PATH` | `200 {"configured": false}`          |
| No `GITHUB_TOKEN`         | `200` with `skipped.noConnector`     |
| No outbound mail relay    | digest delivered to the in-app inbox |

All 200. A red mark in the log every fifteen minutes, for a machine behaving
exactly as intended, trains you to stop reading the log — which costs you the
one time it matters.

---

## Related

- [`docs/reports.md`](reports.md) — what the digest contains
- [`docs/vault.md`](vault.md) — what the sync does with your notes
- [`docs/connectors.md`](connectors.md) — what the refresh keeps current
- [`docs/threat-model.md`](threat-model.md) — the service role as an asset
