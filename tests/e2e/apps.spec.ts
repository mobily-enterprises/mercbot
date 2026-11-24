import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { HOME, botNamed, connectTestDb, directChat, expect, holdDraftReads, homeApi, homeWithBen, openShell, seedMessage, shell, test, textContrast, type Page } from "./harness";

// Apps (D-35), on the Test Preview target only: its fixtures give the owner's home a Contacts table
// (Ana Ruiz, Ben Okafor, Carla Mendes), a bot called Otto, a published Contacts app pinned in the
// sidebar (list with "Ask Otto", edit, a Stages chart, a public contact form), and a draft that adds
// a Notes column. The test target's AI is the stand-in model, so Otto's replies only say so. A button's task for a bot
// runs in the presser's direct chat with it; Ask Builder opens the app's own chat with the home's Builder (D-41, D-112).
// Run with: vibe64-helper playwright --target test-app test tests/e2e/apps.spec.ts
// The tests run in order and change that data (the last removes the Notes field), so each run
// needs a fresh start of the target.
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });
test.describe.configure({ mode: "serial" });

const snackbar = (page: Page) => page.locator(".v-snackbar__content");

/** What's said in a chat, newest page (GET /chats/:id/messages); while it can't be read, its refusal, for the failure. */
async function chatText(page: Page, chatId: string) {
  const response = await page.request.get(`/api${HOME}/chats/${chatId}/messages`);
  if (!response.ok()) return `${response.status()} ${await response.text()}`;
  const { messages } = await response.json();
  return messages.map((message: { body?: { text?: string } }) => message.body?.text || "").join("\n");
}

async function contacts(page: Page) {
  const response = await page.request.get(`/api${HOME}/app-data/tables/contacts/records?size=50`);
  expect(response.ok()).toBe(true);
  const { table, records } = await response.json();
  const field = (key: string) => table.fields.find((entry: { key: string }) => entry.key === key).id;
  return records.map((record: Record<string, unknown>) => ({ name: record[field("name")], stage: record[field("stage")], notes: record[field("notes")] }));
}

test("a pinned app opens, a record is edited, and Activity shows the change", async ({ page }) => {
  await openShell(page);
  await shell.sidebar(page).getByRole("link", { name: "Contacts", exact: true }).click();
  await expect(page).toHaveURL(/\/apps\/contacts/u);
  await expect(page.locator("thead th:not(.app-actions-column)")).toHaveText(["Name", "Email", "Stage"]);

  await page.getByRole("row", { name: /Ben Okafor/u }).click();
  await page.locator(".v-select", { has: page.getByRole("combobox", { name: "Stage" }) }).click();
  await page.locator(".v-overlay--active .v-list-item").filter({ hasText: "Active" }).click();
  await page.locator(".app-form").getByRole("button", { name: "Save" }).click();
  await expect(snackbar(page)).toHaveText("Saved Ben Okafor");
  await expect(page.getByRole("row", { name: /Ben Okafor/u })).toContainText("Active");

  await page.goto(`${HOME}/apps?tab=activity`);
  const change = page.locator(".v-card").filter({ hasText: "Stage: New → Active" });
  await expect(change).toContainText("changed Contacts #");
  await expect(change).toContainText("Contacts › edit");
});

// Practice data (D-71): a draft's preview reads and writes a copy of the live records, so Save works there and the
// live app never sees it; Reset starts again, and Publish (from the banner here, from the Builder's card below) leaves
// the copy behind. The API guard fails either test on any answer of 400 or more.

