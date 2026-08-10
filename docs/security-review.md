# Security review — Phase 7

The pass that was supposed to find things, and did.

This is the record of what was examined, what was found, what was fixed, and
what is knowingly still open. [`docs/threat-model.md`](threat-model.md) holds
the assets, boundaries and standing mitigations; this document is the review
against them.

---

## Summary

| Finding                                                        | Severity     | Status                         |
| -------------------------------------------------------------- | ------------ | ------------------------------ |
| `script-src 'unsafe-inline'` — CSP not an XSS control          | High         | **Fixed**                      |
| Sign-in redirect pointed at the container's bind address       | High         | **Fixed**                      |
| `upgrade-insecure-requests` blocked same-origin prefetches     | Medium       | **Fixed**                      |
| `sharp` — four high-severity libvips CVEs in the runtime image | High         | **Fixed** (removed)            |
| `postcss` advisories                                           | High (rated) | **Assessed** — build-time only |
| RLS coverage was per-table convention, not enforced            | Medium       | **Fixed**                      |
| `security definer` search-path pinning was convention          | Medium       | **Fixed**                      |
| Restore drill never exercised the off-site copy                | Medium       | **Fixed**                      |
| `style-src 'unsafe-inline'`                                    | Low          | **Accepted**, recorded         |
| `/offline` served with a relaxed policy                        | Low          | **Accepted**, bounded          |

---

## 1. Content Security Policy

### The finding

Since Phase 0 the policy carried `script-src 'self' 'unsafe-inline'`, with a
comment admitting it. The admission was honest and the gap was real:
`'unsafe-inline'` means **any injected `<script>` runs**. The policy was a
defence against loading a third-party origin and nothing else — which is to
say, not a defence against XSS at all, which is the only thing it is for.

It mattered more than a comment suggests, because P2 stores third-party email
HTML. A rendering path for that is not built yet, and when it is, the CSP is
the layer that has to hold if the sanitiser has a bad day.

### The fix

The application owns the policy now. `src/middleware.ts` mints a per-request
nonce, hands it to the renderer through a request header, and sets the matching
response header; Caddy no longer sets `Content-Security-Policy` at all, because
its `header` directive _replaces_ and would silently discard the nonce.

```
script-src 'self' 'nonce-<per request>' 'strict-dynamic'
```

`strict-dynamic` is what makes this workable: Next's bootstrap is a single
inline script that then loads content-hashed chunks whose paths cannot be
enumerated in advance. The nonce authorises the bootstrap; `strict-dynamic`
extends that trust to what it loads. `'self'` stays as the fallback for
browsers that do not implement `strict-dynamic` — where it is understood it is
ignored, and where it is not, the policy still refuses other origins.

The Supabase API paths keep a fixed, stricter policy in Caddy
(`default-src 'none'; … sandbox`). They serve JSON, never HTML, so there is no
nonce to carry and no legitimate reason for a response to load anything.

### Two bugs this uncovered

Both were found by `ops/check-csp.mjs`, which drives Chromium at a production
build and fails on a single `securitypolicyviolation`. Neither was findable by
reading a header.

**The sign-in redirect pointed at the container.** `request.nextUrl` is built
from the address the server bound to, not the `Host` the browser sent. Behind
Caddy, an unauthenticated visit to the dashboard answered
`Location: http://localhost:3000/login` — an address that on the user's laptop
is nothing, or something else entirely. The tailnet hostname appeared nowhere
in the response, so **every first sign-in would have dead-ended.**

The redirect is now built from the `Host` header. Reading a host from a request
header is normally how host-header injection works, so the reasoning for why it
is safe here is in the code: the path is a constant, so it can never be an open
redirect; the app container publishes no port, so Caddy is the only thing that
can reach it; and Caddy runs `strict_sni_host`, which refuses a request whose
Host does not match the certificate before it arrives.

**`upgrade-insecure-requests` blocked same-origin prefetches.** On a page the
browser did not reach over TLS, the directive rewrites _every_ request to
`https://` — including same-origin ones — and a scheme change is an origin
change, so `connect-src 'self'` stopped matching. Pages rendered; every
client-side navigation prefetch was refused. It is now conditional on
`X-Forwarded-Proto`, which is the only thing in the stack that knows what the
browser actually saw.

### What is still loose, on purpose

**`style-src 'unsafe-inline'`.** Framer Motion animates by writing inline
styles and Next's font loader injects a `<style>` element; nonces reach
neither. Injected CSS is a real risk — defacement, and exfiltration by
attribute selector — but it is not code execution, and the alternative is
losing all motion in the product. Recorded here rather than quietly accepted.

**`/offline` has a relaxed `script-src`.** It is statically prerendered so the
service worker can serve it with no network, which is mutually exclusive with a
per-request nonce. The carve-out is bounded to a page with no user data, no
fetches and nothing personal on it, and `ops/check-csp.mjs` asserts it loads
nothing from another origin. Every other directive is identical to the strict
policy, asserted in `src/lib/security/csp.test.ts` — a carve-out that quietly
widened `connect-src` on a _cached_ page would be a fine way to exfiltrate from
a page nobody thinks about.

---

## 2. Dependencies

`npm audit` reports three high-severity advisories. Both packages are
transitive dependencies of Next 15, and **no Next 15 release clears either** —
the only upgrade path is a major version, which would move the product off the
stack it is specified on.

Neither was accepted on that basis alone. Each was traced to whether it is
reachable.

### `sharp` — CVE-2026-33327, -33328, -35590, -35591 (libvips)

