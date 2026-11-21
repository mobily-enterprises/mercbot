import knexLib from "knex";
import { expect, test, testDatabaseName, type Locator, type Page, type TestInfo } from "./harness";

// Add bots' Describe what you need and Suggested bots (D-109) as a person meets it, on the Test Preview target, in a
// home of the test's own. The target's AI is the stand-in model (tools/standInModel.mjs): it plans the library bots
// whose tag the request names, plus a new bot for its last word that names none, and writes a new bot's template on the
// name, tag and job it was given. A shop's request shows Kindly and Restock from the library, each with why, and a new
// Rota, its template written meanwhile, with what it asks first and all of it on Read it all; Not quite right? adds a
// Payroll, keeping Rota's template; Add 3 bots makes Restock, Rota and Payroll, new templates with them, in the section
// named. Opened again, the home is asked what's missing and Restock says it's already there. A request too short to
// plan from gets a question. Screenshots light, dark and phone. The test deletes the home it makes.
// Run with: vibe64-helper playwright --target test-app test tests/e2e/add-bots-describe.spec.ts
test.use({ apiGuard: true });

const REQUEST = "I run a small shop and need help with stock, reviews and the staff rota";

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
const posted = (page: Page, path: RegExp) =>
  page.waitForResponse((response) => response.request().method() === "POST" && path.test(new URL(response.url()).pathname));
const connect = () => knexLib({
  client: "pg",
  connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() }
});

