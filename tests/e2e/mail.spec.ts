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

    // The rows identify their account by short name rather than by full
    // address: every one of these addresses starts with "doug", so the local
    // part carries nothing, and at this column width the address truncates
    // from the right — which is where the part that distinguishes them lives.
    // The full address is still shown, in the reading pane, where there is
    // room for it and where it matters because that is what you reply from.
    const rows = page.getByTestId("thread-row");
    await expect(rows.filter({ hasText: "theonefor" })).not.toHaveCount(0);
    await expect(rows.filter({ hasText: "encountive" })).not.toHaveCount(0);
    await expect(rows.filter({ hasText: "proton" })).not.toHaveCount(0);
  });

  test("names the full account on the thread you are about to reply from", async ({
    page,
  }) => {
    // The short name is enough to scan a list by and not enough to send from.
    // Three mailboxes belonging to one person is exactly the setup where
    // replying from the wrong identity is easy and embarrassing.
    await page.goto("/dashboard/email");
    await page.getByTestId("thread-row").first().click();

    await expect(page.getByTestId("thread-account")).toContainText("@");
  });

  test("narrows to one account and back", async ({ page }) => {
    await page.goto("/dashboard/email");

    const rows = page.getByTestId("thread-row");
    await expect(rows.filter({ hasText: "encountive" })).not.toHaveCount(0);

    await page.getByTestId("account-filter-acc-proton").click();
    await expect(rows.filter({ hasText: "encountive" })).toHaveCount(0);
    await expect(rows.filter({ hasText: "proton" })).not.toHaveCount(0);

    await page.getByTestId("account-filter-all").click();
    await expect(rows.filter({ hasText: "encountive" })).not.toHaveCount(0);
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

    // Assert on the call, not only on the list. The row-count assertion below
    // is satisfied by *any* state in which the row is absent — including the
    // filter simply not having rendered results yet — so this test once
    // stayed green while the mark-read request 400ed on every open.
    const markRead = page.waitForResponse("**/api/mail/messages/read");
    await row.click();
    expect((await markRead).status()).toBe(204);

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

  test("the next two days card is on the dashboard", async ({ page }) => {
    // The header has promised "your next two days" since P1 while the rollup
    // lived only in reports. This is the assertion that keeps the promise
    // honest — a card that exists rather than a sentence about one.
    await page.goto("/dashboard");

    await expect(page.getByTestId("next-two-days")).toBeVisible();
  });
});

test.describe("the two-day calendar", () => {
  test("shows meetings and what is due together", async ({ page }) => {
    await page.goto("/dashboard/calendar");
    await page.getByRole("button", { name: "Two days", exact: true }).click();

    const agenda = page.getByTestId("two-day-agenda");
    await expect(agenda).toBeVisible();
    await expect(agenda.getByTestId("two-day-event").first()).toBeVisible();
  });

  test("a task due today appears beside the meetings", async ({ page }) => {
    // The whole reason for this view: a deadline and a meeting compete for
    // the same two days, and seeing them apart is how one of them is missed.
    const dueToday = new Date();
    dueToday.setHours(17, 0, 0, 0);

    const created = await page.request.post("/api/tasks", {
      data: { title: "Sign the renewal", dueAt: dueToday.toISOString() },
    });
    expect(created.ok()).toBe(true);

    await page.goto("/dashboard/calendar");
    await page.getByRole("button", { name: "Two days", exact: true }).click();

    await expect(page.getByTestId("two-day-agenda")).toContainText(
      "Sign the renewal",
    );
  });
});
