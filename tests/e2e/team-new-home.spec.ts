import knexLib from "knex";
import { expect, test, testDatabaseName, type Locator, type Page, type TestInfo } from "./harness";

// New home with Teams (D-105) as a person meets it, on the Test Preview target. Create a home opens New home, which asks
// what the home is for on cards: Mercbot's teams, then Something else. Busy household shows its six bots, all ticked;
// its button counts the bots ticked; the home takes the team's name, which can be changed, and Just me (Mixed). Create
// home with 6 bots lands on the team's first bot, Sweep, with the six in a Busy household section in the team's order.
// Something else asks only the name and who it's for, and the home starts with just Mercbot. Nothing in New home says
// "A team": a team is only ever a set of bots. Screenshots light, dark and phone. Each test deletes the home it makes.
// Run with: vibe64-helper playwright --target test-app test tests/e2e/team-new-home.spec.ts
const HOME = "/w/you";
const FAMILY = ["Sweep", "Pantry", "Kitbag", "Satchel", "Billfold", "Joist"];
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
const section = (page: Page, name: string) =>
  sidebar(page).locator("section.mb-group").filter({ has: page.locator(".mb-header__label", { hasText: new RegExp(`^${name}$`, "u") }) });
const newHomeDialog = (page: Page) => page.getByRole("dialog", { name: "New home" });
const connect = () => knexLib({
  client: "pg",
  connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() }
});

/**
 * Light, dark (transitions off), then light at phone width, 390 by 844, with `ready` waited for there; `atPhone` then
 * does what else is to be seen at that width.
 */
async function shots(page: Page, testInfo: TestInfo, name: string, ready?: Locator, atPhone?: () => Promise<unknown>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.screenshot({ path: testInfo.outputPath(`${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  const size = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  if (ready) await expect(ready).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`${name}-phone.png`) });
  await atPhone?.();
  if (size) await page.setViewportSize(size);
}

/** Create a home, from the home menu: New home, on its cards. */
async function openNewHome(page: Page) {
  await page.goto(HOME);
  await pastIntro(page);
  await sidebar(page).getByRole("button", { name: /^Home: .+\. Switch home$/u }).click();
  await page.getByText("Create a home").click();
  const dialog = newHomeDialog(page);
  await expect(dialog.getByRole("heading", { name: "What's this home for?" })).toBeVisible();
  return dialog;
}

/** Deletes the home called by `slug`, if it was made. */
async function removeHome(knex: ReturnType<typeof connect>, slug: string) {
  const home = slug ? await knex("workspaces").where({ slug }).first() : null;
  if (!home) return;
  await knex("bots").where({ workspace_id: home.id }).del();
  await knex("workspace_settings").where({ workspace_id: home.id }).del();
  await knex("workspace_memberships").where({ workspace_id: home.id }).del();
  await knex("workspaces").where({ id: home.id }).del();
}

test("New home for Busy household: its six bots ticked, a button that counts them, and the home opens on Sweep", async ({ page }, testInfo) => {
  const knex = connect();
  let slug = "";
  try {
    const dialog = await openNewHome(page);
    const cards = dialog.locator(".mb-team__choice");
    await expect(cards.first()).toContainText("Busy household");
    await expect(cards.last()).toContainText("Something else");
    await expect(cards.filter({ hasText: "Busy household" })).toContainText("6 bots");
    await expect(dialog).not.toContainText(/\bA team\b/u);
    await shots(page, testInfo, "new-home-step1", page.locator(".mb-ctemp--phone"));

    await dialog.getByRole("button", { name: /^Busy household/u }).click();
    await expect(dialog.getByRole("heading", { name: "Busy household" })).toBeVisible();
    for (const botName of FAMILY) await expect(dialog.getByRole("checkbox", { name: `Add ${botName}` })).toBeChecked();
    const name = dialog.getByRole("textbox", { name: "Name of the new home" });
    await expect(name).toHaveValue("Busy household");
    await expect(name).toBeEditable();
    const forWhom = dialog.getByRole("group", { name: "Who's it for?" });
    await expect(forWhom.getByRole("radio", { name: "Just me" })).toBeChecked();
    await expect(forWhom.getByRole("radio", { name: "Me and other people" })).not.toBeChecked();
    await expect(dialog).not.toContainText(/\bA team\b/u);

    // The button follows the ticks.
    await expect(dialog.getByRole("button", { name: "Create home with 6 bots" })).toBeEnabled();
    await dialog.getByRole("checkbox", { name: "Add Joist" }).uncheck();
    await expect(dialog.getByRole("button", { name: "Create home with 5 bots" })).toBeEnabled();
    await dialog.getByRole("checkbox", { name: "Add Joist" }).check();
    const create = dialog.getByRole("button", { name: "Create home with 6 bots" });
    await expect(create).toBeEnabled();
    // On a phone, the name and who it's for scroll clear of the foot, which keeps the button in view.
    await shots(page, testInfo, "new-home-step2", page.locator(".mb-ctemp--phone"), async () => {
      await forWhom.scrollIntoViewIfNeeded();
      await expect(forWhom).toBeInViewport({ ratio: 1 });
      await expect(create).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: testInfo.outputPath("new-home-step2-phone-name.png") });
    });

    const chosen = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname.endsWith("/home-settings"));
    const added = page.waitForResponse((response) => response.request().method() === "POST" && /\/teams\/family-home$/u.test(new URL(response.url()).pathname));
    await create.click();
    const answer = await chosen;
    slug = decodeURIComponent(new URL(answer.url()).pathname.split("/")[3]);
    expect((await answer.json()).newBotSharing).toBe("mixed");
    expect((await added).ok()).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/w/${slug}(?:[?#]|$)`, "u"), { timeout: 15_000 });
    await pastIntro(page);
    await expect(page, "the address leaves the team once its bots are made").not.toHaveURL(/[?&](?:team|bots|apps)=/u);
    await expect(sidebar(page).getByRole("button", { name: "Home: Busy household. Switch home" })).toBeVisible();

    // The six, in the team's order, and the team's first bot open.
    const rows = section(page, "Busy household").locator(".mb-row");
    await expect(rows).toHaveCount(FAMILY.length);
    await expect(rows).toContainText(FAMILY);
    await expect(page.getByPlaceholder("Message Sweep")).toBeVisible();
    await expect(newHomeDialog(page)).toHaveCount(0);
    const home = await knex("workspaces").where({ slug }).first();
    const made = await knex("bots").where({ workspace_id: home.id, is_main: false }).select("name", "sharing");
    expect(made.map((row) => row.name).sort()).toEqual([...FAMILY].sort());
    expect(made.every((row) => row.sharing === "mixed")).toBe(true);
    expect((await knex("bots").where({ workspace_id: home.id, is_main: true })).length, "the home's main bot too").toBe(1);
    await shots(page, testInfo, "busy-household-sidebar");
  } finally {
    if (page.url() !== "about:blank") await page.goto("about:blank");
    await removeHome(knex, slug);
    await knex.destroy();
  }
});

