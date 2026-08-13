# Tasks module

The operational core. Everything the product does later — Kanban lanes,
decision-log follow-ups, email-to-task, the weighted priority engine, hours
rollups, reports — reads and writes the same `tasks` row this module owns.

Route: `/dashboard/tasks`. Live on the dashboard as **Top priorities**.

---

## What it does

**Capture in one line.** Type, press Enter, done. The parser pulls out a due
date, priority, category, owner and any event reference and shows each one as
an editable chip. Nothing is blocked by triage: a task with no priority and no
due date still saves, into the Inbox, badged with what it needs.

**Triage when you have a moment.** Expand a row for the full form — title,
priority, due, category, owner, notes, links. Every field saves on change or
blur; there is no Save button.

**Ready state.** Title + priority + due date. A task short of that is badged
"Needs priority and due date" so the gap is visible without being nagging.
Owner is optional in personal mode.

**Manual priority and pins.** Phase 1 ordering is entirely yours: pins first,
then priority, then due date, then oldest. The weighted automatic ranking
arrives in Phase 5 and will sit beside this, not replace it — manual override
stays available at all times.

**One tap to complete, with undo.** The ring fills, the check draws, a brass
ring pulses once. A toast offers Undo for eight seconds, reachable with
<kbd>U</kbd> from anywhere. Undo restores the previous lane, not a guess.

---

## Keyboard

| Key                          | Does                                |
| ---------------------------- | ----------------------------------- |
| <kbd>N</kbd> or <kbd>/</kbd> | Jump to quick-add                   |
| <kbd>Enter</kbd>             | Add the task                        |
| <kbd>J</kbd> / <kbd>K</kbd>  | Move down / up the list             |
| <kbd>X</kbd>                 | Complete or reopen the focused task |
| <kbd>E</kbd>                 | Expand or collapse the focused task |
| <kbd>P</kbd>                 | Pin or unpin                        |
| <kbd>U</kbd>                 | Undo the last completion            |
| <kbd>Esc</kbd>               | Close, collapse, or clear           |
| <kbd>?</kbd>                 | Shortcut sheet                      |

Single-key shortcuts never fire while the caret is in a field (except
<kbd>Esc</kbd>) and never fire with a modifier held, so browser and OS
shortcuts always win.

---

## Confirm before linking

When the parser spots something event-shaped — _"prep for the board review"_,
_"after the exec sync"_ — it asks:

> Looks like **prep for** an event called **"board review"**. Link it?
> **[Link it] [Not now]**

Ignoring the prompt means no link. This is enforced in the schema, not just
the UI: `task_links.confirmed_at` is null until you say yes, and nothing in
the product sets it automatically.

Until a calendar is connected (Phase 2) a confirmed link is stored
**unresolved** — the label, no provider id — and shows as "resolves when
calendar connects".

---

## Files

| Path                          | Role                                                   |
| ----------------------------- | ------------------------------------------------------ |
| `src/lib/tasks/types.ts`      | Domain types and enums                                 |
| `src/lib/tasks/ready.ts`      | Ready-state rule (client twin of the generated column) |
| `src/lib/tasks/sort.ts`       | Manual ordering, overdue, due buckets                  |
| `src/lib/tasks/schema.ts`     | Zod wire schemas — the one validation boundary         |
| `src/lib/tasks/repository.ts` | The seam: interface + Supabase/in-memory selection     |
| `src/lib/tasks/client.ts`     | TanStack Query hooks with optimistic updates           |
| `src/lib/quick-add/parse.ts`  | The parser ([rules](../parser-rules.md))               |
| `src/components/tasks/*`      | Quick-add, rows, complete animation, shortcuts         |
| `src/app/api/tasks/*`         | Route handlers                                         |

### Why a repository interface

Two implementations satisfy one contract: Supabase (RLS does the access
control) and in-memory (end-to-end tests). It is not a mock — the in-memory
one derives `isReady` and keeps `status`/`completedAt` in step exactly as the
database does, so an E2E run exercises real behaviour.

The same shape is what the Phase 2 mail and calendar adapters will use:
provider logic isolated behind a normalized internal model.

Memory mode is unreachable in production — it requires both
`DASHBOARD_DATA_MODE=memory` **and** a non-production `NODE_ENV`. See
[`src/lib/data-mode.ts`](../../src/lib/data-mode.ts).

### Optimistic by default

Every mutation applies to the cache immediately and rolls back on failure.
Capture and completion have to feel instant; a spinner between the click and
the checkmark is what makes a list feel slow.

---

## Accessibility

- The complete control is a real `role="checkbox"` whose accessible name
  includes the task title — "Complete Draft the board deck".
- Toasts live in a polite live region, so an undo that only appears visually
  isn't an undo.
- Overdue is announced as well as coloured, never colour alone.
- All motion respects `prefers-reduced-motion`, in CSS and in Framer Motion.
- axe scans run over the dashboard, the list, the expanded edit panel, the
  quick-add prompt and the dialogs on every CI run. They found — and now
  prevent — a real contrast failure in the sidebar badges.

---

## Capturing without a connection

A task typed with no network is **kept on the device and sent when the network
returns.** This is the one place in the product where losing data would be
unforgivable: an hour of untracked time can be reconstructed, but the thought
you had in a lift cannot.

The mechanism is the hours outbox's, deliberately not a second design:

1. **Written to IndexedDB before any request is attempted.** The network is
   never between pressing Enter and the capture being safe.
2. **Each capture carries a key generated on the device.** `tasks` has a
   partial unique index on `(user_id, client_key)`, so a replayed flush — the
   normal outcome of a connection that dies after the write but before the
   response — cannot create a second task. A duplicate answers `200` with the
   task that already exists.
3. **Nothing leaves the queue until the server confirms it.** A failed flush
   keeps the capture, counts the attempt, and backs off to a five-minute
   ceiling. The cap matters more than the curve: a queue that has backed off to
   an hour looks broken when the network returns and you are watching it.

Two decisions worth knowing:

**The online path is untouched.** Captures are queued only when the browser is
already offline or the request actually fails. Routing everything through the
queue would make the common case inherit the failure modes of the rare one.

**A refused capture is shown, never dropped.** A `4xx` will not succeed on a
retry, so it leaves the queue — but it appears as an alert with the text you
typed and a Dismiss button. Auto-hiding it would delete the last copy of what
you wrote, which is the exact failure this whole mechanism exists to prevent.

The queue is visible whenever anything is in it: the count, the titles, and
whether it is waiting, sending, or refused. An invisible queue asks you to
trust that the task is somewhere — and the moment you doubt it you type it
again, which produces a duplicate no idempotency key can prevent, because it is
genuinely a second capture.

Related: [`docs/hours.md`](../hours.md) for the same mechanism applied to time.

---

## Not in this phase

| Deferred to | What                                                         |
| ----------- | ------------------------------------------------------------ |
| P2          | Email → task, sender importance, calendar-derived context    |
| P3          | The Kanban board itself; Markdown mirroring of a task subset |
| P4          | Hours contributed by Pomodoro and calendar blocks            |
| P5          | Weighted auto-ranking; resolving suggested event links       |
| P6          | Grouped and printable reports                                |
| P7          | Offline capture — **done**; see above                        |

The `status` enum, `task_links` table and `is_ready` column are already shaped
for all of it, so those land as features rather than migrations.
