import path from "node:path";
import type { TestInfo } from "@playwright/test";
import { connectTestDb, directChat, expect, homeApi, makeChat, openShell, shell, test, type Page } from "./harness";

// What a bot knows (D-107): the Knowledge section of its card's Details tab (Team's, or beside its direct chat,
// D-112), under its Instructions. Each test makes its own bot in the owner's fixture home, its direct chat with no
// introduction to sit through, and deletes it. The target's AI is the stand-in model (tools/standInModel.mjs), which,
// asked "What do you know about …?", answers with the first line of its knowledge naming it and where that's from: its
// system prompt's in-mind pieces, or the parts the current state's search found. Run with:
// vibe64-helper playwright --target test-app test tests/e2e/knowledge.spec.ts
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

type Bot = { id: string; name: string; chatId: string };
const card = (page: Page, bot: Bot) => shell.details(page, `${bot.name}'s card`);
const section = (page: Page, bot: Bot) => card(page, bot).getByRole("region", { name: "Knowledge" });
const piece = (page: Page, bot: Bot, title: string) => section(page, bot).locator(`[data-knowledge="${title}"]`);
const editor = (page: Page) => page.getByRole("dialog").filter({ has: page.locator(".mb-kedit") });
/** Where a screenshot goes: SHOTS_DIR when a run collects them, else the test's own output folder. */
const shot = (info: TestInfo, name: string) => (process.env.SHOTS_DIR ? path.join(process.env.SHOTS_DIR, name) : info.outputPath(name));

// A long guide, past what's kept in mind (40,000 characters), with one line about Fremantle in its last section.
const GUIDE = [
  ...Array.from({ length: 30 }, (_, at) => `# Aisle ${at + 1}\n\n${"Shelves are stocked from the back, oldest dates in front, labels facing out. ".repeat(28)}`),
  "# Deliveries\n\nDelivery to Fremantle costs $12 and takes two days."
].join("\n\n");