test("New home for Something else asks the name and who it's for, and starts with just Mercbot", async ({ page }, testInfo) => {
  const knex = connect();
  const homeName = `Plain ${Date.now().toString(36)}`;
  let slug = "";
  try {
    const dialog = await openNewHome(page);
    await dialog.getByRole("button", { name: /^Something else/u }).click();
    await expect(dialog.getByRole("heading", { name: "Something else" })).toBeVisible();
    await expect(dialog.getByText("Your home starts with just Mercbot.")).toBeVisible();
    const create = dialog.getByRole("button", { name: "Create home", exact: true });
    await expect(create).toBeDisabled();
    await dialog.getByRole("textbox", { name: "Name of the new home" }).fill(homeName);
    await dialog.getByRole("group", { name: "Who's it for?" }).getByRole("radio", { name: "Me and other people" }).check();
    await expect(dialog).not.toContainText(/\bA team\b/u);
    await shots(page, testInfo, "something-else", page.locator(".mb-ctemp--phone"));

    const chosen = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname.endsWith("/home-settings"));
    await create.click();
    const answer = await chosen;
    slug = decodeURIComponent(new URL(answer.url()).pathname.split("/")[3]);
    expect((await answer.json()).newBotSharing, "Me and other people: new bots Shared").toBe("shared");
    await expect(page).toHaveURL(new RegExp(`/w/${slug}(?:[?#]|$)`, "u"), { timeout: 15_000 });
    await pastIntro(page);
    await expect(sidebar(page).getByRole("button", { name: `Home: ${homeName}. Switch home` })).toBeVisible();
    const home = await knex("workspaces").where({ slug }).first();
    await expect.poll(async () => (await knex("bots").where({ workspace_id: home.id })).map((row) => row.is_main)).toEqual([true]);
    expect(await knex("bot_sections").where({ workspace_id: home.id }), "no team, no section").toEqual([]);
  } finally {
    if (page.url() !== "about:blank") await page.goto("about:blank");
    await removeHome(knex, slug);
    await knex.destroy();
  }
});
