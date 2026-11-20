import path from "node:path";
import knexLib from "knex";
import type { TestInfo } from "@playwright/test";
import { expect, expectRefusal, test, testDatabaseName, type Page } from "./harness";

// A bot's Instructions (D-98): in its Details panel, the template it points at (read-only, with Change template) and its
// own additions, which the bot also changes on a card when asked. Each test makes its own bot in the owner's fixture
// home, with no introduction to sit through, and deletes it. The target's AI is the stand-in model
// (tools/standInModel.mjs), which says a bot's additions as its system prompt has them when asked "What are your
// additions?", and calls change_additions when told "Change your additions to: …". Run with:
// vibe64-helper playwright --target test-app test tests/e2e/instructions.spec.ts
const HOME = "/w/you";
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

const chat = (page: Page) => page.getByRole("main", { name: "Chat" });
const details = (page: Page) => page.getByRole("complementary", { name: "Details" });
const additions = (page: Page) => details(page).getByRole("button", { name: "Edit additions" });
/** Where a screenshot goes: SHOTS_DIR when a run collects them, else the test's own output folder. */
const shot = (info: TestInfo, name: string) => (process.env.SHOTS_DIR ? path.join(process.env.SHOTS_DIR, name) : info.outputPath(name));

/** A bot made through the API, opened straight into its chat (its introduction skipped); resolves with its id and name. */
async function makeBot(page: Page) {
  const name = `Quill ${Date.now().toString(36)}`;
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const answer = await page.request.post(`/api${HOME}/bots`, { data: { name, color: "#1E86FC" }, headers: { "csrf-token": csrfToken } });
  expect(answer.ok()).toBe(true);
  const { bot } = await answer.json();
  const knex = knexLib({ client: "pg", connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() } });
  try {
    await knex("bot_conversations").where({ bot_id: bot.id }).update({ onboarding_step: null });
  } finally {
    await knex.destroy();
  }
  return { id: String(bot.id), name, csrfToken: csrfToken as string };
}

async function deleteBot(page: Page, bot: { id: string; csrfToken: string }) {
  if (page.url() !== "about:blank") await page.goto("about:blank");
  expect((await page.request.delete(`/api${HOME}/bots/${bot.id}`, { headers: { "csrf-token": bot.csrfToken } })).ok()).toBe(true);
}

/** The bot's chat, past the first-run introduction a new account sees once, with its Details panel open. */
async function openDetails(page: Page, bot: { id: string; name: string }) {
  await page.goto(`${HOME}?bot=${bot.id}`);
  const next = page.getByRole("button", { name: "Next" });
  const shell = page.locator(".mb-shell");
  await expect(shell.or(next).first()).toBeVisible();
  if (await next.isVisible()) {
    for (let slide = 0; slide < 3; slide += 1) await next.click();
  }
  await chat(page).getByRole("button", { name: `${bot.name} details` }).click();
  await expect(details(page).getByText("Instructions", { exact: true })).toBeVisible();
}

