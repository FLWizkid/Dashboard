import { expect, test } from "./fixtures";

/**
 * The hours module, end to end.
 *
 * The spec that matters most is the last one: log time with the network cut,
 * bring it back, and watch the entry arrive. That is the specification's
 * offline requirement stated as a test rather than as a promise, and it is
 * the reason the outbox exists at all.
 */

test.describe("hours", () => {
  test("the three sources are shown separately and combined", async ({
    page,
  }) => {
    await page.goto("/dashboard/hours");

    await expect(page.getByRole("heading", { name: "Hours" })).toBeVisible();

    // All four figures render, even at zero — an empty week is a legitimate
    // answer and blanking the cards would read as a loading failure.
    for (const source of ["focused", "scheduled", "manual"]) {
      await expect(page.getByTestId(`hours-${source}`)).toBeVisible();
    }
    await expect(page.getByTestId("hours-combined")).toBeVisible();
  });

  test("quick-log records time and it lands in the manual total", async ({
    page,
  }) => {
    await page.goto("/dashboard/hours");

    await expect(page.getByTestId("hours-manual")).toHaveText("0m");

    await page
      .getByTestId("quick-log")
      .getByRole("button", { name: "30m", exact: true })
      .first()
      .click();

    await expect(page.getByText("30m logged")).toBeVisible();
    await expect(page.getByTestId("hours-manual")).toHaveText("30m", {
      timeout: 10_000,
    });

    // The combined figure counts it too — nothing else is running, so the
    // union of one interval is that interval.
    await expect(page.getByTestId("hours-combined")).toHaveText("30m");
  });

  test("the dashboard card and the hours view agree", async ({ page }) => {
    await page.goto("/dashboard/hours");
    await page
      .getByTestId("quick-log")
      .getByRole("button", { name: "1h", exact: true })
      .first()
      .click();
    await expect(page.getByTestId("hours-combined")).toHaveText("1h", {
      timeout: 10_000,
    });

    await page.goto("/dashboard");
    await expect(page.getByTestId("dashboard-hours-combined")).toHaveText(
      "1h",
      { timeout: 10_000 },
    );
  });

  test("logging while the browser is offline is confirmed, not refused", async ({
    page,
    context,
  }) => {
    await page.goto("/dashboard/hours");
    await expect(page.getByTestId("hours-manual")).toHaveText("0m");

    // Cut the network the way a lift or a basement does: the page is already
    // loaded, and the next request is the one that fails.
    await context.setOffline(true);

    await page
      .getByTestId("quick-log")
      .getByRole("button", { name: "45m", exact: true })
      .first()
      .click();

    // The confirmation is immediate, and honest about where the entry is.
    await expect(page.getByText("45m logged")).toBeVisible();
    await expect(page.getByTestId("outbox-banner")).toContainText(
      "waiting to sync",
    );

    await context.setOffline(false);

    // Coming back online triggers a flush; the owner does nothing.
    await expect(page.getByTestId("outbox-banner")).toBeHidden({
      timeout: 20_000,
    });
    await expect(page.getByTestId("hours-manual")).toHaveText("45m", {
      timeout: 20_000,
    });
  });

  test("a queued entry survives a reload and syncs afterwards", async ({
    page,
  }) => {
    // The send is blocked at the route rather than by taking the whole context
    // offline, because a genuinely offline context can't reload the page
    // either — and durability across a reload is the thing being tested.
    let blocked = true;
    await page.route("**/api/hours", async (route) => {
      if (route.request().method() === "POST" && blocked) {
        await route.abort("connectionfailed");
        return;
      }
      await route.continue();
    });

    await page.goto("/dashboard/hours");
    await page
      .getByTestId("quick-log")
      .getByRole("button", { name: "45m", exact: true })
      .first()
      .click();

    await expect(page.getByTestId("outbox-banner")).toContainText(
      "waiting to sync",
    );

    // Still queued after a reload — this is the part a localStorage-backed
    // queue that only lives in React state gets wrong.
    await page.reload();
    await expect(page.getByTestId("outbox-banner")).toContainText(
      "waiting to sync",
      { timeout: 15_000 },
    );

    blocked = false;

    await expect(page.getByTestId("hours-manual")).toHaveText("45m", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("outbox-banner")).toBeHidden();
  });

  test("a flush that is retried does not log the time twice", async ({
    page,
  }) => {
    await page.goto("/dashboard/hours");

    // Let the write reach the server, then kill the response. The client never
    // learns it succeeded, so it retries — and the client key is what stops
    // the retry becoming a second hour.
    let dropped = false;
    await page.route("**/api/hours", async (route) => {
      if (route.request().method() !== "POST" || dropped) {
        await route.continue();
        return;
      }
      dropped = true;
      const response = await route.fetch();
      await response.body();
      await route.abort("connectionaborted");
    });

    await page
      .getByTestId("quick-log")
      .getByRole("button", { name: "15m", exact: true })
      .first()
      .click();

    await expect(page.getByTestId("hours-manual")).toHaveText("15m", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("outbox-banner")).toBeHidden({
      timeout: 20_000,
    });

    // Not 30m. The second attempt was answered with the row that already
    // existed rather than inserting another.
    await expect(page.getByTestId("hours-manual")).toHaveText("15m");
  });
});

test.describe("pomodoro", () => {
  test("starts, shows the running state, and follows you across modules", async ({
    page,
  }) => {
    await page.goto("/dashboard/pomodoro");

    await expect(page.getByTestId("pomodoro-status")).toContainText("Ready");
    await expect(page.getByTestId("pomodoro-remaining")).toHaveText("25:00");

    await page.getByRole("button", { name: /Start focus/ }).click();
    await expect(page.getByTestId("pomodoro-status")).toContainText("Running");

    // The indicator is deliberately absent on the Pomodoro page itself.
    await expect(page.getByTestId("focus-indicator")).toBeHidden();

    await page.goto("/dashboard/tasks");
    await expect(page.getByTestId("focus-indicator")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("space starts and pauses without touching the mouse", async ({
    page,
  }) => {
    await page.goto("/dashboard/pomodoro");

    // The Start button being enabled is the signal that the stored state has
    // been read back. Before that the timer deliberately ignores input rather
    // than accepting a start it is about to overwrite.
    await expect(
      page.getByRole("button", { name: /Start focus/ }),
    ).toBeEnabled();

    await page.locator("body").press("Space");
    await expect(page.getByTestId("pomodoro-status")).toContainText("Running");

    await page.locator("body").press("Space");
    await expect(page.getByTestId("pomodoro-status")).toContainText("Paused");
  });

  test("a running session is picked up again after a reload", async ({
    page,
  }) => {
    await page.goto("/dashboard/pomodoro");
    await page.getByRole("button", { name: /Start focus/ }).click();
    await expect(page.getByTestId("pomodoro-status")).toContainText("Running");

    await page.reload();

    // The machine holds instants, so the remaining time is recomputed rather
    // than restarted — a reload costs nothing.
    await expect(page.getByTestId("pomodoro-status")).toContainText("Running", {
      timeout: 10_000,
    });
  });
});
