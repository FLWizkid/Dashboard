# Performance budget

What is measured, what the limits are, and why they are those numbers.

---

## What is measured

**First-load JavaScript per route, uncompressed, from the build manifest.**

Not a synthetic score. This product is opened dozens of times a day on a
laptop, a phone and a headset browser, over a tailnet that is sometimes a hotel
wifi away — and the thing that decides whether it feels instant is how much
JavaScript has to arrive and parse before the page is usable.

`ops/check-bundle.mjs` reads `.next/app-build-manifest.json`, sums the real
size on disk of every chunk each route loads, and **fails the build** when a
budget is exceeded. It reads the artefact rather than scraping `next build`'s
output table, so the budget does not break when Next changes its formatting.

```bash
npm run check:bundle            # enforce
node ops/check-bundle.mjs --report   # just print the table
```

Uncompressed rather than gzipped, deliberately: gzip flatters a bundle by
about 3×, and the number that decides parse time on a phone is the
uncompressed one.

---

## The budgets

| Budget                | Limit   | What it catches                       |
| --------------------- | ------- | ------------------------------------- |
| Shared baseline       | 360 kB  | Something heavy added to a provider   |
| Heaviest single route | 570 kB  | One page quietly becoming the problem |
| Three heaviest routes | 1600 kB | "Each one only grew a little"         |
| `/login` (cold start) | 400 kB  | The first page anyone loads           |

`/login` has its own budget because it is the cold-start cost of the whole
product and the only page an unauthenticated visitor can reach.

These are the measured sizes at the time the budget was introduced, rounded up
to leave a little room. That is the point: a budget taken from an article is a
number nobody can defend, and one set far above today's size never fires.
**They are set to catch the next regression, not to describe an aspiration.**

Raising one is allowed. Raising one without saying why in the commit message is
how a budget quietly becomes decoration.

---

## Where it stands

| Route                 | First load |    Own |
| --------------------- | ---------: | -----: |
| `/dashboard/tasks`    |     544 kB | 201 kB |
| `/dashboard/hours`    |     503 kB | 160 kB |
| `/dashboard`          |     502 kB | 160 kB |
| `/dashboard/kanban`   |     481 kB | 139 kB |
| `/dashboard/notes`    |     477 kB | 134 kB |
| `/dashboard/pomodoro` |     473 kB | 130 kB |
| `/dashboard/inbox`    |     466 kB | 124 kB |
| `/dashboard/reports`  |     426 kB |  84 kB |
| `/login`              |     377 kB |  35 kB |
| `/offline`            |     344 kB |   1 kB |
| Shared by every route |     343 kB |        |

---

## The two changes that got it there

### Framer Motion, loaded as features rather than as a library

**−77 kB on every dashboard route.**

The full `motion` export drags every animation feature into the first-load
bundle of any route that animates anything: gestures, layout projection, drag,
SVG path morphing. This product uses opacity, small translations and
`AnimatePresence`. `domAnimation` is the subset that covers exactly that.

`<LazyMotion features={domAnimation} strict>` is mounted once in
`src/components/providers.tsx`, and every `motion.div` became `m.div`.

The `strict` flag is the part that keeps it honest: with it, `motion.div`
**throws at runtime**, so only `m.div` works. Without it, one import of
`motion` in a new component silently pulls the whole library back in and the
saving disappears with nothing to show for it. The budget would eventually
notice; a thrown error in development notices immediately.

### The Supabase browser client, imported on demand

**−241 kB on `/login`, which went from 618 kB to 377 kB.**

It is the single largest thing in the client bundle, and the sign-in page is
the _only_ place that needs it — everything behind the dashboard authenticates
on the server and talks to its own API routes. Imported at module scope, it
made the first page anyone loads by far the heaviest one, to run code that does
nothing until a form is submitted.

The import is now dynamic, and warmed on `focus` anywhere in the form: by the
time someone has finished typing a password, the chunk arrived long ago. The
`await` in the submit handler is the fallback — correct even if the warm-up
never ran, just slower.

---

## What is deliberately not optimised

**The dashboard routes still carry the whole shell.** Nav, providers, query
client and toasts are loaded on every one of them, because moving between
modules is the common action and a lazily-loaded shell would cost a spinner on
every navigation to save bytes on one.

**No route-level code splitting inside modules.** The heaviest module-specific
chunk is 201 kB uncompressed (~60 kB over the wire). Splitting it would trade a
measurable amount of complexity for an unmeasurable amount of speed on a LAN.

**No image optimisation, at all.** Not a performance decision — see
[`docs/security-review.md` § Dependencies](security-review.md#2-dependencies).
Every graphic in the product is an inline SVG or a PWA icon, so there is
nothing for an optimiser to do.

---

## What this does not measure

Stated plainly, because a budget that implies more than it checks is worse than
none:

- **Runtime performance.** Nothing here measures render time, interaction
  latency or scroll smoothness. A route could stay well inside its budget and
  still stutter on a long task list.
- **Server response time.** Every dashboard route is server-rendered per
  request and hits Postgres. That path is untimed.
- **Real network conditions.** The numbers are bytes on disk. What a phone on a
  distant tailnet actually experiences includes TLS setup, latency and the
  headset browser's own overhead.

The first of those is the most likely to matter first, and the honest place to
start is a real day's data on the box rather than a synthetic list.
