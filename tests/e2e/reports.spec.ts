import { expect, quickAdd, test } from "./fixtures";

/**
 * Reports and digests, end to end.
 *
 * The gate is "interactive + print reports correct; a scheduled brief is
 * generated and delivered". The print half is checked by emulating print
 * media and asserting what actually disappears and what survives — a
 * screenshot comparison would pass with the navigation printed on page one.
 */

test.describe("the report workspace", () => {
  test("shows the three sections in the specified order", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Overdue thing !high yesterday");
    await quickAdd(page, "Soon thing !normal tomorrow");

    await page.goto("/dashboard/reports");

    // Scoped to `section > h2`: card titles are also level-2 headings, so an
    // unscoped nth(0) picks up the filter panel.
    const headings = page.locator("section > h2");
    await expect(headings.nth(0)).toHaveText("Executive summary");
    await expect(headings.nth(1)).toHaveText("Prioritised tasks");
    await expect(headings.nth(2)).toHaveText("The next two days");
  });

  test("counts what is open and overdue", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Late one !high yesterday");
    await quickAdd(page, "Another late one !normal yesterday");

    await page.goto("/dashboard/reports");

    await expect(page.getByTestId("report-stat-overdue")).toHaveText("2", {
      timeout: 10_000,
    });
    await expect(page.getByTestId("report-stat-open")).toHaveText("2");
  });

  test("says '—' rather than a confident zero for what it cannot see", async ({
    page,
  }) => {
    await page.goto("/dashboard/reports");

    await expect(page.getByTestId("report-stat-critical-unread")).toHaveText(
      "—",
      { timeout: 10_000 },
    );
    await expect(page.getByText("no mail account connected")).toBeVisible();
  });

  test("shows every group, including the empty ones", async ({ page }) => {
    // An absent "Overdue" heading and an empty one mean opposite things.
    await page.goto("/dashboard/reports");

    const groups = page.getByTestId("report-groups");
    for (const label of ["Overdue", "Due soon", "Current", "Upcoming"]) {
      // The heading carries a count beside the label, so match on the start.
      await expect(
        groups.getByRole("heading", { name: new RegExp(`^${label}`) }),
      ).toBeVisible();
    }
  });

  test("filters narrow the list but never the summary", async ({ page }) => {
    // A headline figure that changes when you change a dropdown is a headline
    // figure nobody can quote.
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Alpha report item !high yesterday");
    await quickAdd(page, "Beta report item !low yesterday");

    await page.goto("/dashboard/reports");
    await expect(page.getByTestId("report-stat-overdue")).toHaveText("2", {
      timeout: 10_000,
    });

    await page.getByLabel("Search").fill("Alpha");

    // The list narrows…
    await expect(page.getByTestId("report-groups")).not.toContainText("Beta", {
      timeout: 10_000,
    });
    // …and the summary does not.
    await expect(page.getByTestId("report-stat-overdue")).toHaveText("2");
    await expect(page.getByText(/hidden by these filters/)).toBeVisible();
  });

  test("filtering to nothing says so rather than looking broken", async ({
    page,
  }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Only task");

    await page.goto("/dashboard/reports");
    await page.getByLabel("Search").fill("nothing matches this");

    await expect(page.getByTestId("report-groups")).toContainText(
      "Nothing here.",
      { timeout: 10_000 },
    );
  });
});

test.describe("print", () => {
  test("drops the controls and keeps the report", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Printable task !high yesterday");

    await page.goto("/dashboard/reports");
    await expect(page.getByTestId("report-groups")).toBeVisible();

    await page.emulateMedia({ media: "print" });

    // Navigation, filters and buttons go.
    await expect(
      page.getByRole("navigation", { name: "Modules" }),
    ).toBeHidden();
    await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
    await expect(page.getByLabel("Search")).toBeHidden();

    // The report itself stays, all three sections.
    await expect(
      page.getByRole("heading", { name: "Executive summary" }),
    ).toBeVisible();
    await expect(page.getByTestId("report-groups")).toBeVisible();
    await expect(page.getByTestId("report-two-day")).toBeVisible();
    await expect(page.getByText("Printable task").first()).toBeVisible();
  });

  test("flattens the palette to ink on paper", async ({ page }) => {
    await page.goto("/dashboard/reports");
    await page.emulateMedia({ media: "print" });

    // A printer has no dark mode, and the forest/brass tokens turn to mud in
    // greyscale.
    const background = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(background).toBe("rgb(255, 255, 255)");
  });

  test("shows a generated-at stamp only on paper", async ({ page }) => {
    await page.goto("/dashboard/reports");

    await expect(page.getByText(/^Generated /)).toBeHidden();

    await page.emulateMedia({ media: "print" });
    await expect(page.getByText(/^Generated /)).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe("digests", () => {
  test("generates a brief on demand and delivers it to the inbox", async ({
    page,
  }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Something for the brief !high yesterday");

    await page.goto("/dashboard/inbox");
    await expect(page.getByText("Nothing delivered yet.")).toBeVisible();

    await page.getByRole("button", { name: /Generate today's brief/ }).click();

    await expect(page.getByTestId("inbox-item")).toHaveCount(1, {
      timeout: 15_000,
    });
    await expect(page.getByTestId("inbox-list")).toContainText("Morning brief");
  });

  test("the brief contains the summary the report shows", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Overdue for the brief !high yesterday");

    await page.goto("/dashboard/inbox");
    await page.getByRole("button", { name: /Generate today's brief/ }).click();
    await expect(page.getByTestId("inbox-item")).toHaveCount(1, {
      timeout: 15_000,
    });

    await page.getByTestId("inbox-item").first().click();

    const body = page.getByTestId("inbox-body");
    await expect(body).toContainText("SUMMARY");
    await expect(body).toContainText("Overdue");
    // The nullable fields say why rather than printing zero.
    await expect(body).toContainText("no mail account connected");
  });

  test("does not send the same brief twice", async ({ page }) => {
    await page.goto("/dashboard/inbox");

    await page.getByRole("button", { name: /Generate today's brief/ }).click();
    await expect(page.getByTestId("inbox-item")).toHaveCount(1, {
      timeout: 15_000,
    });

    // A cron firing twice, or a restart mid-schedule, must be uneventful.
    await page.getByRole("button", { name: /Generate today's brief/ }).click();
    await expect(page.getByText("Already sent").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("inbox-item")).toHaveCount(1);
  });

  test("opening a brief marks it read", async ({ page }) => {
    await page.goto("/dashboard/inbox");
    await page.getByRole("button", { name: /Generate today's brief/ }).click();
    await expect(page.getByTestId("inbox-item")).toHaveCount(1, {
      timeout: 15_000,
    });

    await expect(page.getByText("(unread)")).toBeAttached();

    await page.getByTestId("inbox-item").first().click();
    await expect(page.getByRole("button", { name: "Mark unread" })).toBeVisible(
      {
        timeout: 10_000,
      },
    );
  });
});
