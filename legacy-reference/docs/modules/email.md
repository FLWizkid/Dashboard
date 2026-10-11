# Email and calendar

Every account in one list, stored on your box, encrypted at rest.

---

## 1. The unified inbox

**One list, not three tabs.** Per-account tabs make you remember which mailbox
a thing arrived at, which is exactly the work this module exists to remove.
Each row carries the account it came to, because you still need to know which
identity you would be replying from.

### The sort

Critical and high senders first, then by arrival. That is the only departure
from chronology, and it earns it: _"the board chair wrote three hours ago"_
outranks _"a newsletter arrived a minute ago"_, and a purely chronological
inbox makes you do that ranking yourself, every time.

Within a group the order is by recency and is **total** — two threads with the
same timestamp keep a stable order, so the list does not reshuffle under you
between refetches.

### Who a thread is "from"

The last message from **someone who is not you**.

This looks like a detail and is not. A thread you replied to last would
otherwise carry your own name, and on the attention card that reads as _you are
waiting on yourself_. Every mail client shows the correspondent; so does this.

---

## 2. What is stored

Set per account, enforced by a database trigger — not by the interface.

| Policy       | Stored                                    |
| ------------ | ----------------------------------------- |
| **Off**      | Nothing at all                            |
| **Metadata** | Headers, subject, snippet. **No bodies.** |
| **Full**     | The above plus bodies, encrypted          |

Full on a corporate account additionally requires recorded admin consent.

### The refusal is a sentence, not an empty pane

Opening a message on a Metadata account shows:

> This account stores metadata only, so the body was never kept.

An empty pane would look like an empty email. Saying which setting caused it —
and that it is a setting rather than a failure — is the difference between a
product that seems broken and one that seems deliberate.

### Tightening the policy is destructive, on purpose

Dropping an account to Metadata **deletes every stored body**; dropping it to
Off deletes the stored mail entirely. Both happen immediately, not "for new
mail". A setting that governed only future mail would leave you believing
bodies were gone when they were not, which is the worst possible outcome for a
privacy control.

### Bodies are never in a list

`listThreads` cannot return one. Only opening a thread decrypts anything, and
only where the policy allowed it to be stored. A list of forty threads would
otherwise decrypt forty bodies to render forty subjects — and a rendering
mistake in that view would put mail content on a page whose only job was
headers.

---

## 3. Sender importance

Four levels, and they are **your judgement, not a heuristic**. Nothing infers
importance from send frequency or from whether you replied.

Rating someone applies to **mail already received**, not only to what arrives
next. Marking the board chair critical and then finding this morning's message
still ranked normal would make the setting look broken.

This feeds three places: the inbox sort, the **Needs attention** card, and the
priority engine's ranking of tasks created from mail.

---

## 4. Needs attention

Unread from a sender rated **critical or high**. Not "unread", which on a real
mailbox is a number in the hundreds and tells you nothing.

The card can only ever be as noisy as you made it — the filter is a list you
wrote. When it is empty it says _"nothing unread from anyone you rated
important"_, not "inbox zero", because claiming an empty inbox while forty
newsletters sit unread is a lie you would catch within a day.

---

## 5. The calendar

**A list, not a grid.** A week grid is what a calendar application owes you;
this is a dashboard, and the question it answers is "what is my day". You
already have the grid in Google Calendar and Outlook, and reproducing it worse
helps nobody.

**Declined meetings are absent.** A meeting you declined is not on your day,
and showing it makes the agenda a record of invitations. The hours module
derives scheduled time from exactly this list, so a declined meeting left in
would inflate the week.

External meetings are badged — at least one attendee outside your domains, per
`DASHBOARD_INTERNAL_DOMAINS`. That flag feeds the priority engine.

---

## 6. Connecting an account

Press **Connect** on the Email page. That is the whole flow for Gmail and
Microsoft; providers with no credentials configured on the box are listed but
not offered, with the reason, because hiding them would suggest the product
cannot do it and a button that fails would be worse.

### The `state` parameter is the security

Without it, anyone who can get your browser to hit the callback URL with a
`code` of their choosing attaches **their** mailbox to your dashboard. It is
not a theoretical attack — it is the reason the parameter exists, and "generate
a random string and ignore it on the way back" is the shape almost every broken
implementation takes.

So the state is signed, bound to the provider it was issued for, given a
ten-minute expiry, and returned **both** in the URL and in an httpOnly cookie:

| Check                            | What it proves                             |
| -------------------------------- | ------------------------------------------ |
| Signature verifies               | We minted it                               |
| Cookie matches the URL parameter | It came back to the browser it left        |
| Provider in the payload matches  | A Google state cannot finish at Microsoft  |
| Not expired                      | A tab left open for a week cannot complete |

And the order matters: the `code` is exchanged **only after** all four pass.
Exchanging first would already have attached the mailbox by the time the check
ran.

### Who the account belongs to

Asked of the provider, never of a form field. A typo would attach the mailbox
under the wrong address, and every later "is this message from me" comparison
— including the one that decides whose name a thread carries — would then be
wrong.

---

## 7. What is not built

- **Compose and reply.** The adapters can send — Gmail, Graph and SMTP through
  Proton Bridge all implement it and are tested — but there is no composer, so
  this module reads mail and does not write it.
- **Proton Bridge has no connect screen.** Gmail and Microsoft connect through
  OAuth; Bridge needs a username and a Bridge-generated password, and the form
  for entering them is not built. Its credentials are seeded by hand.
- **Mailbox navigation.** The inbox is every account's inbox; there is no
  folder tree.

---

## Related

- [`docs/caching-policy.md`](../caching-policy.md) — what each policy stores, and why
- [`docs/providers.md`](../providers.md) — the adapters and their capabilities
- [`docs/oauth-setup.md`](../oauth-setup.md) — registering the applications
- [`docs/priority.md`](../priority.md) — how importance feeds the ranking
