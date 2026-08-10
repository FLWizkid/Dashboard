# Reports and digests

What the numbers mean, when the briefs go out, and how to point them at a mail
relay.

---

## 1. One computation, three renderings

The on-screen report, the printed page and the emailed brief are the **same
functions with different output**. `buildReport()` produces the summary, the
groups and the two-day rollup; the workspace renders it, `@media print`
re-renders it, and `composeDigest()` writes it as text and HTML.

That is deliberate. The moment a digest has its own idea of "overdue", the
email and the dashboard start disagreeing and neither can be quoted.

```
                        buildReport()
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
   report-view.tsx     @media print        composeDigest()
   (the workspace)     (same markup)      (text + HTML email)
```

---

## 2. Report definitions

### 2.1 First-level grouping

Four buckets, in this order. They are derived from `dueBucket()` in
`tasks/sort.ts`, which has five:

| Report group | From `dueBucket` | Means                               |
| ------------ | ---------------- | ----------------------------------- |
| **Overdue**  | `overdue`        | Past its due date.                  |
| **Due soon** | `today`, `soon`  | Due today or in the next two days.  |
| **Current**  | `undated`        | In hand, with no deadline attached. |
| **Upcoming** | `later`          | Dated further out.                  |

**Current holds the undated work.** This is the one judgement call in the
mapping. The literal alternative is a fifth "No due date" section at the
bottom, and that is exactly where undated work goes to be forgotten. Undated
work is what you are doing _now_; a dated task always lands in a dated bucket,
so nothing is hidden by the choice.

Within each group: **soonest due first**, then oldest-created, then id. The
last tie-break is not decoration — it is what makes the report you print and
the digest you receive an hour later list things in the same order.

**Every group is rendered, including empty ones.** An absent "Overdue" heading
and an empty one mean opposite things, and only one of them is good news.

Completed tasks are excluded unless `includeDone` is set. A report of what you
have already finished is a different document, and mixing them makes the counts
answer neither question.

### 2.2 The executive summary

| Figure                  | Definition                                             |
| ----------------------- | ------------------------------------------------------ |
| **Open**                | Not done.                                              |
| **Overdue**             | Size of the Overdue group.                             |
| **Due soon**            | Size of the Due soon group.                            |
| **Ready**               | Title, priority and due date all present.              |
| **Untriaged**           | Captured, no priority set.                             |
| **Completed this week** | `completed_at` on or after the start of the work week. |
| **Hours this week**     | Focused + scheduled + manual, from the hours ledger.   |
| **Critical unread**     | Unread mail from senders scored important.             |
| **Top priorities**      | Highest-ranked open work, from the Phase 5 engine.     |

The week starts **Monday**, matching the Mon–Fri work-week default.

#### The one rule

> **A number that cannot be computed is `null`, never `0`.**

Unread mail with no mail account connected is not "0 unread", it is "not
connected". Every consumer renders `null` as **—** with a reason underneath it
(`no mail account connected`, `nothing recorded yet`) rather than as a figure.
A confident zero for something the system cannot see is the fastest way to make
a report untrustworthy — you only need to catch it lying once.

Two figures are nullable today:

- **Hours this week** — `null` until anything has been logged.
- **Critical unread** — `null` until a mail account is connected. **This is
  the state on a fresh box**: Phase 2's sync is not wired up yet, so this
  reads `—` with its reason.

### 2.3 Activity splits

Per category, over the reporting window: open tasks, completed, minutes (when
hours data exists for that category), and **share** — the category's percentage
of the total, to one decimal place. Uncategorised work is a row named
`Uncategorised`, not a silent omission.

Splits appear in the **weekly and monthly rollups**, not in the daily brief.

### 2.4 The next two days

Today and tomorrow, in the owner's zone. Each slot carries:

- **Calendar events** starting in that day, cancelled ones excluded.
- **Tasks due** in that day.

**Overdue work lands on today's slot.** It is not scheduled for today, but it
is what today has to absorb, and a two-day preview that omits it is a two-day
preview of the wrong two days.

> **Current limitation.** The events half reads `calendar_events`, which
> Phase 2's calendar sync does not yet populate. Until it lands the slots show
> tasks only and read "Nothing scheduled" for the calendar half.

### 2.5 Filters

Search over the title, priority, category, and incomplete-only.

**Filters narrow the task list. They never touch the summary.** "3 overdue" has
to mean three overdue, not three among whichever subset a dropdown happens to
be showing. A headline figure that changes when you change a filter is a
headline figure nobody can quote. When a filter is hiding something, the panel
says how much: _"4 tasks are hidden by these filters."_

