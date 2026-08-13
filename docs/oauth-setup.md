# Connecting mail and calendar accounts

What to create at each provider, and what to put in `.env`. Everything here is
done once, on your box.

**The redirect URI is your tailnet hostname.** That works even though the box
is not publicly reachable, because the redirect happens in _your browser_,
which is on the tailnet — the provider never has to reach you. It does mean
the hostname must be stable: changing `TAILNET_HOSTNAME` means updating the
redirect URI at every provider.

Throughout, `https://dashboard.tail1234.ts.net` stands in for your own.

---

## Before anything: the encryption key

Mail bodies and OAuth tokens are field-encrypted. Without a key configured,
Full caching refuses to run and says so, and account credentials cannot be
stored at all.

```bash
node -e "console.log('v1:' + require('crypto').randomBytes(32).toString('base64'))"
```

Put the result in `.env`:

```
DASHBOARD_ENCRYPTION_KEYS=v1:<the base64 above>
DASHBOARD_ENCRYPTION_ACTIVE_KEY=v1
```

**Back this up somewhere off the box, with `JWT_SECRET`.** Losing it makes
every stored body and every stored token unreadable — the mail is still at the
provider, but the local mirror is gone.

Rotation is additive: add `v2:...` to the list, point
`DASHBOARD_ENCRYPTION_ACTIVE_KEY` at it, and keep `v1` until every row has
been rewritten. The envelope carries its key id, so old rows keep decrypting.

---

## Google — Gmail and Calendar

1. **Create a project** at <https://console.cloud.google.com/>.

2. **Enable two APIs** under _APIs & Services → Library_:
   - Gmail API
   - Google Calendar API

3. **Configure the OAuth consent screen.**
   - User type: **External** unless you have Workspace, then **Internal**.
   - Add yourself as a **test user** — an External app in testing mode only
     works for listed users, which is exactly what you want for a personal
     dashboard. There is no reason to submit it for verification.
   - Scopes: you can leave the screen empty; the app requests what it needs at
     authorization time.

4. **Create credentials** → _OAuth client ID_ → **Web application**.

   Authorized redirect URI:

   ```
   https://dashboard.tail1234.ts.net/api/mail/oauth/gmail/callback
   ```

5. **Put the client id and secret in `.env`:**

   ```
   GOOGLE_CLIENT_ID=…apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=…
   ```

6. `docker compose up -d app`, then connect the account in the dashboard.

**Scopes requested:** `gmail.modify`, `gmail.send`, `calendar.events`,
`calendar.readonly`. Deliberately not `mail.google.com` — the app cannot
permanently delete mail.

> **Test-mode refresh tokens expire after seven days.** If your consent screen
> is External and still in _Testing_, Google expires refresh tokens weekly and
> the account will ask to be reconnected. Moving the app to _In production_
> (no verification needed for your own account with these scopes) stops that.

---

## Microsoft 365 — Outlook mail and calendar

Optional. The adapter is built and tested; it simply cannot be connected until
this registration exists. Nothing in the code needs to change.

1. **Azure Portal** → _Microsoft Entra ID_ → _App registrations_ → **New**.

2. Supported account types: _Accounts in any organizational directory and
   personal Microsoft accounts_, unless you know you want single-tenant.

3. **Redirect URI**, platform **Web**:

   ```
   https://dashboard.tail1234.ts.net/api/mail/oauth/microsoft/callback
   ```

4. **Certificates & secrets** → _New client secret_. Copy the **value**, not
   the id, and note the expiry — Azure secrets expire, and the account will go
   `needs_reauth` when it does.

5. **API permissions** → _Microsoft Graph_ → _Delegated_:
   `offline_access`, `openid`, `email`, `User.Read`, `Mail.ReadWrite`,
   `Mail.Send`, `Calendars.Read`.

6. **`.env`:**

   ```
   MICROSOFT_CLIENT_ID=…
   MICROSOFT_CLIENT_SECRET=…
   # Only for a single-tenant registration:
   # MICROSOFT_TENANT_ID=…
   ```

> **If it is a corporate tenant**, an administrator may have to approve the app
> before it will return any mail. The dashboard surfaces this as its own state
> — "an administrator needs to approve this app" — rather than as a sign-in
> failure, and the mailbox stays at the **Off** caching policy until consent is
> granted. See [caching-policy.md](caching-policy.md).

---

## Proton — via Proton Bridge

Proton has no OAuth. Bridge runs on this box, holds the account keys, and
exposes a local IMAP/SMTP server.

1. Install **Proton Bridge** (a paid Proton plan is required) and sign in.

2. Bridge → _Settings → Mailbox details_. It shows a host, two ports, a
   username and a **Bridge-generated password**. That password is only usable
   against `127.0.0.1`.

3. **`.env`:**

   ```
   PROTON_BRIDGE_HOST=127.0.0.1
   PROTON_BRIDGE_IMAP_PORT=1143
   PROTON_BRIDGE_SMTP_PORT=1025
   ```

   The username and password are entered in the dashboard when connecting the
   account, and stored field-encrypted like any other credential.

4. Bridge must keep running for the account to sync. When it is not, the
   account shows as degraded and cached mail is marked stale rather than
   disappearing.

**Read [the constraints](providers.md#proton--via-proton-bridge) before
connecting it** — in particular, Proton Calendar cannot be read through
Bridge at all.

---

## Where the tokens go

Nowhere near the browser.

The callback lands on a route handler on the server, the code-for-token
exchange happens there, and the result goes straight into
`mail_accounts.credentials_cipher` — AES-256-GCM, bound by AAD to that account
row, so write access to the database is not enough to move a token onto
another account. The account shape the UI receives carries `hasCredentials: true`
and nothing else.

A refresh token is a standing key to a live mailbox and, unlike a mail body,
it keeps working. It is treated accordingly: never logged (the redaction layer
strips bearer tokens and JWTs), never sent to the client, never a build
argument.

---

## When something goes wrong

**"needs to be reconnected" straight after connecting** — Google issued no
refresh token. It only does with `access_type=offline` _and_ `prompt=consent`,
both of which the authorize URL sets; if you have previously authorized the
app, revoke it at <https://myaccount.google.com/permissions> and connect again.

**Everything returns 401 after an hour** — the refresh is failing. Check the
client secret, and for Microsoft check the secret has not expired.

**"An administrator needs to approve this app"** — a tenant restriction, not
something you can fix in the dashboard. The mailbox stays at Off and readable
live meanwhile.

**Proton says the Bridge is not answering** — Bridge is closed, locked, or
signed out. Cached mail keeps showing, marked stale.

**Bodies are not being stored on a Full mailbox** — the encryption key is
missing. The account detail says so; set `DASHBOARD_ENCRYPTION_KEYS`.

---

## Related

[Provider limits](providers.md) · [Caching policy](caching-policy.md) ·
[Runbook](runbook-windows.md) · [Threat model](threat-model.md)