/** A bot made through the API, with its direct chat, the chat it starts in, past its introduction. */
async function makeBot(page: Page): Promise<Bot> {
  const name = `Sage ${Date.now().toString(36)}`;
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

/** The bot's direct chat, past the first-run introduction a new account sees once, with its card open at Knowledge. */
async function openKnowledge(page: Page, bot: Bot) {
  await openShell(page, `?chat=${bot.chatId}`);
  await shell.chat(page).getByRole("button", { name: `${bot.name} details` }).click();
  await card(page, bot).getByRole("tab", { name: "Details" }).click();
  await expect(section(page, bot).locator(".mb-knowledge__sentence")).toBeVisible();
  await section(page, bot).scrollIntoViewIfNeeded();
}

/** Sends `text` in the bot's direct chat and resolves once the bot's reply is in. */
async function say(page: Page, bot: Bot, text: string) {
  const composer = shell.chat(page).getByRole("textbox", { name: `Message ${bot.name}` });
  const replied = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/chats/${bot.chatId}/reply`));
  await composer.fill(text);
  await composer.press("Enter");
  await replied;
}

/** Pastes a piece of text in the editor and adds it. */
async function addText(page: Page, bot: Bot, title: string, text: string) {
  await section(page, bot).getByRole("button", { name: "Add text" }).click();
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
    const known = section(page, bot);
    await expect(known.locator(".mb-knowledge__sentence"))
      .toHaveText(`${bot.name} knows nothing extra yet. Add text or a file, such as a price list, a manual or a book.`);
    // Under it, what the bot remembers (D-113): nothing yet for a new bot, then the home's notes for everyone.
    const memory = card(page, bot).getByRole("region", { name: "Memory" });
    await expect(memory.locator(".mb-memory__sentence").first())
      .toHaveText(`${bot.name} doesn't remember anything yet. It remembers what's said in the public chats it's in, never a private chat.`);
    await expect(memory).toContainText("Notes for everyone");

    await addText(page, bot, "Opening hours", "We open at 9am on Saturdays.\nWe close at noon on Sundays.");
    await expect(known.locator(".mb-knowledge__sentence")).toHaveText(`What ${bot.name} knows, in every chat it's in.`);
    await expect(piece(page, bot, "Opening hours")).toContainText("57 characters · Always in mind");
    await expect(known.locator(".mb-knowledge__summary")).toContainText("Always in mind: 57 characters, read with every message.");
    await expect(known.locator(".mb-knowledge__summary"), "57 characters cost less than money shows").toContainText("Adds less than $0.0001 to each message.");

    await addText(page, bot, "Shop guide", GUIDE);
    await expect(piece(page, bot, "Shop guide"), "got ready in the background, then searched").toContainText(`${GUIDE.length.toLocaleString("en")} characters · Searched first`);
    await expect(known.locator(".mb-knowledge__summary")).toContainText("Each message reads only the parts that match.");
    const summary = (await known.locator(".mb-knowledge__summary").textContent()) || "";
    const [, full, cached] = summary.match(/Adds about (\$0\.\d+) to each message(?:, or about (\$0\.\d+) while it's still cached from a recent one)?\./u) || [];
    expect(full, "a search's parts go with each message").toBeTruthy();
    expect(cached, "the cached figure is said only when it reads differently").not.toBe(full);

    // Opened, a piece shows its whole text, to change.
    await piece(page, bot, "Opening hours").getByRole("button").first().click();
    await expect(editor(page).getByRole("textbox", { name: "Text" })).toHaveValue("We open at 9am on Saturdays.\nWe close at noon on Sundays.");
    await editor(page).getByRole("button", { name: "Cancel" }).click();

    await say(page, bot, "What do you know about Saturdays?");
    await expect(shell.chat(page).getByText("We open at 9am on Saturdays. (from «Opening hours»)"), "in mind: from its instructions").toBeVisible();
    await say(page, bot, "What do you know about Fremantle?");
    await expect(shell.chat(page).getByText(/^Delivery to Fremantle costs \$12 and takes two days\. \(from «Shop guide», part \d+ \(Deliveries\)\)$/u),
      "searched first: from the part the turn's search found, with where it's from").toBeVisible();

    // Removed, it's no longer known.
    await piece(page, bot, "Shop guide").getByRole("button", { name: "Remove Shop guide" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
    await expect(piece(page, bot, "Shop guide")).toHaveCount(0);
    await say(page, bot, "What do you know about Fremantle?");
    await expect(shell.chat(page).getByText("My knowledge doesn't say anything about Fremantle.")).toBeVisible();
  } finally {
    await deleteBot(page, bot);
  }
});

test("Memory: a bot's card shows what it remembers of its public chats, and a note's author removes it", async ({ page }) => {
  const bot = await makeBot(page);
  const stamp = Date.now().toString(36);
  const said = `The tomatoes go in on the fourteenth (${stamp}).`;
  const knex = connectTestDb();
  let noteId: string | null = null;
  let gardenId: string | null = null;
  try {
    const api = await homeApi(page);
    const garden = await makeChat(page, { title: `Garden ${stamp}`, bots: [bot.id] });
    gardenId = String(garden.id);
    await api.post(`/chats/${garden.id}/messages`, { text: said });
    // Another public chat of the bot's, deleted: it forgets it at once and its memory is made again from its other
    // chats, by the serving server straight away (D-113), the target's stand-in model writing it.
    const shed = await makeChat(page, { title: `Shed ${stamp}`, bots: [bot.id] });
    await api.post(`/chats/${shed.id}/messages`, { text: `The mower's blade is blunt (${stamp}).` });
    await api.del(`/chats/${shed.id}`);
    await expect.poll(async () => (await api.get(`/bots/${bot.id}/memory`)).memory?.text || "", { timeout: 20000 }).toContain(said);
    // A note for everyone, as a yes on its card writes one: asked for by the bot's maker, through the bot.
    const made = await knex("bots").where({ id: bot.id }).first();
    expect(made.made_by, "the bot's maker").toBeTruthy();
    const text = `Bins go out on Tuesdays ${stamp}`;
    const [note] = await knex("home_notes")
      .insert({ workspace_id: made.workspace_id, text, by_user_id: made.made_by, via_bot_id: bot.id, from_conversation_id: garden.id })
      .returning("id");
    noteId = String(note.id);

    await openKnowledge(page, bot);
    const memory = card(page, bot).getByRole("region", { name: "Memory" });
    await expect(memory.locator(".mb-memory__sentence").first()).toContainText(`What ${bot.name} remembers of the public chats it's in, made `);
    await expect(memory.locator("[data-memory]")).toContainText(said);
    await expect(memory.locator("[data-memory]"), "the deleted chat is forgotten").not.toContainText("blade");
    const listed = memory.locator(`[data-note="${text}"]`);
    await expect(listed).toContainText(`via ${bot.name}`);

    await listed.getByRole("button", { name: `Remove the note: ${text}` }).click();
    const dialog = page.getByRole("dialog").filter({ hasText: "Remove this note?" });
    await expect(dialog).toContainText(`Every bot stops reading it from its next reply: “${text}”`);
    await dialog.getByRole("button", { name: "Remove" }).click();
    await expect(listed).toHaveCount(0);
    const kept = await knex("home_notes").where({ id: noteId }).first();
    expect(kept.removed_at, "kept, as removed").toBeTruthy();
    expect(String(kept.removed_by), "by its author").toBe(String(made.made_by));
  } finally {
    if (noteId) await knex("home_notes").where({ id: noteId }).del();
    await knex.destroy();
    if (gardenId) await (await homeApi(page)).del(`/chats/${gardenId}`);
    await deleteBot(page, bot);
  }
});

test("Knowledge: a file is added from the computer and read; one that can't be says what to do and offers Try again", async ({ page }) => {
  const bot = await makeBot(page);
  try {
    await openKnowledge(page, bot);
    await section(page, bot).getByLabel("Add file").setInputFiles([
      { name: "Price list.txt", mimeType: "text/plain", buffer: Buffer.from("Bread: $5\nMilk: $2\n") },
      { name: "Backup.zip", mimeType: "application/zip", buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0x08, 0, 1, 2, 3]) }
    ]);
    await expect(piece(page, bot, "Price list.txt")).toContainText("18 characters · Always in mind");
    await expect(piece(page, bot, "Backup.zip")).toContainText("Mercbot can't read text from this kind of file. Add a document, PDF, spreadsheet, presentation or text file, or paste the text.");
    await expect(piece(page, bot, "Backup.zip").getByRole("button", { name: "Try again" })).toBeVisible();
    await say(page, bot, "What do you know about milk?");
    await expect(shell.chat(page).getByText("Milk: $2 (from «Price list.txt»)")).toBeVisible();
    // It's in the bot's own files for everyone (no chat's), in Knowledge.
    const listed = await (await homeApi(page)).get(`/files?folder=${encodeURIComponent("/files/bot/Knowledge")}&bot=${bot.id}`);
    expect(JSON.stringify(listed)).toContain("Price list.txt");
  } finally {
    await deleteBot(page, bot);
  }
});

// The section and its editor beside the card's other sections, at desktop and phone width, light and dark.
test("Knowledge looks like the rest of the app, on a desktop and a phone, light and dark", async ({ page }, info) => {
  const bot = await makeBot(page);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
    await openKnowledge(page, bot);
    await page.screenshot({ path: shot(info, "knowledge-empty-desktop-light.png") });
    const api = await homeApi(page);
    for (const data of [{ title: "Opening hours", text: "We open at 9am on Saturdays." }, { title: "Shop guide", text: GUIDE }]) {
      await api.post(`/bots/${bot.id}/knowledge`, data);
    }
    for (const [width, height, device] of [[1440, 900, "desktop"], [390, 844, "phone"]] as const) {
      for (const scheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme: scheme });
        await openKnowledge(page, bot);
        await expect(piece(page, bot, "Shop guide")).toContainText("Searched first");
        const box = await section(page, bot).boundingBox();
        expect(box && box.x >= 0 && box.x + box.width <= width + 1, `the section fits the ${device}'s width`).toBe(true);
        await page.screenshot({ path: shot(info, `knowledge-${device}-${scheme}.png`) });
        await section(page, bot).getByRole("button", { name: "Add text" }).click();
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
