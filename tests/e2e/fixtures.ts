import { test as base, expect, type Page } from "@playwright/test";

/**
 * Shared fixtures.
 *
 * Every spec starts from an empty task list. The reset endpoint only exists
 * in memory mode, so this cannot touch anything real — and if the server was
 * started without it, the assertion below says so instead of the specs
 * failing in a hundred confusing ways.
 */
export const test = base.extend<{ emptyTaskList: void }>({
  emptyTaskList: [
    async ({ page }, use) => {
      const response = await page.request.post("/api/e2e/reset");
      expect(
        response.ok(),
        "the e2e reset endpoint should exist — is DASHBOARD_DATA_MODE=memory set?",
      ).toBe(true);

      await use();
    },
    { auto: true },
  ],
});

export { expect };

/** Capture a task through the quick-add box, the way the owner would. */
export async function quickAdd(page: Page, text: string): Promise<void> {
  const input = page.getByTestId("quick-add-input");
  await input.click();
  await input.fill(text);
  await input.press("Enter");
  await expect(input).toHaveValue("");
}

export function taskRow(page: Page, title: string) {
  return page.getByTestId("task-row").filter({ hasText: title });
}
