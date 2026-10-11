import { expect, quickAdd, taskRow, test } from "./fixtures";

test.describe("capturing and clearing tasks", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  });

  test("add → edit → complete → undo", async ({ page }) => {
    /* ── Add ────────────────────────────────────────────────────────── */
    await quickAdd(page, "Draft the board deck");

    const row = taskRow(page, "Draft the board deck");
    await expect(row).toBeVisible();

    // Captured with no priority and no due date, so it is not Ready yet and
    // says exactly what it is missing.
    await expect(row.getByText("Needs priority and due date")).toBeVisible();
    await expect(row.getByText("Untriaged")).toBeVisible();

    /* ── Edit ───────────────────────────────────────────────────────── */
    await row.getByRole("button", { name: /Show details/ }).click();

    await row.getByLabel("Priority").selectOption("high");
    await expect(row.getByLabel("Priority")).toHaveValue("high");

    await row.getByLabel("Due").fill("2026-12-01T17:00");
    // With title, priority and due date all present the badge clears.
    await expect(row.getByText(/^Needs /)).toHaveCount(0);

    await row.getByLabel("Title").fill("Draft the Q4 board deck");
    await row.getByLabel("Title").blur();
    await expect(taskRow(page, "Draft the Q4 board deck")).toBeVisible();

    // The title changed, so the original locator no longer matches — re-find
    // the row, then collapse it so the summary badges are the only match.
    const renamed = taskRow(page, "Draft the Q4 board deck");
    await renamed.getByRole("button", { name: /Hide details/ }).click();
    // The panel animates out, so wait for its controls to leave the DOM
    // before asserting on the summary badge.
    await expect(renamed.getByLabel("Priority")).toHaveCount(0);
    await expect(renamed.getByText("High")).toBeVisible();

    /* ── Complete ───────────────────────────────────────────────────── */
    const updated = taskRow(page, "Draft the Q4 board deck");
    await updated.getByRole("checkbox", { name: /^Complete / }).click();

    await expect(page.getByText("Task completed")).toBeVisible();

    // Under the Open filter the completed row leaves the list straight away.
    await expect(taskRow(page, "Draft the Q4 board deck")).toHaveCount(0);

    /* ── Undo ───────────────────────────────────────────────────────── */
    await page.getByRole("button", { name: "Undo" }).click();

    await expect(taskRow(page, "Draft the Q4 board deck")).toBeVisible();
    await expect(
      page
        .getByTestId("task-row")
        .getByRole("checkbox", { name: /^Complete Draft the Q4 board deck/ }),
    ).toBeVisible();
  });

  test("undo also works from the keyboard", async ({ page }) => {
    await quickAdd(page, "Approve the renewal");

    const row = taskRow(page, "Approve the renewal");
    await row.getByRole("checkbox", { name: /^Complete / }).click();
    await expect(page.getByText("Task completed")).toBeVisible();

    await page.keyboard.press("u");
    await expect(taskRow(page, "Approve the renewal")).toBeVisible();
  });

  test("the parser fills in what it can, and every part is editable", async ({
    page,
  }) => {
    const input = page.getByTestId("quick-add-input");
    await input.click();
    await input.fill("Draft board deck !high #strategic");

    // Suggestions appear as chips before anything is saved.
    await expect(
      page.getByRole("button", { name: /Edit priority \(High\)/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Edit category \(Strategic\)/ }),
    ).toBeVisible();

    // Clearing a suggestion removes it and does not come back.
    await page.getByRole("button", { name: "Clear category" }).click();
    await expect(
      page.getByRole("button", { name: /Edit category/ }),
    ).toHaveCount(0);

    await input.press("Enter");

    const row = taskRow(page, "Draft board deck");
    await expect(row.getByText("High")).toBeVisible();
    await expect(row.getByText("Strategic")).toHaveCount(0);
  });

  test("an event reference is never linked without confirmation", async ({
    page,
  }) => {
    const input = page.getByTestId("quick-add-input");
    await input.click();
    await input.fill("Draft slides prep for the Q3 board review");

    const confirm = page.getByTestId("event-link-confirm");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("Q3 board review");

    // Add without answering: no link is created.
    await input.press("Enter");

    const row = taskRow(page, "Draft slides");
    await expect(row).toBeVisible();
    await expect(row.getByText(/Prep for: Q3 board review/)).toHaveCount(0);
  });

  test("confirming the suggestion does create the link", async ({ page }) => {
    const input = page.getByTestId("quick-add-input");
    await input.click();
    await input.fill("Write talking points prep for the Q3 board review");

    await page.getByTestId("event-link-confirm-button").click();
    await expect(page.getByText("Will link on add")).toBeVisible();

    await input.press("Enter");

    const row = taskRow(page, "Write talking points");
    await expect(row.getByText(/Prep for: Q3 board review/)).toBeVisible();
  });

  test("pinning lifts a task above higher-priority work", async ({ page }) => {
    await quickAdd(page, "Fix the outage !critical");
    await quickAdd(page, "Read the vendor SOW !low");

    const rows = page.getByTestId("task-row");
    await expect(rows.first()).toContainText("Fix the outage");

    await taskRow(page, "Read the vendor SOW")
      .getByRole("button", { name: /^Pin / })
      .click();

    await expect(rows.first()).toContainText("Read the vendor SOW");
  });

  test("keyboard: N focuses quick-add, J moves, X completes", async ({
    page,
  }) => {
    await quickAdd(page, "First task");
    await quickAdd(page, "Second task");

    // Escape out of the input so the global shortcuts are live.
    await page.getByTestId("quick-add-input").press("Escape");
    await page.locator("body").click();

    await page.keyboard.press("n");
    await expect(page.getByTestId("quick-add-input")).toBeFocused();

    await page.keyboard.press("Escape");
    await page.locator("h1").click();

    await page.keyboard.press("j");
    await page.keyboard.press("x");

    await expect(page.getByText("Task completed")).toBeVisible();
  });

  test("the shortcut sheet opens with ?", async ({ page }) => {
    await page.locator("h1").click();
    await page.keyboard.press("?");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Keyboard shortcuts");

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("filters split open from completed", async ({ page }) => {
    await quickAdd(page, "Still open");
    await quickAdd(page, "Will be done");

    await taskRow(page, "Will be done")
      .getByRole("checkbox", { name: /^Complete / })
      .click();

    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(taskRow(page, "Will be done")).toBeVisible();
    await expect(taskRow(page, "Still open")).toHaveCount(0);

    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByTestId("task-row")).toHaveCount(2);
  });

  test("tasks survive a reload — the app is the system of record", async ({
    page,
  }) => {
    await quickAdd(page, "Persisted task");
    await page.reload();
    await expect(taskRow(page, "Persisted task")).toBeVisible();
  });

  test("an empty list says so", async ({ page }) => {
    await expect(page.getByTestId("tasks-empty")).toBeVisible();
  });
});

