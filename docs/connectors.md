# Connectors

External context — a pull request, an issue, a document — shown next to the
work it belongs to.

---

## 1. What this is for

A task that says "review the auth migration" is missing the auth migration.
The point of this layer is that the work item and the thing it is about stop
living in two places you have to hold in your head at once.

The payoff is not the list. It is the **brief**: "the pull request your task
was waiting on merged overnight" is the only thing here that can change what
you do this morning. Everything else is filing.

## 2. Connecting GitHub

One environment variable on the box:

```dotenv
# A personal access token. Classic or fine-grained; it needs `repo` scope for
# private repositories and nothing at all for public ones.
GITHUB_TOKEN=github_pat_…

# Only for GitHub Enterprise. Omit for github.com.
# GITHUB_API_URL=https://ghe.example.internal/api/v3
```

Restart the app container. That is the whole setup — no OAuth app, no callback
URL, no consent screen.

### Why a token and not OAuth

The encrypted credential store exists to hold _rotating_ OAuth tokens and to
survive a `pg_dump`. A GitHub personal access token is one long-lived secret
with no refresh cycle, so for a single-user product on a BitLocker volume it
buys nothing that `.env` does not — and it means connecting GitHub takes an
afternoon rather than a form.

When a connector arrives that genuinely needs OAuth — Slack and Zoom both will
— it uses the credential store, and `src/lib/connectors/registry.ts` grows a
branch rather than the store being retrofitted.

### What the token can see, the dashboard can see

There is no separate permission model. A fine-grained token scoped to two
repositories is the tightest way to limit what this can read, and is worth
doing if the alternative is a classic token with `repo` across an org.

## 3. Attaching something

**Paste its URL.** On a task: expand it, _Attach a link_. On a note: the same
panel below the editor.

That is the primary path because it matches what you already have — you were
looking at the pull request, you copied the address. A search-first design
makes you describe something you are holding.

Recognised GitHub URLs:

| Shape                             | Becomes      |
| --------------------------------- | ------------ |
| `/owner/repo/pull/482`            | Pull request |
| `/owner/repo/issues/12`           | Issue        |
| `/owner/repo/discussions/7`       | Discussion   |
| `/owner/repo/releases/tag/v1.2.3` | Release      |
| `/owner/repo/commit/abc123`       | Commit       |
| `/owner/repo`                     | Repository   |

Query strings and fragments are ignored, so a URL copied straight from the
browser works. A lookalike host — `github.com.evil.test` — is refused: hosts
are compared, not pattern-matched.

### Pasting is the confirmation

The product's rule is **confirm before link**, and this does not bend it.

The rule exists because a _guessed_ link is an assertion the owner never made
— a parser deciding two things are related. A pasted URL is the owner making
the assertion themselves, so asking again would be asking them to confirm that
they meant to do the thing they just did.

When a detector eventually suggests links, they arrive **unconfirmed** and
render as an offer. A database trigger refuses a link created already-confirmed
in the past, which is the shape a silent auto-linker would take.

## 4. What is stored, and what is not

**Stored:** title, subtitle, state, author, the URL, when the provider last
saw a change, and a small snapshot (labels).

**Never stored:** bodies. Not issue descriptions, not PR conversations, not
commit message bodies — only the subject line. Mirroring a provider's prose
into a second database would make this a worse version of that provider and a
much larger thing to keep private.

### Why anything is stored at all

Three reasons, in order of how much they matter:

1. **The provider is not always reachable.** A dashboard that empties when
   GitHub is slow is one nobody trusts.
2. **The browser must never talk to a provider.** `connect-src 'self'` forbids
   it, and that is the point — it is what keeps the token on the server.
3. **Search has to work over what is linked**, including offline.

### Freshness is shown, not assumed

A reference is a _cached_ answer. A dashboard that presents six-hour-old data
with the same confidence as live data is one you eventually stop believing.

| State         | Shown as             | Means                                     |
| ------------- | -------------------- | ----------------------------------------- |
| Fresh (< 6h)  | nothing              | Take it at face value                     |
| Stale         | "may be out of date" | Nobody has looked recently                |
| Failing       | "out of date" + why  | The last look failed — token, rename, 403 |
| Never fetched | "not checked yet"    | Pasted but not yet resolved               |

A failure **outranks** age, because a failure is actionable and age is not.
Neither hides the title: yesterday's answer beats none, as long as it is
labelled.

Six hours rather than minutes, deliberately. A pull request's state rarely
changes between the morning brief and lunch, and a dashboard that constantly
announces its own staleness trains you to ignore the indicator — at which
point it is not there for the one time it matters.

