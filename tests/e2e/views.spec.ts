import { expect, expectRefusal, holdDraftReads, test, type Page } from "./harness";

// Views (D-55), on the Test Preview target. Its fixtures give Vera's chat a card for "Contacts by
// stage", an "Everyone's stages" in two versions and a "One contact" with a parameter, all seen by
// everyone in the home (D-66); a Reports app shares the second and keeps a copy of it; a Second report
// shares it too.
// The tests run in order and change that data, so each run needs a fresh start of the target.
const HOME = "/w/you";
test.describe.configure({ mode: "serial" });
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

async function openHome(page: Page) {
  await page.goto(HOME);
  const next = page.getByRole("button", { name: "Next" });
  const shell = page.locator(".mb-shell");
  await expect(shell.or(next).first()).toBeVisible();
  if (await next.isVisible()) {
    for (let slide = 0; slide < 3; slide += 1) await next.click();
  }
  await expect(shell).toBeVisible();
}

async function veraId(page: Page) {
  const response = await page.request.get(`/api${HOME}/bots`);
  const { bots } = await response.json();
  return bots.find((bot: { name: string }) => bot.name === "Vera").id;
}

async function vera(page: Page) {
  await openHome(page);
  await page.getByRole("button", { name: /^Vera/u }).or(page.getByRole("link", { name: /^Vera/u })).first().click();
}

async function contacts(page: Page) {
  const response = await page.request.get(`/api${HOME}/app-data/tables/contacts/records?size=200`);
  expect(response.ok()).toBe(true);
  const { table, records } = await response.json();
  const field = (key: string) => table.fields.find((entry: { key: string }) => entry.key === key).id;
  return records.map((record: Record<string, unknown>) => ({ name: record[field("name")], stage: record[field("stage")] }));
}

async function addContact(page: Page, name: string) {
  const other = await page.context().newPage();
  await other.goto(`${HOME}/apps/data/contacts`);
  await other.getByRole("button", { name: "New record" }).click();
  await other.getByRole("textbox", { name: /Name/u }).fill(name);
  await other.getByRole("button", { name: "Save" }).click();
  await expect(other.getByRole("row", { name: new RegExp(name, "u") })).toBeVisible();
  await other.close();
}

test("a view's card opens it, and it shows a change made elsewhere without a reload", async ({ page }, testInfo) => {
  await vera(page);
  const card = page.getByRole("button", { name: "Open view Contacts by stage" });
  await expect(card).toContainText("How many contacts at each stage");
  await expect(card.getByText("Total").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("card.png") });
  await card.click();

  const viewer = page.getByRole("dialog", { name: "Contacts by stage" });
  const total = viewer.locator(".app-node--totals").first();
  await expect(total).toContainText("Total");
  await expect(viewer.locator("tbody tr")).toHaveCount(2);
  const before = Number(await total.locator("strong").last().innerText());
  expect(before).toBe((await contacts(page)).length);
  await page.screenshot({ path: testInfo.outputPath("viewer.png") });

  await addContact(page, "Zoe Live");
  await expect(total.locator("strong").last()).toHaveText(String(before + 1));
  await expect(viewer.locator("tbody tr").first()).toContainText("Zoe Live");
  await expect(viewer.getByRole("button", { name: "Ask Vera" })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Only me" })).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Everyone in the home" })).toHaveCount(0);
});

test("the Library keeps the view and search finds it", async ({ page }) => {
  await vera(page);
  await page.getByRole("button", { name: "Vera details" }).click();
  const details = page.getByRole("complementary", { name: "Details" });
  await details.getByRole("tab", { name: "Library" }).click();
  await details.getByText("Contacts by stage").click();
  const viewer = page.getByRole("dialog", { name: "Contacts by stage" });
  await expect(viewer.getByText("Total").first()).toBeVisible();
  await viewer.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Search", exact: true }).click();
  const palette = page.getByRole("dialog", { name: "Search" });
  await palette.getByRole("textbox").fill("Contacts by");
  await palette.getByRole("option").filter({ hasText: "Contacts by stage" }).click();
  await expect(page.getByRole("dialog", { name: "Contacts by stage" }).getByText("Total").first()).toBeVisible();
});

