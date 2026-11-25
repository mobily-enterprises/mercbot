import type { Page, TestInfo } from "@playwright/test";
import { expect, test, textContrast } from "./harness";

// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts). The
// page's scripts are this spec's to hold back or empty (page.route), so it has no service worker to answer them in
// its place (D-133): Playwright stops the page registering one. installed-app.spec.ts proves the worker.
test.use({ apiGuard: true, serviceWorkers: "block" });

/** The fixture home, as a signed-in person opens Mercbot. */
const HOME = "/w/you";
// The app's own background (the Material 3 background role of src/theme/index.js's scheme), which covers most of the
// opened shell and which the splash paints.
const BACKGROUND = { light: "rgb(249, 249, 255)", dark: "rgb(17, 19, 24)" };
const FAILED = "Mercbot could not open. Reload the page to try again.";

/** Holds every script the page asks for until release(), so the page shows only its splash, still loading. */
async function holdScripts(page: Page) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let asked = 0;
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "script") {
      asked += 1;
      await held;
    }
    await route.continue();
  });
  return { release, asked: () => asked };
}

/**
 * Answers every script with an empty one, so the page loads with nothing but its splash; open() reloads it with the
 * real ones. Screenshots need it: Playwright takes none while the page's scripts are still on their way.
 */
async function withoutApp(page: Page) {
  let empty = true;
  // The scripts a service worker answered while they were to be empty: page.route never sees those.
  let fromWorker = 0;
  await page.route("**/*", (route) => (empty && route.request().resourceType() === "script"
    ? route.fulfill({ status: 200, contentType: "text/javascript", body: "" })
    : route.continue()));
  page.on("response", (response) => {
    if (empty && response.request().resourceType() === "script" && response.fromServiceWorker()) fromWorker += 1;
  });
  return {
    async open() {
      empty = false;
      await page.reload();
      return appBackground(page);
    },
    async splashAgain() {
      // Mercbot's service worker (D-133) has the page within a moment of the app opening, and from then on answers the
      // built scripts itself: the next load comes once a worker the page may register has it, and none of its scripts
      // may be the worker's, or the app opens in place of the splash as soon as it can.
      await page.evaluate(async () => {
        if (await navigator.serviceWorker.register("/sw.js")) await navigator.serviceWorker.ready;
      });
      empty = true;
      await page.reload();
      expect(fromWorker, "the splash's scripts a service worker answered, which this test can't empty").toBe(0);
    }
  };
}

const splash = (page: Page) => page.locator("#startup-shell");
const reload = (page: Page) => page.getByRole("link", { name: "Reload page" });
const background = (page: Page) => splash(page).evaluate((element) => getComputedStyle(element).backgroundColor);

/** The splash as a person sees it once it has faded in, with its bar stopped part way across. */
async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(async () => {
    const animations = document.getAnimations() as CSSAnimation[];
    const fadingIn = animations.filter((animation) => animation.animationName === "startup-fade-in" && animation.effect?.getTiming().delay === 0);
    await Promise.all(fadingIn.map((animation) => animation.finished));
    for (const animation of animations.filter(({ animationName }) => animationName === "startup-slide")) {
      animation.pause();
      animation.currentTime = 700;
    }
  });
  await page.screenshot({ path: testInfo.outputPath(name) });
}

/** Opening has taken its 10 seconds: the reveal's own CSS animations, which wait them out, run to their end at once. */
async function stall(page: Page) {
  await splash(page).locator(".startup-stalled").evaluate((element) => {
    for (const animation of element.getAnimations()) animation.finish();
  });
}

/** The app opened in place of the splash, and the background it paints. */
async function appBackground(page: Page) {
  await expect(page.locator("#app[data-v-app]")).toBeVisible();
  await expect(splash(page)).toHaveCount(0);
  return page.locator(".v-application").evaluate((element) => getComputedStyle(element).backgroundColor);
}

