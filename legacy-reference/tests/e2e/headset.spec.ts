import { expect, quickAdd, test } from "./fixtures";

/**
 * The flat-in-headset view.
 *
 * The specification asks for the dashboard to be usable on a headset's 2D
 * browser now, and for a future immersive layer to be an addition rather than
 * a rewrite. Only the first half can be tested by a machine, and only
 * partially — **no headset is involved here.** What these specs check is the
 * thing that actually goes wrong in a headset browser, which is not 3D at all:
 *
 *   • The window is a floating panel, not a monitor. It is short, and often
 *     narrower than a laptop, at a viewport size nothing else in the suite
 *     covers.
 *   • Text is read at a simulated distance through lenses. Anything the
 *     browser renders below about 14px is genuinely hard to read.
 *   • Pointing is a raycast from a controller or a pinched hand. It is far
 *     less precise than a mouse, so small targets are missed.
 *   • There is no hover. A control that only reveals itself on hover is a
 *     control that does not exist.
 *
 * `docs/vr.md` records the manual checklist that a real headset still needs,
 * and is explicit that this file is not a substitute for it.
 */

/**
 * Representative headset browser viewports, in CSS pixels.
 *
 * These are window sizes rather than panel resolutions — a headset browser
 * reports a modest CSS viewport at a high device pixel ratio, which is why the
 * numbers look small for a device advertised at 2064×2208 per eye.
 */
const HEADSETS = [
  { name: "Quest browser, default window", width: 1024, height: 640 },
  { name: "Quest browser, narrow panel", width: 720, height: 800 },
  { name: "Quest browser, widened", width: 1600, height: 700 },
];

/** Below this, text is uncomfortable to read through headset optics. */
const MINIMUM_READABLE_PX = 12;

/** A raycast pointer needs a bigger target than a mouse. */
const MINIMUM_TARGET_PX = 24;

for (const headset of HEADSETS) {
  test.describe(headset.name, () => {
    test.use({ viewport: { width: headset.width, height: headset.height } });

    test("nothing scrolls sideways", async ({ page }) => {
      // Horizontal scroll is worse in a headset than on a phone: there is no
      // swipe, so reaching the cut-off content means dragging a scrollbar
      // with a raycast.
      await page.goto("/dashboard/tasks");
      await quickAdd(
        page,
        "A task with a fairly long title to push the layout",
      );

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );

      expect(overflow).toBeLessThanOrEqual(0);
    });

    test("the primary controls are reachable without hovering", async ({
      page,
    }) => {
      // No hover in a headset. Anything that only appears on hover is gone.
      await page.goto("/dashboard/tasks");
      await quickAdd(page, "Reachable without hover");

      await expect(page.getByTestId("quick-add-input")).toBeVisible();

      const row = page.getByTestId("task-row").first();
      await expect(
        row.getByRole("checkbox", { name: /^Complete / }),
      ).toBeVisible();
      await expect(
        row.getByRole("button", { name: /Show details/ }),
      ).toBeVisible();
    });

    test("capture works end to end at this size", async ({ page }) => {
      await page.goto("/dashboard/tasks");
      await quickAdd(page, "Captured in a headset !high tomorrow");

      await expect(
        page
          .getByTestId("task-row")
          .filter({ hasText: "Captured in a headset" }),
      ).toBeVisible();
    });
  });
}

test.describe("headset legibility", () => {
  test.use({ viewport: { width: 1024, height: 640 } });

  test("no visible text is smaller than the readable minimum", async ({
    page,
  }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Legible at arm's length !high tomorrow #strategic");

    const tooSmall = await page.evaluate((minimum) => {
      const offenders: string[] = [];

      for (const element of document.querySelectorAll<HTMLElement>("main *")) {
        // Only elements that render text of their own.
        const ownText = [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent?.trim() ?? "")
          .join("");

        if (!ownText) continue;
        if (element.offsetParent === null) continue;

        const size = Number.parseFloat(getComputedStyle(element).fontSize);
        if (size < minimum) {
          offenders.push(`${size}px — "${ownText.slice(0, 40)}"`);
        }
      }

      return offenders;
    }, MINIMUM_READABLE_PX);

    expect(tooSmall).toEqual([]);
  });

  test("interactive targets are big enough for a raycast", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Big enough to point at");

    // ── Polled, because this is a steady-state property ──────────────────
    //
    // "No interactive target is too small to point at" is a fact about the
    // layout once it has settled, not about every frame on the way there.
    // A single measurement can land mid-flight — a row growing into place is
    // briefly 20px tall, a control inside a layout animation is briefly a
    // fraction under its final size, and an optimistic row being replaced by
    // its confirmed self is collapsing as it goes. Earlier versions of this
    // test chased those one at a time with waits, which is a losing game:
    // each wait fixes the transient it was written for and the next one
    // shows up on a slower machine.
    //
    // Retrying the measurement gets it right by construction. A transient
    // reading clears on the next poll; a genuine violation persists and
    // fails, which is the assertion that was always meant.
    await expect
      .poll(
        async () =>
          page.evaluate((minimum) => {
            const offenders: string[] = [];

            const selector =
              "button, a[href], input, select, textarea, [tabindex]";
            for (const element of document.querySelectorAll<HTMLElement>(
              `main ${selector}`,
            )) {
              const box = element.getBoundingClientRect();
              if (box.width === 0 || box.height === 0) continue;

              // Skip-links and other screen-reader affordances are clipped to
              // nothing until focused, and expand to a full-size control when
              // they are. Measuring them at rest reports the collapsed box and
              // flags a target that is never pointed at in that state.
              if (
                getComputedStyle(element).clip === "rect(0px, 0px, 0px, 0px)"
              ) {
                continue;
              }

              if (box.height < minimum || box.width < minimum) {
                const label =
                  element.getAttribute("aria-label") ??
                  element.textContent?.trim().slice(0, 30) ??
                  element.tagName;
                offenders.push(
                  `${Math.round(box.width)}×${Math.round(box.height)} — ${label}`,
                );
              }
            }

            return offenders;
          }, MINIMUM_TARGET_PX),
        { timeout: 20_000 },
      )
      .toEqual([]);
  });
});