## 5. In the brief

Under **What moved elsewhere**, in the morning brief, the weekly rollup and
the report workspace — all from one computation, so they cannot disagree.

It lists what **changed**, not what exists:

- **Settled first** — merged, closed, archived. A merged pull request may mean
  a task is finished, which is an action; ordinary activity is a nudge.
- Unconfirmed links are excluded entirely. Announcing news about a suggestion
  the owner never agreed to would be the product asserting a link it was
  specifically designed not to assert.
- Nothing changed means **no section at all**, not an empty heading. Unlike the
  task groups there is no meaningful difference between "nothing moved" and
  "nothing to move", and an empty box on a machine with no connectors reads as
  a broken integration.

## 6. Egress

This is the first thing in the product that talks to a third party from the
box, and it changes the network picture:

- **Outbound to `api.github.com` over HTTPS**, from the app container only.
  Nothing inbound: this is not a webhook integration, so no port opens and no
  URL is published.
- **Server-side only.** The browser never contacts a provider — the CSP would
  block it, and that is what keeps the token off the client.
- **The token never leaves the box** except as a `Bearer` header to GitHub, and
  never reaches a browser bundle. `src/lib/connectors/registry.ts` is marked
  `server-only`, so importing it from a component fails the build rather than
  shipping a secret.
- **Nothing is sent to GitHub but the request itself.** No task titles, no
  notes, no telemetry. The only thing GitHub learns is that this token looked
  at a particular issue, which it already knew it could.

If the box must have no egress at all, leave `GITHUB_TOKEN` unset. The product
works exactly as before; the attach panel says nothing is connected.

Recorded in [`docs/threat-model.md`](threat-model.md).

## 7. When a provider misbehaves

Errors are typed, and the distinction that earns the type is **whether cached
data stays valid**:

| What happened              | Shown                                | Cache   |
| -------------------------- | ------------------------------------ | ------- |
| Token expired or revoked   | "Reconnect the integration"          | kept    |
| Token cannot see it        | "Check the scopes on the connection" | dropped |
| Deleted, or never existed  | "GitHub has no such item"            | dropped |
| Rate limited               | "It will refresh itself shortly"     | kept    |
| GitHub down or unreachable | "Showing what was last fetched"      | kept    |

`unavailable` means "we could not look, keep showing what we had".
`not_found` means "it is gone, stop pretending". Rendering a deleted pull
request as open indefinitely is worse than showing nothing.

GitHub answers **403 for both forbidden and rate-limited**, and only the
remaining-quota header tells them apart — so the connector reads it rather
than guessing.

## 8. Retention

Deliberately narrow, and worth reading before adding to it.

**Links are never purged.** A link is the owner's judgement — "this task is
about that PR" — and a purge that removed it on age would be deleting
judgement, not data.

**A reference nothing points at** is removed after 30 days. Those appear when
the last task or note linking a reference is deleted; keeping them would leave
the search index full of context already discarded. It works because an
unlinked reference stops being refreshed, so its timestamp stops moving.

```sql
select public.purge_orphaned_refs();              -- 30-day default
select public.purge_orphaned_refs(interval '7 days');
```

Runs as the caller, so RLS applies and it can only ever purge your own rows.

## 8a. Staying current

A reference is re-fetched every fifteen minutes by the scheduler, but only when
it is worth it:

- **Settled references are never re-fetched.** Merged, closed and archived are
  terminal, and the set of them only grows.
- **Unlinked references are skipped**, because refreshing one would keep
  resetting the clock that decides when it is purged.
- **A failing reference is retried after a day**, not immediately — hammering a
  provider that just answered 403 does not make it answer 200.
- **One broken reference does not stop the rest.** Its failure is written
  against its own row and shown as "out of date", with the reason.

Without this the whole feature is a snapshot: a merged pull request would show
as open indefinitely, and **What moved elsewhere** in the brief would be
permanently empty, because nothing would ever observe a change.

See [`docs/scheduler.md`](scheduler.md).

## 9. What is not built

- **No suggestion engine.** Nothing detects that a task mentions `#482`. The
  unconfirmed-link path exists and is enforced, waiting for something to
  produce one.
- **No Slack, Zoom, Drive or SharePoint.** The contract is provider-agnostic
  and GitHub is the first implementation, not the shape of the design.
- **No webhooks.** `capabilities.webhooks` is false and honest.

## Related

- [`docs/threat-model.md`](threat-model.md) — the egress this adds
- [`docs/reports.md`](reports.md) — where "what moved elsewhere" appears
- [`docs/security-review.md`](security-review.md) — the CSP that keeps tokens server-side
