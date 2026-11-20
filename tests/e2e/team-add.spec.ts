import knexLib from "knex";
import { expect, test, testDatabaseName, type Locator, type Page, type TestInfo } from "./harness";

// New bot's Add a team (D-105) as a person meets it, on the Test Preview target, in a home of the test's own. At the foot
// of what New bot's bot will do, Add a team lists the teams on the cards New home shows; Small shop shows its five bots,
// all ticked, and adds the three left ticked in a Small shop section, in the team's order, with the first of them open.
// Opened again, Small shop says which three are already in this home and adds only the other two. Screenshots light,
// dark and phone. The test deletes the home it makes.
// Run with: vibe64-helper playwright --target test-app test tests/e2e/team-add.spec.ts
const SHOP = ["Restock", "Chorus", "Kindly", "Docket", "Rapport"];
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
const newBotDialog = (page: Page) => page.getByRole("dialog", { name: "New bot" });
const appsRead = (page: Page) => page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/apps-templates"));
const teamAdded = (page: Page) =>
  page.waitForResponse((response) => response.request().method() === "POST" && /\/teams\/shop$/u.test(new URL(response.url()).pathname));
const connect = () => knexLib({
  client: "pg",
  connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() }
});

/** Light, dark (transitions off), then light at phone width, 390 by 844, once the dialog fills the screen there. */
async function shots(page: Page, testInfo: TestInfo, name: string, atPhone?: () => Promise<unknown>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.screenshot({ path: testInfo.outputPath(`${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  const size = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".mb-ctemp--phone")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`${name}-phone.png`) });
  await atPhone?.();
  if (size) await page.setViewportSize(size);
}

/** Leaves every app a team screen offers to set up unticked, once the apps it works with are read. */
async function noApps(dialog: Locator, read: Promise<unknown>) {
  await read;
  for (const box of await dialog.getByRole("checkbox", { name: /^Also set up its .+ app/u }).all()) await box.uncheck();
}

/** New bot → Add a team: the list of teams. */
async function openTeams(page: Page) {
  await sidebar(page).getByRole("button", { name: "New bot", exact: true }).click();
  const dialog = newBotDialog(page);
  await dialog.getByRole("button", { name: /^Add a team/u }).click();
  await expect(dialog.getByRole("heading", { name: "Add a team" })).toBeVisible();
  return dialog;
}

test("Add a team adds the bots ticked in the team's order, and only the bots the home hasn't got", async ({ page }, testInfo) => {
  const knex = connect();
  let homeId = "";
  try {
    const { csrfToken } = await (await page.request.get("/api/session")).json();
    const made = await page.request.post("/api/workspaces", {
      headers: { "csrf-token": csrfToken, "content-type": "application/vnd.api+json", accept: "application/vnd.api+json" },
      data: JSON.stringify({ data: { type: "workspaces", attributes: { name: `Corner ${Date.now().toString(36)}` } } })
    });
    expect(made.ok(), await made.text()).toBe(true);
    const slug = String((await made.json()).data.attributes.slug);
    homeId = String((await knex("workspaces").where({ slug }).first()).id);
    await page.goto(`/w/${slug}`);
    await pastIntro(page);

    const dialog = await openTeams(page);
    await expect(dialog.getByRole("button", { name: /^Small shop/u })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^Something else/u }), "New home's own card").toHaveCount(0);
    await shots(page, testInfo, "add-a-team-list");

    const shopApps = appsRead(page);
    await dialog.getByRole("button", { name: /^Small shop/u }).click();
    for (const botName of SHOP) await expect(dialog.getByRole("checkbox", { name: `Add ${botName}` })).toBeChecked();
    await expect(dialog.getByRole("button", { name: "Add 5 bots" })).toBeEnabled();
    await shopApps;
    await shots(page, testInfo, "add-a-team-detail", async () => {
      const lastApp = dialog.getByRole("checkbox", { name: /^Also set up its .+ app/u }).last();
      await lastApp.scrollIntoViewIfNeeded();
      await expect(lastApp, "the last app box clears the foot").toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: testInfo.outputPath("add-a-team-detail-phone-end.png") });
    });
    await dialog.getByRole("checkbox", { name: "Add Kindly" }).uncheck();
    await dialog.getByRole("checkbox", { name: "Add Rapport" }).uncheck();
    await noApps(dialog, Promise.resolve());
    const shopAdded = teamAdded(page);
    await dialog.getByRole("button", { name: "Add 3 bots" }).click();
    expect((await (await shopAdded).json()).added).toHaveLength(3);
    await expect(dialog).toBeHidden();
    const rows = section(page, "Small shop").locator(".mb-row");
    await expect(rows).toHaveCount(3);
    await expect(rows, "in the team's order").toContainText(["Restock", "Chorus", "Docket"]);
    await expect(page.getByPlaceholder("Message Restock"), "the first of them open").toBeVisible();

    // Small shop again: the three it has say so, and only the other two are added.
    const againApps = appsRead(page);
    const again = await openTeams(page);
    await again.getByRole("button", { name: /^Small shop/u }).click();
    for (const botName of ["Restock", "Chorus", "Docket"]) {
      const there = again.getByRole("checkbox", { name: `${botName}, already in this home` });
      await expect(there).toBeDisabled();
      await expect(there).not.toBeChecked();
    }
    await expect(again.getByText("Already in this home")).toHaveCount(3);
    await expect(again.getByRole("button", { name: "Add 2 bots" })).toBeEnabled();
    await againApps;
    await shots(page, testInfo, "small-shop-again");
    await noApps(again, Promise.resolve());
    const rest = teamAdded(page);
    await again.getByRole("button", { name: "Add 2 bots" }).click();
    const restBody = await (await rest).json();
    expect([restBody.added.length, restBody.skipped]).toEqual([2, []]);
    await expect(rows).toHaveCount(5);
    for (const botName of SHOP) await expect(section(page, "Small shop").getByRole("button", { name: botName, exact: true })).toBeVisible();

    const kept = await knex("bots").where({ workspace_id: homeId, is_main: false }).select("library_template", "sharing");
    expect(kept).toHaveLength(5);
    expect(new Set(kept.map((row) => row.library_template)).size, "never two bots on one template").toBe(5);
    expect(kept.every((row) => row.sharing === "mixed")).toBe(true);
  } finally {
    if (page.url() !== "about:blank") await page.goto("about:blank");
    if (homeId) {
      await knex("bots").where({ workspace_id: homeId }).del();
      await knex("workspace_settings").where({ workspace_id: homeId }).del();
      await knex("workspace_memberships").where({ workspace_id: homeId }).del();
      await knex("workspaces").where({ id: homeId }).del();
    }
    await knex.destroy();
  }
});