test.describe("the dashboard reflects the task list", () => {
  test("top priorities is live and completable", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Brief the CEO !critical");
    await quickAdd(page, "Tidy the backlog !low");

    await page.goto("/dashboard");

    const list = page.getByTestId("top-priorities-list");
    await expect(list).toContainText("Brief the CEO");
    // Manual priority ordering, straight from the comparator.
    await expect(list.getByRole("listitem").first()).toContainText(
      "Brief the CEO",
    );

    await list
      .getByRole("checkbox", { name: /^Complete Brief the CEO/ })
      .click();

    await expect(page.getByText("Task completed")).toBeVisible();
    await expect(list).not.toContainText("Brief the CEO");
  });

  test("every card on the home page is live", async ({ page }) => {
    // These three were placeholders through P2 — the frame was real and the
    // data was not. They are now fed by the mail, calendar and hours modules,
    // and the assertion changed with them rather than being deleted.
    await page.goto("/dashboard");

    await expect(
      // A regex, because the heading uses a typographic apostrophe.
      page.getByRole("heading", { name: /Today.s meetings/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Needs attention" }),
    ).toBeVisible();
    // Hours-this-week moved to the hours page; what the home page owes you
    // now is the ability to log time without going anywhere.
    await expect(
      page.getByRole("heading", { name: "Just finished something?" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Next two days" }),
    ).toBeVisible();

    // Nothing on this page should still be admitting it is unbuilt.
    await expect(page.getByText(/arrives in phase/i)).toHaveCount(0);
  });
});
