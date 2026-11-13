import { expect, test } from "./harness";

test.use({ apiGuard: true });

// The help centre on a phone (390 px): nothing makes the page scroll sideways, not the header and not a
// table wider than the screen, and the page someone opened comes before the list of pages.
test("a help page reads on a phone: the page first, nothing wider than the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/help/own-copy");
  const title = page.locator(".mb-help__title");
  await expect(title).toHaveText("Running your own copy of Mercbot");
  await expect(title).toBeInViewport();
  // The title is there at once; the page's text is loaded after it, its tables with it.
  await expect(page.locator(".mb-help__table").first()).toBeAttached();
  const geometry = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    titleTop: document.querySelector(".mb-help__title")!.getBoundingClientRect().top,
    navTop: document.querySelector(".mb-help__nav")!.getBoundingClientRect().top,
    // How far past its box each table reaches: the settings table is wider than a phone.
    tableOverflows: [...document.querySelectorAll(".mb-help__table")].map((box) => box.scrollWidth - box.clientWidth)
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
  expect(geometry.navTop).toBeGreaterThan(geometry.titleTop);
  // So that table scrolls inside its own box instead of widening the page.
  expect(Math.max(...geometry.tableOverflows)).toBeGreaterThan(0);

  await page.locator(".mb-help__nav a", { hasText: "Security overview" }).click();
  await expect(page).toHaveURL(/\/help\/security$/u);
  await expect(title).toHaveText("Security overview");
  await expect(title).toBeInViewport();
});

// The help centre has Mercbot's own pages; a copy built on Mercbot adds its own (help/extensions.json).
test("the help centre has Mercbot's own pages, and no Legal ones", async ({ page }) => {
  await page.goto("/help");
  await expect(page.locator(".mb-help__nav")).toContainText("Getting started");
  await expect(page.locator(".mb-help__nav")).not.toContainText("Legal");
  await page.goto("/help/terms");
  await expect(page.locator(".mb-help__missing")).toContainText("There's no help page here.");
});

// A browser without the copy's key (D-81), at "/" or a help page: only the plain page saying how to open Mercbot.
test.describe("without the key", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a browser without the key is told to open Mercbot with mercbot open, and sees nothing else", async ({ page }) => {
    for (const address of ["/", "/help/own-copy"]) {
      expect((await page.goto(address))?.status(), address).toBe(401);
      await expect(page.locator("body")).toHaveText("Open Mercbot with mercbot open.");
      await expect(page.getByRole("link")).toHaveCount(0);
    }
  });
});