Reachable from exactly one place: the `/_next/image` optimiser, which exists to
serve `next/image`. **This product imports `next/image` nowhere** — every
graphic is an inline SVG or a PWA icon served straight from `public/`.

Three layers now, rather than an argument:

1. `images.unoptimized` in `next.config.mjs` turns the route off.
2. `postbuild` runs `ops/prune-runtime.mjs`, which **deletes `sharp` and its
   `@img` libvips binaries from `.next/standalone`**. The container ships
   without them.
3. `ops/check-bundle.mjs` fails the build if either reappears.

"Present but unreachable" is a claim about configuration, and configuration
changes. **Absent** is a property of the artefact, and a scanner pointed at the
running container finds nothing rather than finding something and being argued
with.

### `postcss` — GHSA-qx2v-qp2m-jg93 and three sourceMappingURL advisories

**Build-time only.** PostCSS runs during `next build`, over this repository's
own CSS. The XSS advisory requires attacker-controlled CSS content; the
path-traversal ones require an attacker-controlled `sourceMappingURL` comment
in a stylesheet being processed. Neither is a position an attacker can reach
without already being able to commit to the repository — at which point the
CSS pipeline is not the interesting problem.

It does not ship: no PostCSS runs at runtime on the box.

**Verdict:** assessed, not exploitable in this deployment, no action.
Re-evaluate on any Next upgrade — the advisory list is checked in CI by
`npm audit` and the conclusion above should be re-derived, not inherited.

---

## 3. Row Level Security

### The finding

Every module's integration tests proved _its_ tables isolated _its_ users.
Six phases of that is thorough and has one blind spot that matters more than
anything it catches: **a table nobody wrote a test for.** PostgREST exposes
everything in `public`, so a `create table` that ships without a policy is
readable by any signed-in user on the box from the moment it exists — and the
reviewer of that migration was looking at the columns.

### The fix

`tests/integration/coverage.test.ts` asks the catalogue rather than asking a
test author to remember. Over all 22 tables:

- Row level security is enabled on every one.
- Every table with RLS on has at least one policy — RLS with no policy denies
  everything, which is safe but is almost always a half-finished migration.
- **Every policy names the current user.** A policy of `using (true)` is RLS
  that is switched on and does nothing.
- The retired placeholder tables are in `archive`, out of the API surface.

There is an `INTENTIONALLY_SHARED` list, currently empty. It exists so that
adding a shared table is a decision somebody writes down with a reason, rather
than the absence of a policy.

### `security definer` functions

The same file asserts that **every** `security definer` function in `public`
pins a `search_path`. One without it is the classic Postgres privilege
escalation: the caller creates a table or an operator in a schema earlier on
their own path, and the function resolves to theirs while running as the owner.
All of them do; there is also an assertion that the query finds some, so the
check cannot pass by returning nothing.

---

## 4. Tokens and encryption at rest

Reviewed, no change required. Recorded so the next review knows what was
looked at:

- **OAuth tokens and mail bodies** are field-encrypted before they reach
  Postgres (`DASHBOARD_ENCRYPTION_KEYS`), so a `pg_dump` or a stolen backup
  does not hand over the mailbox. The Full caching policy refuses to run
  without a key, rather than degrading quietly to plaintext.
- **The digest cron token** is compared length-safely, and an unset token
  **closes** the token path rather than opening it. "No token configured means
  no auth required" is not a failure mode to leave lying around, even on a
  private tailnet.
- **The service-role key** is server-only and never prefixed `NEXT_PUBLIC_`.
- **Local backups are unencrypted on a BitLocker volume; only the off-site copy
  is `age`-encrypted.** That is deliberate — a restore drill that needs a key
  kept off the box is a drill that never runs — and it makes BitLocker the
  encryption-at-rest control for copies 1 and 2. It remains
  [an item only you can do](../PLAN.md).

---

## 5. Exposure

Unchanged from Phase 0 and re-verified in CI on every push:

- Nothing binds `0.0.0.0`. The ops job asserts this against the **resolved**
  compose config, after variable substitution, not just the source file.
- Caddy is the only listener, on the tailnet address, with `admin off`,
  `auto_https off` and `strict_sni_host`.
- Certificates come from `tailscale cert` — a real Let's Encrypt certificate
  via Tailscale's DNS, with nothing published to the internet. ACME cannot run
  here, by design.
- Access logs drop query strings, `Authorization`, `Cookie` and `apikey`.
  Request URIs carry search terms, and from P2 those can contain fragments of
  mail.
- New in P7: `xr-spatial-tracking=(self)` is listed explicitly rather than left
  to a browser default. See [`docs/vr.md`](vr.md).

---

## 6. What was not done

- **No external penetration test.** This is a self-review by the person who
  wrote the code, which finds the things above and is structurally bad at
  finding the things nobody thought of.
- **No fuzzing** of the quick-add parser or the Markdown vault serializer, both
  of which take free text. Neither crosses a privilege boundary; both are worth
  fuzzing if this ever becomes multi-user.
- **No review of the mail provider adapters against live providers**, because
  none is connected yet.
- **The threat model still assumes a single trusted user.** Teammate mode is
  post-v1, and it changes the analysis substantially — RLS moves from "belt and
  braces around one person's data" to the actual control.

---

## Verifying

```bash
npm run check:csp      # nonce, no violations, hydration, against a prod build
npm run check:bundle   # includes the sharp-is-absent assertion
npm audit              # three advisories, both packages assessed above
DATABASE_URL=… npm run test:integration   # RLS coverage, retention, isolation
```
