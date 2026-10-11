# Hours

Three kinds of time, kept apart and also added together.

| Kind          | Where it comes from                   | Stored?                 |
| ------------- | ------------------------------------- | ----------------------- |
| **Focused**   | Pomodoro sessions you completed       | `time_entries`          |
| **Scheduled** | Work-category blocks on your calendar | **Derived, not stored** |
| **Manual**    | Time you entered by hand              | `time_entries`          |

They are shown separately _and_ combined, weekly and monthly, with a running
weekly total — and manual time is always labelled as manual, so a number you
typed never looks like a number that was measured.

---

## Why scheduled hours are not stored

A meeting can move, be cancelled, or be reclassified at any point. A ledger row
copied out of the calendar at sync time would then be quietly wrong, and the
only symptom would be a total that nobody could reconcile.

So scheduled hours are computed from `calendar_events` every time they are
asked for. The number is always the truth about the calendar as it stands.
`time_entries` has a check constraint refusing `source = 'scheduled'`, so a
future writer cannot reintroduce the problem by accident.

---

## The combined total counts overlap once

This is the one genuinely contentious decision, so it is worth stating plainly.

If you run a Pomodoro during a meeting, that is **one hour of your life, not
two**:

```
Meeting        09:00 ──────────────── 10:00     scheduled  60m
Pomodoro       09:00 ───── 09:25                focused    25m
                                                ─────────────
                                                combined   60m
                                                overlap    25m
```

- **Per-source totals are plain sums.** That is what "shown separately" means,
  and you want to see that you did 25 minutes of focused work even though some
  of it overlapped a call.
- **The combined total is the union of the intervals.** The same wall-clock
  minute is counted once.
- **The overlap is reported too**, so the difference is visible rather than
  mysterious.

Adding the three together instead would produce weeks with 63 hours in them,
and a number nobody believes is a number nobody uses.

Two back-to-back Pomodoros are treated as one continuous stretch, not two
spans with an instant between them.

---

## Work-category classification

Only work-category events count toward hours. A dashboard that silently counts
your dentist appointment is worse than one that counts nothing.

An event's category is decided by the first of these that applies:

| #   | Signal                                        | Beats everything below |
| --- | --------------------------------------------- | ---------------------- |
| 1   | **Your manual override**                      | ✅ always              |
| 2   | **Event-level include/exclude**               | Counting only          |
| 3   | **Your keyword rules**, in order              | First match wins       |
| 4   | Attendee and meeting-type cues                |                        |
| 5   | The source calendar's default                 |                        |
| 6   | Nothing — unclassified, and it does not count |                        |

### A manual override always wins

Once you have set a category, **no automatic rule may change it**. That is
enforced by a database trigger, not by convention: the classifier re-runs on
every calendar sync and would otherwise reassert itself the moment you looked
away.

Changing your mind is fine — a manual choice can be replaced by another manual
choice. Only automatic reclassification is refused.

### Include and exclude toggles

Per event, or for a whole calendar.

The event-level toggle is a tri-state: _inherit_ (the default), _always count_,
_never count_. It changes only **whether** an event counts, never its category
— "this is strategy work" and "don't count this one" are different statements,
and you are allowed to make both.

A whole calendar can be excluded, which is the usual answer for a personal one.

### Keyword rules

Plain, case-insensitive substring matching against the title, location,
organizer or an attendee. Deliberately **not** regular expressions: these are
edited in a text box by someone who wants `board` to match "Board review", and
a regex is a footgun with no upside here.

Rules run in your order, first match wins, and a rule can exclude without
assigning a category at all — _anything with "lunch" in it doesn't count_.

### Attendee cues

Only two, and only where the signal is strong:

- Someone outside your domains is invited → **Stakeholder & Board**
- Exactly two attendees → **People & Team** (a one-to-one)

Anything cleverer — "eight people means it's strategic" — is a guess dressed as
a rule, and you would spend your time correcting it. Both cues are the weakest
signal and lose to everything above them.

### Every classification explains itself

Each event carries a sentence: _"Matched your rule 'board' in the title"_,
_"Someone outside your organisation is invited"_, _"You set this category
yourself"_. A category appearing on a meeting with no explanation is a number
nobody trusts, and the reason is what makes it editable rather than mysterious.

Cancelled meetings do not count — unless you manually categorised one anyway,
because you may have attended regardless.

---

## Pomodoro

25 / 5 / 15 by default, long break every fourth focus interval. All four
configurable. Task linkage is optional; a focus session with no task is still
focus.

### The timer survives everything

State holds **instants, not remaining seconds**. Nothing decrements.

