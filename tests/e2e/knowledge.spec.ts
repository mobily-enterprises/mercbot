import path from "node:path";
import knexLib from "knex";
import type { TestInfo } from "@playwright/test";
import { expect, test, testDatabaseName, type Page } from "./harness";

// What a bot knows (D-107): the Knowledge section of its Details tab, under its Instructions. Each test makes its own
// bot in the owner's fixture home, with no introduction to sit through, and deletes it. The target's AI is the stand-in
// model (tools/standInModel.mjs), which, asked "What do you know about …?", answers with the first line of its
// knowledge naming it and where that's from: its system prompt's in-mind pieces, or the parts the current state's
// search found. Run with: vibe64-helper playwright --target test-app test tests/e2e/knowledge.spec.ts
const HOME = "/w/you";
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

const chat = (page: Page) => page.getByRole("main", { name: "Chat" });
const details = (page: Page) => page.getByRole("complementary", { name: "Details" });
const section = (page: Page) => details(page).getByRole("region", { name: "Knowledge" });
const piece = (page: Page, title: string) => section(page).locator(`[data-knowledge="${title}"]`);
const editor = (page: Page) => page.getByRole("dialog").filter({ has: page.locator(".mb-kedit") });
/** Where a screenshot goes: SHOTS_DIR when a run collects them, else the test's own output folder. */
const shot = (info: TestInfo, name: string) => (process.env.SHOTS_DIR ? path.join(process.env.SHOTS_DIR, name) : info.outputPath(name));

// A long guide, past what's kept in mind (40,000 characters), with one line about Fremantle in its last section.
const GUIDE = [
  ...Array.from({ length: 30 }, (_, at) => `# Aisle ${at + 1}\n\n${"Shelves are stocked from the back, oldest dates in front, labels facing out. ".repeat(28)}`),
  "# Deliveries\n\nDelivery to Fremantle costs $12 and takes two days."
].join("\n\n");