for (const width of [320, 390, 768, 1280]) {
  test(`Mercbot's splash shows before JavaScript at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const scripts = await holdScripts(page);
    try {
      await page.goto(HOME, { waitUntil: "commit" });
      // The tab, a bookmark and a phone's home-screen shortcut take the page's title: Mercbot's own, from the start.
      await expect(page).toHaveTitle("Mercbot");
      // The orange cloud, which says nothing to a screen reader, then the name, which says it.
      const logo = splash(page).locator("svg.startup-logo");
      await expect(logo).toBeVisible();
      await expect(logo).toHaveAttribute("aria-hidden", "true");
      await expect(splash(page).getByRole("img")).toHaveCount(0);
      await expect(splash(page).getByText("Mercbot", { exact: true })).toBeVisible();
      await expect(splash(page).locator(".startup-progress")).toBeVisible();
      await expect(page.getByRole("status")).toHaveText("Loading Mercbot…");
      await expect(page.getByRole("status")).toBeVisible();
      await expect(page.getByRole("status")).toHaveAttribute("aria-live", "polite");
      // No reload offered while opening is still quick.
      await expect(reload(page)).toBeHidden();
      await expect(page.getByText("Taking longer than usual?")).toBeHidden();
      await expect.poll(() => scripts.asked()).toBeGreaterThan(0);
      const geometry = await page.evaluate(() => {
        const logoBox = document.querySelector("#startup-shell .startup-logo")!.getBoundingClientRect();
        const status = document.getElementById("startup-status")!.getBoundingClientRect();
        return {
          width: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          logoCentre: logoBox.left + logoBox.width / 2,
          logoWidth: logoBox.width,
          contentMiddle: (logoBox.top + status.bottom) / 2,
          height: window.innerHeight
        };
      });
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
      // Centred across, and about the middle down (the hidden reload's room is under it, so nothing moves when it
      // shows).
      expect(Math.abs(geometry.logoCentre - geometry.width / 2)).toBeLessThanOrEqual(1);
      expect(geometry.logoWidth).toBe(88);
      expect(Math.abs(geometry.contentMiddle - geometry.height / 2)).toBeLessThanOrEqual(40);
    } finally {
      scripts.release();
    }
    await appBackground(page);
    await expect(page).toHaveTitle("Mercbot");
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`the splash paints the app's own ${scheme} background`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 390, height: 844 });
    const app = await withoutApp(page);
    await page.goto(HOME);
    await expect(page.getByRole("status")).toHaveText("Loading Mercbot…");
    const painted = await background(page);
    expect(painted).toBe(BACKGROUND[scheme]);
    expect(await textContrast(page.getByRole("status"))).toBeGreaterThanOrEqual(4.5);
    expect(await textContrast(splash(page).getByText("Mercbot", { exact: true }))).toBeGreaterThanOrEqual(4.5);
    await screenshot(page, testInfo, `splash-phone-${scheme}.png`);
    await page.setViewportSize({ width: 1280, height: 800 });
    await screenshot(page, testInfo, `splash-desktop-${scheme}.png`);
    // The app paints over it in the same colour, so nothing flashes as it opens.
    expect(await app.open()).toBe(painted);
  });
}

