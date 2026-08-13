# Priority

How the dashboard decides what to show you first, and how to overrule it.

---

## The formula

Five factors, each normalised to 0–1, weighted, and summed to a score out of 100.

| Factor                 | Weight | Answers                                |
| ---------------------- | -----: | -------------------------------------- |
| **Importance**         |    35% | How much does this matter?             |
| **Overdue**            |    25% | How late is it already?                |
| **Due proximity**      |    20% | How soon is it due?                    |
| **Calendar proximity** |    15% | Is there a meeting about it, and when? |
| **Manual**             |     5% | Did you pin it?                        |

Keeping every factor in 0–1 is what makes the weights mean what they say:
changing a weight changes that factor's influence and nothing else.

### Importance — 35%

The higher of **what you said** and **what the context implies**.

| Priority    | Value |
| ----------- | ----: |
| Critical    |  1.00 |
| High        |  0.75 |
| Normal      |  0.45 |
| _Untriaged_ |  0.30 |
| Low         |  0.15 |

Untriaged sits between Normal and Low deliberately — the same judgement the
task list makes. A new capture must not outrank something you explicitly
called Normal, but it must not sink below something you called Low either, or
it disappears before anyone has looked at it.

**Inference can only raise this, never lower it.** The engine is allowed to
notice that an untriaged task is attached to tomorrow's board meeting. It is
not allowed to decide that something you called Critical isn't.

### Overdue — 25%

Linear from zero to **saturated at fourteen days**.

The ceiling matters. Without it, one task forgotten in March outranks
everything else forever, and the list acquires a permanent occupant nobody can
dislodge. Two weeks late is "very late"; six months late is also "very late",
and the difference between them is not what should decide today.

### Due proximity — 20%

Linear over a **seven-day horizon**, and **zero once the task is late** —
`overdue` takes over there. Letting both fire would weight the same fact at
45% of the total.

### Calendar proximity — 15%

A linked meeting inside **48 hours**. The decay is linear and reaches zero
_at_ the boundary, so "within 48 hours" means strictly within.

Prep and follow-up run in opposite directions:

```
              the meeting
                   │
   prep  ▁▂▃▄▅▆▇█  │  ░░░░░░░░░   nothing once it has started
follow-up ░░░░░░░  │  █▇▆▅▄▃▂▁     nothing until it has
        −48h       0       +72h
```

A follow-up ranking highly the day _before_ its meeting is the engine telling
you to do something you cannot yet do.

A meeting you merely marked `related` counts at 60% of one you called `prep`.

### Manual — 5%

The pin. Only 5%, which looks like an insult to your judgement until you
notice the other lever: **a manual rank bypasses scoring entirely**. The pin is
the soft signal — _keep this near the top_ — and a manual rank is the hard one.
Two intentions, two mechanisms.

---

## Worked examples

All three are asserted in `src/lib/priority/score.test.ts`, so if a weight
changes, one of them fails and this page gets corrected with the code.

### The board deck

Due tomorrow at 17:00, marked High, inferred importance 0.85 from a board
meeting tomorrow morning that you are preparing for.

| Factor     | Raw                 |    Points |
| ---------- | ------------------- | --------: |
| Importance | 0.85                | **29.75** |
| Overdue    | 0 (not late)        |         0 |
| Due soon   | 1 − 1.33 ÷ 7 = 0.81 | **16.19** |
| Calendar   | 1 − 24 ÷ 48 = 0.50  |  **7.50** |
| Manual     | 0                   |         0 |
| **Total**  |                     | **53.44** |

### The expenses form

Three weeks late, marked Low, no meeting.

| Factor     | Raw               |    Points |
| ---------- | ----------------- | --------: |
| Importance | 0.15              |  **5.25** |
| Overdue    | saturated at 1.00 | **25.00** |
| **Total**  |                   | **30.25** |

Note what this shows: something trivial and very late still outranks a lot,
which is the point — but it tops out at 30, so it never buries the board deck.

### An untriaged capture

Typed this morning, nothing else known.

| Factor     | Raw  |    Points |
| ---------- | ---- | --------: |
| Importance | 0.30 | **10.50** |
| **Total**  |      | **10.50** |

Not zero. A new capture that scored nothing would sink below everything
permanently and never be triaged.

---

## Importance from the calendar

A task linked to a meeting inherits **part** of that meeting's importance.

The meeting's own importance comes from signals you can check by looking at it:

| Signal            |  Max | Evidence                                  |
| ----------------- | ---: | ----------------------------------------- |
| Imminent          | 0.35 | Within 48 hours, decaying                 |
| External party    | 0.30 | Someone outside your domains is invited   |
| Decision point    | 0.30 | "approval", "sign-off", "board" in title  |
| Leadership        | 0.25 | "exec", "board", "all-hands" in the title |
| Leadership (size) | 0.15 | 8+ attendees, when the title doesn't say  |
| You organised it  | 0.10 | You are the organiser                     |