/** Sends `text` in the bot's chat and resolves once the bot's reply is in. */
async function say(page: Page, bot: { id: string; name: string }, text: string) {
  const composer = chat(page).getByRole("textbox", { name: `Message ${bot.name}` });
  const replied = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/bots/${bot.id}/reply`));
  await composer.fill(text);
  await composer.press("Enter");
  await replied;
}

test("Details shows the bot's template read-only and its additions, which are saved, kept, read by every reply, and changed on a card", async ({ page }) => {
  const bot = await makeBot(page);
  try {
    await openDetails(page, bot);
    const panel = details(page);
    // A bot made with nothing in mind is a general bot, from Mercbot's library, with nothing added.
    await expect(panel.locator(".mb-instructions__sentence")).toHaveText("This bot is a general bot, with nothing added yet.");
    await expect(panel.getByRole("button", { name: "Template general from Mercbot's library. Open its instructions" }), "its tag under its name").toBeVisible();
    await expect(panel.locator(".mb-instructions__template")).toContainText("Mercbot's library");
    await expect(panel.locator(".mb-instructions__template")).toContainText("You have no particular job");
    await expect(additions(page)).toHaveText("Nothing added. Tweaks here apply only to this bot.");
    await expect(panel.locator(".mb-instructions__template").getByRole("textbox"), "the template has no box to edit").toHaveCount(0);

    // Cancel leaves them as they were.
    await additions(page).click();
    const box = panel.getByRole("textbox", { name: "Additions" });
    await expect(box).toBeFocused();
    await box.fill("Never mind.");
    await panel.getByRole("button", { name: "Cancel" }).click();
    await expect(additions(page)).toHaveText("Nothing added. Tweaks here apply only to this bot.");

    // Too long: refused in the server's words, under the box, and nothing changes.
    await additions(page).click();
    expectRefusal(`400 PATCH /api${HOME}/bots/${bot.id}`);
    await box.fill("x".repeat(20001));
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(panel.getByRole("alert")).toHaveText(/^Additions can be up to 20,000 characters, and these are 20,001\./u);
    await expect(box, "still open to fix").toBeVisible();

    const rules = "Reply in British English.\nAlways ask before booking anything.";
    await box.fill(rules);
    const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname.endsWith(`/bots/${bot.id}`));
    await panel.getByRole("button", { name: "Save" }).click();
    expect((await saved).request().postDataJSON()).toEqual({ additions: rules });
    await expect(page.getByText("Additions saved")).toBeVisible();
    await expect(additions(page)).toHaveText(rules);
    await expect(panel.getByRole("button", { name: "Template general from Mercbot's library, with additions. Open its instructions" }), "its tag gets its +").toBeVisible();
    await expect(panel.locator(".mb-instructions__sentence")).toHaveText("This bot is a general bot, plus its own additions.");

    await page.reload();
    await chat(page).getByRole("button", { name: `${bot.name} details` }).click();
    await expect(additions(page)).toHaveText(rules);

    // A reply's system prompt carries them: the stand-in says them as its prompt has them.
    await say(page, bot, "What are your additions?");
    await expect(chat(page).getByText("My additions: Reply in British English.", { exact: false })).toBeVisible();

    // Asked in the chat, the bot shows the change on a card, and only the person's yes makes it.
    await say(page, bot, "Change your additions to: Reply in haiku.");
    const card = chat(page).locator(".mb-choice").filter({ hasText: "Shall I change my additions to this?" });
    await expect(card.locator(".mb-choice__change-text")).toHaveText([rules, "Reply in haiku."]);
    await expect(additions(page), "nothing changes before the yes").toHaveText(rules);
    await card.getByRole("button", { name: "Go ahead" }).click();
    await expect(chat(page).getByText(`Changed ${bot.name}'s additions`)).toBeVisible();
    await expect(additions(page), "Details reads them again").toHaveText("Reply in haiku.");
    await say(page, bot, "What are your additions?");
    await expect(chat(page).getByText("My additions: Reply in haiku.", { exact: false }), "the next reply has them").toBeVisible();
  } finally {
    await deleteBot(page, bot);
  }
});

test("Change template points the bot at another template, keeps its additions, and the bot says so and greets as itself", async ({ page }) => {
  const bot = await makeBot(page);
  try {
    await page.request.patch(`/api${HOME}/bots/${bot.id}`, { data: { additions: "We're vegetarian." }, headers: { "csrf-token": bot.csrfToken } });
    await openDetails(page, bot);
    const panel = details(page);
    await panel.getByRole("button", { name: "Change template" }).click();
    const dialog = page.getByRole("dialog", { name: `Change ${bot.name}'s template` });
    const search = dialog.getByRole("searchbox", { name: "Search templates" });
    await expect(search, "the search has the keyboard").toBeFocused();
    await search.fill("meals");
    await dialog.getByRole("button", { name: /^Pantry/u }).click();
    await expect(dialog.getByText("Its instructions", { exact: true })).toBeVisible();
    await expect(dialog.getByText(`${bot.name}'s additions stay`)).toBeVisible();
    await expect(dialog.getByText("We're vegetarian.", { exact: true })).toBeVisible();

    // Escape on the confirm goes back to the picker, not out of the dialog.
    await page.keyboard.press("Escape");
    await expect(search).toBeFocused();
    await dialog.getByRole("button", { name: /^Pantry/u }).click();

    const changed = page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname.endsWith(`/bots/${bot.id}/template`));
    await dialog.locator(".mb-ctemp__foot").getByRole("button", { name: "Change template" }).click();
    expect((await changed).request().postDataJSON()).toEqual({ library: "weekly-meal-planner" });
    await expect(dialog).toBeHidden();
    await expect(page.getByText(`${bot.name} is now a meals bot`)).toBeVisible();
    await expect(chat(page).getByText("Now a meals bot")).toBeVisible();
    await expect(chat(page).getByText(`I'm ${bot.name}. I plan your family's dinners`, { exact: false }), "the new template's greeting, as itself").toBeVisible();
    await expect(panel.locator(".mb-instructions__sentence")).toHaveText("This bot is a meals bot, plus its own additions.");
    await expect(panel.locator(".mb-instructions__template")).toContainText("Skills: Setup interview");
    await expect(additions(page), "its additions stay").toHaveText("We're vegetarian.");
    await expect(panel.getByRole("button", { name: "Template meals from Mercbot's library, with additions. Open its instructions" })).toBeVisible();
  } finally {
    await deleteBot(page, bot);
  }
});

