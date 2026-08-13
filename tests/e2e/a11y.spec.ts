import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, quickAdd, test } from "./fixtures";

/**
 * Accessibility scans.
 *
 * WCAG 2.1 AA, which is the standard the design system's palette was built
 * against — these scans are what stop it drifting. Violations fail the build
 * with the offending selector, not a warning nobody reads.
 */
async function scan(page: Page) {
  return new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
}

function describeViolations(results: Awaited<ReturnType<typeof scan>>): string {
  return results.violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n` +
        violation.nodes.map((node) => `    ${node.target}`).join("\n"),
    )
    .join("\n");
}

test.describe("accessibility", () => {
  test("the dashboard has no WCAG A/AA violations", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: "Today", exact: true }),
    ).toBeVisible();

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("the task list has no WCAG A/AA violations", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Draft the board deck !high friday 3pm #strategic");
    await quickAdd(page, "Untriaged capture");

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("an expanded task's edit panel has no violations", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Review the SOC2 gap");

    await page
      .getByTestId("task-row")
      .getByRole("button", { name: /Show details/ })
      .click();
    await expect(page.getByLabel("Notes")).toBeVisible();

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("the quick-add suggestions and link prompt have no violations", async ({
    page,
  }) => {
    await page.goto("/dashboard/tasks");
    const input = page.getByTestId("quick-add-input");
    await input.click();
    await input.fill("Draft slides !high friday prep for the Q3 board review");
    await expect(page.getByTestId("event-link-confirm")).toBeVisible();

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("the shortcut dialog has no violations", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await page.getByRole("button", { name: /Shortcuts/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("the sign-in page has no violations", async ({ page }) => {
    await page.goto("/login");
    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("nothing depends on animation — reduced motion still works", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/dashboard/tasks");

    await quickAdd(page, "Motion-free capture");
    const row = page.getByTestId("task-row").filter({ hasText: "Motion-free" });
    await expect(row).toBeVisible();

    await row.getByRole("checkbox", { name: /^Complete / }).click();
    await expect(page.getByText("Task completed")).toBeVisible();

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("the board has no WCAG A/AA violations", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Board card !high tomorrow");
    await quickAdd(page, "Untriaged card");

    await page.goto("/dashboard/kanban");
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("a board card announces how to move it", async ({ page }) => {
    // The instruction lives on the card, not in a shortcuts sheet, so it is
    // discoverable by keyboard users and announced by screen readers.
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Announce me");
    await page.goto("/dashboard/kanban");

    await expect(
      page.getByLabel(/Announce me\. In Inbox\. Use left and right arrow keys/),
    ).toBeVisible();
  });

  test("the hours view has no WCAG A/AA violations", async ({ page }) => {
    await page.goto("/dashboard/hours");
    await expect(page.getByRole("heading", { name: "Hours" })).toBeVisible();

    // Log something first: the empty view exercises far less of the markup
    // than the one with a populated ledger and an outbox banner.
    await page
      .getByTestId("quick-log")
      .getByRole("button", { name: "30m", exact: true })
      .first()
      .click();
    await expect(page.getByTestId("hours-manual")).toHaveText("30m", {
      timeout: 10_000,
    });

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("the rule editor has no violations", async ({ page }) => {
    await page.goto("/dashboard/hours");

    await page.getByLabel("Field to match").selectOption("title");
    await page.getByLabel("When the").fill("board");
    await page.getByRole("button", { name: "Add rule" }).click();
    await expect(page.getByTestId("rule-list")).toContainText("board");

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("the Pomodoro timer has no violations, running or idle", async ({
    page,
  }) => {
    await page.goto("/dashboard/pomodoro");
    expect(describeViolations(await scan(page))).toBe("");

    await page.getByRole("button", { name: /Start focus/ }).click();
    await expect(page.getByTestId("pomodoro-status")).toContainText("Running");
    expect(describeViolations(await scan(page))).toBe("");
  });

  test("the notes editor has no WCAG A/AA violations", async ({ page }) => {
    await page.goto("/dashboard/notes");

    const capture = page.getByTestId("note-capture");
    await capture.fill("Vendor renewal decision");
    await capture.press("Enter");
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
      "Vendor renewal decision",
    );

    // As a decision, so the incomplete banner and both anchors are rendered.
    await page.getByLabel("Kind", { exact: true }).selectOption("decision");
    await page
      .getByLabel("Decision", { exact: true })
      .fill("Renew for one year, not three.");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("the wiki-link menu is announced and reachable by keyboard", async ({
    page,
  }) => {
    await page.goto("/dashboard/notes");

    const capture = page.getByTestId("note-capture");
    await capture.fill("Security review");
    await capture.press("Enter");
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
      "Security review",
    );

    const body = page.getByLabel("Notes", { exact: true });
    await body.click();
    await body.pressSequentially("See [[Sec");

    // A completion menu that a screen reader cannot see is a mouse-only
    // feature wearing a keyboard's clothes.
    const menu = page.getByRole("listbox", { name: "Link to a note" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("option").first()).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("the ranking explanation has no WCAG A/AA violations", async ({
    page,
  }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Overdue and important !high yesterday");

    await page.goto("/dashboard");
    const list = page.getByTestId("top-priorities-list");
    await expect(list).toBeVisible();

    // Open the panel: collapsed, it exercises almost none of the markup.
    await list.getByTestId("why-toggle").first().click();
    await expect(page.getByTestId("why-panel").first()).toBeVisible();

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("a suggestion prompt has no violations", async ({ page }) => {
    const reset = await page.request.post("/api/e2e/reset", {
      data: {
        calendar: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            title: "Helios board decision",
            startsAt: new Date(Date.now() + 20 * 3_600_000).toISOString(),
            endsAt: new Date(Date.now() + 21 * 3_600_000).toISOString(),
            attendeeCount: 9,
            isExternal: true,
            isCancelled: false,
            organizerAddress: null,
            isOwnerOrganiser: false,
          },
        ],
      },
    });
    expect(reset.ok()).toBe(true);

    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Helios board pack");

    await page.goto("/dashboard");
    await expect(page.getByTestId("suggestion-prompt").first()).toBeVisible({
      timeout: 10_000,
    });

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("the why-panel toggle announces its state", async ({ page }) => {
    // The panel is the whole "explainable" claim; a screen reader has to be
    // able to tell it is there and whether it is open.
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Announce my reasoning !high tomorrow");

    await page.goto("/dashboard");
    const toggle = page
      .getByTestId("top-priorities-list")
      .getByTestId("why-toggle")
      .first();

    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("the report workspace has no WCAG A/AA violations", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Overdue report row !high yesterday");
    await quickAdd(page, "Upcoming report row !normal next monday");

    await page.goto("/dashboard/reports");
    await expect(page.getByTestId("report-groups")).toBeVisible();
    // With a filter applied, so the "hidden by these filters" status line and
    // the empty-group copy are both in the tree being scanned.
    await page.getByLabel("Search").fill("Overdue report row");
    await expect(page.getByText(/hidden by these filters/)).toBeVisible({
      timeout: 10_000,
    });

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("the printed report has no WCAG A/AA violations", async ({ page }) => {
    // Print is a separate rendering of the same markup: the palette flattens
    // to ink on white and whole regions are removed. Contrast that passes on
    // screen says nothing about contrast on paper, and a heading whose only
    // label was a control that print hides would leave an unlabelled region.
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Printed a11y row !high yesterday");

    await page.goto("/dashboard/reports");
    await expect(page.getByTestId("report-groups")).toBeVisible();

    await page.emulateMedia({ media: "print" });
    await expect(page.getByText(/^Generated /)).toBeVisible({
      timeout: 10_000,
    });

    const results = await scan(page);
    expect(describeViolations(results)).toBe("");
  });

  test("the printed report keeps one first-level heading", async ({ page }) => {
    // On screen the page is titled by the shell's "Reports" heading. Print
    // removes the shell, so the report has to carry its own — otherwise the
    // PDF opens with a level-2 heading and no document title at all.
    await page.goto("/dashboard/reports");
    await page.emulateMedia({ media: "print" });

    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText("Executive report");
  });

  test("the inbox has no WCAG A/AA violations, empty and populated", async ({
    page,
  }) => {
    await page.goto("/dashboard/inbox");
    await expect(page.getByText("Nothing delivered yet.")).toBeVisible();
    expect(describeViolations(await scan(page))).toBe("");

    await page.getByRole("button", { name: /Generate today's brief/ }).click();
    await expect(page.getByTestId("inbox-item")).toHaveCount(1, {
      timeout: 15_000,
    });

    // And with a brief open, which is where the <pre> body renders.
    await page.getByTestId("inbox-item").first().click();
    await expect(page.getByTestId("inbox-body")).toBeVisible();

    expect(describeViolations(await scan(page))).toBe("");
  });

  test("an unread brief is announced, not just coloured", async ({ page }) => {
    // Unread state is a dot. A dot is invisible to a screen reader and to
    // anyone who cannot distinguish it from the row background.
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
    await expect(page.getByText("(unread)")).toHaveCount(0);
  });

  test("the whole capture flow is reachable by keyboard alone", async ({
    page,
  }) => {
    await page.goto("/dashboard/tasks");

    // Tab from the top of the document until the quick-add box has focus.
    const input = page.getByTestId("quick-add-input");
    for (
      let i = 0;
      i < 25 && !(await input.evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press("Tab");
    }
    await expect(input).toBeFocused();

    await page.keyboard.type("Keyboard-only capture");
    await page.keyboard.press("Enter");

    await expect(
      page.getByTestId("task-row").filter({ hasText: "Keyboard-only capture" }),
    ).toBeVisible();
  });
});

/* ── Every module, not just the ones that were easy ───────────────────── */

/**
 * The routes a person can reach, and what has to be on each one before it is
 * fair to scan it. Scanning a skeleton proves nothing — axe is happiest with
 * an empty page.
 */
const MODULES = [
  { path: "/dashboard", ready: "Today" },
  { path: "/dashboard/tasks", ready: "Tasks" },
  { path: "/dashboard/kanban", ready: "Board" },
  { path: "/dashboard/notes", ready: "Notes" },
  { path: "/dashboard/pomodoro", ready: "Pomodoro" },
  { path: "/dashboard/hours", ready: "Hours" },
  { path: "/dashboard/reports", ready: "Reports" },
  { path: "/dashboard/inbox", ready: "Inbox" },
];

test.describe("accessibility, every module", () => {
  /**
   * Before Phase 7 this file scanned whichever surfaces each phase happened to
   * add. That is how a module ends up with three scans of its dialogs and none
   * of the page they open from.
   */
  for (const { path, ready } of MODULES) {
    test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: ready, exact: true }).first(),
      ).toBeVisible();

      expect(describeViolations(await scan(page))).toBe("");
    });

    test(`${path} survives prefers-reduced-motion`, async ({ page }) => {
      // Two failure modes, and only the second is obvious. The loud one is an
      // animation that still moves. The quiet one is content that never
      // arrives, because it was revealed *by* an animation whose duration was
      // collapsed to zero and whose completion callback therefore never fired.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(path);

      await expect(
        page.getByRole("heading", { name: ready, exact: true }).first(),
      ).toBeVisible();

      // Anything mounted with a reveal variant must have landed at full
      // opacity rather than being stuck mid-transition.
      //
      // Scoped to *inline* opacity, because that is what Framer Motion writes
      // and nothing else does. The first version of this read the computed
      // value and failed on every page with a disabled button on it —
      // `disabled:opacity-50` is a deliberate style, not a stalled animation,
      // and a check that cannot tell them apart reports the wrong problem.
      const stalled = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("main [style*='opacity']")]
          .map((element) => Number(element.style.opacity))
          .filter((opacity) => opacity > 0 && opacity < 0.9),
      );
      expect(stalled).toEqual([]);

      expect(describeViolations(await scan(page))).toBe("");
    });
  }

  test("every module is reachable from the keyboard alone", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    const nav = page.getByRole("navigation", { name: "Modules" });
    const links = nav.getByRole("link");

    // Every module in the sidebar must be a real, focusable link. A div with
    // an onClick looks identical until you try to reach it with Tab.
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(MODULES.length);

    for (let index = 0; index < count; index += 1) {
      const link = links.nth(index);
      await link.focus();
      await expect(link).toBeFocused();
      await expect(link).toHaveAttribute("href", /^\/dashboard/);
    }
  });

  test("a board card can actually be moved with the keyboard", async ({
    page,
  }) => {
    // The card advertises "use left and right arrow keys" in its label. This
    // is the test that the advertisement is true — an instruction nobody
    // implemented is worse than no instruction.
    //
    // The card has to be *ready* to move: priority and a due date, or the
    // board refuses to promote it (see the next test). A bare title would
    // fail here for the right reason and look like the wrong one.
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Move me by keyboard !high tomorrow");

    await page.goto("/dashboard/kanban");
    const card = page.getByLabel(/Move me by keyboard\. In Inbox\./);
    await card.focus();
    await page.keyboard.press("ArrowRight");

    await expect(
      page.getByLabel(/Move me by keyboard\. In Inbox\./),
    ).toHaveCount(0);
    await expect(
      page.getByLabel(/Move me by keyboard\. In Ready\./),
    ).toBeVisible();
  });

  test("a refused keyboard move explains itself instead of doing nothing", async ({
    page,
  }) => {
    // Silence is the accessibility failure here. A sighted user might notice
    // the card did not move; someone driving this by keyboard and screen
    // reader gets no signal at all unless the refusal is announced.
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Not ready to move");

    await page.goto("/dashboard/kanban");
    await page.getByLabel(/Not ready to move\. In Inbox\./).focus();
    await page.keyboard.press("ArrowRight");

    await expect(page.getByText("Can't move to Ready")).toBeVisible();
    await expect(
      page.getByLabel(/Not ready to move\. In Inbox\./),
    ).toBeVisible();
  });

  test("the Pomodoro timer starts from the keyboard", async ({ page }) => {
    await page.goto("/dashboard/pomodoro");

    // The control stays disabled until the stored session has been read back,
    // so that a click landing in that window cannot be silently discarded.
    // Waiting for it is the honest way to drive it — `click()` waits for
    // enabled on its own, which is why only the keyboard path noticed.
    const start = page.getByRole("button", { name: /Start focus/ });
    await expect(start).toBeEnabled();

    await start.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("pomodoro-status")).toContainText("Running");
  });

  test("the 404 and the offline page are accessible too", async ({ page }) => {
    // Both are pages you only ever see when something has already gone wrong,
    // which is exactly when a broken one is least welcome — and exactly why
    // neither had ever been scanned.
    await page.goto("/no-such-page");
    await expect(
      page.getByRole("heading", { name: "There is nothing here" }),
    ).toBeVisible();
    expect(describeViolations(await scan(page))).toBe("");

    await page.goto("/offline");
    expect(describeViolations(await scan(page))).toBe("");
  });
});

test.describe("email and calendar", () => {
  test("the unified inbox has no WCAG A/AA violations", async ({ page }) => {
    await page.goto("/dashboard/email");
    await expect(page.getByTestId("thread-row").first()).toBeVisible();

    expect(describeViolations(await scan(page))).toBe("");
  });

  test("an open thread has none either", async ({ page }) => {
    // The pane carries the sender-rating controls, which are the densest
    // cluster of buttons in the module.
    await page.goto("/dashboard/email");
    await page.getByTestId("thread-row").first().click();
    await expect(page.getByTestId("thread-pane")).toBeVisible();

    expect(describeViolations(await scan(page))).toBe("");
  });

  test("the agenda has no violations", async ({ page }) => {
    await page.goto("/dashboard/calendar");
    await expect(page.getByTestId("agenda")).toBeVisible();

    expect(describeViolations(await scan(page))).toBe("");
  });
});
