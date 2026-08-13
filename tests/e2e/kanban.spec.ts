import { expect, quickAdd, test } from "./fixtures";

test.describe("the board", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  });

  test("captures land in Inbox", async ({ page }) => {
    await quickAdd(page, "Review the vendor SOW");

    await page.goto("/dashboard/kanban");

    const inbox = page.getByTestId("lane-inbox");
    await expect(inbox).toContainText("Review the vendor SOW");
    // And nowhere else.
    await expect(page.getByTestId("lane-ready")).not.toContainText(
      "Review the vendor SOW",
    );
  });

  test("an incomplete card cannot be promoted, and says what it needs", async ({
    page,
  }) => {
    await quickAdd(page, "Half-formed idea");
    await page.goto("/dashboard/kanban");

    const card = page
      .getByTestId("kanban-card")
      .filter({ hasText: "Half-formed idea" });

    await expect(card).toContainText("Needs priority and due date");
    // No promote button while it is short of the Ready minimum.
    await expect(
      card.getByRole("button", { name: "Promote to Ready" }),
    ).toHaveCount(0);

    // Moving it with the keyboard is refused, with the reason shown.
    await card.click();
    await page.keyboard.press("ArrowRight");

    await expect(page.getByText("Can't move to Ready")).toBeVisible();
    await expect(page.getByTestId("lane-inbox")).toContainText(
      "Half-formed idea",
    );
  });

  test("a complete card promotes in one click", async ({ page }) => {
    await quickAdd(page, "Draft the board deck !high tomorrow");
    await page.goto("/dashboard/kanban");

    const card = page
      .getByTestId("kanban-card")
      .filter({ hasText: "Draft the board deck" });

    await card.getByRole("button", { name: "Promote to Ready" }).click();

    await expect(page.getByTestId("lane-ready")).toContainText(
      "Draft the board deck",
    );
    await expect(page.getByTestId("lane-inbox")).not.toContainText(
      "Draft the board deck",
    );
  });

  test("cards move between lanes with the keyboard alone", async ({ page }) => {
    // Dragging is an enhancement; the keyboard path has to be complete on its
    // own, or the board is unusable with a screen reader and on a phone.
    await quickAdd(page, "Chase the renewal !high tomorrow");
    await page.goto("/dashboard/kanban");

    // Scoped to the lane: while a card moves, the outgoing copy is briefly
    // still in the DOM animating out, so an unscoped locator matches twice.
    const cardIn = (lane: string) =>
      page
        .getByTestId(`lane-${lane}`)
        .getByTestId("kanban-card")
        .filter({ hasText: "Chase the renewal" });

    await cardIn("inbox").click();
    await page.keyboard.press("ArrowRight");
    await expect(cardIn("ready")).toBeVisible();
    await expect(cardIn("inbox")).toHaveCount(0);

    await cardIn("ready").click();
    await page.keyboard.press("ArrowRight");
    await expect(cardIn("in_progress")).toBeVisible();

    await cardIn("in_progress").click();
    await page.keyboard.press("ArrowLeft");
    await expect(cardIn("ready")).toBeVisible();
  });

  test("a lane move shows up on the task list", async ({ page }) => {
    // The board is a view of tasks.status, not a separate record.
    await quickAdd(page, "Cross-check me !high tomorrow");
    await page.goto("/dashboard/kanban");

    await page
      .getByTestId("kanban-card")
      .filter({ hasText: "Cross-check me" })
      .getByRole("button", { name: "Promote to Ready" })
      .click();
    await expect(page.getByTestId("lane-ready")).toContainText(
      "Cross-check me",
    );

    await page.goto("/dashboard/tasks");
    const row = page
      .getByTestId("task-row")
      .filter({ hasText: "Cross-check me" });
    await row.getByRole("button", { name: /Show details/ }).click();
    await expect(row.getByLabel("Status")).toHaveValue("ready");
  });

  test("the board shows all five lanes, in order", async ({ page }) => {
    await page.goto("/dashboard/kanban");

    const headings = page.getByRole("heading", { level: 2 });
    await expect(headings).toHaveText([
      "Inbox",
      "Ready",
      "In progress",
      "Waiting",
      "Done",
    ]);
  });

  test("an empty lane says so", async ({ page }) => {
    await page.goto("/dashboard/kanban");
    await expect(page.getByTestId("lane-inbox")).toContainText(
      "Everything you capture lands here",
    );
  });
});
