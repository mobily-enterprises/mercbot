import knexLib from "knex";
import { expect, expectRefusal, test, testDatabaseName, type Page } from "./harness";

// A bot's Instructions (D-95), in its Details panel and on the card the bot leaves when asked to change them. Each test
// makes its own bot in the owner's fixture home, with no introduction to sit through, and deletes it. The target's AI
// is the stand-in model (tools/standInModel.mjs), which says a bot's instructions as its system prompt has them when
// asked "What are your instructions?", and calls change_instructions when told "Change your instructions to: …". Run
// with: vibe64-helper playwright --target test-app test tests/e2e/instructions.spec.ts
const HOME = "/w/you";
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

const chat = (page: Page) => page.getByRole("main", { name: "Chat" });
const details = (page: Page) => page.getByRole("complementary", { name: "Details" });

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

test("Instructions are written in Details, saved, kept across a reload, read by every reply, and changed by the bot on a card", async ({ page }) => {
  const bot = await makeBot(page);
  try {
    await openDetails(page, bot);
    const shown = details(page).getByRole("button", { name: "Edit instructions" });
    await expect(shown, "a scratch bot has none: the box says what to write").toHaveText(`What ${bot.name} is for, how you like things done and where it should stop and ask. It reads these before every reply.`);
    await page.screenshot({ path: test.info().outputPath("instructions-none-desktop-light.png") });

    // Cancel leaves them as they were.
    await shown.click();
    const box = details(page).getByRole("textbox", { name: "Instructions" });
    await expect(box).toBeFocused();
    await box.fill("Never mind.");
    await details(page).getByRole("button", { name: "Cancel" }).click();
    await expect(shown).toContainText("What ");

    // Too long: refused in the server's words, under the box, and nothing changes.
    await shown.click();
    expectRefusal(`400 PATCH /api${HOME}/bots/${bot.id}`);
    await box.fill("x".repeat(20001));
    await details(page).getByRole("button", { name: "Save" }).click();
    await expect(details(page).getByRole("alert")).toHaveText(/^Instructions can be up to 20,000 characters, and these are 20,001\./u);
    await expect(box, "still open to fix").toBeVisible();

    const rules = "Reply in British English.\nAlways ask before booking anything.";
    await box.fill(rules);
    const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname.endsWith(`/bots/${bot.id}`));
    await details(page).getByRole("button", { name: "Save" }).click();
    expect((await saved).request().postDataJSON()).toEqual({ instructions: rules });
    await expect(page.getByText("Instructions saved")).toBeVisible();
    await expect(shown).toHaveText(rules);

    await page.reload();
    await chat(page).getByRole("button", { name: `${bot.name} details` }).click();
    await expect(details(page).getByRole("button", { name: "Edit instructions" })).toHaveText(rules);

    // A reply's system prompt carries them: the stand-in says them as its prompt has them.
    await say(page, bot, "What are your instructions?");
    await expect(chat(page).getByText("My instructions: Reply in British English.", { exact: false })).toBeVisible();

    // Asked in the chat, the bot shows the change on a card, and only the person's yes makes it.
    await say(page, bot, "Change your instructions to: Reply in haiku.");
    const card = chat(page).locator(".mb-choice").filter({ hasText: "Shall I change my instructions to this?" });
    await expect(card.locator(".mb-choice__change-text")).toHaveText([rules, "Reply in haiku."]);
    await expect(details(page).getByRole("button", { name: "Edit instructions" }), "nothing changes before the yes").toHaveText(rules);
    await card.getByRole("button", { name: "Go ahead" }).click();
    await expect(chat(page).getByText(`Changed ${bot.name}'s instructions`)).toBeVisible();
    await expect(details(page).getByRole("button", { name: "Edit instructions" }), "Details reads them again").toHaveText("Reply in haiku.");
    await say(page, bot, "What are your instructions?");
    await expect(chat(page).getByText("My instructions: Reply in haiku.", { exact: false }), "the next reply has them").toBeVisible();
  } finally {
    await deleteBot(page, bot);
  }
});

// The Instructions box beside the panel's other sections, and the card, at desktop and phone width, light and dark.
test("Instructions and the change card look like the rest of the panel and the chat, on a desktop and a phone, light and dark", async ({ page }, info) => {
  const bot = await makeBot(page);
  try {
    await page.request.patch(`/api${HOME}/bots/${bot.id}`, {
      data: { instructions: "Plan our week's meals around what's in season.\nKeep the shopping list in one place, grouped by aisle.\nAlways ask before ordering anything." },
      headers: { "csrf-token": bot.csrfToken }
    });
    for (const [width, height, device] of [[1440, 900, "desktop"], [390, 844, "phone"]] as const) {
      for (const scheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme: scheme });
        await openDetails(page, bot);
        const panel = details(page);
        const box = await panel.boundingBox();
        expect(box && box.x >= 0 && box.x + box.width <= width + 1, `the panel fits the ${device}'s width`).toBe(true);
        await panel.getByRole("button", { name: "Edit instructions" }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`instructions-${device}-${scheme}.png`) });
        await panel.getByRole("button", { name: "Edit instructions" }).click();
        await panel.getByRole("button", { name: "Save" }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`instructions-editing-${device}-${scheme}.png`) });
        await panel.getByRole("button", { name: "Cancel" }).click();
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await openDetails(page, bot);
    await say(page, bot, "Change your instructions to: Plan our week's meals around what's in season.\nAlways ask before ordering anything.");
    const card = chat(page).locator(".mb-choice").filter({ hasText: "Shall I change my instructions to this?" });
    await expect(card).toBeVisible();
    await card.screenshot({ path: info.outputPath("instructions-card-desktop-light.png") });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("instructions-card-phone-dark.png") });
  } finally {
    await deleteBot(page, bot);
  }
});