test.describe("a draft", () => {
  test.use({ apiGuard: true });

  test("a draft preview works on practice data: Save shows in the list, Reset starts again, and Publish leaves it behind", async ({ page }) => {
    await page.goto(`${HOME}/apps/contacts?version=draft`);
    const banner = page.locator(".app-frame__draft");
    await expect(banner).toContainText("Practice data: changes here are thrown away when you publish.");
    await expect(page.locator("thead th:not(.app-actions-column)")).toHaveText(["Name", "Email", "Stage", "Notes"]);
    const row = (name: string) => page.getByRole("row", { name: new RegExp(name, "u") });

    // Save works on the copy: the draft's list shows the change, the live records don't have it.
    await row("Ana Ruiz").click();
    await page.getByRole("textbox", { name: "Notes" }).fill("Written in the draft");
    await page.locator(".app-form").getByRole("button", { name: "Save" }).click();
    await expect(snackbar(page)).toHaveText("Saved Ana Ruiz");
    await expect(row("Ana Ruiz")).toContainText("Written in the draft");
    expect((await contacts(page)).find((record: { name: string }) => record.name === "Ana Ruiz").notes).toBeNull();

    // A new record through the draft's own form shows in the draft's list only.
    await page.goto(`${HOME}/apps/contacts/contact?version=draft`);
    await page.getByRole("textbox", { name: /Name/u }).fill("Pia Practice");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Thanks, we'll be in touch.")).toBeVisible();
    await page.goto(`${HOME}/apps/contacts?version=draft`);
    await expect(row("Pia Practice")).toBeVisible();
    expect((await contacts(page)).map((record: { name: string }) => record.name)).not.toContain("Pia Practice");

    // A hand-off to a bot is only reported.
    await row("Ben Okafor").getByRole("button", { name: "Ask Otto" }).click();
    await expect(snackbar(page)).toHaveText("Practice data: nothing was sent. Once published, this would ask Otto.");

    // Reset: a fresh copy of the live records. The draft's reads still on their way when it's pressed are dropped.
    const readsAtReset = await holdDraftReads(page, `**/api${HOME}/apps/contacts/query`);
    await page.reload();
    await expect(banner).toContainText("Practice data");
    await expect.poll(() => readsAtReset.held(), "the draft's reads are on their way").toBeGreaterThan(0);
    readsAtReset.stopHolding();
    await banner.getByRole("button", { name: "Reset" }).click();
    await expect(snackbar(page)).toHaveText("Practice data reset: it's a fresh copy of the live records.");
    expect(await readsAtReset.release(), "reads of the old copy the page still waited for").toBe(0);
    await expect(row("Pia Practice")).toHaveCount(0);
    await expect(row("Ana Ruiz")).not.toContainText("Written in the draft");

    // One more practice record, then Publish from the banner: the live app has the new column, not the record.
    await page.goto(`${HOME}/apps/contacts/contact?version=draft`);
    await page.getByRole("textbox", { name: /Name/u }).fill("Pia Practice");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Thanks, we'll be in touch.")).toBeVisible();
    await page.goto(`${HOME}/apps/contacts?version=draft`);
    await expect(row("Pia Practice")).toBeVisible();
    // Publish, with the draft's reads still on their way: the page drops them.
    const readsAtPublish = await holdDraftReads(page, `**/api${HOME}/apps/contacts/query`);
    await page.reload();
    await expect(banner).toContainText("Practice data");
    await expect.poll(() => readsAtPublish.held(), "the draft's reads are on their way").toBeGreaterThan(0);
    readsAtPublish.stopHolding();
    await banner.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
    expect(await readsAtPublish.release(), "reads of the draft the page still waited for").toBe(0);
    await page.goto(`${HOME}/apps/contacts`);
    await expect(page.locator("thead th:not(.app-actions-column)")).toHaveText(["Name", "Email", "Stage", "Notes"]);
    await expect(row("Ana Ruiz")).toBeVisible();
    await expect(row("Pia Practice")).toHaveCount(0);
    expect((await contacts(page)).map((record: { name: string }) => record.name)).not.toContain("Pia Practice");
    const knex = connectTestDb();
    try {
      const copies = knex("app_practices").whereIn("app_id", knex("apps").select("id").where({ slug: "contacts" }));
      expect(Number((await copies.count("* as n").first()).n), "publishing cleared the copy").toBe(0);
    } finally {
      await knex.destroy();
    }
  });

  test("the Builder's draft card publishes the draft from the chat", async ({ page }) => {
    const api = await homeApi(page);
    const { app } = await api.post("/apps-templates/stock/install", {});
    const name = `Builder ${Date.now().toString(36)}`;
    const { bot } = await api.post("/bots", { name, color: "#1E86FC" });
    const knex = connectTestDb();
    try {
      // The card the Builder posts after app_save_draft, in the person's direct chat with it, past its greeting.
      const chat = await directChat(page, String(bot.id));
      await knex("conversations").where({ id: chat.id }).update({ onboarding_step: null });
      const { workspace_id: homeId } = await knex("conversations").where({ id: chat.id }).first();
      const { draft_version_id: versionId } = await knex("apps").where({ id: app.id }).first();
      await seedMessage(knex, { homeId, chatId: chat.id, kind: "app_draft", botId: bot.id, body: { slug: app.slug, name: app.name, summary: "Tracks what's in stock", versionId: String(versionId) } });

      await openShell(page);
      await shell.chatRow(page, name).click();
      const card = shell.chat(page).getByRole("region", { name: `Draft of ${app.name}` });
      await expect(card).toContainText("Try it in Preview on practice data, then press Publish to start using it.");
      await expect(card.getByRole("link", { name: "Preview" })).toBeVisible();
      await card.getByRole("button", { name: "Publish" }).click();
      await expect(card).toContainText("Published as version 1.");
      await expect(card.getByRole("button", { name: "Publish" })).toHaveCount(0);
      const published = await knex("apps").where({ id: app.id }).first();
      expect([published.draft_version_id, published.live_version_id === null]).toEqual([null, false]);
      await page.goto(`${HOME}/apps/${app.slug}`);
      await expect(page.getByRole("button", { name: "New item" })).toBeVisible();
      await expect(page.locator(".app-frame__draft")).toHaveCount(0);
    } finally {
      await knex.destroy();
      // Left first, so the page doesn't go on reading the bot once it's gone (the API guard would see that).
      await page.goto("about:blank");
      await api.answer("DELETE", `/bots/${bot.id}`);
    }
  });
});

