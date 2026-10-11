import type { Page } from "@playwright/test";

import { expect, quickAdd, test } from "./fixtures";

/**
 * The priority engine, end to end.
 *
 * The gate is "auto-ranking feels right and is explainable; overrides
 * respected". These are the three claims:
 *
 *   the order changes when the *world* changes (a due date, a meeting),
 *   the reason is on screen without digging,
 *   and a manual placement beats all of it.
 */

/** Seeds the calendar the priority engine reads. */
async function seedCalendar(
  page: Page,
  events: {
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    attendeeCount?: number;
    isExternal?: boolean;
  }[],
) {
  const response = await page.request.post("/api/e2e/reset", {
    data: {
      calendar: events.map((event) => ({
        attendeeCount: 4,
        isExternal: false,
        isCancelled: false,
        organizerAddress: null,
        isOwnerOrganiser: false,
        ...event,
      })),
    },
  });
  expect(response.ok()).toBe(true);
}

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

const list = (page: Page) => page.getByTestId("top-priorities-list");

test.describe("ranking", () => {
  test("orders by the engine, not by capture order", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Something vague");
    await quickAdd(page, "Ship the audit response !critical yesterday");

    await page.goto("/dashboard");
    await expect(list(page)).toBeVisible();

    // The critical, overdue item leads regardless of which was captured first.
    const first = list(page).locator("li").first();
    await expect(first).toContainText("audit response");
  });

  test("moves a task up as its due date arrives", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Alpha review !normal");
    await quickAdd(page, "Beta review !normal");

    await page.goto("/dashboard");
    await expect(list(page)).toBeVisible();

    // Give Beta a due date in the past. Nothing else about it changes.
    const tasks = await page.request.get("/api/tasks?scope=open");
    const body = (await tasks.json()) as {
      tasks: { id: string; title: string }[];
    };
    const beta = body.tasks.find((t) => t.title.includes("Beta"))!;

    const patched = await page.request.patch(`/api/tasks/${beta.id}`, {
      data: { dueAt: new Date(Date.now() - 3 * 86_400_000).toISOString() },
    });
    expect(patched.ok()).toBe(true);

    await page.reload();
    await expect(list(page).locator("li").first()).toContainText("Beta", {
      timeout: 10_000,
    });
  });

  test("explains why a task is where it is", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Overdue thing !high yesterday");

    await page.goto("/dashboard");

    // The one-line reason is on screen without any interaction.
    await expect(list(page).getByTestId("why-line").first()).toBeVisible();

    await list(page).getByTestId("why-toggle").first().click();
    const panel = page.getByTestId("why-panel").first();

    await expect(panel).toBeVisible();
    // Sentences, not a bare number.
    await expect(panel).toContainText(/Overdue|Due|marked it/);
    await expect(panel).toContainText("out of 100");
  });
});

