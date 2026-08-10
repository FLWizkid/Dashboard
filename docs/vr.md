# The headset view

What works today, what a machine can check, and what still needs a real
headset on a real head.

---

## 1. What "flat-in-headset" means

The dashboard runs in the headset's **2D browser**, as a floating window. There
is no 3D scene, no immersive session, and no WebXR code in the product. That is
the specification's Phase 7 target; an immersive layer is post-v1.

So the interesting question is not "does it render in VR" — it is a web page,
it renders. It is whether it is _usable_ there, and the ways a page becomes
unusable in a headset have almost nothing to do with 3D:

| What changes                | Consequence                                          |
| --------------------------- | ---------------------------------------------------- |
| The window is a panel       | Short, often narrow, at a viewport nothing else uses |
| Text is read through lenses | Small type stops resolving, well above 10px          |
| Pointing is a raycast       | Far less precise than a mouse; small targets missed  |
| **There is no hover**       | A control that only appears on hover does not exist  |
| Typing is uncomfortable     | Anything that needs a lot of typing will not be used |

## 2. What is checked automatically

`tests/e2e/headset.spec.ts`, run in the ordinary E2E suite:

- **Three headset-shaped viewports** — 1024×640, 720×800, 1600×700 — with a
  full capture flow at each, and no horizontal overflow at any of them.
  Horizontal scroll is worse here than on a phone: there is no swipe, so
  reaching cut-off content means dragging a scrollbar with a raycast.
- **No visible text below 12px.** This found and fixed one real offender: the
  keycap component rendered shortcut hints at 11px.
- **No interactive target smaller than 24×24.** Screen-reader affordances that
  are clipped until focused are excluded — they expand to full size when they
  are the thing being pointed at.
- **Every primary control is visible without hovering.**
- **The seam is unobstructed**: `xr-spatial-tracking` is not denied by
  Permissions-Policy, a WebGL context can be created, and the app runs
  top-level rather than framed.

> **None of that involves a headset.** It is a browser at headset dimensions,
> which catches layout and legibility problems and nothing else. Comfort,
> readability through actual optics, and controller ergonomics cannot be
> tested this way, and the checklist in § 4 is not optional because these pass.

## 3. Keeping the seam clean

Three things would make an immersive layer a rewrite rather than an addition.
None of them is true today, and each has something pinning it:

**A denied `xr-spatial-tracking`.** Permissions-Policy now lists
`xr-spatial-tracking=(self)` explicitly rather than relying on the browser
default, because a later tightening pass that added it to the deny list would
make `navigator.xr` unavailable no matter what was built on top — and the
failure would only ever surface in a headset, months later, with nothing in the
code to point at. `ops/lib/caddy.test.mts` fails if it disappears.

**Rendering coupled to the DOM.** It is not: every module's logic is a pure
function over the data model — grouping, scoring, aggregation, digest
composition — with React only rendering the result. An immersive view is
another renderer over the same functions, not a second implementation of them.
This is the same seam that lets the report, the print page and the emailed
digest all come from one `buildReport()`.

**A framed or non-secure context.** An immersive session can only be entered
from a top-level, secure context. The product is served over TLS on a single
origin and refuses to be framed (`frame-ancestors 'none'`), so it already
qualifies. A future "embed the dashboard in something" change would quietly
end that, which is why there is a test for it.

## 4. The manual checklist

**This is the part that actually verifies the headset view.** Run it on the
box, in the headset, signed in.

Nothing below has been done — I have no headset. Record the date and the
device when you do it.

### Layout and reading

- [ ] Open the dashboard in the headset browser. Sign in.
- [ ] Read the task list at a comfortable window distance **without leaning
      in**. Anything you have to move towards is too small.
- [ ] Resize the window narrow, then wide. Check nothing scrolls sideways at
      either extreme.
- [ ] Check the sidebar and the bottom bar do not both appear, and that the one
      you get suits the window shape.
- [ ] Dark mode as well as light: the palette was tuned on a monitor, and
      headset optics wash out low-contrast greys more than a screen does.

### Pointing and input

- [ ] Complete a task with the checkbox using a controller raycast, first try.
- [ ] Open and close a task's detail panel.
- [ ] Move a Kanban card between lanes — by drag if it works, and by arrow keys
      if it does not.
- [ ] Type a capture with the virtual keyboard. Note how painful it is; if it
      is bad enough, the parser hints matter more than they do on a laptop.
- [ ] Try the Pomodoro start/stop controls, which are the most likely thing to
      be used mid-session with hands busy.

### The things a test cannot see

- [ ] Any motion that induces discomfort. The product animates opacity and
      small translations only, which should be fine — confirm it.
- [ ] Text shimmer or fringing on the forest/brass palette through the lenses.
- [ ] Whether the print view is even reachable (headset browsers vary in
      whether they expose a print dialog at all).
- [ ] Whether the PWA can be installed, and whether the installed window
      behaves differently from a browser tab.

### Record it

| Date | Device | Browser | Result | Notes |
| ---- | ------ | ------- | ------ | ----- |
|      |        |         |        |       |

## 5. When the immersive layer arrives

Not now, and deliberately not started — but the shape it should take, so the
decision is not re-litigated from scratch:

- **A separate route**, entered by an explicit action, never automatically.
  Nobody wants a dashboard that hijacks their view.
- **The same data hooks.** If the immersive view needs its own fetching, the
  seam was not clean and the fix belongs in the shared layer, not in the new
  one.
- **Flat panels first.** Rendering the existing views as textured quads in
  space is most of the value; a bespoke spatial layout is a product decision
  that should follow evidence of use, not precede it.
- **The flat view stays.** It is the one that works on a laptop, a phone and in
  a headset browser, and it is what most days will use.

---

## Related

- [`docs/testing.md`](testing.md) — how the three test tiers run
- [`docs/threat-model.md`](threat-model.md) — headers, and why they are set where they are
