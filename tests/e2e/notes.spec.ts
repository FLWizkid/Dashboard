import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

/**
 * The notes module, end to end.
 *
 * The two behaviours worth protecting are the ones that look like bugs until
 * you know why they are there: a decision note **saves without its rationale**,
 * and a wiki-link to a page that does not exist yet **is a valid link**. Both
 * are deliberate, and both are the kind of thing a later refactor would
 * "fix" without a test standing in the way.
 */

async function capture(page: Page, title: string) {
  const input = page.getByTestId("note-capture");
  await input.fill(title);
  await input.press("Enter");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(title);
}

test.describe("notes", () => {
  test("captures a note with one field and opens it", async ({ page }) => {
    await page.goto("/dashboard/notes");
    await capture(page, "Vendor renewal");

    await expect(page.getByTestId("note-list-item")).toHaveCount(1);
    await expect(page.getByTestId("note-list")).toContainText("Vendor renewal");
  });

  test("decision and rationale are both first-class fields", async ({
    page,
  }) => {
    await page.goto("/dashboard/notes");
    await capture(page, "Move to self-hosted Supabase");

    await page.getByLabel("Kind", { exact: true }).selectOption("decision");

    // Both anchors exist as labelled fields of their own. Not a title and a
    // body; not a field and an optional note.
    await expect(page.getByLabel("Decision", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Why", { exact: true })).toBeVisible();
  });

  test("a decision saves without its reasoning, and says what is missing", async ({
    page,
  }) => {
    await page.goto("/dashboard/notes");
    await capture(page, "Retire the legacy VPN");

    await page.getByLabel("Kind", { exact: true }).selectOption("decision");
    await page
      .getByLabel("Decision", { exact: true })
      .fill("We retire it at the end of Q3.");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // Saved — not refused. Losing the decision because the reasoning isn't
    // written yet would be the worse failure.
    await expect(page.getByText("Saved")).toBeVisible();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "This decision is incomplete" }),
    ).toContainText("still needs the reasoning");

    // And the gap is visible from the list, so you don't have to open each
    // note to find the ones that need finishing.
    await expect(page.getByTestId("note-list")).toContainText("Incomplete");
  });

  test("filling in the reasoning clears the incomplete marker", async ({
    page,
  }) => {
    await page.goto("/dashboard/notes");
    await capture(page, "Adopt Tailscale for remote access");

    await page.getByLabel("Kind", { exact: true }).selectOption("decision");
    await page
      .getByLabel("Decision", { exact: true })
      .fill("Tailscale, not a public ingress.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTestId("note-list")).toContainText("Incomplete");

    await page
      .getByLabel("Why")
      .fill("Nothing is exposed publicly, and the ACLs are auditable.");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(page.getByTestId("note-list")).not.toContainText("Incomplete");
  });

  test("a wiki-link to a page that doesn't exist is allowed, and resolves later", async ({
    page,
  }) => {
    await page.goto("/dashboard/notes");
    await capture(page, "Q3 planning");

    await page
      .getByLabel("Notes", { exact: true })
      .fill("Superseded by [[Q4 planning]], which does not exist yet.");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // Rendered as an unresolved link rather than rejected.
    await expect(page.getByTestId("outbound-links")).toContainText(
      "Q4 planning",
    );
    await expect(page.getByTestId("outbound-links")).toContainText(
      "not written yet",
    );

    // Writing the page it names resolves the link — the same thing Obsidian
    // does the moment the file appears.
    await capture(page, "Q4 planning");
    await expect(page.getByTestId("backlinks")).toContainText("Q3 planning", {
      timeout: 10_000,
    });
  });

  test("the backlinks pane shows the line the link appears on", async ({
    page,
  }) => {
    await page.goto("/dashboard/notes");
    await capture(page, "Vendor consolidation");

    await capture(page, "Renewal decision");
    await page
      .getByLabel("Notes", { exact: true })
      .fill("Part of [[Vendor consolidation]] — three contracts become one.");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await page
      .getByTestId("note-list-item")
      .filter({ hasText: "Vendor consolidation" })
      .click();

    await expect(page.getByTestId("backlinks")).toContainText(
      "three contracts become one",
    );
  });

  test("typing [[ offers the notes that exist", async ({ page }) => {
    await page.goto("/dashboard/notes");
    await capture(page, "Security review");
    await capture(page, "Working note");

    const body = page.getByLabel("Notes", { exact: true });
    await body.click();
    await body.pressSequentially("See [[Sec");

    const suggestions = page.getByTestId("wiki-suggestions");
    await expect(suggestions).toBeVisible();
    await expect(suggestions).toContainText("Security review");

    await body.press("Enter");
    await expect(body).toHaveValue("See [[Security review]]");
  });

  test("search narrows the list", async ({ page }) => {
    await page.goto("/dashboard/notes");
    await capture(page, "Board pack for October");
    await capture(page, "Hiring plan");

    await page.getByLabel("Search notes").fill("Hiring");

    await expect(page.getByTestId("note-list-item")).toHaveCount(1, {
      timeout: 10_000,
    });
    await expect(page.getByTestId("note-list")).toContainText("Hiring plan");
  });
});