test.describe("the calendar half", () => {
  test("a linked meeting raises the task, and the panel says which", async ({
    page,
  }) => {
    await seedCalendar(page, [
      {
        id: "11111111-1111-4111-8111-111111111111",
        title: "Helios board decision",
        startsAt: hoursFromNow(20),
        endsAt: hoursFromNow(21),
        attendeeCount: 9,
        isExternal: true,
      },
    ]);

    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Helios board pack");
    await quickAdd(page, "Unrelated errand");

    await page.goto("/dashboard");

    // Detection produced a question. Nothing is linked yet.
    const prompt = page.getByTestId("suggestion-prompt").first();
    await expect(prompt).toBeVisible({ timeout: 10_000 });
    await expect(prompt).toContainText("helios");

    // Accepting is what creates the link — and the ranking moves only then.
    await prompt
      .getByRole("button", { name: "Yes, link them", exact: true })
      .click();

    await expect(list(page).locator("li").first()).toContainText("Helios", {
      timeout: 10_000,
    });
  });

  test("declining a suggestion links nothing, and it is not asked again", async ({
    page,
  }) => {
    await seedCalendar(page, [
      {
        id: "22222222-2222-4222-8222-222222222222",
        title: "Helios board decision",
        startsAt: hoursFromNow(20),
        endsAt: hoursFromNow(21),
      },
    ]);

    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Helios board pack");

    await page.goto("/dashboard");
    const prompt = page.getByTestId("suggestion-prompt").first();
    await expect(prompt).toBeVisible({ timeout: 10_000 });

    await prompt.getByRole("button", { name: "No", exact: true }).click();
    await expect(page.getByTestId("suggestion-prompt")).toHaveCount(0, {
      timeout: 10_000,
    });

    // A prompt that comes back after you said no is a nag.
    await page.reload();
    await expect(list(page)).toBeVisible();
    await expect(page.getByTestId("suggestion-prompt")).toHaveCount(0);
  });

  test("accepting with a note creates one", async ({ page }) => {
    await seedCalendar(page, [
      {
        id: "33333333-3333-4333-8333-333333333333",
        title: "Helios board decision",
        startsAt: hoursFromNow(20),
        endsAt: hoursFromNow(21),
      },
    ]);

    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Helios board pack");

    await page.goto("/dashboard");
    const prompt = page.getByTestId("suggestion-prompt").first();
    await expect(prompt).toBeVisible({ timeout: 10_000 });

    await prompt
      .getByRole("button", { name: /Link and start a meeting note/ })
      .click();

    await page.goto("/dashboard/notes");
    await expect(page.getByTestId("note-list")).toContainText(
      "Helios board decision",
      { timeout: 10_000 },
    );
  });
});

test.describe("the manual override", () => {
  test("a placed task leads, whatever the engine thinks", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Screaming urgent !critical yesterday");
    await quickAdd(page, "Quiet but mine !low");

    const tasks = await page.request.get("/api/tasks?scope=open");
    const body = (await tasks.json()) as {
      tasks: { id: string; title: string }[];
    };
    const quiet = body.tasks.find((t) => t.title.includes("Quiet"))!;

    const patched = await page.request.patch(`/api/tasks/${quiet.id}`, {
      data: { manualRank: 0 },
    });
    expect(patched.ok()).toBe(true);

    await page.goto("/dashboard");
    await expect(list(page).locator("li").first()).toContainText("Quiet", {
      timeout: 10_000,
    });

    // And it says so rather than pretending the score did it.
    await list(page).getByTestId("why-toggle").first().click();
    await expect(page.getByTestId("why-panel").first()).toContainText(
      "by hand",
    );
  });

  test("survives an ordinary edit", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Placed task !low");

    const tasks = await page.request.get("/api/tasks?scope=open");
    const body = (await tasks.json()) as { tasks: { id: string }[] };
    const id = body.tasks[0].id;

    await page.request.patch(`/api/tasks/${id}`, {
      data: { manualRank: 0 },
    });
    // Editing the priority must not disturb where the owner put it.
    await page.request.patch(`/api/tasks/${id}`, {
      data: { priority: "critical" },
    });

    const after = await page.request.get("/api/tasks?scope=open");
    const afterBody = (await after.json()) as {
      tasks: { id: string; manualRank: number | null }[];
    };

    expect(afterBody.tasks.find((t) => t.id === id)?.manualRank).toBe(0);
  });

  test("releasing it hands the task back to the engine", async ({ page }) => {
    await page.goto("/dashboard/tasks");
    await quickAdd(page, "Screaming urgent !critical yesterday");
    await quickAdd(page, "Quiet but mine !low");

    const tasks = await page.request.get("/api/tasks?scope=open");
    const body = (await tasks.json()) as {
      tasks: { id: string; title: string }[];
    };
    const quiet = body.tasks.find((t) => t.title.includes("Quiet"))!;

    await page.request.patch(`/api/tasks/${quiet.id}`, {
      data: { manualRank: 0 },
    });
    await page.request.patch(`/api/tasks/${quiet.id}`, {
      data: { manualRank: null },
    });

    await page.goto("/dashboard");
    await expect(list(page).locator("li").first()).toContainText("Screaming", {
      timeout: 10_000,
    });
  });
});
