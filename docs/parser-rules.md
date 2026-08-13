# Quick-add parser rules

The quick-add box turns one line of text into a task plus a set of
**suggestions**. This is the reference for what it understands.

Three rules govern everything below:

1. **Nothing is ever decided for you.** Every value the parser produces is a
   suggestion shown as an editable chip. Touch a field and it is pinned — the
   parser stops overwriting it for the rest of that capture.
2. **Event references are never linked silently.** A detected event shows an
   explicit _Link it / Not now_ prompt. Unanswered means no link.
3. **Capture is never blocked.** Whatever is left over becomes the title, the
   title is never empty, and a task that isn't Ready yet still saves — into
   Inbox, badged with what it is missing.

Implementation: [`src/lib/quick-add/parse.ts`](../src/lib/quick-add/parse.ts).
Tests: [`parse.test.ts`](../src/lib/quick-add/parse.test.ts) — every example
on this page is asserted there.

---

## Order of interpretation

Rules run in a fixed order, and each one blanks the text it claims so a later
rule can't re-claim it. The order is what resolves ambiguity:

1. Explicit tokens — `!priority`, `p1`–`p4`, `#category`, `@owner`, `^event`
2. Dates and times
3. Event phrases in ordinary prose

That ordering is why **`before friday` is a due date** but **`before the board
review` is an event reference**.

---

## Priority

| You type                 | You get                        |
| ------------------------ | ------------------------------ |
| `!critical` `!crit` `!c` | Critical                       |
| `!high` `!hi` `!h`       | High                           |
| `!normal` `!norm` `!n`   | Normal                         |
| `!low` `!l`              | Low                            |
| `p1` `p2` `p3` `p4`      | Critical / High / Normal / Low |

The token is removed from the title.

**Inferred, not removed.** The words `urgent`, `asap`, `emergency`,
`critical` suggest Critical, and `important` suggests High — but they stay in
the title, because they are part of what the task says. An explicit `!token`
always beats an inferred word.

**No priority is a real state.** A capture with nothing priority-shaped is
left _untriaged_ rather than defaulted to Normal. That is what keeps it out of
Ready and visible as something still to triage.

---

## Category

`#tag` resolves against your activity taxonomy by, in order:

1. exact slug — `#strategic`
2. exact display name — `#People-Team`
3. a known alias — `#vendor` → Vendor & Budget, `#ops` → Operational
4. a **unique** prefix — `#sec` → Security, Risk & Compliance

Matching ignores case and punctuation. An ambiguous prefix resolves to
nothing.

If a tag doesn't resolve, it is **left in the title** rather than dropped —
you can see that it didn't take.

Default aliases live in
[`src/lib/categories/defaults.ts`](../src/lib/categories/defaults.ts).

---

## Owner

`@name` sets the owner and is removed from the title. Owner is optional in
personal mode and is not part of the Ready state.

An address like `doug@example.com` is not treated as an owner — the `@` has to
start a word.

---

## Dates

A bare date lands at **17:00** local time (the end of the working day),
configurable per install.

### Relative

| You type                                 | You get                        |
| ---------------------------------------- | ------------------------------ |
| `today`                                  | today, 17:00                   |
| `tonight`                                | today, 20:00                   |
| `tomorrow`, `tmrw`, `tmw`                | tomorrow, 17:00                |
| `yesterday`                              | yesterday, 17:00               |
| `in 45 minutes`, `in 4 hours`            | now plus that, exact time kept |
| `in 3 days`, `in 2 weeks`, `in 2 months` | that many out, 17:00           |

### Weekdays

| You type                       | You get                                              |
| ------------------------------ | ---------------------------------------------------- |
| `friday`, `fri`, `this friday` | the next Friday; **today counts** if today is Friday |
| `next friday`                  | the Friday of the _following_ calendar week          |

`next friday` is deliberately never "the Friday two days away" — unambiguous
beats clever. Weeks start Monday.

### Shorthand

| You type              | You get                                                 |
| --------------------- | ------------------------------------------------------- |
| `eod`, `end of day`   | today                                                   |
| `eow`, `end of week`  | Friday of the work week; rolls forward over the weekend |
| `eom`, `end of month` | the last day of this month                              |
| `next week`           | Monday of next week                                     |
| `this week`           | same as `eow`                                           |
| `next month`          | the first of next month                                 |

### Explicit

| You type                            | You get             |
| ----------------------------------- | ------------------- |
| `2026-09-14`                        | that date           |
| `9/14`, `9/14/2026`                 | month/day, US order |
| `Sept 14`, `September 14th`         | that date           |
| `14 September`, `14th of September` | that date           |

With no year, the parser picks whichever year puts the date in the near
future — on 5 August, `3/1` means next March.

Month names are matched in full, so **"marketing 5 review" is not the 5th of
March**.

### Times

| You type                           | You get                                  |
| ---------------------------------- | ---------------------------------------- |
| `friday 3pm`, `tomorrow at 9:15am` | that date at that time                   |
| `tomorrow 14:30`                   | 24-hour times are read _after a date_    |
| `at 4pm` on its own                | today if still ahead, otherwise tomorrow |

A bare `14:30` with no date and no am/pm is **not** read as a time — that is
what stops `1:1 with Sam` becoming a due date.

### Lead-in words

`by`, `due`, `on`, `before`, `until`, `till` are swallowed along with the date
they introduce: "Send the pack **by friday**" leaves the title "Send the
pack".

---

## Event references

An event reference is always a _suggestion_ with a relation. It is never
linked without confirmation.

| You type                                                            | Relation     | Label          |
| ------------------------------------------------------------------- | ------------ | -------------- |
| `^"Q3 board review"` or `^Q3 board review`                          | Related to   | as typed       |
| `prep for the board review`, `prep board review`                    | Prep for     | board review   |
| `ahead of the audit`, `prior to the audit`, `before the audit`      | Prep for     | audit          |
| `after the exec sync`, `follow up on the exec sync`, `post standup` | Follow-up to | exec sync      |
| `re: vendor renewal`                                                | Related to   | vendor renewal |

Limits, all deliberate:

- The label is at most **six words** and must **start with a letter**, so
  "Prep 1:1 notes for Maya" is not read as prep for an event called "1".
- If removing the phrase would leave the title empty, the phrase stays in the
  title and the suggestion is still offered.
- Until a calendar provider is connected (Phase 2), a confirmed event link is
  stored **unresolved** — label only, no provider id. It shows as "resolves
  when calendar connects" and will be matched to a real event then.

---

## What it does not do

Not oversights — these belong to later phases:

- **Priority from deadline language** ("must ship by Friday") — Phase 5, where
  the weighted ranking lands.
- **Resolving an event name to a real calendar entry** — Phase 2.
- **Recurring tasks** — not in the product spec.
- **Locales other than en-US** — month/day ordering assumes US order.

---

## Timezones

Every date resolves in **your** timezone, not the browser's and not the
server's. The zone is auto-detected with a settings override, and the parser
takes it as an explicit input, so a due date typed on a phone in another
country still lands at 5pm your time.

Daylight-saving edges are handled and tested: adding days keeps the wall-clock
time, the repeated hour resolves to the first occurrence, and a wall-clock
time inside the spring-forward gap resolves to the last valid instant before
the jump.
