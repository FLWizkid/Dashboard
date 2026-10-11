import { expect, test } from "./fixtures";

/**
 * The dashboard's own furniture.
 *
 * The cards on this page are covered by the suites that own them — hours,
 * priority, mail. What is left is the page itself: the things that are here
 * because this is the screen you land on.
 */

test.describe("the dashboard header", () => {
  test("puts the AI Tools link within reach without scrolling", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    const link = page.getByTestId("quick-link-ai-tools");
    await expect(link).toBeVisible();

    // In the viewport at rest, not merely present in the DOM. "Somewhere I
    // can get to it easily" is a claim about the first screenful, and a link
    // that needs a scroll to reach quietly fails it while still passing a
    // visibility check.
    const box = await link.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(box!.y).toBeLessThan(viewport!.height);
  });

  test("goes where it says, in a new tab, without handing over this one", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    const link = page.getByTestId("quick-link-ai-tools");

    await expect(link).toHaveAttribute(
      "href",
      "https://academy.techpresso.co/free-tools",
    );
    await expect(link).toHaveAttribute("target", "_blank");

    // `noopener` is the one that matters: without it the opened page gets a
    // handle on this tab through `window.opener` and can navigate it
    // somewhere else. Pinned rather than trusted, because it is invisible
    // when absent — the link works perfectly either way.
    const rel = (await link.getAttribute("rel")) ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
  });

  test("says that it leaves, for someone who cannot see the icon", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    // The icon carries this visually. A new tab opening unannounced is
    // disorienting for a screen-reader user, who then presses Back and finds
    // it does nothing.
    await expect(page.getByTestId("quick-link-ai-tools")).toContainText(
      "opens in a new tab",
    );
  });
});