// Instructions, the tag and Change template beside the panel's other sections, and the card, at desktop and phone width,
// light and dark.
test("Instructions, the tag and Change template look like the rest of the app, on a desktop and a phone, light and dark", async ({ page }, info) => {
  const bot = await makeBot(page);
  try {
    await page.request.put(`/api${HOME}/bots/${bot.id}/template`, { data: { library: "weekly-meal-planner" }, headers: { "csrf-token": bot.csrfToken } });
    await page.request.patch(`/api${HOME}/bots/${bot.id}`, {
      data: { additions: "We're vegetarian, and Thursday is pizza night.\nKeep the shopping list grouped by aisle." },
      headers: { "csrf-token": bot.csrfToken }
    });
    for (const [width, height, device] of [[1440, 900, "desktop"], [390, 844, "phone"]] as const) {
      for (const scheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme: scheme });
        if (device === "desktop") {
          await page.goto(`${HOME}?bot=${bot.id}`);
          await expect(chat(page).getByText("Now a meals bot")).toBeVisible();
          await page.screenshot({ path: shot(info, `tags-sidebar-${device}-${scheme}.png`) });
        }
        await openDetails(page, bot);
        const panel = details(page);
        const box = await panel.boundingBox();
        expect(box && box.x >= 0 && box.x + box.width <= width + 1, `the panel fits the ${device}'s width`).toBe(true);
        await page.screenshot({ path: shot(info, `instructions-${device}-${scheme}.png`) });
        await additions(page).click();
        await panel.getByRole("button", { name: "Save" }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: shot(info, `instructions-editing-${device}-${scheme}.png`) });
        await panel.getByRole("button", { name: "Cancel" }).click();
        await panel.getByRole("button", { name: "Change template" }).click();
        const dialog = page.getByRole("dialog", { name: `Change ${bot.name}'s template` });
        await expect(dialog.locator("[data-template-entry]").first()).toBeVisible();
        await page.screenshot({ path: shot(info, `change-template-picker-${device}-${scheme}.png`) });
        await dialog.getByRole("searchbox", { name: "Search templates" }).fill("bills");
        await dialog.locator("[data-template-entry]").first().click();
        await expect(dialog.getByText("Its instructions", { exact: true })).toBeVisible();
        // The confirm slides in over the picker, which fades out: the shot is of where they settle.
        await expect(dialog.locator(".mb-ctemp__picker")).toHaveCSS("opacity", "0");
        await expect(dialog.locator(".mb-ctemp__step")).toHaveCSS("opacity", "1");
        await page.screenshot({ path: shot(info, `change-template-confirm-${device}-${scheme}.png`) });
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await openDetails(page, bot);
    await say(page, bot, "Change your additions to: We're vegetarian.\nKeep the shopping list grouped by aisle.");
    const card = chat(page).locator(".mb-choice").filter({ hasText: "Shall I change my additions to this?" });
    await expect(card).toBeVisible();
    await card.screenshot({ path: shot(info, "additions-card-desktop-light.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot(info, "additions-card-phone-dark.png") });
  } finally {
    await deleteBot(page, bot);
  }
});