test.describe("the WebXR seam", () => {
  test("nothing on the page blocks an immersive layer being added", async ({
    page,
  }) => {
    // This is a structural check, not a functional one — there is no WebXR
    // code yet and this test does not pretend otherwise. What it pins is that
    // the *conditions* for adding one are still true, because they are the
    // kind of thing a later change breaks silently.
    await page.goto("/dashboard/tasks");

    const findings = await page.evaluate(() => {
      const problems: string[] = [];

      // A Permissions-Policy that denies xr-spatial-tracking would make
      // `navigator.xr` unavailable no matter what was built on top of it.
      // `xr` being absent in a non-headset browser is expected; being
      // *blocked* is not, and the two are distinguishable.
      const policy = (
        document as Document & {
          featurePolicy?: { allowsFeature(f: string): boolean };
        }
      ).featurePolicy;

      if (policy && !policy.allowsFeature("xr-spatial-tracking")) {
        problems.push("xr-spatial-tracking is denied by Permissions-Policy");
      }

      // An immersive session needs a canvas with an XR-compatible WebGL
      // context. Nothing here uses WebGL yet; what matters is that the page
      // is not in a context where one cannot be created.
      const canvas = document.createElement("canvas");
      if (!canvas.getContext("webgl2") && !canvas.getContext("webgl")) {
        problems.push("no WebGL context is available on this page");
      }

      return problems;
    });

    expect(findings).toEqual([]);
  });

  test("the app is a single origin with no framing, which XR requires", async ({
    page,
  }) => {
    // An immersive session can only be entered from a top-level, secure
    // context. The product is already both — worth pinning, because a future
    // "embed the dashboard in something" change would quietly end it.
    await page.goto("/dashboard");

    const topLevel = await page.evaluate(() => window.top === window.self);
    expect(topLevel).toBe(true);
  });
});

test.describe("email and calendar in the headset", () => {
  test.use({ viewport: { width: 1024, height: 640 } });

  test("no text in the inbox is below the readable minimum", async ({
    page,
  }) => {
    // The densest surface in the product: a list row carries a sender, a
    // subject, a snippet, a timestamp and an account line. Density is exactly
    // where a headset build stops being readable at arm's length.
    await page.goto("/dashboard/email");
    await expect(page.getByTestId("thread-row").first()).toBeVisible();

    expect(await textBelow(page, MINIMUM_READABLE_PX)).toEqual([]);
  });

  test("no text in an open thread is below it either", async ({ page }) => {
    await page.goto("/dashboard/email");
    await page.getByTestId("thread-row").first().click();
    await expect(page.getByTestId("thread-pane")).toBeVisible();

    expect(await textBelow(page, MINIMUM_READABLE_PX)).toEqual([]);
  });

  test("the agenda stays readable", async ({ page }) => {
    await page.goto("/dashboard/calendar");
    await expect(page.getByTestId("agenda")).toBeVisible();

    expect(await textBelow(page, MINIMUM_READABLE_PX)).toEqual([]);
  });
});

/** Every visible element whose own text renders below `minimum` px. */
async function textBelow(
  page: import("@playwright/test").Page,
  minimum: number,
): Promise<string[]> {
  return page.evaluate((floor) => {
    const offenders: string[] = [];

    for (const element of document.querySelectorAll<HTMLElement>("main *")) {
      const ownText = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent?.trim() ?? "")
        .join("");

      if (!ownText) continue;
      if (element.offsetParent === null) continue;

      const size = Number.parseFloat(getComputedStyle(element).fontSize);
      if (size < floor) offenders.push(`${size}px — "${ownText.slice(0, 40)}"`);
    }

    return offenders;
  }, minimum);
}