test("the Data tab imports a CSV file (all rows or none) and exports it again", async ({ page }, testInfo) => {
  const tag = randomUUID().slice(0, 8);
  const bad = testInfo.outputPath("bad.csv");
  const good = testInfo.outputPath("good.csv");
  await writeFile(bad, `Name,Stage,Shoe size\nDana ${tag},New,42\nEli ${tag},Maybe,43\n`);
  await writeFile(good, `Name,Email,Stage\nDana ${tag},dana@example.test,New\nEli ${tag},,Won\n`);
  await page.goto(`${HOME}/apps/data/contacts`);
  const before = (await contacts(page)).length;

  await page.getByRole("button", { name: "Import" }).click();
  const dialog = page.locator(".v-dialog .v-card").filter({ hasText: "Import into Contacts" });
  await dialog.locator("input[type=file]").setInputFiles(bad);
  await expect(dialog).toContainText("Not used (no field with that name): Shoe size.");
  await dialog.getByRole("button", { name: "Import 2 records" }).click();
  await expect(dialog).toContainText("Row 3: Stage: must be one of: New, Active, Won.");
  expect((await contacts(page)).length).toBe(before);

  await dialog.locator("input[type=file]").setInputFiles(good);
  await dialog.getByRole("button", { name: "Import 2 records" }).click();
  await expect(snackbar(page)).toHaveText("Imported 2 records.");
  await expect(page.getByRole("row", { name: new RegExp(`Eli ${tag}`, "u") })).toContainText("Won");
  expect((await contacts(page)).length).toBe(before + 2);

  await page.getByRole("button", { name: "Export" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByText("CSV (.csv)").click()]);
  expect(download.suggestedFilename()).toBe("contacts.csv");
  const csv = await readFile(await download.path(), "utf8");
  expect(csv).toContain("Name,Email,Stage,Notes");
  expect(csv).toContain(`Dana ${tag},dana@example.test,New,`);
});

