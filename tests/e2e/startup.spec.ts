import { expect, test } from "./harness";

// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

for (const width of [390, 768, 1280]) {
  test(`startup remains visible before JavaScript at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let releaseScripts!: () => void;
    const scriptsHeld = new Promise<void>(resolve => { releaseScripts = resolve; });
    let scriptRequests = 0;
    await page.route("**/*", async route => {
      if (route.request().resourceType() === "script") {
        scriptRequests += 1;
        await scriptsHeld;
      }
      await route.continue();
    });
    try {
      await page.goto("/home", { waitUntil: "commit" });
      await expect(page.getByRole("status")).toHaveText("Loading application…");
      await expect(page.getByRole("status")).toBeVisible();
      await expect(page.getByRole("link", { name: "Reload page" })).toBeVisible();
      await expect.poll(() => scriptRequests).toBeGreaterThan(0);
      const geometry = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        reloadHeight: document.querySelector("#startup-shell a")!.getBoundingClientRect().height
      }));
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
      expect(geometry.reloadHeight).toBeGreaterThanOrEqual(48);
    } finally {
      releaseScripts();
    }
    await expect(page.locator("#app[data-v-app]")).toBeVisible();
    await expect(page.locator("#startup-shell")).toHaveCount(0);
  });
}

// Built files have their content's hash in their names, so a browser keeps them for good and
// another page load asks for none of them again; the page itself is asked for each time.
test("the browser keeps the built files, not the page", async ({ page }) => {
  const document = await page.request.get("/home");
  expect(document.ok()).toBe(true);
  expect(document.headers()["cache-control"] ?? "").not.toContain("immutable");
  const script = /src="(\/assets\/[^"]+\.js)"/u.exec(await document.text())?.[1];
  expect(script).toBeTruthy();
  const built = await page.request.get(script!);
  expect(built.ok()).toBe(true);
  expect(built.headers()["cache-control"]).toContain("max-age=31536000");
  expect(built.headers()["cache-control"]).toContain("immutable");
});
