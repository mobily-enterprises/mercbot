import path from "node:path";
import type { TestInfo } from "@playwright/test";
import { connectTestDb, directChat, expect, expectRefusal, HOME, homeApi, openShell, shell, test, type Page } from "./harness";

// A bot's Instructions (D-98): in the Details of its card (Team's, or beside its direct chat, D-112), the template it
// points at (read-only, with Change template) and its own additions, which the bot also changes on a card in a chat
// when asked. Each test makes its own bot in the owner's fixture home, its direct chat with no introduction to sit
// through, and deletes it. The target's AI is the stand-in model (tools/standInModel.mjs), which says a bot's additions
// as its system prompt has them when asked "What are your additions?", and calls change_additions when told "Change
// your additions to: …". Run with:
// vibe64-helper playwright --target test-app test tests/e2e/instructions.spec.ts
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

type Bot = { id: string; name: string; chatId: string };
const card = (page: Page, bot: Bot) => shell.details(page, `${bot.name}'s card`);
const additions = (page: Page, bot: Bot) => card(page, bot).getByRole("button", { name: "Edit additions" });
/** Where a screenshot goes: SHOTS_DIR when a run collects them, else the test's own output folder. */
const shot = (info: TestInfo, name: string) => (process.env.SHOTS_DIR ? path.join(process.env.SHOTS_DIR, name) : info.outputPath(name));

/** A bot made through the API, with its direct chat, the chat it starts in, past its introduction. */
async function makeBot(page: Page): Promise<Bot> {
  const name = `Quill ${Date.now().toString(36)}`;
  const { bot } = await (await homeApi(page)).post("/bots", { name, color: "#1E86FC" });
  const chat = await directChat(page, String(bot.id));
  const knex = connectTestDb();
  try {
    await knex("conversations").where({ id: chat.id }).update({ onboarding_step: null });
  } finally {
    await knex.destroy();
  }
  return { id: String(bot.id), name, chatId: String(chat.id) };
}

async function deleteBot(page: Page, bot: Bot) {
  if (page.url() !== "about:blank") await page.goto("about:blank");
  await (await homeApi(page)).del(`/bots/${bot.id}`);
}

/** The bot's card, from its direct chat's details, at its Details tab. */
async function showCard(page: Page, bot: Bot) {
  await shell.chat(page).getByRole("button", { name: `${bot.name} details` }).click();
  await card(page, bot).getByRole("tab", { name: "Details" }).click();
  await expect(card(page, bot).getByText("Instructions", { exact: true })).toBeVisible();
}

/** The bot's direct chat, past the first-run introduction a new account sees once, with its card open beside it. */
async function openDetails(page: Page, bot: Bot) {
  await openShell(page, `?chat=${bot.chatId}`);
  await showCard(page, bot);
}

/** Sends `text` in the bot's direct chat and resolves once the bot's reply is in. */
async function say(page: Page, bot: Bot, text: string) {
  const composer = shell.chat(page).getByRole("textbox", { name: `Message ${bot.name}` });
  const replied = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/chats/${bot.chatId}/reply`));
  await composer.fill(text);
  await composer.press("Enter");
  await replied;
}

test("Details shows the bot's template read-only and its additions, which are saved, kept, read by every reply, and changed on a card", async ({ page }) => {
  const bot = await makeBot(page);
  try {
    await openDetails(page, bot);
    const panel = card(page, bot);
    // A bot made with nothing in mind is a general bot, from Mercbot's library, with nothing added.
    await expect(panel.locator(".mb-instructions__sentence")).toHaveText("This bot is a general bot, with nothing added yet.");
    await expect(panel.getByRole("button", { name: "Template general from Mercbot's library. Open its instructions" }), "its tag under its name").toBeVisible();
    await expect(panel.locator(".mb-instructions__template")).toContainText("Mercbot's library");
    await expect(panel.locator(".mb-instructions__template")).toContainText("You have no particular job");
    await expect(additions(page, bot)).toHaveText("Nothing added. Tweaks here apply only to this bot.");
    await expect(panel.locator(".mb-instructions__template").getByRole("textbox"), "the template has no box to edit").toHaveCount(0);

    // Cancel leaves them as they were.
    await additions(page, bot).click();
    const box = panel.getByRole("textbox", { name: "Additions" });
    await expect(box).toBeFocused();
    await box.fill("Never mind.");
    await panel.getByRole("button", { name: "Cancel" }).click();
    await expect(additions(page, bot)).toHaveText("Nothing added. Tweaks here apply only to this bot.");

    // Too long: refused in the server's words, under the box, and nothing changes.
    await additions(page, bot).click();
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
    await expect(additions(page, bot)).toHaveText(rules);
    await expect(panel.getByRole("button", { name: "Template general from Mercbot's library, with additions. Open its instructions" }), "its tag gets its +").toBeVisible();
    await expect(panel.locator(".mb-instructions__sentence")).toHaveText("This bot is a general bot, plus its own additions.");

    await page.reload();
    await showCard(page, bot);
    await expect(additions(page, bot)).toHaveText(rules);

    // A reply's system prompt carries them: the stand-in says them as its prompt has them.
    await say(page, bot, "What are your additions?");
    await expect(shell.chat(page).getByText("My additions: Reply in British English.", { exact: false })).toBeVisible();

    // Asked in the chat, the bot shows the change on a card, and only the person's yes makes it.
    await say(page, bot, "Change your additions to: Reply in haiku.");
    const choice = shell.chat(page).locator(".mb-choice").filter({ hasText: "Shall I change my additions to this?" });
    await expect(choice.locator(".mb-choice__change-text")).toHaveText([rules, "Reply in haiku."]);
    await expect(additions(page, bot), "nothing changes before the yes").toHaveText(rules);
    await choice.getByRole("button", { name: "Go ahead" }).click();
    await expect(shell.chat(page).getByText(`Changed ${bot.name}'s additions`)).toBeVisible();
    await expect(additions(page, bot), "its card reads them again").toHaveText("Reply in haiku.");
    await say(page, bot, "What are your additions?");
    await expect(shell.chat(page).getByText("My additions: Reply in haiku.", { exact: false }), "the next reply has them").toBeVisible();
  } finally {
    await deleteBot(page, bot);
  }
});