test("removing a field asks first, then takes it out of the table and the app", async ({ page }) => {
  await page.goto(`${HOME}/apps/data/contacts`);
  await page.getByRole("button", { name: "Fields" }).click();
  await page.locator(".v-list-item").filter({ hasText: "notes · text" }).getByRole("button", { name: "Remove…" }).click();
  await expect(page.getByText("Remove Notes from Contacts?")).toBeVisible();
  await expect(page.locator(".v-dialog")).toContainText("Contacts");
  await page.getByRole("button", { name: "Remove everywhere" }).click();
  await expect(snackbar(page)).toHaveText("Field removed.");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("columnheader", { name: "Notes" })).toHaveCount(0);

  await page.goto(`${HOME}/apps/contacts`);
  await expect(page.locator("thead th:not(.app-actions-column)")).toHaveText(["Name", "Email", "Stage"]);
});

test("a chart shows the totals of a query", async ({ page }, testInfo) => {
  // The chart draws its bars at once rather than growing them in, so the screenshot shows them.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${HOME}/apps/contacts/stages`);
  const chart = page.locator(".app-chart");
  await expect(chart.locator("canvas")).toBeVisible();
  await expect(chart).toHaveAttribute("aria-label", /^Bar chart of People by stage: /u);
  const label = await chart.getAttribute("aria-label");
  for (const stage of ["Active", "New", "Won"]) expect(label).toContain(stage);
  await page.screenshot({ path: testInfo.outputPath("chart.png") });
});

test("a button hands a task to a bot, which works on it in the presser's direct chat with it", async ({ page }) => {
  await page.goto(`${HOME}/apps/contacts`);
  await page.getByRole("row", { name: /Carla Mendes/u }).getByRole("button", { name: "Ask Otto" }).click();
  await expect(snackbar(page)).toHaveText("Sent to Otto");
  // The person's one direct chat with Otto: asking for it finds the one the task went to.
  const chat = await directChat(page, String((await botNamed(page, "Otto")).id));
  await expect.poll(() => chatText(page, String(chat.id)))
    .toMatch(/Task from Contacts[\s\S]*runs on a stand-in model, which only plays the bot templates/u);
});

test("the home's look applies to its apps", async ({ page }, testInfo) => {
  await page.goto(`${HOME}/apps?tab=look`);
  await page.locator('button[aria-label="Use #0B7A5B"]').click();
  await page.locator(".apps-look__form").getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".v-snackbar__content")).toHaveText("Saved. Every app in this home uses the new look.");
  await page.goto(`${HOME}/apps/contacts`);
  await expect(page.locator(".v-theme--app-light-0b7a5b").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("themed-app.png") });
});


// In a home of the test's own, removed afterwards even when it fails: the template's sample contacts (Ana Ruiz, Ben
// Okafor) go into the home's shared Contacts, which in the fixtures' home already has people of those names that the
// files after this one, in the same Test Preview, look up by name.
test("a template installs as a draft and can be published", async ({ page }, testInfo) => {
  const knex = connectTestDb();
  const home = await homeWithBen(page, knex);
  try {
    await page.goto(`${home.path}/apps?tab=templates`);
    const crm = page.locator('[data-template="crm"]');
    await expect(crm).toContainText("CRM");
    // The six apps, with Contacts and To-dos (D-130).
    await expect(page.locator("[data-template]")).toHaveCount(8);
    await page.screenshot({ path: testInfo.outputPath("templates.png") });
    await crm.getByRole("button", { name: "With sample data" }).click();
    await expect(page).toHaveURL(/\/apps\/crm[^/]*\?version=draft/u);
    await expect(page.locator(".v-snackbar__content")).toContainText("is ready as a draft");
    await expect(page.getByRole("button", { name: "Publish" })).toBeVisible();
    await page.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
    await page.getByRole("link", { name: "Deals" }).first().click();
    await expect(page.getByRole("row", { name: /Website refresh/u })).toBeVisible();
    await expect(page.locator(".app-chart")).toHaveAttribute("aria-label", /Bar chart of Deals by stage/u);
    // The pipeline is each contact's stage, kept in the contacts' CRM extension (D-130); the sample puts its contacts
    // in it.
    await page.getByRole("link", { name: "Pipeline" }).first().click();
    await expect(page.locator(".app-chart")).toHaveAttribute("aria-label", /Bar chart of Pipeline by stage/u);
    await expect(page.getByRole("row", { name: /Ana Ruiz.*Qualified/u })).toBeVisible();
  } finally {
    await home.remove();
    // Its records are AnyAPI's tenant ws:<home>, and each draft's practice copy ws:<home>:p:<copy>, not the home's
    // rows, so they don't go with it.
    for (const table of ["any_links", "any_records", "any_resource_configs"]) {
      await knex(table).where({ tenant_id: `ws:${home.homeId}` }).orWhereLike("tenant_id", `ws:${home.homeId}:p:%`).del();
    }
    await knex.destroy();
  }
});

