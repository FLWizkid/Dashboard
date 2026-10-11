# Data model

The Phase 1 schema, and the reasoning behind the parts that aren't obvious.

Source of truth:
[`supabase/migrations/20260805000001_tasks_core.sql`](../supabase/migrations/20260805000001_tasks_core.sql).
Domain types: [`src/lib/tasks/types.ts`](../src/lib/tasks/types.ts).

---

## Principles

**The app is the system of record.** Every table below is authoritative. Mail,
calendar and Markdown notes will be _linked_ to these rows, never the other
way round.

**RLS is the access control, not application code.** Every table is
`enable row level security` with four policies keyed on `auth.uid() = user_id`,
and `user_id` defaults to `auth.uid()` so the client never sends it. A query
that forgets a filter still cannot see anyone else's data. This is asserted,
not assumed — see [testing](./testing.md).

**Single-user now, teammates later.** Rows are user-owned from day one, so
teammate mode is a policy change rather than a migration.

---

## Enums

| Type                 | Values                                             |
| -------------------- | -------------------------------------------------- |
| `task_priority`      | `critical`, `high`, `normal`, `low`                |
| `task_status`        | `inbox`, `ready`, `in_progress`, `waiting`, `done` |
| `task_link_kind`     | `message`, `event`, `note`, `kanban`               |
| `task_link_relation` | `source`, `prep`, `follow_up`, `related`           |

`task_status` is the full Kanban lane set from the product spec, declared now
even though Phase 1 only writes three of them, so Phase 3's board is a UI
change rather than a data migration.

---

## `activity_categories`

The CIO activity taxonomy. Eight defaults are seeded per user by
`seed_default_activity_categories()`, which the signup trigger calls; the
migration also backfills existing accounts.

| Column                | Notes                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `slug`                | Stable identifier the parser matches `#tags` against. Unique per user.                                                      |
| `name`, `description` | Editable.                                                                                                                   |
| `color`               | A **design-system token name**, not a hex value, so themes stay honest.                                                     |
| `position`            | Display order.                                                                                                              |
| `is_default`          | Marks a seeded row, so the app can tell the default taxonomy from categories you invented. Seeded rows stay fully editable. |
| `is_archived`         | Retire a category without breaking the tasks that reference it.                                                             |

The eight defaults are mirrored in
[`src/lib/categories/defaults.ts`](../src/lib/categories/defaults.ts) so the
parser can resolve `#strategic` with no round-trip. **The database is what
actually seeds**; the TypeScript copy is a convenience, and a unit test fails
if the two drift.

---

## `tasks`

| Column          | Notes                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `title`         | 1–500 chars after trimming.                                                                           |
| `notes`         | Free text.                                                                                            |
| `priority`      | **Nullable.** See below.                                                                              |
| `due_at`        | `timestamptz`. Always stored UTC; rendered in your zone.                                              |
| `category_id`   | Nullable FK. `on delete set null` — deleting a category must not delete work.                         |
| `status`        | Kanban lane. Defaults to `inbox`: new captures land in the Inbox.                                     |
| `pinned`        | Manual override that lifts a task above everything.                                                   |
| `source_link`   | Free-form provenance for a one-off URL with no record behind it. Structured links go in `task_links`. |
| `owner`         | Nullable — optional in personal mode, required when teammate mode lands.                              |
| `is_ready`      | **Generated.** See below.                                                                             |
| `completed_at`  | Kept in step with `status` by a check constraint.                                                     |
| `search_vector` | Generated `tsvector` over title (weight A) and notes (weight B), GIN-indexed.                         |

### Nullable priority is deliberate

`NULL` means **untriaged**, which is a real and useful state: it is what keeps
a fresh capture out of Ready and visible as something still to triage. If
priority defaulted to Normal, the Ready badge would only ever be able to
report a missing due date, and the Inbox → Ready flow would lose its point.

In sort order, untriaged sits **between Normal and Low** — it must not outrank
something you explicitly called Normal, and must not sink below something you
explicitly called Low, or new captures would vanish before you triaged them.

### `is_ready` vs `status = 'ready'`

Two different things, and the names are close enough to be worth stating
plainly:

- **`is_ready`** — the minimum fields are present: title **and** priority
  **and** due date. A generated stored column, so it can never drift from the
  fields it describes, and Phase 3's "promote to Ready" check is a plain
  indexed predicate.
