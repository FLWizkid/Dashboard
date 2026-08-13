import { expect, test } from "./fixtures";

/**
 * Offline capture, end to end.
 *
 * The claim under test is the blunt one: **a task typed without a connection
 * is not lost.** Everything here takes the network away for real —
 * `context.setOffline(true)` — rather than mocking a failed fetch, because
 * the failure being defended against is the browser's, not the server's.
 */

test.describe("capturing without a connection", () => {
  test("keeps the task on the device and says so", async ({
    page,
    context,
  }) => {
    await page.goto("/dashboard/tasks");

    await context.setOffline(true);

    const input = page.getByTestId("quick-add-input");
    await input.click();
    await input.fill("Thought I had in a lift");
    await input.press("Enter");

    // The reassurance matters as much as the storage. Someone who is not told
    // their capture was kept will type it again, and *that* duplicate no
    // idempotency key can prevent — it is genuinely a second capture.
    await expect(page.getByTestId("pending-captures")).toContainText(
      "1 task saved on this device",
    );
    await expect(page.getByTestId("pending-captures")).toContainText(
      "Thought I had in a lift",
    );

    await context.setOffline(false);
  });

  test("sends it when the connection comes back, exactly once", async ({
    page,
    context,
  }) => {
    await page.goto("/dashboard/tasks");
    await context.setOffline(true);

    const input = page.getByTestId("quick-add-input");
    await input.click();
    await input.fill("Reconnect and send me");
    await input.press("Enter");

    await expect(page.getByTestId("pending-capture-count")).toBeVisible();

    await context.setOffline(false);
    // The `online` event is what the queue listens for. Playwright's
    // setOffline does fire it, but nudging visibility covers the case where
    // the tab was backgrounded when the network returned.
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    await expect(
      page.getByTestId("task-row").filter({ hasText: "Reconnect and send me" }),
    ).toHaveCount(1);

    // The banner goes only once the server has confirmed it.
    await expect(page.getByTestId("pending-captures")).toHaveCount(0);
  });

  test("survives the tab being destroyed", async ({ page, context }) => {
    // IndexedDB, not React state. A queue that lives in memory protects you
    // from a flaky network and from nothing else — and a phone killing a
    // backgrounded tab is the more likely of the two.
    //
    // The reload happens *after* the network is back, because reloading while
    // offline lands on the cached offline page rather than the task list.
    // What is being tested is that the capture outlived the page, and a
    // memory-only queue would have died with it either way.
    await page.goto("/dashboard/tasks");
    await context.setOffline(true);

    const input = page.getByTestId("quick-add-input");
    await input.click();
    await input.fill("Survive a reload");
    await input.press("Enter");

    await expect(page.getByTestId("pending-capture-count")).toBeVisible();

    await context.setOffline(false);
    await page.reload();

    await expect(
      page.getByTestId("task-row").filter({ hasText: "Survive a reload" }),
    ).toHaveCount(1);
  });

  test("does not double-count when the queue flushes twice", async ({
    page,
    context,
  }) => {
    await page.goto("/dashboard/tasks");
    await context.setOffline(true);

    const input = page.getByTestId("quick-add-input");
    await input.click();
    await input.fill("Only one of me");
    await input.press("Enter");

    await expect(page.getByTestId("pending-capture-count")).toBeVisible();

    await context.setOffline(false);

    // Two flushes racing is exactly what a reconnect plus a visibility change
    // produces. The client key is what makes the second one a no-op.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await expect(
      page.getByTestId("task-row").filter({ hasText: "Only one of me" }),
    ).toHaveCount(1);

    // And it stays one after a reload, which is where a duplicate would
    // otherwise show up.
    await page.reload();
    await expect(
      page.getByTestId("task-row").filter({ hasText: "Only one of me" }),
    ).toHaveCount(1);
  });

  test("captures several and keeps them in the order they were typed", async ({
    page,
    context,
  }) => {
    await page.goto("/dashboard/tasks");
    await context.setOffline(true);

    const input = page.getByTestId("quick-add-input");
    for (const title of ["First offline", "Second offline", "Third offline"]) {
      await input.click();
      await input.fill(title);
      await input.press("Enter");
    }

    const pending = page.getByTestId("pending-captures");
    await expect(pending).toContainText("3 tasks saved on this device");

    const listed = await pending.locator("li").allInnerTexts();
    expect(listed).toEqual([
      "First offline",
      "Second offline",
      "Third offline",
    ]);

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    await expect(page.getByTestId("pending-captures")).toHaveCount(0);
    for (const title of ["First offline", "Second offline", "Third offline"]) {
      await expect(
        page.getByTestId("task-row").filter({ hasText: title }),
      ).toHaveCount(1);
    }
  });

  test("the online path is untouched — no queue, no banner", async ({
    page,
  }) => {
    // Routing every capture through the queue would make the common case
    // inherit the failure modes of the rare one. Online captures go straight
    // to the server and never appear here.
    await page.goto("/dashboard/tasks");

    const input = page.getByTestId("quick-add-input");
    await input.click();
    await input.fill("Ordinary online capture");
    await input.press("Enter");

    await expect(
      page
        .getByTestId("task-row")
        .filter({ hasText: "Ordinary online capture" }),
    ).toBeVisible();

    await expect(page.getByTestId("pending-captures")).toHaveCount(0);
  });
});

/*
 * The service worker is deliberately **not** tested here.
 *
 * It only registers when `NODE_ENV === "production"` — in development it would
 * serve stale chunks and make every change look like it had not applied — and
 * this suite runs against `next dev`, because that is the only mode in which
 * the in-memory repository is allowed to exist.
 *
 * So a service-worker assertion in this file could only ever pass by
 * accident. Installability, registration, and serving `/offline` with the
 * network off are checked against a real production build by
 * `ops/check-pwa.mjs`.
 */
