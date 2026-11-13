import { expect, test, type Page } from "./harness";

// The bot templates' honest badge (D-43, D-79), where people choose a bot: the gallery, a template's page, and the
// preview before Add bot. A Test Preview's own results (tests/support/start-test-app.mjs) have Pantry, the weekly meal
// planner, passing its end-to-end check today, Fernhill failing it, and nothing else; people see only the badge, never
// the checks themselves (D-79). Run with:
// vibe64-helper playwright --target test-app test tests/e2e/templates.spec.ts
const HOME = "/w/you";
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

const TESTED = "weekly-meal-planner";
const UNTESTED = "plant-care";
type Summary = { slug: string; name: string; tested: string | null };

/** The badge the page should show for a day the check passed, in the browser's own way of writing dates. */
const testedOn = (page: Page, day: string) => page.evaluate((date) => `Tested ${new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`, day);

/** The gallery as the API gives it, with the one tested day there should be. */
async function gallery(page: Page) {
  const { templates } = (await (await page.request.get("/api/templates")).json()) as { templates: Summary[] };
  expect(templates.filter((entry) => entry.tested).map((entry) => entry.slug), "only Pantry passed its check here").toEqual([TESTED]);
  const day = templates.find((entry) => entry.slug === TESTED)!.tested!;
  expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  return { templates, tested: await testedOn(page, day) };
}

test("the gallery shows every template's badge, on a computer and on a phone", async ({ page }) => {
  await page.goto("/templates");
  const { templates, tested } = await gallery(page);
  // The Mercbot team's chip lists every template, in the API's order.
  await page.getByRole("button", { name: "Mercbot team" }).click();
  const rows = page.locator(".mb-gallery__row");
  await expect(rows).toHaveCount(templates.length);
  const shown = await rows.evaluateAll((links) => links.map((row) => [row.querySelector("strong")?.textContent?.trim(), row.querySelector("[data-tested-badge]")?.textContent?.trim()]));
  expect(shown).toEqual(templates.map((entry) => [entry.name, entry.slug === TESTED ? tested : "Not tested yet"]));
  // Its title says what the badge means.
  await expect(rows.filter({ hasText: "Pantry" }).locator("[data-tested-badge]")).toHaveAttribute("title", /checked this bot end to end/u);

  // On a phone the badge wraps under the name instead of widening the page.
  await page.setViewportSize({ width: 390, height: 844 });
  const badge = rows.filter({ hasText: "Pantry" }).locator("[data-tested-badge]");
  await badge.scrollIntoViewIfNeeded();
  await expect(badge).toBeInViewport({ ratio: 1 });
  const width = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(width[0]).toBeLessThanOrEqual(width[1]);
});

test("a template's page shows its badge", async ({ page }) => {
  // People see the badge only: no check, no reasons.
  await page.goto(`/templates/${UNTESTED}`);
  await expect(page.locator(".mb-tpage__name")).toHaveText("Fernhill");
  await expect(page.locator("[data-tested-badge]")).toHaveText("Not tested yet");
  await expect(page.locator(".mb-tpage")).not.toContainText("The judge");

  await page.goto(`/templates/${TESTED}`);
  const { tested } = await gallery(page);
  await expect(page.locator(".mb-tpage__name")).toHaveText("Pantry");
  await expect(page.locator("[data-tested-badge]")).toHaveText(tested);
});

/** Mercbot, opened on a template's preview, past the first-run introduction a new account sees once. */
async function openPreview(page: Page, slug: string) {
  await page.goto(`${HOME}?template=${slug}`);
  const next = page.getByRole("button", { name: "Next" });
  const preview = page.getByRole("dialog", { name: "Add a bot" });
  await expect(preview.or(next).first()).toBeVisible();
  if (await next.isVisible()) {
    for (let slide = 0; slide < 3; slide += 1) await next.click();
  }
  await expect(preview.getByRole("button", { name: "Add bot" })).toBeVisible();
  return preview;
}

test("the preview before Add bot shows the badge, and adding still works", async ({ page }) => {
  await page.goto("/templates");
  const { tested } = await gallery(page);
  const untested = await openPreview(page, UNTESTED);
  await expect(untested.locator("[data-tested-badge]")).toHaveText("Not tested yet");
  await untested.getByRole("button", { name: "Cancel" }).click();
  await expect(untested).toBeHidden();

  const preview = await openPreview(page, TESTED);
  await expect(preview.getByRole("heading", { name: "Pantry", exact: true })).toBeVisible();
  await expect(preview.locator("[data-tested-badge]")).toHaveText(tested);
  const added = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api${HOME}/bots/from-template`);
  await preview.getByRole("button", { name: "Add bot" }).click();
  const { bot } = (await (await added).json()) as { bot: { id: string } };
  try {
    await expect(preview).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`[?&]bot=${bot.id}\\b`, "u"));
    await expect(page.getByRole("main", { name: "Chat" })).toContainText("I'm Pantry");
  } finally {
    // The page is left first: still open on the bot, it would go on reading it once it's gone.
    await page.goto("about:blank");
    const { csrfToken } = await (await page.request.get("/api/session")).json();
    expect((await page.request.delete(`/api${HOME}/bots/${bot.id}`, { headers: { "csrf-token": csrfToken } })).ok()).toBe(true);
  }
});
