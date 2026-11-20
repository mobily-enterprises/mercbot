import knexLib, { type Knex } from "knex";
import { expect, test, testDatabaseName, type Page } from "./harness";

// A Shared bot keeps each person's own chat as its last tab, "You only" (D-99), on the Test Preview target: a Private
// bot with a chat, a file in Just me and a routine is made Shared, asking first; General opens beside You only, which
// holds the chat, its file and its routine; made Private again, asking first, General's routine pauses with a line
// saying so, and the chat, its file and its routine are as they were. Each test makes its own bot and deletes it. Run
// with: vibe64-helper playwright --target test-app test tests/e2e/you-only.spec.ts
const HOME = "/w/you";
test.describe.configure({ mode: "serial" });
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

async function openHome(page: Page, query = "") {
  await page.goto(`${HOME}${query}`);
  const next = page.getByRole("button", { name: "Next" });
  const shell = page.locator(".mb-shell");
  await expect(shell.or(next).first()).toBeVisible();
  if (await next.isVisible()) {
    for (let slide = 0; slide < 3; slide += 1) await next.click();
  }
  await expect(shell).toBeVisible();
}

const chat = (page: Page) => page.getByRole("main", { name: "Chat" });
const tabs = (page: Page) => page.getByRole("navigation", { name: "Conversations" }).getByRole("tab");
const composer = (page: Page) => page.locator("textarea.mb-composer__input");
const details = (page: Page) => page.getByRole("complementary", { name: "Details" });
const sharingDialog = (page: Page) => page.locator(".v-overlay--active .mb-confirm");
const section = (page: Page, label: string | RegExp) => page.locator(".mb-files__section").filter({ has: page.locator(".mb-files__crumb", { hasText: label }) });

const connect = () => knexLib({
  client: "pg",
  connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() }
});

/**
 * A bot of the fixtures' home made for one test, `sharing` as given, whose maker's own chat with it holds a message
 * and an answer (past its introduction) and a routine; `remove` deletes it.
 */
async function botWithChat(page: Page, knex: Knex, sharing: string) {
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const headers = { "csrf-token": csrfToken };
  const name = `Ledger ${Date.now().toString(36)}`;
  const made = await page.request.post(`/api${HOME}/bots`, { headers, data: { name, color: "#1E86FC" } });
  expect(made.ok()).toBe(true);
  const { bot } = await made.json();
  const home = await knex("workspaces").where({ slug: HOME.slice(3) }).first();
  const where = { workspace_id: home.id, bot_id: bot.id, user_id: home.owner_user_id };
  const seat = (await knex("bot_conversations").where(where).first()) ?? (await knex("bot_conversations").insert(where).returning("*"))[0];
  await knex("bot_conversations").where({ id: seat.id }).update({ onboarding_step: null, unread: false });
  await knex("bot_messages").insert([
    { workspace_id: home.id, bot_id: bot.id, conversation_id: seat.id, kind: "text", role: "user", body: { text: "Private hello" } },
    { workspace_id: home.id, bot_id: bot.id, conversation_id: seat.id, kind: "text", role: "bot", body: { text: "Hello, just us here." } }
  ]);
  const routine = async (conversationId: string, routineName: string) => (await knex("bot_routines").insert({
    workspace_id: home.id, bot_id: bot.id, conversation_id: conversationId, name: routineName, schedule: "Every morning", cron: "0 8 * * *",
    timezone: "UTC", instructions: "Say good morning", enabled: true, next_run_at: knex.raw("now() + interval '1 day'")
  }).returning("*"))[0];
  await routine(String(seat.id), "My own brief");
  expect((await page.request.patch(`/api${HOME}/bots/${bot.id}`, { headers, data: { sharing } })).ok()).toBe(true);
  const remove = async () => {
    if (page.url() !== "about:blank") await page.goto("about:blank");
    expect((await page.request.delete(`/api${HOME}/bots/${bot.id}`, { headers })).ok()).toBe(true);
  };
  return { id: String(bot.id), name, homeId: String(home.id), seatId: String(seat.id), routine, remove };
}