They do not sum to 1 — a meeting that is imminent, external, leadership-sized
_and_ a decision point should saturate, because it genuinely is the most
important thing on your calendar. The total is clamped at 1.

**Every signal names something you can verify in a second.** The tempting
additions are all unfalsifiable: sentiment in the title, seniority guessed from
an email address, "importance" scraped from the description. Those produce a
number you cannot argue with, which sounds good and is exactly the failure
mode — you can't correct what you can't interrogate.

A **cancelled** meeting contributes nothing, however important it would
otherwise have been.

### Inheritance

| Relation  | Share |
| --------- | ----: |
| Prep      |   70% |
| Follow-up |   50% |
| Source    |   40% |
| Related   |   30% |

Part, not all: the prep for the board meeting matters because the board
meeting does, but it is not as important as the board meeting — or every
three-line task attached to a big meeting would outrank the meeting's own
preparation.

Prep inherits more than follow-up because prep has a deadline it cannot miss:
the meeting happens whether or not the deck is ready.

With several linked meetings the engine takes the **strongest, not the sum**.
Summing would make "link everything to everything" a way to game your own
ranking.

---

## Overrides

### The pin

A soft nudge worth 5 points. Use it for "keep this in view".

### A manual rank

**Wins outright.** A manually placed task sits above every scored one, however
critical or overdue the alternatives.

It is sticky by construction: nothing in the automatic path writes
`tasks.manual_rank`, so no rescore can clear it and no meeting appearing on
your calendar can move it. Editing the title, the priority or the due date
leaves it exactly where you put it. The only thing that changes it is you.

Releasing a task back to the engine closes the gap in the remaining ranks
rather than leaving a hole at position 3 forever.

The explanation says so plainly — "You placed this by hand, so nothing else
moves it" — rather than showing a score that isn't what decided the order.

---

## Explainability

Every ranked row carries a one-line reason, and a panel with the full
breakdown behind a "Why here?" toggle.

The panel shows the sentence for each factor that moved the score, the
calendar signals behind any importance boost, and — last and quietly — the
number. Leading with "68" invites you to compare figures and reverse-engineer
the weights. Leading with "overdue by three days" tells you what to do.

A factor that contributed nothing gets no sentence. Listing all five every
time, three of them saying "0", is a debug dump rather than an explanation.

---

## Confirm before link

When the engine notices that a task and a meeting share significant words, it
asks. It never links.

**A suggestion is a question, not a weak link.** They live in their own table
(`link_suggestions`) rather than as unconfirmed `task_links` rows, because
every consumer of a shared table has to remember to filter, and the first one
that forgets shows you a relationship you never agreed to.

Detection requires **shared significant words** between the two titles.
Timing alone is never enough — "these happened near each other" describes
every task and every meeting in a busy week. Common calendar vocabulary
("meeting", "review", "weekly", "sync") is stripped before matching, or
everything would relate to everything.

Timing decides _which_ relationship is offered — prep before, follow-up
after — and adjusts confidence, but cannot create a suggestion on its own.

Accepting offers a note as a **separate** yes: agreeing that a task relates to
a meeting and wanting a note about it are different decisions, and bundling
them fills the vault with notes nobody asked for.

Declining means **never asking again**. Not "not now" — the answer is
recorded and detection skips the pair from then on. A prompt that returns
after you said no is a nag, and a nag gets dismissed unread, which costs the
good suggestions too.

### Enforced in the database

A trigger on `task_links` refuses an event link that arrives already-confirmed
with a backdated timestamp — the shape a silent auto-link would take. Accepting
a suggestion is the only path that creates a confirmed event link.

That makes "never auto-link silently" a property of the system rather than a
promise about the current application code. It has to survive the next person
who writes an import script.

---

## Why the score is not stored

A score is a function of the task, its links, and **what time it is**. Storing
it would mean every row goes stale the moment the clock moves: a task that
becomes overdue at midnight would keep yesterday's score until something
rewrote it — and "something rewrote it" is exactly the kind of background job
that fails silently and leaves the dashboard confidently showing the wrong
order.

So the score is computed at read time, from pure functions. What _is_ stored is
the thing the clock cannot derive: your manual override.

---

## Current limitation

The calendar-derived half of the engine — proximity, importance inference and
suggestion detection — reads `calendar_events`. **Phase 2's calendar sync is
not built yet**, so that table has no live feed. The paths are complete and
tested against seeded and stored events, but until the sync lands, the engine
is running on the three factors it can see: importance from your stated
priority, overdue, and due proximity.

---

## Related

[Hours](hours.md) · [Data model](data-model.md) · [Vault](vault.md) ·
[Providers](providers.md)
