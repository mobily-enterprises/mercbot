import { expect, test, type Page } from "./harness";

// The file browsers (D-47), on the Test Preview target: a file uploaded into Otto's "Just me"
// folder is moved to the whole home, seen on the home's Files page, renamed and deleted. Run with:
// vibe64-helper playwright --target test-app test tests/e2e/files.spec.ts
const HOME = "/w/you";
test.describe.configure({ mode: "serial" });
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

async function openHome(page: Page, query = "") {
  await page.goto(`${HOME}${query}`);
  const next = page.getByRole("button", { name: "Next" });
  const shell = page.locator(".mb-shell");
  await expect(shell.or(next).first()).toBeVisible();
  if (await next.isVisible()) {
    for (let slide = 0; slide < 3; slide += 1) await next.click();
  }
  await expect(shell).toBeVisible();
}

const section = (page: Page, label: string | RegExp) => page.locator(".mb-files__section").filter({ has: page.locator(".mb-files__crumb", { hasText: label }) });
const row = (page: Page, name: string) => page.locator(".mb-files__row").filter({ hasText: name });

async function chooseFromMenu(page: Page, name: string, item: string) {
  await row(page, name).getByRole("button", { name: `More for ${name}` }).click();
  await page.locator(".v-overlay--active .v-list-item").filter({ hasText: item }).click();
}

test("a file moves from Just me to the whole home, is renamed there and deleted", async ({ page }, info) => {
  const response = await page.request.get(`/api${HOME}/bots`);
  expect(response.ok()).toBe(true);
  const { bots } = await response.json();
  const otto = bots.find((bot: { name: string }) => bot.name === "Otto");
  // Otto as the fixtures make it, mixed, so each person has a "Just me" folder with it: a shared
  // bot has none, and apps.spec.ts makes Otto a shared Builder earlier in the suite.
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const mixed = await page.request.patch(`/api${HOME}/bots/${otto.id}`, {
    headers: { "csrf-token": csrfToken },
    data: { sharing: "mixed" }
  });
  expect(mixed.ok()).toBe(true);
  await openHome(page, `?bot=${otto.id}&files=1`);
  const mine = section(page, "Just me");
  await expect(mine).toBeVisible();
  await expect(section(page, "Everyone using Otto")).toBeVisible();

  // Upload into Just me, then into a new folder.
  const name = `notes-${Date.now()}.txt`;
  const chooser = page.waitForEvent("filechooser");
  await mine.getByRole("button", { name: "Upload to Just me" }).click();
  await (await chooser).setFiles({ name, mimeType: "text/plain", buffer: Buffer.from("hello from the test") });
  await expect(row(page, name)).toBeVisible();
  await page.screenshot({ path: info.outputPath("bot-files.png") });

  // Move it to the whole home.
  await chooseFromMenu(page, name, "Move to…");
  await page.locator(".v-dialog .v-select").click();
  const homeOption = page.getByRole("option").filter({ hasNotText: /Just me|Everyone using/ }).first();
  await homeOption.click();
  await page.locator(".v-dialog").getByRole("button", { name: "Move" }).click();
  await expect(mine.locator(".mb-files__row").filter({ hasText: name })).toHaveCount(0);

  // The home's Files page, from the sidebar: there, renamed, then deleted.
  await page.locator(".mb-files-entry__link").click();
  await expect(page).toHaveURL(new RegExp(`${HOME}/files$`));
  await expect(row(page, name)).toBeVisible();
  await expect(page.getByRole("link", { name: "Otto" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("home-files.png") });
  await chooseFromMenu(page, name, "Rename");
  const renamed = `renamed-${name}`;
  await page.locator(".v-dialog input").fill(renamed);
  await page.locator(".v-dialog").getByRole("button", { name: "Rename" }).click();
  await expect(row(page, renamed)).toBeVisible();
  await chooseFromMenu(page, renamed, "Delete");
  await page.getByRole("button", { name: /^Delete$/ }).click();
  await expect(row(page, renamed)).toHaveCount(0);

  // On a phone, the same page still fits.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath("home-files-phone.png") });
});