A `setInterval` that counts down stops when the tab is backgrounded and lies
about how much time has passed — so a phone locking, a laptop sleeping or a
reload would each corrupt the session. Instead every displayed value is
computed from "now", and sleeping through a whole interval resolves correctly
on wake: _it finished, thirty-five minutes ago_.

Pausing banks the elapsed time rather than pausing a clock, so a two-hour
pause does not eat the interval.

### What counts

- **A completed focus session** becomes focused hours.
- **An abandoned focus session still counts the time actually spent.** A
  product that discards twenty minutes because you were interrupted at minute
  twenty-one teaches you not to use the timer.
- **Breaks never count.** They are not work.
- **An overrun is capped at the planned length**, so a laptop asleep for eight
  hours cannot log an eight-hour Pomodoro.

Only a completed focus interval advances the long-break cadence.

The database allows **one running session at a time**: two running timers mean
two overlapping claims on the same hour, and the totals stop meaning anything.

---

## Offline logging

The requirement is blunt and correct: **never lose logged time**.

### How

1. **Write locally first, always.** A logged entry is durable in IndexedDB
   before any request is attempted. The network is never on the path between
   pressing stop and the time being safe.

2. **Every entry carries a client key** generated on the device. The server has
   a unique index on it, so a replayed flush — the normal outcome of a
   connection dying _after_ the write but _before_ the response — cannot
   double-count. An entry that comes back as a duplicate is a **success**.

3. **Nothing is deleted locally until the server confirms it.** A failed flush
   leaves the entry where it is with an attempt count, and the next
   reconnection tries again, with back-off capped at five minutes.

4. **Silence is not success.** If the server says nothing about an entry, it is
   kept. The request may never have been sent, and assuming otherwise is the
   one mistake that loses time.

5. **A permanent rejection is surfaced, not swallowed.** If the server refuses
   an entry outright — it referenced a task you deleted — you are told, rather
   than the time quietly disappearing.

IndexedDB rather than `localStorage`: it survives more aggressive eviction, it
is transactional, and it does not block the main thread — which matters
precisely when you press stop and expect to be able to close the tab.

### What you see

"3 entries waiting to sync — 1h 45m", so you are never left wondering whether
your afternoon was recorded.

---

## Manual entries

Always allowed, always labelled. A manual entry carries an optional note and
appears in its own column in every rollup, so the distinction between measured
and asserted time is never lost.

---

## Weeks and months

Weeks start **Monday** (the work-week default) in your configured timezone, not
the browser's.

A span crossing midnight is **split across both days**, which is what makes the
daily figures add up to the weekly one and the weekly ones add up to the
monthly. A meeting from 23:00 to 01:00 is one hour on each side, not two hours
arbitrarily assigned to whichever day it began.

Durations read as `6h 30m`, not `6.5`. The first is a day; the second is a
timesheet.

---

## The interface

Two pages and one card.

**`/dashboard/pomodoro`** — the dial, the controls, and the recent sessions.
Space starts and pauses, `s` stops, `n` skips. The whole page is the timer
rather than a widget in a corner, because during a focus interval this is the
screen that should be open.

**`/dashboard/hours`** — the three sources, the combined total with its
overlap stated, a daily breakdown, the manual entry form, the scheduled blocks
with their reasons and overrides, and the rule editor. Quick-log sits above the
totals on a phone and below them on a desktop: on a phone the page is usually
open _to log something_, on a desktop _to look at something_.

**The dashboard card** reads the same `/api/hours` endpoint the hours view
does, so the two cannot drift apart.

### One machine, one queue

Both the Pomodoro state and the outbox queue live in a provider mounted once,
and their hooks throw if used outside it.

This is not tidiness. An earlier version let every component call the hook
directly, and both failure modes showed up immediately:

- Two copies of the **Pomodoro machine** — one on the page, one in the shell's
  focus indicator — both wrote the same `localStorage` key. The idle one
  overwrote the running one, and a reload lost the session in progress.
- Three copies of the **outbox** shared IndexedDB but not the state derived
  from it, so quick-log queued an entry into its own React state and the
  banner, holding a different copy, showed nothing at all.

Both are invisible until the exact moment they matter. Hence the throw.

### Why the controls are disabled for a moment on load

The stored timer state is read in an effect, and React may flush that effect
_after_ paint — so there is a brief window where the Start button is on screen
but the restore has not run. A click in that window would be silently
overwritten.

Two guards, because either alone leaves a hole: the restore refuses to
overwrite a state that has already moved, and the controls stay disabled until
it has run. A button that accepts a click it is going to discard is worse than
one that waits.

---

## Related

[Data model](data-model.md) · [Providers](providers.md) ·
[Vault](vault.md) · [Threat model](threat-model.md)
