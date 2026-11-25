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

// Each page's text is its own chunk, loaded after its title. One left before its text came keeps no hold on the
// page: here Running your own copy's text is held back until Security overview, opened next, shows its own, then let
// through; it arrives last, and Security overview's text and title stay.
// The page's scripts are this test's to hold back (page.route), so it has no service worker to answer them in its place
// (as startup.spec.ts): Playwright stops the page registering one.
test.describe("with its scripts held back", () => {
  test.use({ serviceWorkers: "block" });

  test("a help page opened while the last one's text is still on its way keeps its own text", async ({ page }) => {
    let release = () => {};
    let asked = false;
    const held = new Promise<void>((resolve) => { release = resolve; });
    // Its chunk (assets/own-copy-<hash>.js, or help/own-copy.md?raw unbundled), not the page's own address.
    await page.route(/\/own-copy[^/]*$/u, async (route) => {
      if (route.request().resourceType() !== "document") {
        asked = true;
        await held;
      }
      await route.continue();
    });
    await page.goto("/help/own-copy");
    const title = page.locator(".mb-help__title");
    const article = page.locator(".mb-help__article");
    await expect(title).toHaveText("Running your own copy of Mercbot");
    await expect.poll(() => asked, { message: "its text was asked for, and is held back" }).toBe(true);
    await page.locator(".mb-help__nav a", { hasText: "Security overview" }).click();
    await expect(title).toHaveText("Security overview");
    await expect(article).toContainText("This page is for people reviewing Mercbot for security or compliance.");
    const late = page.waitForResponse((response) => /\/own-copy[^/]*$/u.test(new URL(response.url()).pathname + new URL(response.url()).search)
      && response.request().resourceType() !== "document");
    release();
    await (await late).finished();
    // Two frames after it arrived: whatever it was going to change, it has.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await article.textContent()).toContain("This page is for people reviewing Mercbot for security or compliance.");
    expect(await article.textContent()).not.toContain("Mercbot runs on your own Linux computer");
    expect(await page.title()).toBe("Security overview · Mercbot help");
  });
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
