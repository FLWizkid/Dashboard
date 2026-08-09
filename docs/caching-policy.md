# The per-mailbox caching policy

How much of a mailbox is mirrored onto your box, decided per account.

This exists because "connect my mail" means something different for a personal
account than for a corporate one. Mirroring your own Gmail is your decision to
make. Mirroring a corporate mailbox may not be — it can be your employer's
data, under their retention rules, and possibly their lawyers'.

---

## The three levels

| Level        | Stored locally                                 | Searchable | Works offline | Default for |
| ------------ | ---------------------------------------------- | ---------- | ------------- | ----------- |
| **Off**      | Nothing at all                                 | No         | No            | Corporate   |
| **Metadata** | Sender, recipients, subject, timestamps, flags | Subjects   | Partly        | —           |
| **Full**     | The above **plus bodies, field-encrypted**     | Everything | Yes           | Personal    |

**Off really means off.** The sync service makes no request at all — a mailbox
set to Off does not even appear in the provider's access log against your
credentials. Nothing about it is written down.

**Metadata means headers only.** Bodies are never requested: Gmail is asked
for `format=metadata`, Graph's `$select` omits `body`, and IMAP's FETCH omits
the source. The snippet is not stored either — a snippet is a fragment of the
body, and "headers only" has to mean headers only.

**Full mirrors bodies, encrypted.** Each body is encrypted with AES-256-GCM
before it is stored, bound by AAD to the message it belongs to. Read
[the encryption module](../src/lib/crypto/envelope.ts) for the envelope
format.

---

## It is enforced by the database, not by good intentions

This is the part that makes the policy a guarantee rather than a convention.

`20260810000001_mail_calendar.sql` installs a trigger that reads the account's
policy on every message write and rejects anything that exceeds it:

```
Off       → any message row is refused
Metadata  → a row carrying body_cipher is refused
Full      → accepted, and body_cipher must carry the 'cio1.' envelope prefix
```

A bug in the sync service, or a future adapter that forgets to check, cannot
quietly mirror a corporate mailbox. The insert fails.

There is a second rule alongside it: **a corporate mailbox cannot be set to
Full until administrator consent is recorded as granted.** The unsafe
combination is unrepresentable, not merely discouraged.

Both are covered by `tests/integration/mail.test.ts`, which asserts the
failures as well as the successes.

---

## Corporate accounts and the consent path

A mailbox marked corporate starts at **Off**, and the connect flow offers a
consent path rather than a policy dropdown:

1. `not_required` — a personal account, or a tenant that does not gate the app.
2. `required` — the provider has told us an administrator must approve it.
3. `requested` — you have asked. The mailbox stays at Off meanwhile.
4. `granted` — Metadata and Full become available.
5. `denied` — the mailbox stays readable live, at Off, indefinitely.

Microsoft Graph reports this distinctly (`AADSTS65001` and friends), which is
why `admin_consent_required` is its own error kind rather than a generic auth
failure. Being told "ask your administrator" is actionable; being sent round
the sign-in loop is not.

---

## Search, and the one thing it discloses

Postgres cannot index ciphertext. For Full mailboxes to be searchable at all,
the search vector must be built from the plaintext **before** it is encrypted:

```
body ──► to_tsvector('english', …) ──► search_vector   (stored)
     └─► AES-256-GCM ──────────────► body_cipher      (stored)
     └─► discarded
```

The plaintext exists in memory between those two steps and nowhere else. In
the code it is carried on a field named `searchIndexInput`, documented as
transient, and it is never written to a column.

**What this discloses.** A `tsvector` contains the set of stemmed words in a
message — not their order, not the sentences, not the numbers in context. Some
one who can read the table can therefore learn that a message mentioned
"acquisition" and "termination", but not what it said about them.

That is a real disclosure and it is recorded in
[the threat model](threat-model.md). The alternative was no search, which the
product requires. If a particular mailbox is sensitive enough that even the
word list matters, set it to **Metadata** — subjects stay searchable, bodies
are not stored at all.

---

## Retention

Each account has its own window, defaulting to **24 months** as specified.
`purge_expired_messages()` deletes cached messages past it and tidies away any
thread left empty.

It runs as its caller, so RLS applies: it can only ever purge your own rows,
which the integration tests verify by having a second user call it and delete
nothing.

Retention applies to the **local mirror**, not to the mailbox. Purging here
never touches anything at Google, Microsoft or Proton.

---

## Changing a mailbox's policy

| Change              | What happens to what is already stored                                                    |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Off → Metadata/Full | Nothing was stored; the next sync begins mirroring.                                       |
| Metadata → Full     | Bodies arrive from the next sync onward. Older messages keep headers only.                |
| Full → Metadata     | New bodies stop being stored. **Existing bodies are not deleted** — do that deliberately. |
| Anything → Off      | Syncing stops. **Existing rows are not deleted** — do that deliberately.                  |

Downgrading deliberately does _not_ delete: silently destroying mail because a
dropdown changed is the wrong default. To clear a mailbox, delete the account,
which cascades.

---

## Related

[Providers and their limits](providers.md) · [OAuth setup](oauth-setup.md) ·
[Threat model](threat-model.md) · [Data model](data-model.md)