- **`status = 'ready'`** — the card is sitting in the Ready lane.

A task can be `is_ready` while still in the Inbox. It should never be in the
Ready lane without being `is_ready`.

Owner is **not** part of Ready state — it is optional in personal mode. The
same three-field rule is implemented client-side in
[`src/lib/tasks/ready.ts`](../src/lib/tasks/ready.ts) so a badge updates the
instant a field changes; a unit test pins the field list so the two
definitions can't diverge.

### `completed_at` matches `status`

```sql
check ((status = 'done' and completed_at is not null)
    or (status <> 'done' and completed_at is null))
```

A completed task must record when. An open task must not claim it did. Hours
rollups (Phase 4) and reports (Phase 6) both depend on that timestamp being
trustworthy, and one place derives it:
`completedAtFor()` in [`repository.ts`](../src/lib/tasks/repository.ts).

### Cross-user category guard

RLS can't stop you attaching _someone else's_ category to your own task —
the foreign key is checked with the table owner's rights. A
`before insert or update` trigger enforces it instead, raising
`check_violation`. Integration-tested.

---

## `task_links`

The polymorphic join that makes the modules one product rather than eight.

| Column         | Notes                                                    |
| -------------- | -------------------------------------------------------- |
| `kind`         | `message` / `event` / `note` / `kanban`.                 |
| `relation`     | `source` / `prep` / `follow_up` / `related`.             |
| `target_id`    | Provider or internal id. **Nullable** while unresolved.  |
| `target_label` | Human label, always present — this is what the UI shows. |
| `target_url`   | Optional deep link.                                      |
| `confirmed_at` | **Null means suggested, not established.**               |
| `metadata`     | `jsonb` escape hatch for provider specifics.             |

### Confirm-before-link is a schema rule

`confirmed_at` exists so "we think this is related" and "you told us it is"
are different states in the database, not just different pixels. Nothing in
the product may set it automatically — only an explicit user action does. The
API surfaces it as a required `confirmed: boolean` on the link input, defaulting
to `false`.

### Unresolved links are expected

The quick-add parser can detect _"before the board review"_ long before
Phase 2 can say which calendar event that is. Such a link is stored with
`target_id IS NULL` and a label. The unique index deliberately covers only
resolved links:

```sql
create unique index ... on task_links (task_id, kind, target_id, relation)
  where target_id is not null;
```

so several unresolved suggestions can coexist, while a resolved link can't be
duplicated.

---

## Indexes

| Index                                                                                 | Serves                                                      |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `tasks_user_open_idx (user_id, pinned desc, priority, due_at) where status <> 'done'` | The dashboard's top-priorities query.                       |
| `tasks_user_due_idx`                                                                  | Overdue and due-soon lookups; the two-day rollup (Phase 2). |
| `tasks_user_status_idx`                                                               | The Kanban board (Phase 3).                                 |
| `tasks_search_idx` (GIN)                                                              | Full-text search and the command palette.                   |
| `task_links_unconfirmed_idx`                                                          | "You have suggestions waiting" surfaces.                    |

---

## Retired tables

`priorities` and `time_entries` were created by earlier sessions working
**without** the product spec, and their UI has been removed.

- `priorities` is superseded by `tasks`.
- `time_entries` will be superseded by the Phase 4 hours model.

`20260809000001_retire_placeholder_tables` **moves** them to an `archive`
schema and revokes every grant, rather than dropping them. Moving out of
`public` is what actually retires them — PostgREST exposes only the schemas
named in `PGRST_DB_SCHEMAS`, so an archived table has no API surface at all —
while every row stays recoverable and RLS stays switched on.

Dropping is irreversible, so it remains a separate, deliberate step; the
statements are in a comment at the end of that migration. Neither table is
referenced by any code.

---

## Still to come

| Phase | Adds                                                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------- |
| P2    | Mail and calendar accounts, per-mailbox caching policy, field-encrypted message bodies, sender importance |
| P3    | Notes with decision/rationale anchors; Markdown vault sync state                                          |
| P4    | Pomodoro sessions, work-category classification, hours rollups                                            |
| P5    | Stored priority scores and their inputs                                                                   |
| P6    | Scheduled digests and delivery log                                                                        |
| P7    | Audit log and retention/purge jobs                                                                        |