/** A bot made through the API, opened straight into its chat (its introduction skipped); resolves with its id and name. */
async function makeBot(page: Page) {
  const name = `Sage ${Date.now().toString(36)}`;
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

/** The bot's chat, past the first-run introduction a new account sees once, with its Details panel open at Knowledge. */
async function openKnowledge(page: Page, bot: { id: string; name: string }) {
  await page.goto(`${HOME}?bot=${bot.id}`);
  const next = page.getByRole("button", { name: "Next" });
  await expect(page.locator(".mb-shell").or(next).first()).toBeVisible();
  if (await next.isVisible()) {
    for (let slide = 0; slide < 3; slide += 1) await next.click();
  }
  await chat(page).getByRole("button", { name: `${bot.name} details` }).click();
  await expect(section(page).locator(".mb-knowledge__sentence")).toBeVisible();
  await section(page).scrollIntoViewIfNeeded();
}

/** Sends `text` in the bot's chat and resolves once the bot's reply is in. */
async function say(page: Page, bot: { id: string; name: string }, text: string) {
  const composer = chat(page).getByRole("textbox", { name: `Message ${bot.name}` });
  const replied = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/bots/${bot.id}/reply`));
  await composer.fill(text);
  await composer.press("Enter");
  await replied;
}

/** Pastes a piece of text in the editor and adds it. */
async function addText(page: Page, title: string, text: string) {
  await section(page).getByRole("button", { name: "Add text" }).click();
  const dialog = editor(page);
  await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
  await dialog.getByRole("textbox", { name: "Name" }).fill(title);
  await dialog.getByRole("textbox", { name: "Text" }).fill(text);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("Knowledge: short text is always in mind, a long guide is searched first, and the bot says where its answers came from", async ({ page }) => {
  const bot = await makeBot(page);
  try {
    await openKnowledge(page, bot);
    await expect(section(page).locator(".mb-knowledge__sentence"))
      .toHaveText(`${bot.name} knows nothing extra yet. Add text or a file, such as a price list, a manual or a book.`);

    await addText(page, "Opening hours", "We open at 9am on Saturdays.\nWe close at noon on Sundays.");
    await expect(section(page).locator(".mb-knowledge__sentence")).toHaveText(`What ${bot.name} knows, for everyone it talks with.`);
    await expect(piece(page, "Opening hours")).toContainText("57 characters · Always in mind");
    await expect(section(page).locator(".mb-knowledge__summary")).toContainText("Always in mind: 57 characters, read with every message.");
    await expect(section(page).locator(".mb-knowledge__summary"), "57 characters cost less than money shows").toContainText("Adds less than $0.0001 to each message.");

    await addText(page, "Shop guide", GUIDE);
    await expect(piece(page, "Shop guide"), "got ready in the background, then searched").toContainText(`${GUIDE.length.toLocaleString("en")} characters · Searched first`);
    await expect(section(page).locator(".mb-knowledge__summary")).toContainText("Each message reads only the parts that match.");
    await expect(section(page).locator(".mb-knowledge__summary"), "a search's parts go with each message").toContainText(/Adds about \$0\.\d+ to each message, or about \$0\.\d+ while it's still cached/u);

    // Opened, a piece shows its whole text, to change.
    await piece(page, "Opening hours").getByRole("button").first().click();
    await expect(editor(page).getByRole("textbox", { name: "Text" })).toHaveValue("We open at 9am on Saturdays.\nWe close at noon on Sundays.");
    await editor(page).getByRole("button", { name: "Cancel" }).click();

    await say(page, bot, "What do you know about Saturdays?");
    await expect(chat(page).getByText("We open at 9am on Saturdays. (from «Opening hours»)"), "in mind: from its instructions").toBeVisible();
    await say(page, bot, "What do you know about Fremantle?");
    await expect(chat(page).getByText(/^Delivery to Fremantle costs \$12 and takes two days\. \(from «Shop guide», part \d+ \(Deliveries\)\)$/u),
      "searched first: from the part the turn's search found, with where it's from").toBeVisible();

    // Removed, it's no longer known.
    await piece(page, "Shop guide").getByRole("button", { name: "Remove Shop guide" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
    await expect(piece(page, "Shop guide")).toHaveCount(0);
    await say(page, bot, "What do you know about Fremantle?");
    await expect(chat(page).getByText("My knowledge doesn't say anything about Fremantle.")).toBeVisible();
  } finally {
    await deleteBot(page, bot);
  }
});

test("Knowledge: a file is added from the computer and read; one that can't be says what to do and offers Try again", async ({ page }) => {
  const bot = await makeBot(page);
  try {
    await openKnowledge(page, bot);
    await section(page).getByLabel("Add file").setInputFiles([
      { name: "Price list.txt", mimeType: "text/plain", buffer: Buffer.from("Bread: $5\nMilk: $2\n") },
      { name: "Backup.zip", mimeType: "application/zip", buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0x08, 0, 1, 2, 3]) }
    ]);
    await expect(piece(page, "Price list.txt")).toContainText("18 characters · Always in mind");
    await expect(piece(page, "Backup.zip")).toContainText("Mercbot can't read text from this kind of file. Add a document, PDF, spreadsheet, presentation or text file, or paste the text.");
    await expect(piece(page, "Backup.zip").getByRole("button", { name: "Try again" })).toBeVisible();
    await say(page, bot, "What do you know about milk?");
    await expect(chat(page).getByText("Milk: $2 (from «Price list.txt»)")).toBeVisible();
    // It's in the bot's files for everyone, in Knowledge.
    const listed = await page.request.get(`/api${HOME}/bots/${bot.id}/files?folder=${encodeURIComponent("/files/bot/Knowledge")}`);
    expect(JSON.stringify(await listed.json())).toContain("Price list.txt");
  } finally {
    await deleteBot(page, bot);
  }
});

// The section and its editor beside the panel's other sections, at desktop and phone width, light and dark.
test("Knowledge looks like the rest of the app, on a desktop and a phone, light and dark", async ({ page }, info) => {
  const bot = await makeBot(page);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await openKnowledge(page, bot);
    await page.screenshot({ path: shot(info, "knowledge-empty-desktop-light.png") });
    const headers = { "csrf-token": bot.csrfToken };
    for (const data of [{ title: "Opening hours", text: "We open at 9am on Saturdays." }, { title: "Shop guide", text: GUIDE }]) {
      expect((await page.request.post(`/api${HOME}/bots/${bot.id}/knowledge`, { data, headers })).ok()).toBe(true);
    }
    for (const [width, height, device] of [[1440, 900, "desktop"], [390, 844, "phone"]] as const) {
      for (const scheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme: scheme });
        await openKnowledge(page, bot);
        await expect(piece(page, "Shop guide")).toContainText("Searched first");
        const box = await section(page).boundingBox();
        expect(box && box.x >= 0 && box.x + box.width <= width + 1, `the section fits the ${device}'s width`).toBe(true);
        await page.screenshot({ path: shot(info, `knowledge-${device}-${scheme}.png`) });
        await section(page).getByRole("button", { name: "Add text" }).click();
        await editor(page).getByRole("textbox", { name: "Text" }).fill("Our returns policy: 30 days with a receipt.");
        // The shot is of the editor where it settles, its opening transition (the dialog's and its scrim's) over.
        const opening = page.locator(".v-overlay--active").filter({ has: page.locator(".mb-kedit") });
        await expect.poll(() => opening.evaluate((overlay) => overlay.getAnimations({ subtree: true }).filter((one) => one.playState === "running").length)).toBe(0);
        await page.screenshot({ path: shot(info, `knowledge-editor-${device}-${scheme}.png`) });
        await page.keyboard.press("Escape");
        await expect(editor(page)).toBeHidden();
      }
    }
  } finally {
    await deleteBot(page, bot);
  }
});