/** The bot's Details, open on its Details tab. */
async function openDetails(page: Page, name: string) {
  if (!(await details(page).isVisible())) await chat(page).getByRole("button", { name: `${name} details` }).click();
  await details(page).getByRole("tab", { name: "Details" }).click();
}

/** Who sees what set to `mode` in Details, through its question; resolves with the question's text. */
async function chooseSharing(page: Page, { id, name }: { id: string; name: string }, mode: string) {
  await openDetails(page, name);
  await details(page).getByRole("radiogroup", { name: "Who sees what" }).getByRole("radio", { name: new RegExp(`^${mode}`, "u") }).click();
  await expect(sharingDialog(page).locator(".mb-confirm__title")).toHaveText(`Make ${name} ${mode}?`);
  const text = (await sharingDialog(page).locator(".mb-confirm__text").textContent()) || "";
  const changed = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api${HOME}/bots/${id}`);
  await sharingDialog(page).getByRole("button", { name: `Make it ${mode}` }).click();
  expect((await changed).ok()).toBe(true);
  await expect(details(page).getByRole("radio", { name: new RegExp(`^${mode}`, "u") })).toHaveAttribute("aria-checked", "true");
  return text;
}

test("private, then Shared with You only holding the chat, its file and routine, then private again", async ({ page }, testInfo) => {
  const knex = connect();
  const bot = await botWithChat(page, knex, "private");
  try {
    await openHome(page, `?bot=${bot.id}`);
    await expect(chat(page).getByText("Private hello")).toBeVisible();
    await expect(tabs(page)).toHaveCount(0);

    // A file in Just me, uploaded while the chat is private.
    await openDetails(page, bot.name);
    await details(page).getByRole("tab", { name: "Files" }).click();
    const file = `mine-${Date.now().toString(36)}.txt`;
    const chooser = page.waitForEvent("filechooser");
    await section(page, "Just me").getByRole("button", { name: "Upload to Just me" }).click();
    await (await chooser).setFiles({ name: file, mimeType: "text/plain", buffer: Buffer.from("only mine") });
    await expect(section(page, "Just me").getByText(file)).toBeVisible();

    // Shared, asked first: General opens, and everyone's own chat is the last tab.
    const toShared = await chooseSharing(page, bot, "Shared");
    expect(toShared).toMatch(/Each person's own chat stays theirs alone, as the last tab, You only\./u);
    await expect(tabs(page)).toHaveText(["General", "You only"]);
    await expect(tabs(page).first()).toHaveAttribute("aria-selected", "true");
    await expect(chat(page).getByText("Private hello")).toHaveCount(0);
    await expect(composer(page)).toHaveAttribute("placeholder", new RegExp(`^Message ${bot.name} · everyone in .+ sees this$`, "u"));

    // You only: the chat Pat had, only theirs, with its file (the file browser asks for that tab's place).
    const ownFiles = page.waitForRequest((request) => new URL(request.url()).pathname === `/api${HOME}/bots/${bot.id}/files` && new URL(request.url()).searchParams.get("room") === bot.seatId);
    await tabs(page).filter({ hasText: "You only" }).click();
    await expect(tabs(page).last()).toHaveAttribute("aria-selected", "true");
    await expect(tabs(page).last()).toHaveAttribute("title", "Only you see this conversation");
    await expect(chat(page).getByText("Private hello")).toBeVisible();
    await expect(composer(page)).toHaveAttribute("placeholder", `Message ${bot.name} · only you see this`);
    await details(page).getByRole("tab", { name: "Files" }).click();
    await ownFiles;
    await expect(section(page, "Just me").getByText(file)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("you-only-tab.png") });

    // Search, from General, opens a message of You only in its tab.
    await tabs(page).first().click();
    await expect(tabs(page).first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Search" });
    await page.keyboard.type("Private hello");
    await palette.getByRole("listbox", { name: "Results" }).getByRole("option").filter({ hasText: `You to ${bot.name}` }).first().click();
    await expect(palette).toBeHidden();
    await expect(tabs(page).last()).toHaveAttribute("aria-selected", "true");
    await expect(chat(page).getByText("Private hello")).toBeVisible();

    // General gets a routine of its own; making the bot private again hides General and pauses it, saying so there.
    const general = (await knex("bot_conversations").where({ bot_id: bot.id, title: "General" }).whereNull("user_id").first()).id;
    const generalRoutine = await bot.routine(String(general), "Morning brief");
    await tabs(page).first().click();
    await expect(tabs(page).first()).toHaveAttribute("aria-selected", "true");
    const toPrivate = await chooseSharing(page, bot, "Private");
    expect(toPrivate).toBe(
      `The shared conversations (“General”) are hidden from everyone in ${(await knex("workspaces").where({ id: bot.homeId }).first()).name}, not deleted, ` +
        `until ${bot.name} is Shared again, and their routines and watches pause. Each person's You only becomes their chat with ${bot.name}.`
    );
    await expect(tabs(page)).toHaveCount(0);
    await expect(chat(page).getByText("Private hello")).toBeVisible();
    await expect(composer(page)).not.toHaveAttribute("placeholder", /sees this/u);
    const routines = await knex("bot_routines").where({ bot_id: bot.id }).orderBy("id").select("name", "enabled");
    expect(routines).toEqual([{ name: "My own brief", enabled: true }, { name: "Morning brief", enabled: false }]);
    const paused = await knex("bot_messages").where({ conversation_id: general, kind: "event" }).orderBy("id", "desc").first();
    expect(paused.body.text).toBe("Paused while hidden");
    expect(paused.body.detail).toContain(`routine "${generalRoutine.name}"`);
    await details(page).getByRole("tab", { name: "Files" }).click();
    await expect(section(page, "Just me").getByText(file)).toBeVisible();
  } finally {
    await bot.remove();
    await knex.destroy();
  }
});