test("an app shows a shared view and its own copy, and asks before the copy takes a change", async ({ page }, testInfo) => {
  await page.goto(`${HOME}/apps/reports`);
  const charts = page.locator(".app-node--view");
  await expect(charts).toHaveCount(2);
  await expect(charts.nth(0).locator(".app-node--totals strong").last()).toBeVisible();
  await expect(charts.nth(1).locator(".app-node--totals strong").last()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("reports.png") });

  // A parameter comes from the screen around the view.
  await page.getByRole("row", { name: /Ben Okafor/u }).click();
  await expect(page.getByText("Their stage")).toBeVisible();
  const ben = (await contacts(page)).find((person: { name: string }) => person.name === "Ben Okafor");
  await expect(page.locator(".app-node--view")).toContainText(ben.stage);

  // An app's shared view stays live on its screen too, while it's open.
  await page.goBack();
  const shared = page.locator(".app-node--view").first();
  const count = Number(await shared.locator(".app-node--totals strong").last().innerText());
  await addContact(page, "Yara Embedded");
  await expect(shared.locator(".app-node--totals strong").last()).toHaveText(String(count + 1));
  await expect(page.locator(".app-node--view").nth(1).locator(".app-node--totals strong").last()).toHaveText(String(count + 1));

  // Restoring an older version of the view is a change: a newer version number.
  await page.goto(`${HOME}/apps/everyone-s-stages`);
  await page.getByRole("button", { name: "Versions" }).click();
  await page.locator(".v-overlay--active .v-list-item").filter({ hasText: "Version 1" }).getByRole("button", { name: "Restore" }).click();
  await expect(page.locator(".v-overlay--active")).toHaveCount(0);

  await page.goto(`${HOME}/apps/reports`);
  const asking = page.getByText("\"Everyone's stages\" has changed since this app copied it.");
  await expect(asking).toBeVisible();
  // Not now: it stays quiet for this version, through a reload.
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(asking).toHaveCount(0);
  await page.evaluate(() => window.localStorage.removeItem("mercbot.view-copies-skipped"));
  await page.reload();
  await expect(asking).toBeVisible();
  // The question is one line above the app, which still shows.
  expect((await asking.boundingBox())?.y).toBeLessThan(200);
  await expect(page.locator(".app-node--view")).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath("asking.png") });
  await page.getByRole("button", { name: "Update" }).click();
  await expect(page).toHaveURL(/version=draft/u);
  await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();
  await expect(page.locator(".app-node--view")).toHaveCount(2);
  // In the draft, the copy (a screen of this app) reads the practice data (D-71), which Reset and Publish clear: the page
  // drops the copy's reads still on their way, and after Reset the copy reads the fresh practice data.
  const copyReads = (read: Record<string, unknown>) => read.screen !== "home";
  const readsAtReset = await holdDraftReads(page, `**/api${HOME}/apps/reports/query`, copyReads);
  await page.reload();
  await expect.poll(() => readsAtReset.held(), "the copy's reads are on their way").toBeGreaterThan(0);
  readsAtReset.stopHolding();
  await page.locator(".app-frame__draft").getByRole("button", { name: "Reset" }).click();
  await expect(page.locator(".v-snackbar__content")).toHaveText("Practice data reset: it's a fresh copy of the live records.");
  expect(await readsAtReset.release(), "the copy's reads of the practice data Reset cleared, still waited for").toBe(0);
  await expect(page.locator(".app-node--view").nth(1).locator(".app-node--totals strong").last()).toHaveText(String(count + 1));
  const readsAtPublish = await holdDraftReads(page, `**/api${HOME}/apps/reports/query`, copyReads);
  await page.reload();
  await expect.poll(() => readsAtPublish.held(), "the copy's reads are on their way").toBeGreaterThan(0);
  readsAtPublish.stopHolding();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page).not.toHaveURL(/version=draft/u);
  expect(await readsAtPublish.release(), "the copy's reads of the draft, still waited for").toBe(0);
  await expect(asking).toHaveCount(0);

  await page.goto(`${HOME}/apps/second-report`);
  await expect(page.locator(".app-node--view .app-node--totals")).toBeVisible();
});

test("on a phone the card, the viewer and its actions all fit", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(`${HOME}/apps/contacts-by-stage`);
  await expect(page.getByText("Total").first()).toBeVisible();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await overflow()).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("phone-page.png") });
  await page.goto(`${HOME}?bot=${await veraId(page)}`);
  const card = page.getByRole("button", { name: "Open view Contacts by stage" });
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByText("Total").first()).toBeVisible();
  await card.click();
  const viewer = page.getByRole("dialog", { name: "Contacts by stage" });
  await expect(viewer.getByText("Total").first()).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Close" })).toBeInViewport();
  await expect(viewer.getByRole("button", { name: "Versions" })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("phone-viewer.png") });
});

test("a view shared by an app can't be retired; one that isn't can", async ({ page }) => {
  expectRefusal("409 POST /api/w/you/apps/everyone-s-stages/retire", "404 GET /api/w/you/apps/contacts-by-stage");
  await page.goto(`${HOME}/apps/everyone-s-stages`);
  await page.getByRole("button", { name: "Retire this view" }).click();
  await page.locator(".v-overlay--active").getByRole("button", { name: "Retire" }).click();
  await expect(page.locator(".v-snackbar__content")).toContainText("shows this view");

  await page.goto(`${HOME}/apps/contacts-by-stage`);
  await page.getByRole("button", { name: "Retire this view" }).click();
  await page.locator(".v-overlay--active").getByRole("button", { name: "Retire" }).click();
  await expect(page).toHaveURL(/\/apps$/u);
  await expect(page.getByText("Contacts by stage", { exact: true })).toHaveCount(0);

  // Its old card says so, and so does its address, instead of an error page or a spinner.
  await vera(page);
  await expect(page.getByRole("button", { name: /Open view/u }).getByText("This view was retired")).toBeVisible();
  await page.goto(`${HOME}/apps/contacts-by-stage`);
  await expect(page.getByText("There's no app or view at this address in this home.")).toBeVisible();

  // Nothing is deleted (D-62): it comes back from the Apps area, as it was.
  await page.goto(`${HOME}/apps`);
  await page.getByRole("radio", { name: "Retired" }).or(page.locator(".v-chip", { hasText: "Retired" })).first().click();
  await page.getByRole("button", { name: "Bring back" }).first().click();
  await expect(page.locator(".v-snackbar__content")).toContainText("Contacts by stage is back");
  await expect(page.getByText("Contacts by stage", { exact: true })).toBeVisible();
  await page.goto(`${HOME}/apps/contacts-by-stage`);
  await expect(page.getByRole("button", { name: "Retire this view" })).toBeVisible();
});