// The theme saved on this device (Settings → Preferences) paints the splash from the first frame, over the device's own
// setting. Signed in, the app then follows the account's theme and saves it on the device in its place (JSKIT's
// workspaces-web), so the next splash paints what the app showed.
for (const [saved, device] of [["dark", "light"], ["light", "dark"]] as const) {
  test(`a ${saved} theme saved on a ${device} device paints the splash ${saved}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: device });
    await page.addInitScript((theme) => {
      try {
        if (window.sessionStorage.getItem("e2e-theme-saved")) return;
        window.localStorage.setItem("jskit.themePreference", theme);
        window.sessionStorage.setItem("e2e-theme-saved", "yes");
      } catch {
        // A document with no storage of its own, such as the page's first blank one.
      }
    }, saved);
    const app = await withoutApp(page);
    await page.goto(HOME);
    await expect(page.getByRole("status")).toHaveText("Loading Mercbot…");
    expect(await background(page)).toBe(BACKGROUND[saved]);
    expect(await textContrast(page.getByRole("status"))).toBeGreaterThanOrEqual(4.5);
    const shown = await app.open();
    await app.splashAgain();
    await expect(page.getByRole("status")).toHaveText("Loading Mercbot…");
    expect(await background(page)).toBe(shown);
  });
}

test("the bar stands still when the device asks for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const scripts = await holdScripts(page);
  const bar = splash(page).locator(".startup-progress span");
  const motion = () => bar.evaluate((element) => ({
    name: getComputedStyle(element).animationName,
    running: element.getAnimations().filter((animation) => animation.playState === "running").length,
    // Everything animating on the page: under reduced motion only the reload's timer, which moves nothing.
    page: [...new Set((document.getAnimations() as CSSAnimation[]).map((animation) => animation.animationName))].sort()
  }));
  try {
    await page.goto(HOME, { waitUntil: "commit" });
    await expect(page.getByRole("status")).toHaveText("Loading Mercbot…");
    await expect(bar).toBeVisible();
    expect(await motion()).toEqual({ name: "none", running: 0, page: ["startup-reveal"] });
    // The same page once the device no longer asks: the bar slides.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(async () => (await motion()).name).toBe("startup-slide");
    expect((await motion()).running).toBe(1);
  } finally {
    scripts.release();
  }
  await appBackground(page);
});

test("Reload shows only once opening has taken 10 seconds", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const app = await withoutApp(page);
  await page.goto(HOME);
  await expect(page.getByRole("status")).toHaveText("Loading Mercbot…");
  const stalled = splash(page).locator(".startup-stalled");
  await expect(reload(page)).toBeHidden();
  // Its CSS timer: 10 seconds from the page's start, then it fades in (shows at once under reduced motion).
  expect(await stalled.evaluate((element) => getComputedStyle(element).animationDelay)).toBe("10s, 10s");
  await stall(page);
  await expect(page.getByText("Taking longer than usual?")).toBeVisible();
  await expect(reload(page)).toBeVisible();
  // A link to this page, so it reloads even when no script runs; a text button to the eye, 48 px to touch.
  await expect(reload(page)).toHaveAttribute("href", "");
  const box = (await reload(page).boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(48);
  expect(box.width).toBeGreaterThanOrEqual(48);
  expect(await reload(page).evaluate((element) => getComputedStyle(element).textDecorationLine)).toBe("none");
  expect(await textContrast(reload(page))).toBeGreaterThanOrEqual(4.5);
  // Still loading: the bar and the words stay.
  await expect(page.getByRole("status")).toHaveText("Loading Mercbot…");
  await expect(splash(page).locator(".startup-progress")).toBeVisible();
  await screenshot(page, testInfo, "splash-stalled-phone-light.png");
  await page.setViewportSize({ width: 320, height: 640 });
  const scroll = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.width + 1);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await textContrast(reload(page))).toBeGreaterThanOrEqual(4.5);
  await page.setViewportSize({ width: 1280, height: 800 });
  await screenshot(page, testInfo, "splash-stalled-desktop-dark.png");
  await app.open();
});

test("a script that can't be downloaded says so at once, and Reload opens Mercbot", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let failing = true;
  await page.route("**/*", (route) => (failing && route.request().resourceType() === "script" ? route.abort() : route.continue()));
  await page.goto(HOME);
  await expect(page.getByRole("status")).toHaveText(FAILED);
  await expect(reload(page)).toBeVisible();
  await expect(page.getByText("Taking longer than usual?")).toBeHidden();
  await expect(splash(page).locator(".startup-progress")).toBeHidden();
  expect(await textContrast(page.getByRole("status"))).toBeGreaterThanOrEqual(4.5);
  await screenshot(page, testInfo, "splash-failed-phone-light.png");
  failing = false;
  await reload(page).click();
  await appBackground(page);
});

// main.js's own failure. JSKIT recovers from a bootstrap answer that fails and from page code that can't be
// downloaded, so here the page's code throws as it runs: the router never gets ready, and the splash says so.
test("an opening that fails says so in the splash, and Reload opens Mercbot", async ({ page }) => {
  const html = await (await page.request.get(HOME)).text();
  const named = new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/gu)].map((match) => match[1]));
  expect(named.size).toBeGreaterThan(0);
  let failing = true;
  await page.route("**/*", (route) => {
    const { pathname } = new URL(route.request().url());
    return failing && route.request().resourceType() === "script" && !named.has(pathname)
      ? route.fulfill({ status: 200, contentType: "text/javascript", body: "throw new Error(\"This page's code failed as it ran (a browser test's own).\");" })
      : route.continue();
  });
  await page.goto(HOME);
  await expect(page.getByRole("status")).toHaveText(FAILED);
  await expect(splash(page)).toHaveAttribute("data-startup", "failed");
  await expect(reload(page)).toBeVisible();
  await expect(page.getByText("Taking longer than usual?")).toBeHidden();
  await expect(splash(page).locator(".startup-progress")).toBeHidden();
  failing = false;
  await reload(page).click();
  await appBackground(page);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false, apiGuard: false });

  test("the splash says Mercbot needs it, with no loading and no reload", async ({ page }) => {
    await page.goto(HOME);
    await expect(splash(page).getByText("Mercbot", { exact: true })).toBeVisible();
    // Playwright's text matching skips a noscript element, so its own text and box: shown when no script runs.
    const noscript = splash(page).locator("noscript");
    expect((await noscript.innerText()).trim()).toBe("JavaScript must be enabled to open Mercbot.");
    expect((await noscript.boundingBox())?.height).toBeGreaterThan(0);
    await expect(page.getByRole("status")).toBeHidden();
    await expect(splash(page).locator(".startup-progress")).toBeHidden();
    await expect(splash(page).locator(".startup-stalled")).toBeHidden();
  });
});

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
