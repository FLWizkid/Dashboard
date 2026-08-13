# Threat model

What this system is protecting, from whom, and where it is still weak.

This is a working document, not a compliance artefact. It is written against
the code in this repository, so every mitigation names the file that
implements it and can be checked. When a phase changes the shape of the
system, the corresponding section changes with it — see
[Per-phase review](#per-phase-review).

**Scope:** the self-hosted stack in `docker-compose.yml`, the Next.js
application in `src/`, and the operational scripts in `ops/`. It covers the
system as of Phase 1 (tasks) and flags where Phases 2–7 will move the
boundaries.

---

## 1. What is worth stealing

Ranked by what the loss would actually cost.

| Asset                                | Why it matters                                                                                      | Where it lives                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Mail bodies and attachments** (P2) | A CIO's inbox is the single richest target here: vendor pricing, personnel matters, incident detail | `db-data` volume; `storage-data` volume       |
| **Calendar** (P2)                    | Who is meeting whom reveals deals, hires and incidents before they are announced                    | `db-data`                                     |
| **Tasks and notes**                  | Board prep, budget positions, security findings, decision logs with rationale                       | `db-data`                                     |
| **OAuth tokens** (P2)                | Not data but _access_ — a token is a standing key to the live Google or Microsoft account           | `db-data`, AES-256-GCM at the field level     |
| **`SERVICE_ROLE_KEY`**               | Bypasses Row Level Security entirely. Reads and writes everything                                   | `.env`, app container environment             |
| **`JWT_SECRET`**                     | Mints any token, including a service-role one                                                       | `.env`, `db`, `auth`, `rest`, `realtime`      |
| **Backups**                          | A full copy of everything above, in one file, designed to be portable                               | `ops/backups`, second device, off-site remote |

The uncomfortable observation: the backup is the most portable copy of the
most valuable data. It gets the most attention below.

---

## 2. Trust boundaries

```
        ┌──────────────────────────── the internet ────────────────────────────┐
        │  No inbound path exists. Nothing is published, no ports forwarded,   │
        │  no ACME challenge, no reverse tunnel.                               │
        └──────────────────────────────────────────────────────────────────────┘
                                        ╳  (no route)
        ┌───────────────────────────── the tailnet ────────────────────────────┐
        │  WireGuard. Device identity, not a password. Boundary ①              │
        │                                                                      │
        │   your laptop / phone / headset  ──HTTPS──▶  Caddy :443              │
        └──────────────────────────────────────────────────────────────────────┘
                                        │  Boundary ②
        ┌────────────────────── the Windows box (Docker) ──────────────────────┐
        │  Caddy ──▶ Next.js app ──┐                                           │
        │        └─▶ Kong ──▶ auth / rest / realtime / storage                 │
        │                              │  Boundary ③                           │
        │                              ▼                                       │
        │                          Postgres  (RLS)   ──▶  backup sidecar       │
        └──────────────────────────────────────────────────────────────────────┘
                                        │  Boundary ④
                                   off-site remote (age-encrypted)
```

- **① tailnet edge** — Tailscale ACLs and device authorisation decide who can
  even open a socket. Everything past here assumes the caller is on your
  tailnet.
- **② the reverse proxy** — the only listening socket. TLS terminates here;
  security headers are added here.
- **③ the database** — Row Level Security. This is the real access boundary,
  not Kong and not the application.
- **④ data leaving the box** — backups, and (only if you enable it) error
  reports.

---

## 3. Who we are defending against

Realistically, in order of likelihood.

| #   | Adversary                                                                | Capability                                | Taken seriously?   |
| --- | ------------------------------------------------------------------------ | ----------------------------------------- | ------------------ |
| A1  | **Opportunistic internet scanning**                                      | Finds and exploits anything exposed       | Yes — primary      |
| A2  | **Your own mistake**: a port published, a secret committed, a key pasted | Full access, silently                     | Yes — primary      |
| A3  | **A lost or stolen device** that is on the tailnet                       | Whatever that device's session can reach  | Yes                |
| A4  | **Malicious content**: a phishing mail rendered in the app (P2)          | XSS in the app's origin, then the session | Yes — from P2      |
| A5  | **A compromised dependency** in npm or a container image                 | Code execution as the app                 | Partly             |
| A6  | **Someone else on your tailnet** (a shared device, a future teammate)    | Reaches the dashboard's port              | Partly             |
| A7  | **The off-site storage provider** reading what it stores                 | The backup, if it were not encrypted      | Yes                |
| A8  | **A targeted attacker with physical access to the box**                  | Everything, eventually                    | Partially — see §6 |

A1 and A2 are where nearly all real-world loss comes from, and they are what
most of the design below is shaped around.

---

## 4. Threats and what stops them

### 4.1 Exposure to the internet (A1, A2)

The single highest-consequence failure would be publishing this stack.

| Threat                                                     | Mitigation                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A service is published on all interfaces                   | Every port in `docker-compose.yml` is bound to `${BIND_ADDRESS}`, which defaults to `127.0.0.1`. A missing or mistyped value makes the stack **unreachable**, not public. A unit test asserts the generated `.env` never sets it to `0.0.0.0` |
| Docker punches through the Windows Firewall                | This is true and worth stating plainly: published ports bypass host firewall rules. The defence is the bind address, not the firewall — which is why nothing here relies on the firewall                                                      |
| The database, auth or Kong is reachable directly           | None of them publish a port at all. They use `expose`, which is internal to the Docker network. Caddy is the only listener                                                                                                                    |
| Studio's broad admin surface is left running               | `studio` and `meta` sit behind the `admin` compose profile, off unless asked for, and Studio binds to `127.0.0.1` even then                                                                                                                   |
| ACME/HTTP-01 forces a public endpoint to get a certificate | Certificates come from `tailscale cert` over Tailscale's DNS. `auto_https off` in the Caddyfile means Caddy never attempts an ACME challenge                                                                                                  |

**How you check it**, on the box:

```powershell
docker compose ps --format '{{.Service}}  {{.Ports}}'   # only caddy maps a port
netstat -an | Select-String ':443'                       # bound to 100.x, not 0.0.0.0
```

### 4.2 Authentication and session (A3, A6)

| Threat                                   | Mitigation                                                                                                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Someone on the tailnet enrols an account | `GOTRUE_DISABLE_SIGNUP=true`. The single account is created once, by you, with a service-role call. There is no sign-up UI                                       |
| Password guessing                        | `GOTRUE_PASSWORD_MIN_LENGTH=12`; GoTrue rate-limits authentication attempts                                                                                      |
| A stolen refresh token is replayed       | Refresh token rotation is on, with a 10-second reuse interval — a replayed token invalidates the family                                                          |
| A device is lost while signed in         | Sessions are 1 hour (`JWT_EXPIRY`). Removing the device from the tailnet cuts the route immediately, which is faster and more complete than revoking a session   |
| No second factor                         | MFA is **enabled in GoTrue** (`GOTRUE_MFA_ENABLED`) so factors can be enrolled without a migration. Enrolment UI is P7 — see [Residual risks](#6-residual-risks) |

### 4.3 Data access (A4, A5, A6)

| Threat                                      | Mitigation                                                                                                                                                                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One user reads another's rows               | Row Level Security on every table, `user_id` defaulting to `auth.uid()`. Asserted by the integration suite, which runs as the `authenticated` role — as superuser the policies would be bypassed and the tests would pass regardless. `docs/data-model.md` |
| Application code forgets a `where user_id`  | It cannot matter. RLS is enforced in the database, below the application                                                                                                                                                                                   |
| A forged `user_id` on insert                | `with check (auth.uid() = user_id)`; covered by an integration test                                                                                                                                                                                        |
| Cross-user linking via a foreign key        | RLS cannot express "the category you referenced is also yours". Two `security definer` triggers do, raising `check_violation`                                                                                                                              |
| `SERVICE_ROLE_KEY` reaches the browser      | Never prefixed `NEXT_PUBLIC_`, never a Docker build argument, only injected at runtime into the server process. `PLAN.md` guardrails                                                                                                                       |
| Test-only memory mode enabled in production | `isMemoryMode()` requires `DASHBOARD_DATA_MODE=memory` **and** `NODE_ENV !== "production"`. No environment variable alone can turn it on in a production build                                                                                             |
| The archived placeholder tables leak        | Moved out of `public` (which is what PostgREST exposes) and all grants revoked; verified in `tests/integration/retirement.test.ts`                                                                                                                         |

### 4.4 Secrets (A2)

The repository is **public**. That single fact drives this section.

| Threat                                        | Mitigation                                                                                                                                                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A secret is committed                         | `.gitignore` excludes `.env` and `.env.*` except `.env.example`; `.dockerignore` keeps them out of image layers; `.env` is written mode `0600`                                                                                                         |
| A secret is baked into a container image      | Only `NEXT_PUBLIC_*` values are build arguments, and those are public by design. The service-role key is runtime-only                                                                                                                                  |
| Weak or predictable secrets                   | `ops/generate-secrets.mjs` uses `randomBytes` with rejection sampling; ~233 bits for the database password, ~373 for the JWT secret                                                                                                                    |
| A secret is logged                            | `src/lib/observability/scrub.ts` redacts JWTs, bearer tokens, connection-string passwords, `apikey=`/`token=` parameters and any key named `*_key`, `*secret*`, `*token*`, `*password*`. Caddy's access log drops query strings and credential headers |
| A rotated secret leaves the stack half-broken | Rotation is documented as a single procedure in the runbook, including that both API keys are derived from `JWT_SECRET`                                                                                                                                |

### 4.5 Data at rest, and backups (A3, A7, A8)

| Threat                                 | Mitigation                                                                                                                                                                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The disk is removed from the box       | **BitLocker on the volume holding the Docker data root.** This is the encryption-at-rest control; the runbook makes it a setup step and it is the one thing on that list with no software fallback                                                                                                                       |
| The off-site provider reads the backup | Encrypted with `age` **before** upload, to a public key whose private half is kept off the box. `backup.sh` verifies the age header and refuses to upload anything without it                                                                                                                                            |
| A backup is corrupt and nobody notices | Every dump is checksummed and its table of contents read back at write time; a **weekly restore drill** restores the newest archive into a throwaway database and checks the schema, the row counts, that RLS survived, and that `tasks.is_ready` is still generated. It fails if the newest backup is over 48 hours old |
| Ransomware encrypts the local copies   | The off-site copy is a separate credential and a separate system; retention keeps 24 monthly archives                                                                                                                                                                                                                    |
| The restore key is lost with the box   | Stated explicitly in the runbook: the age private key and a copy of `JWT_SECRET` live somewhere else. A backup you cannot decrypt is not a backup                                                                                                                                                                        |
| Local backups are unencrypted          | Deliberate. They sit on the BitLocker volume, and a drill that needs an off-box key is a drill that never runs. Only the copy that _leaves_ is encrypted                                                                                                                                                                 |

### 4.6 Application-level attack (A4, A5)

| Threat                                 | Mitigation                                                                                                                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| XSS via rendered content               | Strict CSP from Caddy: `default-src 'self'`, no third-party origins, `object-src 'none'`, `frame-ancestors 'none'`. **`script-src` still allows `'unsafe-inline'`** — see residual risks |
| Clickjacking                           | `X-Frame-Options: DENY` and `frame-ancestors 'none'`                                                                                                                                     |
| MIME sniffing                          | `X-Content-Type-Options: nosniff`                                                                                                                                                        |
| Cross-origin API abuse                 | Kong's CORS plugin allows exactly one origin — the tailnet hostname                                                                                                                      |
| Injection through the quick-add parser | The parser only produces structured values; every database call is parameterised through PostgREST or `pg`                                                                               |
| A malicious npm package                | `npm ci` against a committed lockfile; CI runs the same install. No post-install scripts are added by this repo                                                                          |
| A malicious container image            | Image tags are pinned in `docker-compose.yml`, so an upstream tag being re-pointed does not silently change the box                                                                      |
| The service worker caches private data | It caches static assets only — never authenticated pages, never API responses                                                                                                            |

### 4.7 Diagnostics leaving the box (A7)

| Threat                                   | Mitigation                                                                                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Error reports carry private data off-box | Remote reporting is **off unless `SENTRY_DSN` is set**, and the app logs its choice at boot. When enabled, only the already-scrubbed event is sent — the raw error never is |
| Logs carry mail content                  | Caddy strips query strings; the scrubber redacts fields named `body`, `html`, `snippet`, `preview` before P2 ever populates them                                            |
| Container logs grow unbounded on disk    | `json-file` with 10 MB × 5 rotation on every service                                                                                                                        |

---

## 5. What we are _not_ defending against

Stated so nobody assumes otherwise:

- **A compromised Windows account with administrator rights.** It can read the
  Docker volumes, the `.env`, and unlock BitLocker. Everything here assumes the
  box's own account is trusted.
- **A malicious Tailscale coordination plane.** Tailscale can, in principle,
  authorise a device. The mitigation available is tailnet ACLs and device
  approval; we accept the residual.
- **Nation-state targeting.** Out of scope for a personal dashboard.
- **Availability.** This is a single box with no redundancy. If it is off, the
  dashboard is off. That is an accepted trade for keeping the data on your own
  hardware.

---

## 6. Residual risks

The honest list. Each has an owner phase.

| #   | Residual risk                                                     | Why it is still open                                                                                                                                                                                                                                                                                                                                                                    | Closes in                                         |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| R1  | **CSP allows `script-src 'unsafe-inline'`**                       | Next.js hydration ships inline scripts; the nonce plumbing is worth doing when third-party e-mail HTML is actually rendered                                                                                                                                                                                                                                                             | **P2**                                            |
| R2  | **No MFA enrolment UI**                                           | GoTrue is configured for it; the enrolment and recovery-code flow is a product surface, not a config flag                                                                                                                                                                                                                                                                               | **P7**                                            |
| R3  | **No audit log**                                                  | "Who changed what, when" needs the write paths to be settled first                                                                                                                                                                                                                                                                                                                      | **P7**                                            |
| R4  | **No retention/purge job** (spec default: 24 months)              | ~~Open~~ — **closed.** `purge_expired_messages()` honours each account's window and runs as its caller, so RLS applies                                                                                                                                                                                                                                                                  | ~~P2/P7~~ done                                    |
| R5  | **Mail bodies field-encrypted**                                   | ~~Open~~ — **closed.** AES-256-GCM, AAD-bound to the message id; additive key rotation. See R11 for what the search index still leaks                                                                                                                                                                                                                                                   | ~~P2~~ done                                       |
| R6  | **Storage and imgproxy run but are unused**                       | They are in the specified stack and P2 needs them; running them early is surface without benefit                                                                                                                                                                                                                                                                                        | **P2** — or comment them out now                  |
| R7  | **Off-site backup is opt-in and starts unconfigured**             | It needs an `age` key and an rclone remote that only you can create. Until then every backup log says "NOT yet a 3-2-1 backup"                                                                                                                                                                                                                                                          | Setup                                             |
| R8  | **The archived `priorities`/`time_entries` still hold rows**      | Deliberate: dropping is irreversible. The drop is a documented, separate step                                                                                                                                                                                                                                                                                                           | On your say-so                                    |
| R9  | **WSL2 and Docker Desktop are a large trusted computing base**    | Inherent to running this on Windows                                                                                                                                                                                                                                                                                                                                                     | Accepted                                          |
| R10 | **No intrusion detection**                                        | A single-user box on a private network; the detection story is the review checklist below                                                                                                                                                                                                                                                                                               | Accepted                                          |
| R11 | **The full-text index discloses the set of words in a mail body** | Postgres cannot index ciphertext, so the search vector is built from the plaintext before encryption. A `tsvector` leaks stemmed lexemes — not their order, not the sentences, not figures in context. Accepted: the alternative is no search, which the product requires. A mailbox where even the word list matters should be set to **Metadata**, where bodies are not stored at all | Accepted — [caching-policy.md](caching-policy.md) |
| R12 | **A refresh token is a standing key to a live mailbox**           | Encrypted at rest and AAD-bound to its account row, never sent to the browser, never logged. But an attacker with both the database and the encryption key gets working access to Gmail, not merely to yesterday's copy of it                                                                                                                                                           | Inherent                                          |

---

## 7. Detection — what would tell you something is wrong

There is no monitoring stack, so this is a short manual list. The runbook
schedules it monthly.

1. `docker compose ps --format '{{.Service}} {{.Ports}}'` — **only** `caddy`
   should map a host port, and only to your tailnet address.
2. `docker compose logs backup --since 168h` — a week with no successful
   backup, or a failed drill, is the loudest signal here.
3. `docker compose logs auth | Select-String "invalid"` — repeated failed
   sign-ins from a device you don't recognise.
4. The Tailscale admin console device list — anything you didn't authorise.
5. `git status` in the repository — an untracked `.env` is correct; a
   **tracked** one is an incident.

---

## 8. If something does go wrong

1. **Cut the route first.** Remove the box from the tailnet
   (`tailscale logout`) or disable the device in the admin console. This is
   faster than anything else available and it is complete.
2. **Preserve evidence.** `docker compose logs --no-color > incident.log`
   before restarting anything.
3. **Rotate.** `node ops/generate-secrets.mjs --force`, then follow
   "Rotating secrets" in the runbook. This invalidates every session and both
   API keys.
4. **Assess the backups.** If the box may have been writable by an attacker,
   restore from a copy predating the incident and run the drill against it.
5. **Re-issue the certificate** if the private key may have been read:
   `Update-TailscaleCert.ps1 -Force`.

---

## Per-phase review

This document is reviewed at each phase gate, not just at the end.

| Phase                    | What changes about the threat picture                                                                                                                                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P2 — Email, calendar** | The biggest shift in the project. Third-party HTML gets rendered (R1 must close), OAuth tokens become a stored asset (now encrypted), mail bodies are field-encrypted (R5 closed), the search index discloses a lexeme set (R11), retention starts to matter (R4) |
| **P3 — Notes**           | A filesystem boundary appears: the Obsidian vault is read and written outside Postgres, so RLS does not cover it                                                                                                                                                  |
| **P4 — Pomodoro/hours**  | Offline time-logging means data at rest in the browser; check what the PWA persists                                                                                                                                                                               |
| **P6 — Digests**         | Outbound e-mail carries summaries of everything. SMTP credentials become an asset, and the digest becomes a data-egress path                                                                                                                                      |
| **P7 — Hardening**       | Closes R2, R3, R4; full review; a restore drill you watch, not just one that passes                                                                                                                                                                               |

---

## Connector egress (post-v1)

The GitHub connector is the first thing in the product that contacts a third
party from the box, so it is worth stating exactly what that does and does not
change.

**What is new**

- **Outbound HTTPS to `api.github.com`**, from the app container only. A
  second network destination where previously the only ones were the owner's
  own mail and calendar providers.
- **A long-lived access token** (`GITHUB_TOKEN`) becomes an asset on the box.

**What is deliberately _not_ new**

- **No inbound anything.** This is not a webhook integration: no port opens,
  no URL is published, and the tailnet-only property is untouched.
- **The browser still talks to nothing but this app.** `connect-src 'self'`
  forbids a page contacting GitHub, and every connector call is made
  server-side. That is what keeps the token off the client rather than merely
  discouraging it — `src/lib/connectors/registry.ts` is `server-only`, so an
  import from a component fails the build instead of shipping a secret.
- **Nothing about your work is sent.** No task titles, no notes, no telemetry.
  The only thing GitHub learns is that this token looked at a particular
  issue, which it already knew it could.
- **No provider prose is stored.** Titles, state and author only — never issue
  or PR bodies. Mirroring a provider's content into a second database would
  create a much larger thing to keep private.

**Residual risks this adds**

| Id  | Risk                                                                                                    | Position                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| R12 | The token is as broad as it was issued — a classic `repo` token can read every repository the owner can | Accepted, documented. A fine-grained token scoped to the repositories that matter is the mitigation, and `docs/connectors.md` says so |
| R13 | Cached titles disclose what the owner is working on to anyone who reads the database                    | Bounded by RLS and by storing titles only. Not field-encrypted: a title is already in the search index and in the digest              |
| R14 | An egress path exists at all, on a box whose premise is that it is private                              | Off by default. With `GITHUB_TOKEN` unset the connector does not exist and nothing leaves                                             |

---

## Related

[Data model and RLS](data-model.md) · [Connectors](connectors.md) ·
[Windows runbook](runbook-windows.md) · [Backups](backups.md) ·
[Testing](testing.md)
