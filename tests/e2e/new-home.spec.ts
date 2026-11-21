import knexLib from "knex";
import { expect, test, testDatabaseName, type Locator, type Page, type TestInfo } from "./harness";

// New home (D-36, D-109) as a person meets it, on the Test Preview target. Create a home opens New home, which asks only
// the home's name: no choice of who it's for or of how bots are shared, no teams, no cards, nothing that says "A team"
// (a team is only ever a set of bots, D-105). Create home makes it, with the default for new bots it always started
// with (Mixed), and goes there, and it starts with just Mercbot, with no section. Screenshots light, dark and phone. The
// test deletes the home it makes.
// Run with: vibe64-helper playwright --target test-app test tests/e2e/new-home.spec.ts
const HOME = "/w/you";
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

/** Create a home, from the home menu: New home. */
async function openNewHome(page: Page) {
  await page.goto(HOME);
  await pastIntro(page);
  await sidebar(page).getByRole("button", { name: /^Home: .+\. Switch home$/u }).click();
  await page.getByText("Create a home").click();
  const dialog = newHomeDialog(page);
  await expect(dialog.getByRole("heading", { name: "New home" })).toBeVisible();
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

test("New home asks only the name, and the home starts with just Mercbot", async ({ page }, testInfo) => {
  const knex = connect();
  const homeName = `Plain ${Date.now().toString(36)}`;
  let slug = "";
  try {
    const dialog = await openNewHome(page);
    await expect(dialog.getByText("Your home starts with Mercbot, which helps you add the bots you need.")).toBeVisible();
    const name = dialog.getByRole("textbox", { name: "Name of the new home" });
    await expect(name, "the name has the keyboard").toBeFocused();
    // Nothing but the name: no choice of who it's for or how bots are shared, no teams, no cards, no Something else.
    await expect(dialog.getByRole("radio")).toHaveCount(0);
    await expect(dialog).not.toContainText(/Who's it for|Just me|Shared|Private|Mixed/u);
    await expect(dialog.locator(".mb-team__choice")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /^(?:Busy household|Something else)/u })).toHaveCount(0);
    await expect(dialog).not.toContainText(/\bA team\b/u);
    const create = dialog.getByRole("button", { name: "Create home", exact: true });
    await expect(create).toBeDisabled();
    await name.fill(homeName);
    await expect(create).toBeEnabled();
    await shots(page, testInfo, "new-home", page.locator(".mb-ctemp--phone"));

    const chosen = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname.endsWith("/home-settings"));
    await create.click();
    const answer = await chosen;
    slug = decodeURIComponent(new URL(answer.url()).pathname.split("/")[3]);
    expect((await answer.json()).newBotSharing, "the default new homes always started with").toBe("mixed");
    await expect(page).toHaveURL(new RegExp(`/w/${slug}(?:[?#]|$)`, "u"), { timeout: 15_000 });
    await pastIntro(page);
    await expect(sidebar(page).getByRole("button", { name: `Home: ${homeName}. Switch home` })).toBeVisible();
    await expect(newHomeDialog(page)).toHaveCount(0);
    const home = await knex("workspaces").where({ slug }).first();
    await expect.poll(async () => (await knex("bots").where({ workspace_id: home.id })).map((row) => row.is_main)).toEqual([true]);
    expect(await knex("bot_sections").where({ workspace_id: home.id }), "no team, no section").toEqual([]);
  } finally {
    if (page.url() !== "about:blank") await page.goto("about:blank");
    await removeHome(knex, slug);
    await knex.destroy();
  }
});
