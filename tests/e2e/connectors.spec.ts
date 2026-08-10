import { expect, quickAdd, taskRow, test } from "./fixtures";

/**
 * External context, end to end.
 *
 * The connector runs against a fixture rather than github.com — see
 * `createFixtureConnector` in `src/lib/connectors/registry.ts`. That is
 * deliberate: a suite that reaches a real provider fails when the provider is
 * slow, when a token expires, and on any machine without an outbound route,
 * none of which is a fact about this product. The *real* URL parser, the real
 * mapping, the real repository invariants and the real interface all run.
 *
 * The fixture derives state from the number in the URL: `/pull/1` is open,
 * `/pull/2` is merged, `/pull/3` is closed.
 */

const PR_OPEN = "https://github.com/acme/api/pull/1";
const PR_MERGED = "https://github.com/acme/api/pull/2";

/** Expand a task row and attach a link to it. */
async function attachToTask(
  page: import("@playwright/test").Page,
  title: string,
  url: string,
) {
  const row = taskRow(page, title);
  await row.getByRole("button", { name: /Show details/ }).click();

  await row.getByRole("button", { name: "Attach a link" }).click();
  await row.getByLabel("Paste a link").fill(url);
  await row.getByRole("button", { name: "Attach", exact: true }).click();
}

test.describe("attaching context to a task", () => {
  test("a pasted link becomes a live reference", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Review the auth migration");

    await attachToTask(page, "Review the auth migration", PR_OPEN);

    const chip = page.getByTestId("ref-chip");
    await expect(chip).toHaveCount(1);
    // The title comes from the provider, not from the URL — proof the
    // reference was actually resolved rather than stored as a bare link.
    await expect(chip).toContainText("Fixture item 1");
    await expect(chip).toContainText("acme/api#1");
  });

  test("shows the state the provider reports", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Ship the release");

    await attachToTask(page, "Ship the release", PR_MERGED);

    // Merged, not "closed" — GitHub reports both as closed and only
    // `merged_at` tells them apart.
    await expect(page.getByTestId("ref-chip")).toContainText("Merged");
  });

  test("the link opens the provider in a new tab", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Open me");
    await attachToTask(page, "Open me", PR_OPEN);

    const anchor = page.getByTestId("ref-chip").getByRole("link");
    await expect(anchor).toHaveAttribute("href", PR_OPEN);
    await expect(anchor).toHaveAttribute("target", "_blank");
    // Without this, the opened page can navigate the opener.
    await expect(anchor).toHaveAttribute("rel", /noopener/);
  });

  test("survives a reload — it is stored, not held in the page", async ({
    page,
  }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Persist me");
    await attachToTask(page, "Persist me", PR_OPEN);
    await expect(page.getByTestId("ref-chip")).toHaveCount(1);

    await page.reload();

    const row = taskRow(page, "Persist me");
    await row.getByRole("button", { name: /Show details/ }).click();
    await expect(page.getByTestId("ref-chip")).toHaveCount(1);
  });

  test("attaching the same link twice leaves one chip", async ({ page }) => {
    // A person double-clicks, or pastes the same address again after
    // scrolling away. Neither should produce two identical rows.
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Only once");
    await attachToTask(page, "Only once", PR_OPEN);
    await expect(page.getByTestId("ref-chip")).toHaveCount(1);

    const row = taskRow(page, "Only once");
    await row.getByRole("button", { name: "Attach a link" }).click();
    await row.getByLabel("Paste a link").fill(PR_OPEN);
    await row.getByRole("button", { name: "Attach", exact: true }).click();

    await expect(page.getByTestId("ref-chip")).toHaveCount(1);
  });

  test("detaching removes it", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Remove the attachment");
    await attachToTask(page, "Remove the attachment", PR_OPEN);
    await expect(page.getByTestId("ref-chip")).toHaveCount(1);

    // Scoped to the chip: the row's expand button's accessible name is the
    // task title plus "Hide details", so a title containing "Detach" would
    // match this too.
    await page
      .getByTestId("ref-chip")
      .getByRole("button", { name: /^Detach / })
      .click();

    await expect(page.getByTestId("ref-chip")).toHaveCount(0);
  });

  test("refuses a link nothing recognises, and says why", async ({ page }) => {
    // The failure has to be legible. "Something went wrong" would leave the
    // owner re-pasting a URL that will never work.
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Bad link");

    const row = taskRow(page, "Bad link");
    await row.getByRole("button", { name: /Show details/ }).click();
    await row.getByRole("button", { name: "Attach a link" }).click();
    await row.getByLabel("Paste a link").fill("https://example.test/nope");
    await row.getByRole("button", { name: "Attach", exact: true }).click();

    await expect(page.getByText("Couldn't attach that")).toBeVisible();
    await expect(page.getByTestId("ref-chip")).toHaveCount(0);
  });

  test("says nothing is attached rather than showing an empty box", async ({
    page,
  }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Nothing attached");

    const row = taskRow(page, "Nothing attached");
    await row.getByRole("button", { name: /Show details/ }).click();

    await expect(
      row.getByText(/Nothing attached\. Paste a link/),
    ).toBeVisible();
  });
});

test.describe("attaching context to a note", () => {
  test("the same panel works on a note", async ({ page }) => {
    await page.goto("/dashboard/notes");

    const capture = page.getByTestId("note-capture");
    await capture.fill("Auth design decisions");
    await capture.press("Enter");
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
      "Auth design decisions",
    );

    await page.getByRole("button", { name: "Attach a link" }).click();
    await page.getByLabel("Paste a link").fill(PR_MERGED);
    await page.getByRole("button", { name: "Attach", exact: true }).click();

    await expect(page.getByTestId("ref-chip")).toContainText("Fixture item 2");
  });
});

test.describe("linked context in the brief", () => {
  test("a merged reference appears in the morning brief", async ({ page }) => {
    // The whole reason to connect anything: not "here is a list of pull
    // requests you linked", but "the one your task was waiting on merged".
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Waiting on the release");
    await attachToTask(page, "Waiting on the release", PR_MERGED);
    await expect(page.getByTestId("ref-chip")).toHaveCount(1);

    await page.goto("/dashboard/inbox");
    await page.getByRole("button", { name: /Generate today's brief/ }).click();
    await expect(page.getByTestId("inbox-item")).toHaveCount(1, {
      timeout: 15_000,
    });

    await page.getByTestId("inbox-item").first().click();

    const body = page.getByTestId("inbox-body");
    await expect(body).toContainText("WHAT MOVED ELSEWHERE");
    await expect(body).toContainText("was merged");
  });

  test("the report shows the same change the brief does", async ({ page }) => {
    // One computation, three renderings — the property the reports module was
    // built around. A connector section that only appeared in email would be
    // a second source of truth.
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Also waiting");
    await attachToTask(page, "Also waiting", PR_MERGED);

    await page.goto("/dashboard/reports");
    await expect(page.getByTestId("report-context")).toContainText(
      "was merged",
    );
  });

  test("says nothing at all when nothing has moved", async ({ page }) => {
    // No heading, no empty box. Unlike the task groups there is no meaningful
    // difference between "nothing moved" and "nothing to move", and an empty
    // section on a box with no connectors reads as a broken integration.
    await page.goto("/dashboard/reports");
    await expect(page.getByTestId("report-context")).toHaveCount(0);
    await expect(page.getByText("What moved elsewhere")).toHaveCount(0);
  });
});
