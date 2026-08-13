# Provider capability and limits matrix

Three providers sit behind one internal model. They are **not** equally
capable, and the honest way to handle that is to declare the differences
rather than discover them at the moment you click something.

Each adapter publishes a `ProviderCapabilities` descriptor
(`src/lib/mail/adapters/types.ts`). The UI reads it and hides or explains what
a provider cannot do; a missing capability is a documented product behaviour,
never a runtime surprise. The tests assert that the descriptor matches the
methods each adapter actually implements, so this table cannot drift from the
code without something going red.

---

## At a glance

| Capability           | Gmail / Google | Microsoft 365              | Proton (via Bridge)        |
| -------------------- | -------------- | -------------------------- | -------------------------- |
| Read mail            | ✅             | ✅                         | ✅                         |
| Send mail            | ✅             | ✅                         | ✅ (SMTP)                  |
| Server-side search   | ✅             | ✅                         | ❌ — local cache only      |
| Incremental sync     | ✅ historyId   | ✅ delta                   | ⚠️ IMAP UID                |
| Read/flag write-back | ✅             | ✅                         | ✅ (IMAP flags)            |
| Read calendar        | ✅             | ✅                         | ❌ — not exposed           |
| Write calendar       | ✅             | ❌ (scope not requested)   | ❌                         |
| Push notifications   | ✅             | ✅                         | ❌ — polling only          |
| Needs extra setup    | OAuth app      | **Azure app registration** | **Bridge running locally** |

---

## Google — Gmail and Calendar

One adapter, because they are one connection: a single OAuth grant covers
both, and splitting them would mean two refresh paths for one account.

**Scopes requested.** `gmail.modify`, `gmail.send`, `calendar.events`,
`calendar.readonly`. Note `gmail.modify` rather than `mail.google.com` — it
cannot permanently delete mail, which is the right ceiling for a dashboard.

**Limits worth knowing:**

- **Labels are not folders.** A Gmail message carries several at once
  (`INBOX`, `UNREAD`, `IMPORTANT`, a user label). The folder shown is the most
  specific one it carries; category and state labels are ignored.
- **`historyId` expires.** Google keeps roughly a week of history. After a
  quiet period the cursor 404s and the next sync is a full one — handled, and
  surfaced as `requiresFullResync`.
- **Two calls per message.** `messages.list` returns ids only. Under the
  Metadata caching policy the second call uses `format=metadata`, so Google
  never sends the body at all.
- **Rate limits are per-user and easy to trip.** Messages are fetched
  sequentially rather than in a burst; a throttled account costs far more than
  the seconds saved.
- **Filters keep running.** A message marked read here may be moved again by
  Gmail's own rules straight afterwards.

## Microsoft 365 — Outlook mail and calendar

**Wired, tested, and not yet connectable** — there is nothing to obtain a
token from until an Azure application exists. That is a configuration state,
not unfinished work: set `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`
and it turns on with no code change. Until then the connect screen lists the
provider and says exactly what is missing.

**Limits worth knowing:**

- **Administrator consent.** Corporate tenants routinely refuse the app until
  an admin approves it. This is surfaced as its own state
  (`admin_consent_required`), not as an auth failure — otherwise you would be
  sent round the sign-in loop forever.
- **Sending returns nothing.** `sendMail` answers `202 Accepted` with an empty
  body, so there is no id for the sent message. It appears when the Sent
  folder next syncs.
- **The calendar is read-only here.** Writing needs `Calendars.ReadWrite`, a
  scope worth requesting only when the product actually writes events.
- **Times come with a separate zone.** Graph returns a local wall-clock string
  plus a `timeZone` field. Treating that string as UTC is the classic Outlook
  bug; the two travel together and are resolved together.

## Proton — via Proton Bridge

**Constrained, by design and by Proton's architecture.** Proton's servers are
never spoken to directly. Bridge runs on the same box, holds the account keys,
and exposes a local IMAP/SMTP server serving already-decrypted mail. The
adapter talks only to `127.0.0.1`.

**Limits worth knowing:**

- **Bridge must be running and signed in.** When it is not, the account goes
  `degraded`: cached mail stays visible and is marked stale, exactly like a
  provider outage.
- **No usable server-side search.** IMAP SEARCH exists, but Bridge implements
  it by scanning locally; on a large mailbox it is slower than searching what
  we have cached. Declared `serverSearch: false`, so the product searches the
  local cache instead.
- **UID-based sync.** The cursor is a `UIDVALIDITY:UID` pair. If Bridge
  renumbers a mailbox, every stored UID becomes meaningless and the only
  correct response is a full resync — which is what the adapter asks for.
- **Threading is reconstructed.** IMAP has no conversation id, so threads are
  built from `In-Reply-To` and `Message-ID`. Occasionally coarser than Gmail's.
- **Proton Calendar cannot be read.** Bridge exposes no CalDAV endpoint. The
  specification asks for read-visibility first; until Proton ships an
  interface, visibility means sharing the calendar into Google or Outlook and
  connecting that account. Saying so is better than a calendar that silently
  never populates.

---

## Adding a provider

1. Implement `MailAdapter` in `src/lib/mail/adapters/`.
2. Publish a `ProviderCapabilities` descriptor. **Declare what you cannot
   do** — an honest `false` is worth more than an optimistic `true` that
   throws.
3. Map failures onto `AdapterError` kinds. Getting `auth` versus
   `unavailable` right is what decides whether cached mail stays on screen.
4. Add a test file asserting the descriptor matches the methods implemented.

Nothing outside the adapter directory should need to change.

---

## Related

[OAuth setup](oauth-setup.md) · [Caching policy](caching-policy.md) ·
[Data model](data-model.md) · [Threat model](threat-model.md)