test("scripts: a formula function, data worked out by a script, a button and a rule", async ({ page }, testInfo) => {
  await page.goto(`${HOME}/apps/leads`);
  const dora = page.getByRole("row", { name: /Dora Lee/u }).first();
  await expect(dora).toContainText("A"); // grade(91), worked out in the browser's sandbox
  await expect(page.getByRole("row", { name: /Eli Park/u }).first()).toContainText("B");
  await expect(page.getByRole("row", { name: /Fay Moss/u }).first()).toContainText("C");
  const top = page.locator(".app-node[data-app-type='table']").nth(1);
  await expect(top.getByRole("row")).toHaveCount(4); // the header and three leads, best first
  await expect(top.getByRole("row").nth(1)).toContainText("Dora Lee");
  await expect(top.getByRole("row").nth(3)).toContainText("Eli Park");
  await page.getByRole("row", { name: /Fay Moss/u }).first().getByRole("button", { name: "Promote" }).click();
  await expect(snackbar(page)).toHaveText("Promoted Fay Moss");
  await expect(page.getByRole("row", { name: /Fay Moss/u }).first()).toContainText("Won");
  await page.screenshot({ path: testInfo.outputPath("scripts-app.png") });

  // The rule refuses a score over 100, wherever the change comes from, and fills in references.
  const tableResponse = await page.request.get(`/api${HOME}/app-data/tables/leads/records?size=50`);
  const { table, records } = await tableResponse.json();
  const field = (key: string) => table.fields.find((entry: { key: string }) => entry.key === key).id;
  const fay = records.find((record: Record<string, unknown>) => record[field("name")] === "Fay Moss");
  expect(fay[field("ref")]).toBe("L-FAY"); // the button's change went through the rule
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const refused = await page.request.patch(`/api${HOME}/app-data/tables/leads/records/${fay.id}`, { headers: { "csrf-token": csrfToken }, data: { values: { score: 150 } } });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error).toBe("A score is at most 100.");

  // The Logic tab: each script in plain words, its code and its runs.
  await page.getByRole("button", { name: "App details" }).click();
  await page.getByRole("tab", { name: "Logic" }).click();
  await expect(page.locator(".app-logic .v-expansion-panel")).toHaveCount(4);
  const promote = page.locator(".app-logic .v-expansion-panel", { hasText: "Marks a lead as won" });
  await promote.click();
  await expect(promote.locator("pre")).toContainText("records.update('leads'");
  // The selected view's label reads clearly (it was drawn in its segment's own colour, so it looked blank).
  const code = promote.getByRole("button", { name: "Code" });
  await expect(code).toHaveClass(/v-btn--active/u);
  await expect.poll(() => textContrast(code)).toBeGreaterThanOrEqual(4.5);
  const runs = promote.getByRole("button", { name: /Runs/u });
  await runs.click();
  await expect(runs).toHaveClass(/v-btn--active/u);
  await expect.poll(() => textContrast(runs)).toBeGreaterThanOrEqual(4.5);
  await expect(promote).toContainText("OK");
  // An owner can switch a script off at once, and back on.
  await promote.getByRole("button", { name: "Turn off" }).click();
  await expect(promote.getByText("Off", { exact: true })).toBeVisible();
  await promote.getByRole("button", { name: "Turn on" }).click();
  await expect(promote.getByText("Off", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("logic-tab.png") });

  // The Scripts tab: every script of the home, and the addresses scripts may call.
  await page.goto(`${HOME}/apps?tab=scripts`);
  await expect(page.getByRole("row", { name: /Marks a lead as won/u })).toContainText("OK");
  await page.getByRole("button", { name: "Add an address" }).click();
  await page.getByLabel("Address (e.g. https://api.example.com)").fill("https://api.example.com");
  await page.getByRole("button", { name: "Add a secret header" }).click();
  await page.getByLabel("Header").fill("X-Api-Key");
  await page.getByLabel("Secret value").fill("not-a-real-key");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(snackbar(page)).toHaveText("Saved. Scripts can call these addresses.");
  await expect(page.getByLabel("Secret kept (type to replace)")).toHaveValue("");
  await page.screenshot({ path: testInfo.outputPath("scripts-tab.png") });
});

