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

  test("the board has no WCAG A/AA violations", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Board card !high tomorrow");
    await quickAdd(page, "Untriaged card");

    await page.goto("/dashboard/kanban");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("a board card announces how to move it", async ({ page }) => {
    // The instruction lives on the card, not in a shortcuts sheet, so it is
    // discoverable by keyboard users and announced by screen readers.
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Announce me");
    await page.goto("/dashboard/kanban");

    await expect(
      page.getByLabel(/Announce me\. In Inbox\. Use left and right arrow keys/),
    ).toBeVisible();
  });

  test("the hours view has no WCAG A/AA violations", async ({ page }) => {
    await page.goto("/dashboard/hours");
    await expect(page.getByRole("heading", { name: "Hours" })).toBeVisible();

    // Log something first: the empty view exercises far less of the markup
    // than the one with a populated ledger and an outbox banner.
    await page
      .getByTestId("quick-log")
      .getByRole("button", { name: "30m", exact: true })
      .first()
      .click();
    await expect(page.getByTestId("hours-manual")).toHaveText("30m", {
      timeout: 10_000,
    });

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("the rule editor has no violations", async ({ page }) => {
    await page.goto("/dashboard/hours");

    await page.getByLabel("Field to match").selectOption("title");
    await page.getByLabel("When the").fill("board");
    await page.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByTestId("rule-list")).toContainText("board");

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("the Pomodoro timer has no violations, running or idle", async ({
    page,
  }) => {
    await page.goto("/dashboard/pomodoro");
    expect(describeViolations(await scan(page))).toBe("");

    await page.getByRole("button", { name: /Start focus/ }).click();
    await expect(page.getByTestId("pomodoro-status")).toContainText("Running");
    expect(describeViolations(await scan(page))).toBe("");
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