// The tabs and the question, as people see them, at a desktop's and a phone's width, light and dark.
test("You only and the question before a change, at desktop and phone width, light and dark", async ({ page }, testInfo) => {
  const knex = connect();
  const bot = await botWithChat(page, knex, "shared");
  try {
    for (const [width, height, size] of [[1280, 800, "desktop"], [390, 844, "phone"]] as const) {
      await page.setViewportSize({ width, height });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        await openHome(page, `?bot=${bot.id}`);
        await expect(page.locator(".v-application")).toHaveClass(new RegExp(`\\bv-theme--(workspace-)?${colorScheme}\\b`, "u"));
        await tabs(page).filter({ hasText: "You only" }).click();
        await expect(chat(page).getByText("Private hello")).toBeVisible();
        await expect(tabs(page).last().locator(".mb-tabs__lock")).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`tabs-${size}-${colorScheme}.png`) });
        await openDetails(page, bot.name);
        await details(page).getByRole("radiogroup", { name: "Who sees what" }).getByRole("radio", { name: /^Mixed/u }).click();
        await expect(sharingDialog(page)).toBeVisible();
        await expect(sharingDialog(page).locator(".mb-confirm__title")).toHaveText(`Make ${bot.name} Mixed?`);
        await page.screenshot({ path: testInfo.outputPath(`confirm-${size}-${colorScheme}.png`) });
        await sharingDialog(page).getByRole("button", { name: "Cancel" }).click();
        await expect(sharingDialog(page)).toHaveCount(0);
        await expect(details(page).getByRole("radio", { name: /^Shared/u }), "Cancel changes nothing").toHaveAttribute("aria-checked", "true");
      }
    }
  } finally {
    await bot.remove();
    await knex.destroy();
  }
});