/** Light, dark (transitions off), then light at phone width, 390 by 844, once the dialog fills the screen there. */
async function shots(page: Page, testInfo: TestInfo, name: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.screenshot({ path: testInfo.outputPath(`${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  const size = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".mb-ctemp--phone")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`${name}-phone.png`) });
  if (size) await page.setViewportSize(size);
}

async function openAddBots(page: Page) {
  await sidebar(page).getByRole("button", { name: "Add bots", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add bots" });
  await expect(dialog.getByRole("textbox", { name: "Describe what you need" })).toBeVisible();
  return dialog;
}

/** Leaves every app the suggestion offers to set up unticked. */
async function noApps(dialog: Locator) {
  for (const box of await dialog.getByRole("checkbox", { name: /^Also set up its .+ app/u }).all()) await box.uncheck();
}

test("Describe what you need suggests library and new bots, checked before Add makes them with their templates", async ({ page }, testInfo) => {
  const knex = connect();
  let homeId = "";
  try {
    const { csrfToken } = await (await page.request.get("/api/session")).json();
    const made = await page.request.post("/api/workspaces", {
      headers: { "csrf-token": csrfToken, "content-type": "application/vnd.api+json", accept: "application/vnd.api+json" },
      data: JSON.stringify({ data: { type: "workspaces", attributes: { name: `Shop ${Date.now().toString(36)}` } } })
    });
    expect(made.ok(), await made.text()).toBe(true);
    const slug = String((await made.json()).data.attributes.slug);
    homeId = String((await knex("workspaces").where({ slug }).first()).id);
    await page.goto(`/w/${slug}`);
    await pastIntro(page);

    const drafts: Array<{ bot: { name: string } }> = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/bots/templates/draft")) drafts.push(request.postDataJSON());
    });
    const dialog = await openAddBots(page);
    const describe = dialog.getByRole("textbox", { name: "Describe what you need" });
    await expect(describe).toHaveAttribute("placeholder", /dog-grooming salon/u);
    await expect(dialog.getByText("or choose yourself")).toBeVisible();
    await describe.fill(REQUEST);
    await shots(page, testInfo, "add-bots-describe");

    const planned = posted(page, /\/bots\/plan$/u);
    await dialog.getByRole("button", { name: "Suggest bots" }).click();
    expect((await planned).request().postDataJSON()).toEqual({ describe: REQUEST });
    await expect(dialog.getByRole("heading", { name: "Suggested bots" })).toBeVisible();
    await expect(dialog.getByText(`For: “${REQUEST}”`)).toBeVisible();
    const library = dialog.getByRole("region", { name: "From Mercbot's library" });
    const fresh = dialog.getByRole("region", { name: "New, written for this home" });
    for (const name of ["Kindly", "Restock"]) await expect(library.getByRole("checkbox", { name: `Add ${name}` })).toBeChecked();
    await expect(library.getByText("Why: You mentioned stock.")).toBeVisible();
    await expect(fresh.getByRole("checkbox", { name: "Add Rota" })).toBeChecked();
    await expect(fresh.getByText("Asks first: What matters most to them in this job; How often they want to hear from you")).toBeVisible();
    expect(drafts.map((draft) => draft.bot.name), "one call per new bot, as soon as the plan shows").toEqual(["Rota"]);
    await expect(dialog.getByRole("textbox", { name: "Section in your sidebar" })).toHaveValue("Suggested bots");
    await fresh.getByRole("button", { name: "Read it all" }).click();
    await expect(fresh.getByText("You are Rota. Your job: Helps with rota. Ask before anything leaves this chat, and say what you did.")).toBeVisible();
    await shots(page, testInfo, "suggested-bots");

    // Not quite right? plans again from the plan before; Rota's template is kept, and only Payroll's is written.
    const changed = posted(page, /\/bots\/plan$/u);
    await dialog.getByRole("textbox", { name: "Not quite right?" }).fill("Add someone for the payroll");
    await dialog.getByRole("button", { name: "Change", exact: true }).click();
    const asked = (await changed).request().postDataJSON();
    expect([asked.describe, asked.change, asked.plan.bots.map((bot: { key: string }) => bot.key)])
      .toEqual([REQUEST, "Add someone for the payroll", ["library:review-replies", "library:shop-stock-keeper", "new:rota"]]);
    await expect(fresh.getByRole("checkbox", { name: "Add Payroll" })).toBeChecked();
    await expect(fresh.getByText(/Asks first: /u)).toHaveCount(2);
    expect(drafts.map((draft) => draft.bot.name)).toEqual(["Rota", "Payroll"]);

    await library.getByRole("checkbox", { name: "Add Kindly" }).uncheck();
    await noApps(dialog);
    await dialog.getByRole("textbox", { name: "Section in your sidebar" }).fill("Shop");
    const added = posted(page, /\/bots\/batch$/u);
    await dialog.getByRole("button", { name: "Add 3 bots" }).click();
    const batch = (await added).request().postDataJSON();
    expect(batch.section).toBe("Shop");
    expect(batch.bots.map((bot: { library?: string, name?: string }) => bot.library || bot.name)).toEqual(["shop-stock-keeper", "Rota", "Payroll"]);
    expect(batch.bots.slice(1).map((bot: { draft: { tag: string } }) => bot.draft.tag)).toEqual(["rota", "payroll"]);
    await expect(dialog).toBeHidden();
    const rows = section(page, "Shop").locator(".mb-row");
    await expect(rows, "in the order suggested").toContainText(["Restock", "Rota", "Payroll"]);
    await expect(page.getByPlaceholder("Message Restock"), "the first of them open").toBeVisible();
    const templates = await knex("home_templates").where({ workspace_id: homeId }).orderBy("tag").select("id", "tag");
    expect(templates.map((row) => row.tag)).toEqual(["payroll", "rota"]);
    const onThem = await knex("bots").where({ workspace_id: homeId }).whereIn("home_template_id", templates.map((row) => row.id)).count("* as n").first();
    expect(Number(onThem?.n)).toBe(2);

    // Again: the home is asked what's missing, and Restock says it's here already.
    const again = await openAddBots(page);
    await expect(again.getByRole("textbox", { name: "Describe what you need" })).toHaveAttribute("placeholder", "What's missing? For example, help with payroll");
    await again.getByRole("textbox", { name: "Describe what you need" }).fill("stock and reviews");
    await again.getByRole("button", { name: "Suggest bots" }).click();
    const there = again.getByRole("checkbox", { name: "Restock, already in this home" });
    await expect(there).toBeDisabled();
    await expect(there).not.toBeChecked();
    await expect(again.getByRole("checkbox", { name: "Add Kindly" })).toBeChecked();
    await expect(again.getByRole("button", { name: "Add 1 bot" })).toBeEnabled();
    await shots(page, testInfo, "suggested-bots-more");

    // Too short to plan from: a question above the box, and nothing suggested.
    await again.getByRole("button", { name: "Back", exact: true }).click();
    await again.getByRole("textbox", { name: "Describe what you need" }).fill("a shop");
    await again.getByRole("button", { name: "Suggest bots" }).click();
    await expect(again.getByText("What kind of work is it, and what takes up most of your time?")).toBeVisible();
    await expect(again.getByRole("heading", { name: "Add bots" })).toBeVisible();
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