test("Ask Builder opens the app's own chat with the home's Builder, the same one every time", async ({ page }, testInfo) => {
  const api = await homeApi(page);
  const otto = await botNamed(page, "Otto");
  await api.put("/apps/builder", { botId: otto.id });

  // The app's chat (D-41): Public, named after the app, with the Builder and the person who asked, and a first line
  // saying where they asked from in its composer.
  await page.goto(`${HOME}/apps/contacts`);
  await page.getByRole("button", { name: "Ask Builder" }).click();
  await expect(page).toHaveURL(/[?&]chat=\d+/u);
  const chatId = new URL(page.url()).searchParams.get("chat");
  const { chat } = await api.get(`/chats/${chatId}`);
  expect([chat.title, chat.kind, chat.directBotId, Boolean(chat.appId), chat.people.length]).toEqual(["Contacts", "public", null, true, 1]);
  expect(chat.bots.map((bot: { botId: string }) => String(bot.botId))).toEqual([String(otto.id)]);
  await expect(shell.chat(page).getByRole("button", { name: "Contacts details" })).toContainText("Public");
  await expect(shell.composer(page)).toHaveValue(/^About the app "Contacts" \(contacts\), screen "list": $/u);
  await page.screenshot({ path: testInfo.outputPath("app-chat.png") });

  // The second time the same chat opens, and the home still has one chat for the app.
  await page.goto(`${HOME}/apps/contacts`);
  await page.getByRole("button", { name: "Ask Builder" }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]chat=${chatId}(&|$)`, "u"));
  await expect(shell.chat(page).getByRole("button", { name: "Contacts details" })).toBeVisible();
  const { chats } = await api.get("/chats");
  expect(chats.filter((entry: { appId: string | null }) => entry.appId === chat.appId)).toHaveLength(1);
});

test("an app's own CSS restyles its area, and only its area", async ({ page }, testInfo) => {
  await page.goto(`${HOME}/apps/leads`);
  const area = page.locator("[data-app-style]");
  await expect(area).toHaveCSS("background-color", "rgb(10, 10, 40)");
  // A title text part carries the theme's Material 3 type role, which the app's CSS targets.
  await expect(page.locator(".x-banner .text-title-large")).toHaveCSS("color", "rgb(255, 51, 102)");
  await expect(page.locator(".x-banner .text-title-large")).toHaveCSS("text-transform", "uppercase");
  await expect(page.locator(".app-frame__bar")).not.toHaveCSS("background-color", "rgb(10, 10, 40)");
  await expect(area).toHaveCSS("contain", "paint");
  await page.screenshot({ path: testInfo.outputPath("styled-app.png") });
});

test("a calculated total shows in the list, the totals and the form, follows an edit, and a named formula shows with it", async ({ page }, testInfo) => {
  // The Orders fixture: total = price × quantity (D-78), worked out on every read; "With VAT" is the app's named formula.
  await page.goto(`${HOME}/apps/orders`);
  const mug = page.getByRole("row", { name: /Mug/u }).first();
  await expect(mug).toContainText("50.00");
  await expect(mug).toContainText("60.00");
  const totals = page.locator(".app-node--totals");
  await expect(totals).toContainText("250.00");
  await expect(totals).toContainText("300.00"); // the grand total, summed from the records' worked-out totals
  await page.screenshot({ path: testInfo.outputPath("orders-list.png") });

  // The edit form shows the total read-only, works it out as the person types, and never sends it.
  await mug.click();
  await expect(page.locator(".app-node--text")).toContainText("Mug: 60.00 with VAT");
  const total = page.getByTestId("app-form-calculated");
  await expect(total.locator("input")).toHaveValue("50.00");
  await expect(total).toContainText("Calculated");
  await expect(total.locator("input")).toHaveAttribute("readonly", "");
  await page.locator(".app-form").getByLabel("Quantity").fill("6");
  await expect(total.locator("input")).toHaveValue("75.00");
  await page.screenshot({ path: testInfo.outputPath("orders-form.png") });
  await page.locator(".app-form").getByRole("button", { name: "Save" }).click();
  await expect(snackbar(page)).toHaveText("Saved Mug");
  await expect(page.getByRole("row", { name: /Mug/u }).first()).toContainText("75.00");
  await expect(totals).toContainText("325.00");

  // The Data tab: the total is a column that can't be sorted, which a line says, and a new record's dialog works it
  // out too.
  await page.goto(`${HOME}/apps/data/orders`);
  await expect(page.getByRole("row", { name: /Mug/u })).toContainText("75.00");
  await expect(page.getByRole("columnheader", { name: "Total" })).not.toHaveClass(/sortable/u);
  await expect(page.getByRole("columnheader", { name: "Price" })).toHaveClass(/sortable/u);
  await expect(page.getByTestId("apps-table-calculated-note")).toHaveText("Search and sorting leave out Total: it's calculated each time a record is shown, not stored.");
  await page.getByRole("button", { name: "New record" }).click();
  const dialog = page.locator(".v-overlay--active .v-card");
  await dialog.getByLabel("Item *").fill("Pen");
  await dialog.getByLabel("Price").fill("3");
  await dialog.getByLabel("Quantity").fill("2");
  await expect(dialog.getByLabel("Total")).toHaveValue("6.00");
  await expect(dialog).toContainText("Calculated: =price * quantity");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("row", { name: /Pen/u })).toContainText("6.00");
  await page.screenshot({ path: testInfo.outputPath("orders-data.png") });

  // Fields says why a calculated field can't be filtered, sorted or grouped by. Removing a field the total is worked out
  // from lists the apps using it and warns about the total too.
  await page.getByRole("button", { name: "Fields" }).click();
  await expect(page.getByTestId("apps-fields-calculated-note")).toContainText("Calculated fields aren't stored, so lists can't be filtered, sorted or grouped by them.");
  await page.locator(".v-list-item").filter({ hasText: "quantity · number" }).getByRole("button", { name: "Remove…" }).click();
  const removal = page.locator(".field-removal");
  await expect(removal).toContainText("Remove Quantity from Orders?");
  await expect(removal.locator("li")).toHaveText(["Orders: form field, column"]);
  await expect(removal).toContainText("Total is worked out from it, and will show “—” until the Builder changes its formula.");
  await removal.getByRole("button", { name: "Keep it" }).click();
  await expect(page.getByText("Fields of Orders")).toBeVisible();
});

test("on a phone the Data tab's buttons all fit, New record included", async ({ page }, testInfo) => {
  // The bar wraps onto a second line instead of pushing New record past the screen's edge.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${HOME}/apps/data/orders`);
  await expect(page.getByRole("row", { name: /Mug/u })).toBeVisible();
  for (const name of ["Fields", "Import", "Export", "New record"]) await expect(page.getByRole("button", { name })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "New record" }).click();
  await expect(page.locator(".v-overlay--active .v-card").getByLabel("Item *")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("data-tab-phone.png") });
});
