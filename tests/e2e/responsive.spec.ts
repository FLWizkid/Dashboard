import { expect, quickAdd, taskRow, test } from "./fixtures";

/**
 * Phone-sized checks. This project runs on a Pixel 7 viewport — the shell
 * swaps the sidebar for a bottom bar there, and capture has to stay just as
 * fast with a thumb as with a keyboard.
 */
test.describe("on a phone", () => {
  test("the bottom navigation replaces the sidebar", async ({ page }) => {
    await page.goto("/dashboard");

    const nav = page.getByRole("navigation", { name: "Modules" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: "Tasks" })).toBeVisible();

    await nav.getByRole("link", { name: "Tasks" }).click();
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  });

  test("capture and complete work at phone width", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Sign the PO on the train");

    const row = taskRow(page, "Sign the PO on the train");
    await expect(row).toBeVisible();

    await row.getByRole("checkbox", { name: /^Complete / }).click();
    await expect(page.getByText("Task completed")).toBeVisible();
  });

  test("nothing scrolls sideways", async ({ page }) => {
    await page.goto("/dashboard");
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("every module is reachable on a phone", () => {
  test("the bottom bar leads to the ones it has no room for", async ({
    page,
  }) => {
    // The bar fits four modules. Without a way to the other six, a phone is
    // running half the product — which is what this suite exists to catch.
    await page.goto("/dashboard");

    await page.getByRole("button", { name: "More" }).click();
    // Scoped to the sheet: the dashboard's attention card links to Email too.
    const sheet = page.locator("#mobile-more");
    await sheet.getByRole("link", { name: "Email" }).click();

    await expect(
      page.getByRole("heading", { name: "Email", level: 1 }),
    ).toBeVisible();
  });

  test("the sheet closes once you have gone somewhere", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "More" }).click();
    await page
      .locator("#mobile-more")
      .getByRole("link", { name: "Calendar" })
      .click();

    await expect(page.locator("#mobile-more")).toHaveCount(0);
  });
});

test.describe("email on a phone", () => {
  test("is a list, then a thread — not both stacked", async ({ page }) => {
    await page.goto("/dashboard/email");
    await expect(page.getByTestId("thread-list")).toBeVisible();
    await expect(page.getByTestId("thread-pane")).toBeHidden();

    await page.getByTestId("thread-row").first().click();

    await expect(page.getByTestId("thread-pane")).toBeVisible();
    await expect(page.getByTestId("thread-list")).toBeHidden();
  });

  test("has a way back to the list", async ({ page }) => {
    await page.goto("/dashboard/email");
    await page.getByTestId("thread-row").first().click();
    await expect(page.getByTestId("thread-pane")).toBeVisible();

    await page.getByRole("button", { name: "All mail" }).click();
    await expect(page.getByTestId("thread-list")).toBeVisible();
  });

  test("the agenda does not scroll sideways", async ({ page }) => {
    await page.goto("/dashboard/calendar");
    await expect(page.getByTestId("agenda")).toBeVisible();

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
