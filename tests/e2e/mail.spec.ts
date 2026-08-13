import { expect, test } from "./fixtures";

/**
 * Email and calendar.
 *
 * The rules being protected, in the order they matter:
 *
 *   1. **The caching policy is a rule, not a label.** An account set to
 *      Metadata must never show a body, and must say why rather than
 *      rendering an empty pane that looks like an empty email.
 *   2. **One list, every account.** The unified inbox is the module's reason
 *      to exist.
 *   3. **Importance is the owner's judgement**, and applies to mail already
 *      received — not only to what arrives next.
 */

test.describe("the unified inbox", () => {
  test("shows threads from every connected account in one list", async ({
    page,
  }) => {
    await page.goto("/dashboard/email");

    const rows = page.getByTestId("thread-row");
    await expect(rows.filter({ hasText: "doug@theonefor.ai" })).not.toHaveCount(
      0,
    );
    await expect(rows.filter({ hasText: "doug@proton.me" })).not.toHaveCount(0);
  });

  test("puts a critical sender above newer ordinary mail", async ({ page }) => {
    // "The board chair wrote three hours ago" outranks "a newsletter arrived a
    // minute ago", which is the whole reason the list is not purely by time.
    await page.goto("/dashboard/email");

    const first = page.getByTestId("thread-row").first();
    await expect(first).toContainText("Priya Raman");
  });

  test("filters to unread", async ({ page }) => {
    await page.goto("/dashboard/email");
    await page.getByRole("button", { name: "Unread" }).click();

    await expect(page.getByTestId("thread-row")).not.toHaveCount(0);
    // The reply the owner sent is read, so its thread's sent message should
    // not be what identifies the row.
    await expect(page.getByTestId("thread-row").first()).toBeVisible();
  });

  test("searches by subject", async ({ page }) => {
    await page.goto("/dashboard/email");
    await page.getByLabel("Search mail").fill("Okta");

    await expect(page.getByTestId("thread-row")).toHaveCount(1);
    await expect(page.getByTestId("thread-row")).toContainText("Okta renewal");
  });

  test("says so plainly when nothing matches", async ({ page }) => {
    await page.goto("/dashboard/email");
    await page.getByLabel("Search mail").fill("zzzzz-no-such-thing");

    await expect(page.getByTestId("mail-empty")).toBeVisible();
  });
});

test.describe("reading a thread", () => {
  test("shows every message, oldest first", async ({ page }) => {
    await page.goto("/dashboard/email");
    await page
      .getByTestId("thread-row")
      .filter({ hasText: "Board pack" })
      .click();

    const messages = page.getByTestId("thread-message");
    await expect(messages).toHaveCount(2);
    await expect(messages.first()).toContainText("Priya Raman");
  });

  test("shows the body under the Full policy", async ({ page }) => {
    await page.goto("/dashboard/email");
    await page
      .getByTestId("thread-row")
      .filter({ hasText: "Board pack" })
      .click();

    await expect(page.getByTestId("thread-pane")).toContainText(
      "review the security section",
    );
  });

  test("refuses a body under the Metadata policy, and says why", async ({
    page,
  }) => {
    // The rule this whole suite exists for. An empty pane would look like an
    // empty email; this has to be a sentence.
    await page.goto("/dashboard/email");
    await page
      .getByTestId("thread-row")
      .filter({ hasText: "insurance renewal" })
      .click();

    const withheld = page.getByTestId("body-withheld");
    await expect(withheld).toBeVisible();
    await expect(withheld).toContainText("metadata only");
  });

  test("marks the thread read when it is opened", async ({ page }) => {
    await page.goto("/dashboard/email");

    const row = page
      .getByTestId("thread-row")
      .filter({ hasText: "Okta renewal" });
    await row.click();

    await expect(page.getByTestId("thread-pane")).toBeVisible();

    // Unread rows are bold; once read, the sender is no longer emphasised.
    await page.getByRole("button", { name: "Unread" }).click();
    await expect(
      page.getByTestId("thread-row").filter({ hasText: "Okta renewal" }),
    ).toHaveCount(0);
  });
});

test.describe("rating a sender", () => {
  test("applies to mail already received", async ({ page }) => {
    // Marking someone important and then seeing this morning's message still
    // ranked normal would make the setting look broken.
    await page.goto("/dashboard/email");
    await page
      .getByTestId("thread-row")
      .filter({ hasText: "Okta renewal" })
      .click();

    await page
      .getByTestId("thread-pane")
      .getByRole("button", { name: "Critical" })
      .click();

    await expect(
      page.getByTestId("thread-row").filter({ hasText: "Okta renewal" }),
    ).toContainText("Critical");
  });
});

test.describe("the calendar", () => {
  test("shows today as a list", async ({ page }) => {
    await page.goto("/dashboard/calendar");

    await expect(page.getByTestId("agenda-event")).not.toHaveCount(0);
    await expect(page.getByTestId("agenda")).toContainText("Board prep");
  });

  test("hides a meeting you declined", async ({ page }) => {
    // A declined meeting is not on your day, and the hours module derives
    // scheduled time from this list.
    await page.goto("/dashboard/calendar");

    await expect(page.getByTestId("agenda")).not.toContainText("All-hands");
  });

  test("marks an external meeting", async ({ page }) => {
    await page.goto("/dashboard/calendar");

    await expect(
      page.getByTestId("agenda-event").filter({ hasText: "Board prep" }),
    ).toContainText("External");
  });

  test("moves to another day and back", async ({ page }) => {
    await page.goto("/dashboard/calendar");
    await page.getByRole("button", { name: "Next" }).click();

    await expect(page.getByTestId("calendar-empty")).toBeVisible();

    await page.getByRole("button", { name: "Today" }).click();
    await expect(page.getByTestId("agenda")).toBeVisible();
  });
});

test.describe("the dashboard cards", () => {
  test("today's meetings is live", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByTestId("todays-meetings")).toContainText(
      "Board prep",
    );
  });

  test("needs attention lists only important senders", async ({ page }) => {
    // Not "unread", which on a real mailbox is a number in the hundreds.
    await page.goto("/dashboard");

    const card = page.getByTestId("needs-attention");
    await expect(card).toContainText("Priya Raman");
    await expect(card).not.toContainText("Vendor Sales");
  });
});
