import knexLib from "knex";
import { expect, test, testDatabaseName, type Page } from "./harness";

// Teams (D-105) as a person meets them, on the Test Preview target. New home, from the home menu, asks what the home is
// for: Busy household names the home after it (the name can still be changed) and its six bots come with the home,
// Mixed (Who's it for? is Just me), in a sidebar section called Busy household. Then New bot's Add a team, at the foot
// of what it will do, lists the teams; Small shop shows its five bots, all ticked, and adds the three left ticked in a
// Small shop section. Opened again, Small shop says which three are already in this home and adds only the other two.
// Screenshots light and dark, and at phone width. The test deletes the home it makes.
// Run with: vibe64-helper playwright --target test-app test tests/e2e/teams.spec.ts
const HOME = "/w/you";
const FAMILY = {
  "family-chores-rota": "Sweep",
  "weekly-meal-planner": "Pantry",
  "kids-activities-planner": "Kitbag",
  "school-admin-helper": "Satchel",
  "household-bills-tracker": "Billfold",
  "home-maintenance-log": "Joist"
};
const SHOP = {
  "shop-stock-keeper": "Restock",
  "social-post-calendar": "Chorus",
  "review-replies": "Kindly",
  "receipts-and-invoices": "Docket",
  "customer-follow-up": "Rapport"
};
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

// The shell, past the introduction a person sees in a home where they have no bots yet.
async function pastIntro(page: Page) {
  const next = page.getByRole("button", { name: "Next" });
  const shell = page.locator(".mb-shell");
  await expect(shell.or(next).first()).toBeVisible();
  if (await next.isVisible()) {
    for (let slide = 0; slide < 3; slide += 1) await next.click();
  }
  await expect(shell).toBeVisible();
}

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Bots" });
// A section of the sidebar by its name, and the bots in it.
const section = (page: Page, name: string) =>
  sidebar(page).locator("section.mb-group").filter({ has: page.locator(".mb-header__label", { hasText: new RegExp(`^${name}$`, "u") }) });
// Its bots, whatever their order (they were made together).
async function expectBots(page: Page, name: string, botNames: string[]) {
  await expect(section(page, name).locator(".mb-row")).toHaveCount(botNames.length);
  for (const botName of botNames) await expect(section(page, name).getByRole("button", { name: botName, exact: true })).toBeVisible();
}
const newBotDialog = (page: Page) => page.getByRole("dialog", { name: "New bot" });
const appsRead = (page: Page) => page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/apps-templates"));

/** Leaves every app a team screen offers to set up unticked, once the apps it works with are read. */
async function noApps(dialog: ReturnType<Page["getByRole"]>, read: Promise<unknown>) {
  await read;
  for (const box of await dialog.getByRole("checkbox", { name: /^Also set up the .+ app/u }).all()) await box.uncheck();
}
const connect = () => knexLib({
  client: "pg",
  connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() }
});

