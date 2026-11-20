import knexLib from "knex";
import { expect, test, testDatabaseName, type Page } from "./harness";

// Renaming a home (D-103) as a person does it, on the Test Preview target: in a home of their own, its owner opens
// Settings → General, where Home name refuses a name of spaces, and saving a new one shows it at once in the sidebar and
// the home switcher, without reading the page again; as a member of someone else's home, they see its name and that its
// owners and admins change it, with nothing to type in. Screenshots light and dark. The test deletes the homes and the
// person it makes.
// Run with: vibe64-helper playwright --target test-app test tests/e2e/home-rename.spec.ts
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
const connect = () => knexLib({
  client: "pg",
  connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() }
});

async function openGeneral(page: Page) {
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Settings: General");
  await page.keyboard.press("Enter");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  return settings;
}

test("a home's owner renames it in Settings → General, and the sidebar and the switcher show it at once", async ({ page }, testInfo) => {
  const knex = connect();
  const stamp = Date.now().toString(36);
  const slug = `rename-${stamp}`;
  const renamed = `The Smiths ${stamp}`;
  let homeId = "";
  let memberHomeId = "";
  let kimId = "";
  try {
    // A home of the Test Preview's person, who owns it.
    const person = (await knex("workspaces").where({ slug: "you" }).first()).owner_user_id;
    const [home] = await knex("workspaces")
      .insert({ slug, name: `Rename ${stamp}`, owner_user_id: person, is_personal: false })
      .returning("id");
    homeId = String(home.id);
    await knex("workspace_memberships").insert({ workspace_id: homeId, user_id: person, role_sid: "owner", status: "active" });
    await knex("workspace_settings").insert({ workspace_id: homeId });

    // Screenshots with transitions finished, so the Settings dialog isn't caught fading in.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/w/${slug}`);
    await pastIntro(page);
    await expect(sidebar(page).getByRole("button", { name: `Home: Rename ${stamp}. Switch home` })).toBeVisible();

    const settings = await openGeneral(page);
    const field = settings.getByRole("textbox", { name: "Home name" });
    await expect(field).toHaveValue(`Rename ${stamp}`);
    await field.scrollIntoViewIfNeeded();
    await expect(settings.getByRole("button", { name: "Save", exact: true }), "nothing to save until it changes").toHaveCount(0);

    // A name of spaces can't be saved.
    await field.fill("   ");
    await expect(settings.getByRole("alert").filter({ hasText: "A home needs a name." })).toBeVisible();
    await expect(settings.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("home-name-empty.png") });

    // A new name: saved on JSKIT's route for the home, and shown at once where the home's name is.
    await field.fill(renamed);
    const saved = page.waitForResponse((response) =>
      response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/w/${slug}`);
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await expect(settings.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
    await expect(field).toHaveValue(renamed);
    await expect(sidebar(page).getByRole("button", { name: `Home: ${renamed}. Switch home` })).toBeAttached();
    expect((await knex("workspaces").where({ id: homeId }).first()).name).toBe(renamed);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({ path: testInfo.outputPath(`home-name-owner-${scheme}.png`) });
    }
    await page.emulateMedia({ colorScheme: "light" });

    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await sidebar(page).getByRole("button", { name: `Home: ${renamed}. Switch home` }).click();
    await expect(page.locator(".mb-home-menu__name", { hasText: renamed })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("home-switcher-renamed.png") });
    await page.keyboard.press("Escape");

    // As a member of someone else's home: its name, and who changes it, with nothing to type in.
    const [kim] = await knex("users").insert({
      auth_provider: "test",
      auth_provider_user_sid: `kim-${stamp}`,
      email: `kim-${stamp}@example.com`,
      username: `kim${stamp}`,
      display_name: "Kim"
    }).returning("id");
    kimId = String(kim.id);
    const [theirs] = await knex("workspaces")
      .insert({ slug: `kims-${stamp}`, name: `Kim's team ${stamp}`, owner_user_id: kimId, is_personal: false })
      .returning("id");
    memberHomeId = String(theirs.id);
    await knex("workspace_memberships").insert([
      { workspace_id: memberHomeId, user_id: kimId, role_sid: "owner", status: "active" },
      { workspace_id: memberHomeId, user_id: person, role_sid: "member", status: "active" }
    ]);
    await knex("workspace_settings").insert({ workspace_id: memberHomeId });
    await page.goto(`/w/kims-${stamp}`);
    await pastIntro(page);
    const asMember = await openGeneral(page);
    await expect(asMember.getByRole("textbox", { name: "Home name" })).toHaveCount(0);
    await expect(asMember.getByText("The home's owners and admins can change it.")).toBeVisible();
    await asMember.getByText("The home's owners and admins can change it.").scrollIntoViewIfNeeded();
    await expect(asMember.getByText(`Kim's team ${stamp}`, { exact: true })).toBeVisible();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({ path: testInfo.outputPath(`home-name-member-${scheme}.png`) });
    }
  } finally {
    if (page.url() !== "about:blank") await page.goto("about:blank");
    const made = [homeId, memberHomeId].filter(Boolean);
    await knex("bots").whereIn("workspace_id", made).del();
    await knex("workspace_settings").whereIn("workspace_id", made).del();
    await knex("workspace_memberships").whereIn("workspace_id", made).del();
    await knex("workspaces").whereIn("id", made).del();
    if (kimId) await knex("users").where({ id: kimId }).del();
    await knex.destroy();
  }
});