test("Change template points the bot at another template, keeps its additions, and the bot says so and greets as itself", async ({ page }) => {
  const bot = await makeBot(page);
  try {
    await (await homeApi(page)).patch(`/bots/${bot.id}`, { additions: "We're vegetarian." });
    await openDetails(page, bot);
    const panel = card(page, bot);
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
    // In the person's direct chat with it, the chat open here: the line, then the new template's greeting, as itself.
    await expect(shell.chat(page).getByText("Now a meals bot")).toBeVisible();
    await expect(shell.chat(page).getByText(`I'm ${bot.name}. I plan your family's dinners`, { exact: false }), "the new template's greeting, as itself").toBeVisible();
    await expect(panel.locator(".mb-instructions__sentence")).toHaveText("This bot is a meals bot, plus its own additions.");
    await expect(panel.locator(".mb-instructions__template")).toContainText("Skills: Setup interview");
    await expect(additions(page, bot), "its additions stay").toHaveText("We're vegetarian.");
    await expect(panel.getByRole("button", { name: "Template meals from Mercbot's library, with additions. Open its instructions" })).toBeVisible();
  } finally {
    await deleteBot(page, bot);
  }
});

// Instructions, the tag and Change template beside the card's other sections, the tag on Team, and the card in the
// chat, at desktop and phone width, light and dark.
test("Instructions, the tag and Change template look like the rest of the app, on a desktop and a phone, light and dark", async ({ page }, info) => {
  const bot = await makeBot(page);
  try {
    const api = await homeApi(page);
    await api.put(`/bots/${bot.id}/template`, { library: "weekly-meal-planner" });
    await api.patch(`/bots/${bot.id}`, { additions: "We're vegetarian, and Thursday is pizza night.\nKeep the shopping list grouped by aisle." });
    for (const [width, height, device] of [[1440, 900, "desktop"], [390, 844, "phone"]] as const) {
      for (const scheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme: scheme });
        if (device === "desktop") {
          await openShell(page, `?chat=${bot.chatId}`);
          await expect(shell.chat(page).getByText("Now a meals bot")).toBeVisible();
          // Its tag beside its name on Team.
          await openShell(page, "?team=1");
          await expect(shell.team(page).getByRole("button", { name: `${bot.name}, Bot · made by you` })).toContainText("meals");
          await page.screenshot({ path: shot(info, `tags-team-${device}-${scheme}.png`) });
        }
        await openDetails(page, bot);
        const panel = card(page, bot);
        const box = await panel.boundingBox();
        expect(box && box.x >= 0 && box.x + box.width <= width + 1, `the card fits the ${device}'s width`).toBe(true);
        await page.screenshot({ path: shot(info, `instructions-${device}-${scheme}.png`) });
        await additions(page, bot).click();
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
    const choice = shell.chat(page).locator(".mb-choice").filter({ hasText: "Shall I change my additions to this?" });
    await expect(choice).toBeVisible();
    await choice.screenshot({ path: shot(info, "additions-card-desktop-light.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(choice).toBeVisible();
    await choice.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot(info, "additions-card-phone-dark.png") });
  } finally {
    await deleteBot(page, bot);
  }
});
