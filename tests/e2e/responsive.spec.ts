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