An empty filter means **everything**, never nothing. Getting that backwards is
the classic filter bug — the page loads with no boxes ticked and shows an empty
report, which reads as "you have no work" rather than "you have chosen to see
none of it".

---

## 3. Print

### 3.1 There is no print route

The same page prints, driven by `@media print` in `src/app/globals.css`. A
second implementation for print is a second thing to keep correct, and the one
that goes stale is always the one nobody looks at until they need a PDF at
23:00.

Use the browser's own print dialog — **File → Print → Save as PDF**, or the
**Print** button, which just calls `window.print()`. No server-side PDF
renderer, no headless Chrome in the stack, nothing to keep patched.

### 3.2 What print changes

| On paper                     | How                                             |
| ---------------------------- | ----------------------------------------------- |
| Navigation, filters, buttons | Removed (`.no-print`, `nav`, `aside`, `button`) |
| Palette                      | Flattened to ink on white                       |
| Section 2 and 3              | `break-before-page`                             |
| Cards and groups             | `break-inside-avoid`                            |
| Link targets                 | URL printed after the text                      |
| Page margin                  | 15 mm                                           |
| Title                        | An `<h1>` that only exists on paper             |

That last one matters: on screen the shell titles the page. Print removes the
shell, so the report carries its own heading or the PDF opens with no title at
all.

### 3.3 Printed structure

Fixed, in this order:

1. **Executive summary** — the counts, hours this week, critical unread,
   overdue, top priorities.
2. **Prioritised tasks** — the four groups, due-date ordered.
3. **The next two days** — calendar and task rollup.

### 3.4 The standalone two-day report

Section 3 is `break-before-page`, so printing pages 3-onwards from the print
dialog gives the two-day report by itself. No separate route, no second
codepath.

---

## 4. Digests

### 4.1 The three kinds

| Kind        | Subject line   | Contains                                     | Default |
| ----------- | -------------- | -------------------------------------------- | ------- |
| **daily**   | Morning brief  | Summary, overdue + due-soon in full, two-day | on      |
| **weekly**  | Weekly rollup  | Summary, activity splits                     | on      |
| **monthly** | Monthly rollup | Summary, activity splits                     | **off** |

The daily brief lists **overdue and due-soon in full** and nothing else — a
morning email listing ninety upcoming tasks is one nobody finishes reading. The
rest is a count you act on by opening the dashboard.

Every digest is composed as **both HTML and plain text**. The HTML is written
by hand: tables and inline styles, no template engine and no CSS framework,
because email clients are a decade behind browsers and that is the reliable
subset. The text version is written to be genuinely readable rather than
stripped-tags fallout — the in-app inbox renders _that_ one.

### 4.2 The schedule

**The cron fires hourly, not daily.** `5 * * * *` — five past every hour.

Each firing asks the application "is it the configured hour for anyone yet?"
That is the only way one schedule serves owners in different time zones, and it
makes a missed hour recoverable instead of lost until tomorrow: the next firing
still finds the period unclaimed.

```
  pg_cron (hourly, 5 past)
        │
        ▼
  POST /api/digests/run     ← bearer DIGEST_CRON_TOKEN
        │
        ├─ dueKinds(settings, now)   is it 07:00 in *their* zone?
        ├─ claimPeriod(kind, date)   ← the idempotency guard
        ├─ buildReport() → composeDigest()
        └─ deliverDigest()
              ├─ 1. in-app inbox   (always, first)
              └─ 2. email          (if configured)
```

There is also a weekly purge at `30 3 * * 0` running `purge_old_digests()`.

### 4.3 Not sending twice

`digest_runs` has a unique index on `(user_id, kind, period_date)`. Claiming
that row is the guard, and the period key is what makes it work:

| Kind    | `period_date`         |
| ------- | --------------------- |
| daily   | the local date        |
| weekly  | the week's **Monday** |
| monthly | the month's **first** |

So a weekly rollup is once per week whatever hour it fires at, and a retry on
Tuesday lands on the same key rather than producing a second one.

**The claim happens before composing.** A crash mid-composition leaves the
period claimed and no digest sent — visible, and recoverable by hand. The
reverse order produces two contradictory briefs, which is not recoverable by
anything.

### 4.4 In-app inbox first, always

`deliverDigest()` writes the in-app copy **before** attempting any email, and
unconditionally. The inbox is local, it cannot fail for a reason outside the
box, and it is the copy you can always reach. A failed send is recorded on the
run — it never costs you the brief.

The tempting order is send-then-record, and it means an SMTP outage on Monday
morning produces no brief at all and no trace that one was due.

### 4.5 Settings

`digest_settings`, one row per owner, all constrained in the database:

| Column            | Default      | Constraint          |
| ----------------- | ------------ | ------------------- |
| `daily_enabled`   | `true`       |                     |
| `weekly_enabled`  | `true`       |                     |
| `monthly_enabled` | `false`      |                     |
| `daily_hour`      | `7`          | `between 0 and 23`  |
| `weekly_dow`      | `1` (Monday) | `between 0 and 6`   |
| `time_zone`       | `UTC`        |                     |
| `email_to`        | `null`       | null, or an address |

**A null `email_to` is valid, not incomplete.** In-app inbox only is a
perfectly reasonable configuration, and it is what a box with no relay gets.

The weekly and monthly rollups fire at the same `daily_hour` — one "when do you
want to be interrupted" setting rather than three.

### 4.6 Retention

`purge_old_digests(older_than interval default '24 months')` deletes inbox
messages and runs older than the window. Same 24-month default as everything
else; see [`docs/data-model.md`](data-model.md).

---

## 5. Email setup

### 5.1 The default is no email at all

With `DIGEST_SMTP_HOST` or `DIGEST_FROM` unset, the channel is a **stub**: it
records the send and delivers nothing. This is not a failure mode — the in-app
inbox still gets every brief, and for a box with no outbound mail that is the
whole feature working as intended.

### 5.2 Turning on SMTP

In `.env` on the box (never in git — the repository is public):

```dotenv
DIGEST_SMTP_HOST=smtp.example.net
DIGEST_SMTP_PORT=587
DIGEST_SMTP_USER=dashboard@theonefor.ai
DIGEST_SMTP_PASS=…                      # app password, not your account password
DIGEST_SMTP_SECURE=false                # true only for implicit TLS on 465
DIGEST_FROM=dashboard@theonefor.ai
```

Then set the destination in the app — `digest_settings.email_to`, defaulting to
`doug@theonefor.ai`.

Port 587 with `SECURE=false` means STARTTLS, which is what almost every relay
wants. Port 465 is implicit TLS and needs `SECURE=true`; the code infers this
from the port if you leave the flag off.

**A send failure is recorded, never thrown.** A cron job that crashes on an
SMTP outage is worse than one that writes `email_ok = false` with the reason
and carries on.

### 5.3 The cron token

pg_cron has no session, so the endpoint takes a bearer token:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Put it in `.env` as `DIGEST_CRON_TOKEN`, and tell Postgres about it and the
endpoint:

```sql
alter database postgres set app.digest_endpoint =
  'https://dashboard.your-tailnet.ts.net/api/digests/run';
alter database postgres set app.digest_token = '…the same token…';
```

Comparison is length-safe, and **an unset token closes the token path
entirely** rather than opening it to everyone. "No token configured means no
auth required" is not a failure mode to leave lying around, even on a private
tailnet.

The other way in is a signed-in session — the **Generate today's brief** button
on the inbox page, which runs the identical code path. A preview that renders
differently from the real thing is not a preview.

### 5.4 If pg_cron is not available

The migration checks `pg_available_extensions` first. If pg_cron is not there
it raises a notice and moves on — the tables, the RLS policies and the purge
function all install fine, and nothing schedules itself.

```
NOTICE:  pg_cron is not available; digest schedule not installed.
```

This is the state on a stock Postgres, including the integration-test
container. The self-hosted Supabase image ships pg_cron, so the box gets the
schedule. On a Postgres without it, either add `pg_cron` to
`shared_preload_libraries` and restart, or drive the endpoint from an external
scheduler:

```bash
curl -fsS -X POST https://dashboard.your-tailnet.ts.net/api/digests/run \
  -H "authorization: Bearer $DIGEST_CRON_TOKEN"
```

Hourly. The period claim makes over-firing harmless.

---

## 6. Verifying it works

```bash
# Unit — grouping, summary, composition, schedule
npx vitest run src/lib/reports

# Integration — generated and delivered, through real Postgres
DATABASE_URL=… npx vitest run tests/integration/reports.test.ts --no-file-parallelism

# E2E — report, filters, print, digest delivery
npx playwright test reports

# Accessibility, including the printed rendering
npx playwright test a11y
```

By hand, on the box: open **Inbox → Generate today's brief**. The message
appears immediately (inbox first), and `digest_runs` records whether the email
attempt succeeded. Press it twice — the second press says _"Already sent"_ and
the inbox still holds one brief.

---

## Related

- [`docs/priority.md`](priority.md) — how "top priorities" is ranked
- [`docs/hours.md`](hours.md) — where "hours this week" comes from
- [`docs/data-model.md`](data-model.md) — retention and RLS
- [`docs/runbook-windows.md`](runbook-windows.md) — running the stack
