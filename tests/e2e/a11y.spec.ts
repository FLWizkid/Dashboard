import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, quickAdd, test } from "./fixtures";

/**
 * Accessibility scans.
 *
 * WCAG 2.1 AA, which is the standard the design system's palette was built
 * against — these scans are what stop it drifting. Violations fail the build
 * with the offending selector, not a warning nobody reads.
 */
async function scan(page: Page) {
  return new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
}

function describeViolations(results: Awaited<ReturnType<typeof scan>>): string {
  return results.violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n` +
        violation.nodes.map((node) => `    ${node.target}`).join("\n"),
    )
    .join("\n");
}

test.describe("accessibility", () => {
  test("the dashboard has no WCAG A/AA violations", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: "Today", exact: true }),
    ).toBeVisible();

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("the task list has no WCAG A/AA violations", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Draft the board deck !high friday 3pm #strategic");
    await quickAdd(page, "Untriaged capture");

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("an expanded task's edit panel has no violations", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Review the SOC2 gap");

    await page
      .getByTestId("task-row")
      .getByRole("button", { name: /Show details/ })
      .click();
    await expect(page.getByLabel("Notes")).toBeVisible();

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("the quick-add suggestions and link prompt have no violations", async ({
    page,
  }) => {
    await page.goto("/dashboard/tasks");
    const input = page.getByTestId("quick-add-input");
    await input.click();
    await input.fill("Draft slides !high friday prep for the Q3 board review");
    await expect(page.getByTestId("event-link-confirm")).toBeVisible();

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("the shortcut dialog has no violations", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await page.getByRole("button", { name: /Shortcuts/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("the sign-in page has no violations", async ({ page }) => {
    await page.goto("/login");
    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("nothing depends on animation — reduced motion still works", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/dashboard/tasks");

    await quickAdd(page, "Motion-free capture");
    const row = page.getByTestId("task-row").filter({ hasText: "Motion-free" });
    await expect(row).toBeVisible();

    await row.getByRole("checkbox", { name: /^Complete / }).click();
    await expect(page.getByText("Task completed")).toBeVisible();

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("the whole capture flow is reachable by keyboard alone", async ({
    page,
  }) => {
    await page.goto("/dashboard/tasks");

    // Tab from the top of the document until the quick-add box has focus.
    const input = page.getByTestId("quick-add-input");
    for (
      let i = 0;
      i < 25 && !(await input.evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press("Tab");
    }
    await expect(input).toBeFocused();

    await page.keyboard.type("Keyboard-only capture");
    await page.keyboard.press("Enter");

    await expect(
      page.getByTestId("task-row").filter({ hasText: "Keyboard-only capture" }),
    ).toBeVisible();
  });
});