/** Light and dark, each settled: Vuetify's transitions are off while it is taken. */
async function inBothThemes(page: Page, take: (scheme: string) => Promise<unknown>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await take(scheme);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/** New bot → Add a team → the team named `team`, on its team screen. */
async function openTeam(page: Page, team: string) {
  await sidebar(page).getByRole("button", { name: "New bot", exact: true }).click();
  const dialog = newBotDialog(page);
  await dialog.getByRole("button", { name: /^Add a team/u }).click();
  await expect(dialog.getByRole("heading", { name: "Add a team" })).toBeVisible();
  await dialog.getByRole("button", { name: new RegExp(`^${team}`, "u") }).click();
  await expect(dialog.getByRole("heading", { name: team })).toBeVisible();
  return dialog;
}

test("a New home for Busy household comes with its six bots, and Add a team adds only the bots not there yet", async ({ page }, testInfo) => {
  const knex = connect();
  let slug = "";
  try {
    await page.goto(HOME);
    await pastIntro(page);

    // New home: what it's for comes first, and Busy household names the home, which stays editable.
    await sidebar(page).getByRole("button", { name: /^Home: .+\. Switch home$/u }).click();
    await page.getByText("Create a home").click();
    const purpose = page.getByLabel("What's this home for?");
    await expect(purpose).toHaveValue("");
    await expect(purpose.locator("option:checked")).toHaveText("Something else");
    await purpose.selectOption({ label: "Busy household" });
    const name = page.getByRole("textbox", { name: "Name of the new home" });
    await expect(name).toHaveValue("Busy household");
    await expect(name).toBeEditable();
    await expect(page.getByText("6 bots come with it:")).toBeVisible();
    await expect(page.getByRole("group", { name: "Who's it for?" }).getByRole("radio", { name: "Just me" })).toBeChecked();
    await inBothThemes(page, (scheme) => page.screenshot({ path: testInfo.outputPath(`new-home-team-${scheme}.png`) }));

    const chosen = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname.endsWith("/home-settings"));
    const added = page.waitForResponse((response) => response.request().method() === "POST" && /\/teams\/family-home$/u.test(new URL(response.url()).pathname));
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const answer = await chosen;
    slug = decodeURIComponent(new URL(answer.url()).pathname.split("/")[3]);
    expect((await answer.json()).newBotSharing).toBe("mixed");
    expect((await added).ok()).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/w/${slug}(?:[?#]|$)`, "u"), { timeout: 15_000 });
    await pastIntro(page);
    await expect(sidebar(page).getByRole("button", { name: "Home: Busy household. Switch home" })).toBeVisible();
    await expectBots(page, "Busy household", Object.values(FAMILY));
    await expect(newBotDialog(page)).toHaveCount(0);

    const home = await knex("workspaces").where({ slug }).first();
    const made = await knex("bots").where({ workspace_id: home.id, is_main: false }).orderBy("id").select("name", "sharing", "library_template");
    expect(made).toEqual(Object.entries(FAMILY).map(([template, botName]) => ({ name: botName, sharing: "mixed", library_template: template })));
    expect((await knex("bots").where({ workspace_id: home.id, is_main: true })).length, "the home's main bot too").toBe(1);
    await inBothThemes(page, (scheme) => page.screenshot({ path: testInfo.outputPath(`busy-household-sidebar-${scheme}.png`) }));

    // Add a team, at the foot of what New bot's bot will do: the teams, then Small shop, its five bots ticked. Two
    // are left out, and the stock app isn't set up.
    await sidebar(page).getByRole("button", { name: "New bot", exact: true }).click();
    const dialog = newBotDialog(page);
    await dialog.getByRole("button", { name: /^Add a team/u }).click();
    await expect(dialog.getByRole("button", { name: /^Small shop/u })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^Busy household/u })).toBeVisible();
    await inBothThemes(page, (scheme) => page.screenshot({ path: testInfo.outputPath(`add-a-team-list-${scheme}.png`) }));
    const shopApps = appsRead(page);
    await dialog.getByRole("button", { name: /^Small shop/u }).click();
    for (const botName of Object.values(SHOP)) await expect(dialog.getByRole("checkbox", { name: `Add ${botName}` })).toBeChecked();
    await expect(dialog.getByRole("button", { name: "Add 5 bots" })).toBeEnabled();
    await dialog.getByRole("checkbox", { name: "Add Kindly" }).uncheck();
    await dialog.getByRole("checkbox", { name: "Add Rapport" }).uncheck();
    await noApps(dialog, shopApps);
    const shopAdded = page.waitForResponse((response) => response.request().method() === "POST" && /\/teams\/shop$/u.test(new URL(response.url()).pathname));
    await dialog.getByRole("button", { name: "Add 3 bots" }).click();
    expect((await (await shopAdded).json()).added).toHaveLength(3);
    await expect(dialog).toBeHidden();
    await expectBots(page, "Small shop", ["Restock", "Chorus", "Docket"]);

    // Small shop again: the three it has say so, and only the other two are added.
    const againApps = appsRead(page);
    const again = await openTeam(page, "Small shop");
    for (const botName of ["Restock", "Chorus", "Docket"]) {
      const there = again.getByRole("checkbox", { name: `${botName}, already in this home` });
      await expect(there).toBeDisabled();
      await expect(there).not.toBeChecked();
    }
    await expect(again.getByText("Already in this home")).toHaveCount(3);
    await expect(again.getByRole("button", { name: "Add 2 bots" })).toBeEnabled();
    await inBothThemes(page, (scheme) => page.screenshot({ path: testInfo.outputPath(`small-shop-again-${scheme}.png`) }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath("small-shop-again-phone.png") });
    await page.setViewportSize({ width: 1280, height: 800 });
    await noApps(again, againApps);
    const rest = page.waitForResponse((response) => response.request().method() === "POST" && /\/teams\/shop$/u.test(new URL(response.url()).pathname));
    await again.getByRole("button", { name: "Add 2 bots" }).click();
    const restBody = await (await rest).json();
    expect([restBody.added.length, restBody.skipped]).toEqual([2, []]);
    await expectBots(page, "Small shop", Object.values(SHOP));

    const kept = await knex("bots").where({ workspace_id: home.id, is_main: false }).select("library_template", "sharing");
    expect(kept).toHaveLength(11);
    expect(new Set(kept.map((row) => row.library_template)).size, "never two bots on one template").toBe(11);
    expect(kept.every((row) => row.sharing === "mixed")).toBe(true);
  } finally {
    if (page.url() !== "about:blank") await page.goto("about:blank");
    if (slug) {
      const home = await knex("workspaces").where({ slug }).first();
      if (home) {
        await knex("bots").where({ workspace_id: home.id }).del();
        await knex("workspace_settings").where({ workspace_id: home.id }).del();
        await knex("workspace_memberships").where({ workspace_id: home.id }).del();
        await knex("workspaces").where({ id: home.id }).del();
      }
    }
    await knex.destroy();
  }
});
