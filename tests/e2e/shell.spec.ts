import knexLib from "knex";
import { MADE_UP, expect, test, testDatabaseName, type Page, type Route } from "./harness";

// The signed-in shell around a bot, on the Test Preview target: what it shows, the
// actions it offers and the calls they make. The fixtures give the owner's home a bot called Otto;
// the target's AI is the stand-in model, so Otto answers that it runs on one. Each test leaves the data as
// it found it, apart from the messages it sends. Run with: vibe64-helper playwright --target
// test-app test tests/e2e/shell.spec.ts
const HOME = "/w/you";
// The test target's AI is the stand-in model (tools/standInModel.mjs): a reply says so in the chat.
const STAND_IN_REPLY = /runs on a stand-in model, which only plays the bot templates/u;
test.describe.configure({ mode: "serial" });
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

// The home page, past the first-run introduction a new account sees there once.
async function openHome(page: Page) {
  await page.goto(HOME);
  const next = page.getByRole("button", { name: "Next" });
  const shell = page.locator(".mb-shell");
  await expect(shell.or(next).first()).toBeVisible();
  if (await next.isVisible()) {
    for (let slide = 0; slide < 3; slide += 1) await next.click();
  }
  await expect(shell).toBeVisible();
}

// The calls the page makes to a bot's routes, as "METHOD /path" with numeric ids as :id; a PATCH
// also names the fields it changes ("PATCH /bots/:id name").
function botCalls(page: Page) {
  const calls: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (!pathname.startsWith(`/api${HOME}/bots/`)) return;
    const fields = request.method() === "PATCH" ? ` ${Object.keys(request.postDataJSON() || {}).sort().join(",")}` : "";
    calls.push(`${request.method()} ${pathname.slice(`/api${HOME}`.length).replace(/\/\d+/gu, "/:id")}${fields}`);
  });
  return calls;
}

// Answers the next POST to a route with an error, once (made up, so the API guard expects it); everything else goes through.
async function failNextPost(page: Page, url: string, status: number) {
  let failed = false;
  await page.route(url, async (route: Route) => {
    if (failed || route.request().method() !== "POST") return route.fallback();
    failed = true;
    return route.fulfill({ status, contentType: "application/json", headers: { [MADE_UP]: "1" }, body: JSON.stringify({ error: "Pinned failure" }) });
  });
}

const chat = (page: Page) => page.getByRole("main", { name: "Chat" });
const sidebarBot = (page: Page, name: string) => page.getByRole("navigation", { name: "Bots" }).getByRole("button", { name, exact: true });
const composer = (page: Page) => chat(page).getByRole("textbox", { name: "Message Otto" });
const menuItems = (page: Page) => page.locator(".v-overlay--active .mb-menu .mb-menu__text");
const sent = (calls: string[]) => calls.filter((call) => /\/(messages|activity|reply)$/u.test(call) && call.startsWith("POST"));

async function ottoId(page: Page) {
  const { bots } = await (await page.request.get(`/api${HOME}/bots`)).json();
  return bots.find((bot: { name: string }) => bot.name === "Otto").id;
}

// How many of Otto's replies are the stand-in's.
async function standInReplies(page: Page) {
  const { messages } = await (await page.request.get(`/api${HOME}/bots/${await ottoId(page)}/messages`)).json();
  return messages.filter((message: { body?: { text?: string } }) => STAND_IN_REPLY.test(message.body?.text || "")).length;
}

// Each test starts with Otto as the fixtures make it, mixed and read, whichever specs ran before on
// this worker: apps.spec.ts makes Otto the home's shared Builder, and its tasks leave Otto unread.
test.beforeEach(async ({ page }) => {
  const otto = await ottoId(page);
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  for (const data of [{ sharing: "mixed" }, { unread: false }]) {
    expect((await page.request.patch(`/api${HOME}/bots/${otto}`, { headers: { "csrf-token": csrfToken }, data })).ok()).toBe(true);
  }
});

test("a message is sent and answered; a reply that can't be had offers Try again, which asks again", async ({ page }) => {
  const calls = botCalls(page);
  await failNextPost(page, `**/api${HOME}/bots/*/reply`, 409);
  await openHome(page);
  await sidebarBot(page, "Otto").click();
  const repliedBefore = await standInReplies(page);
  const text = `Pinned reply ${Date.now()}`;
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await expect(composer(page)).toHaveValue("");
  await expect(chat(page).getByText(text)).toBeVisible();
  const failure = chat(page).getByRole("alert").filter({ hasText: "Couldn't get a reply." });
  await expect(failure).toBeVisible();
  expect(sent(calls)).toEqual(["POST /bots/:id/messages", "POST /bots/:id/messages/:id/activity", "POST /bots/:id/reply"]);
  calls.length = 0;
  await failure.getByRole("button", { name: "Try again" }).click();
  await expect(failure).toBeHidden();
  await expect(chat(page).getByText(STAND_IN_REPLY).last()).toBeVisible();
  expect(sent(calls)).toEqual(["POST /bots/:id/reply"]);
  // The answer to Try again arrives, so no reply is still on its way when the next test starts.
  await expect.poll(() => standInReplies(page)).toBe(repliedBefore + 1);
});

// A chat that's slow to load (a slow connection, a busy server) keeps what the person did meanwhile. Otto's chat is
// read before the message is sent, and that answer arrives only once the reply has failed, so it knows neither.
test("a message sent while its chat is loading stays, and so does Try again when its reply can't be had", async ({ page }) => {
  const otto = await ottoId(page);
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  // A message from before, which shows once the chat's read has arrived.
  const before = `Pinned before ${Date.now()}`;
  expect((await page.request.post(`/api${HOME}/bots/${otto}/messages`, { headers: { "csrf-token": csrfToken }, data: { text: before } })).ok()).toBe(true);
  const repliedBefore = await standInReplies(page);
  await failNextPost(page, `**/api${HOME}/bots/*/reply`, 409);
  let arrive = () => {};
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  let held = false;
  await page.route(`**/api${HOME}/bots/${otto}/messages`, async (route) => {
    if (held || route.request().method() !== "GET") return route.fallback();
    held = true;
    const response = await route.fetch();
    await arrived;
    return route.fulfill({ response });
  });
  await openHome(page);
  await sidebarBot(page, "Otto").click();
  const text = `Pinned while loading ${Date.now()}`;
  await composer(page).fill(text);
  await composer(page).press("Enter");
  const failure = chat(page).getByRole("alert").filter({ hasText: "Couldn't get a reply." });
  await expect(failure).toBeVisible();
  await expect(chat(page).getByText(before), "the chat's read hasn't arrived").toHaveCount(0);
  arrive();
  await expect(chat(page).getByText(before)).toBeVisible();
  await expect(chat(page).getByText(text)).toBeVisible();
  await expect(failure).toBeVisible();
  await failure.getByRole("button", { name: "Try again" }).click();
  await expect(failure).toBeHidden();
  // The answer to Try again arrives, so no reply is still on its way when the next test starts.
  await expect.poll(() => standInReplies(page)).toBe(repliedBefore + 1);
});

test("a message that doesn't send stays with Try again, which sends it", async ({ page }) => {
  const calls = botCalls(page);
  await failNextPost(page, `**/api${HOME}/bots/*/messages`, 400);
  await openHome(page);
  await sidebarBot(page, "Otto").click();
  const repliedBefore = await standInReplies(page);
  const text = `Pinned send ${Date.now()}`;
  await composer(page).fill(text);
  await composer(page).press("Enter");
  const retry = chat(page).locator(".mb-timeline__retry").filter({ hasText: "Try again" });
  await expect(retry).toBeVisible();
  await expect(chat(page).getByText(text)).toBeVisible();
  expect(sent(calls)).toEqual(["POST /bots/:id/messages"]);
  await retry.click();
  await expect(retry).toBeHidden();
  await expect(chat(page).getByText(text)).toHaveCount(1);
  await expect.poll(() => sent(calls)).toEqual(["POST /bots/:id/messages", "POST /bots/:id/messages", "POST /bots/:id/messages/:id/activity", "POST /bots/:id/reply"]);
  // Its answer arrives, so no reply is still on its way when the next test starts.
  await expect.poll(() => standInReplies(page)).toBe(repliedBefore + 1);
});

// Acting on messages as soon as they show, Reply on the one just sent and a reaction on Otto's answer, uses
// the ids the server gave them, never one the page made up while a message was on its way.
test("a sent message and its answer can be acted on as soon as they show", async ({ page }) => {
  const sends: Array<{ replyTo?: { id: string } | null }> = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/bots\/\d+\/messages$/u.test(new URL(request.url()).pathname)) sends.push(request.postDataJSON());
  });
  await openHome(page);
  await sidebarBot(page, "Otto").click();
  const repliedBefore = await standInReplies(page);
  const text = `Pinned act ${Date.now()}`;
  await composer(page).fill(text);
  await composer(page).press("Enter");
  // The sent message, as it shows: pending at first, then saved (when both briefly show, the saved one is last).
  const mine = chat(page).locator("[data-message-id]").filter({ hasText: text }).last();
  await mine.getByRole("button", { name: "Reply" }).click();
  await expect(chat(page).locator(".mb-composer__reply")).toHaveText(text);
  const mineId = await mine.getAttribute("data-message-id");
  expect(mineId, "Reply is offered once the message is saved").toMatch(/^\d+$/u);
  // Otto's answer to it, the first after it.
  const answer = chat(page).locator(`[data-message-id="${mineId}"] ~ [data-message-id]`).filter({ hasText: STAND_IN_REPLY }).first();
  await answer.hover();
  await answer.getByRole("button", { name: "React" }).click();
  await page.getByRole("button", { name: "React with 👍" }).click();
  await expect(answer.locator(".mb-reaction")).toHaveText("👍");
  await composer(page).fill("Pinned reply to it");
  await composer(page).press("Enter");
  await expect(chat(page).locator(".mb-bubble__quote").filter({ hasText: text })).toBeVisible();
  expect(sends.at(-1)?.replyTo?.id, "the reply names the sent message by its saved id").toBe(mineId);
  // Its answer arrives, so no reply is still on its way when the next test starts.
  await expect.poll(() => standInReplies(page)).toBe(repliedBefore + 2);
});

test("a bot's menu offers its actions, and Pin pins it until Unpin", async ({ page }) => {
  const calls = botCalls(page);
  await openHome(page);
  await sidebarBot(page, "Otto").click({ button: "right" });
  await expect(menuItems(page)).toHaveText(["Pin", "Move to new section", "Mark as unread", "Rename bot", "Copy conversation ID", "Hide from sidebar", "Delete"]);
  await menuItems(page).filter({ hasText: /^Pin$/u }).click();
  const tile = page.getByRole("region", { name: "Pinned bots" }).getByRole("button", { name: "Otto" });
  await expect(tile).toBeVisible();
  await tile.click({ button: "right" });
  await expect(menuItems(page)).toHaveText(["Unpin", "Mark as unread", "Copy conversation ID", "Hide from sidebar", "Delete"]);
  await menuItems(page).filter({ hasText: "Unpin" }).click();
  await expect(page.getByRole("region", { name: "Pinned bots" })).toHaveCount(0);
  await expect(sidebarBot(page, "Otto")).toBeVisible();
  expect(calls.filter((call) => call.includes("pinned"))).toEqual(["PATCH /bots/:id pinned", "PATCH /bots/:id pinned"]);
});

test("Details shows the bot's tabs, reads each, and renames the bot in place", async ({ page }) => {
  const calls = botCalls(page);
  await openHome(page);
  await sidebarBot(page, "Otto").click();
  calls.length = 0;
  await chat(page).getByRole("button", { name: "Otto details" }).click();
  const details = page.getByRole("complementary", { name: "Details" });
  await expect(details.getByRole("tab")).toHaveText(["Details", "Files", "Library", "Computer"]);
  await expect(details.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
  await expect(details.getByRole("radiogroup", { name: "Who sees what" }).getByRole("radio")).toHaveCount(3);
  await expect(details.getByText("Routines are jobs Otto repeats on a schedule.", { exact: false })).toBeVisible();
  await expect.poll(() => calls.filter((call) => /\/(notebook|routines)$/u.test(call)).sort()).toEqual(["GET /bots/:id/notebook", "GET /bots/:id/routines"]);
  calls.length = 0;
  for (const [tab, call] of [["Files", "GET /bots/:id/files"], ["Library", "GET /bots/:id/library"], ["Computer", "GET /bots/:id/computer/stream"]]) {
    await details.getByRole("tab", { name: tab }).click();
    await expect(details.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => calls).toContain(call);
  }
  await details.getByRole("tab", { name: "Details" }).click();
  calls.length = 0;
  await details.getByRole("button", { name: "Otto", exact: true }).click();
  const name = details.getByRole("textbox", { name: "Bot name" });
  await name.fill("Otto Pinned");
  await name.press("Enter");
  await expect(sidebarBot(page, "Otto Pinned")).toBeVisible();
  await details.getByRole("button", { name: "Otto Pinned", exact: true }).click();
  await name.fill("Otto");
  await name.press("Escape");
  await expect(details.getByRole("button", { name: "Otto Pinned", exact: true })).toBeVisible();
  await details.getByRole("button", { name: "Otto Pinned", exact: true }).click();
  await name.fill("Otto");
  await name.press("Enter");
  await expect(sidebarBot(page, "Otto")).toBeVisible();
  expect(calls.filter((call) => call.endsWith(" name"))).toEqual(["PATCH /bots/:id name", "PATCH /bots/:id name"]);
});

test("the search palette lists bots then commands, and runs what is chosen", async ({ page }) => {
  await openHome(page);
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Search" });
  const options = palette.getByRole("listbox", { name: "Results" }).getByRole("option");
  await expect(options.first()).toHaveText("Otto");
  const commands = [
    "New Bot", "New group chat", "Keyboard shortcuts", "Settings: General", "Settings: Computer",
    "Settings: Permissions", "Settings: Files", "Settings: Website", "Settings: Memory", "Settings: Vault", "Settings: Spending",
    "Settings: Mercbot account", "Settings: About", "Connect Apps", "Theme: System", "Theme: Light", "Theme: Dark"
  ];
  const texts = (await options.allTextContents()).slice(-commands.length);
  expect(texts.map((entry, index) => entry.includes(commands[index]) ? commands[index] : entry)).toEqual(commands);
  await page.keyboard.type("Keyboard");
  await expect(options.first()).toContainText("Keyboard shortcuts");
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(page.locator(".v-overlay--active .v-card-title", { hasText: /^Keyboard shortcuts$/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Otto");
  await expect(options.first()).toHaveText("Otto");
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(sidebarBot(page, "Otto")).toHaveAttribute("aria-current", "page");

  // A theme applies at once and is saved to the account, as Settings → Preferences saves it. System puts it back.
  // JSKIT then shows the home's own variant of it (v-theme--workspace-dark), as it does from the start.
  const savedTheme = async () => /"theme":"(\w+)"/u.exec(await (await page.request.get("/api/settings")).text())?.[1];
  for (const [theme, shown] of [["Dark", "dark"], ["System", "light"]]) {
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Theme");
    await options.filter({ hasText: `Theme: ${theme}` }).click();
    await expect(palette).toBeHidden();
    await expect(page.locator(".v-application")).toHaveClass(new RegExp(`\\bv-theme--(workspace-)?${shown}\\b`, "u"));
    await expect.poll(savedTheme, `the account's theme after Theme: ${theme}`).toBe(theme.toLowerCase());
  }
});

test("Connect apps and skills searches its catalogue and opens an app's page", async ({ page }) => {
  await openHome(page);
  await page.keyboard.press("Control+Alt+w");
  const modal = page.locator(".mb-apps-modal");
  await expect(modal.getByRole("heading", { name: "Connect apps", level: 2 })).toBeVisible();
  await modal.getByRole("textbox", { name: "Search apps and skills" }).fill("mail");
  const results = modal.getByRole("listbox");
  await expect(results).toContainText("Plugins");
  await expect(results.getByRole("button").first()).toHaveText("Gmail");
  await results.getByRole("button", { name: "Gmail" }).click();
  await expect(modal.getByRole("heading", { name: /^Gmail/u, level: 2 })).toBeVisible();
  await expect(modal.getByRole("heading", { name: "Accounts", level: 3 })).toBeVisible();
  await modal.getByRole("button", { name: "Connect apps", exact: true }).click();
  await expect(modal.getByRole("heading", { name: "Connect apps", level: 2 })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
});

test("the group picker names the chosen bots in the composer and offers a new bot by name", async ({ page }) => {
  await openHome(page);
  await page.keyboard.press("Control+Alt+g");
  const field = chat(page).getByRole("textbox", { name: "Add bots to the group" });
  await expect(field).toBeVisible();
  await expect(composer(page)).toHaveAttribute("placeholder", "Write a message");
  const rows = chat(page).getByRole("listbox", { name: "Bots" }).getByRole("option");
  await field.fill("Ott");
  await expect(rows).toHaveText(["Create a new bot called “Ott”", /^Otto/u]);
  await rows.filter({ hasText: /^Otto/u }).dispatchEvent("mousedown");
  await expect(chat(page).getByRole("button", { name: "Remove Otto" })).toBeVisible();
  await expect(composer(page)).toHaveAttribute("placeholder", "Message Otto");
  await field.fill("Pinned helper");
  await rows.filter({ hasText: "Pinned helper" }).dispatchEvent("mousedown");
  const newBot = page.getByRole("dialog", { name: "New bot" });
  await expect(newBot.getByRole("textbox", { name: "Bot name" })).toHaveValue("Pinned helper");
  await newBot.getByRole("button", { name: "Close" }).click();
  await expect(newBot).toBeHidden();
  await chat(page).locator(".mb-picker").getByRole("button", { name: "Close" }).click();
  await expect(field).toBeHidden();
});

// Two bots made for one test through the API, past their onboarding, the second the newest and so the
// first in the list. `news` gives the older one news, a message answered (by the stand-in model), which
// puts it first; `remove` leaves the page first, so it doesn't go on reading them once they're gone (the
// API guard would see that).
async function twoNewBots(page: Page) {
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const headers = { "csrf-token": csrfToken };
  const stamp = Date.now().toString(36);
  const made: Array<{ id: string; name: string }> = [];
  for (const name of [`Older ${stamp}`, `Newer ${stamp}`]) {
    const created = await page.request.post(`/api${HOME}/bots`, { headers, data: { name, color: "#1E86FC" } });
    expect(created.ok()).toBe(true);
    made.push((await created.json()).bot);
  }
  const knex = knexLib({ client: "pg", connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() } });
  try {
    await knex("bot_conversations").whereIn("bot_id", made.map((bot) => bot.id)).update({ onboarding_step: null });
  } finally {
    await knex.destroy();
  }
  const [older, newer] = made;
  return {
    older,
    newer,
    async news() {
      expect((await page.request.post(`/api${HOME}/bots/${older.id}/messages`, { headers, data: { text: "Anything new?" } })).ok()).toBe(true);
      expect((await page.request.post(`/api${HOME}/bots/${older.id}/reply`, { headers, data: {} })).ok()).toBe(true);
    },
    async remove() {
      await page.goto("about:blank");
      for (const bot of made) await page.request.delete(`/api${HOME}/bots/${bot.id}`, { headers });
    }
  };
}

const named = (botId: string) => new RegExp(`[?&]bot=${botId}(&|$)`, "u");

// 2026-11-11 review: with no bot named in the address, the chat showed whichever bot was first in the list,
// so another bot's news moved it there until the person picked one.
test("with no bot in the address, the chat keeps the bot it opened on when another bot's news puts that one first", async ({ page }) => {
  const made = await twoNewBots(page);
  try {
    await openHome(page);
    const rows = page.getByRole("navigation", { name: "Bots" }).locator(".mb-row");
    await expect(rows.first()).toHaveAttribute("aria-label", made.newer.name);
    await expect(sidebarBot(page, made.newer.name)).toHaveAttribute("aria-current", "page");
    await made.news();
    await expect(rows.first(), "the older bot's news puts it first").toHaveAttribute("aria-label", made.older.name);
    await expect(sidebarBot(page, made.newer.name), "the chat stays where it opened").toHaveAttribute("aria-current", "page");
    await expect(chat(page).getByRole("button", { name: `${made.newer.name} details` })).toBeVisible();
    expect(new URL(page.url()).searchParams.has("bot")).toBe(false);
  } finally {
    await made.remove();
  }
});

// 2026-11-11 review: picking the bot already shown added a history entry, so Back could land on an address
// with no bot named, which showed whichever bot was first by then.
test("picking the bot already shown names it in place, adding no history entry, so Back returns to it", async ({ page }) => {
  const made = await twoNewBots(page);
  try {
    await openHome(page);
    await expect(sidebarBot(page, made.newer.name)).toHaveAttribute("aria-current", "page");
    const entries = await page.evaluate(() => history.length);
    await sidebarBot(page, made.newer.name).click();
    await expect(page).toHaveURL(named(made.newer.id));
    expect(await page.evaluate(() => history.length), "no new history entry").toBe(entries);
    await sidebarBot(page, made.older.name).click();
    await expect(page).toHaveURL(named(made.older.id));
    expect(await page.evaluate(() => history.length)).toBe(entries + 1);
    await page.goBack();
    await expect(page).toHaveURL(named(made.newer.id));
    await expect(sidebarBot(page, made.newer.name)).toHaveAttribute("aria-current", "page");
  } finally {
    await made.remove();
  }
});

// A long chat opens on its newest 100 messages; scrolling up brings the older ones above, a
// page at a time, in order and each once. Its 230 messages are written straight to the database.
test("a long chat opens on its newest messages, and scrolling up brings the older ones in order", async ({ page }) => {
  await openHome(page);
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const name = `Long chat ${Date.now().toString(36)}`;
  const created = await page.request.post(`/api${HOME}/bots`, { headers: { "csrf-token": csrfToken }, data: { name, color: "#1E86FC" } });
  expect(created.ok()).toBe(true);
  const { bot } = await created.json();
  const knex = knexLib({ client: "pg", connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() } });
  try {
    const conversation = await knex("bot_conversations").where({ bot_id: bot.id }).whereNotNull("user_id").first();
    await knex("bot_conversations").where({ id: conversation.id }).update({ onboarding_step: null });
    const rows = Array.from({ length: 230 }, (_, index) => ({
      bot_id: bot.id,
      conversation_id: conversation.id,
      workspace_id: conversation.workspace_id,
      kind: "text",
      role: index % 2 ? "bot" : "user",
      body: { text: `Line ${index + 1}` }
    }));
    const written = (await knex("bot_messages").insert(rows).returning("id")).map((row: { id: number }) => String(row.id));
    const ours = new Set(written);
    const shown = async () => (await chat(page).locator("[data-message-id]").evaluateAll((items) => items.map((item) => item.getAttribute("data-message-id")))).filter((id) => ours.has(String(id)));

    await openHome(page);
    await sidebarBot(page, name).click();
    await expect(chat(page).getByText("Line 230", { exact: true })).toBeVisible();
    expect(await shown()).toEqual(written.slice(-100));

    const scroller = chat(page).locator(".mb-chat__scroller");
    await expect.poll(async () => {
      await scroller.evaluate((element) => element.scrollTo({ top: 0 }));
      return (await shown()).length;
    }).toBe(written.length);
    expect(await shown(), "every message once, in order, across the page boundaries").toEqual(written);
  } finally {
    await knex.destroy();
    // Left first, so the page doesn't go on reading the bot once it's gone (the API guard would see that).
    await page.goto("about:blank");
    await page.request.delete(`/api${HOME}/bots/${bot.id}`, { headers: { "csrf-token": csrfToken } });
  }
});

// Find in chat on a long chat: the server counts the matches in the pages not loaded yet, so opening find
// reads no older page, and the pages come down to a match only when the person goes to it. Of 230 messages, lines 5,
// 120 and 200 hold the word; the chat opens on lines 131 to 230.
test("find in chat counts the whole chat and brings older pages down only to the match it goes to", async ({ page }) => {
  await openHome(page);
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const name = `Find chat ${Date.now().toString(36)}`;
  const word = `zq${Date.now().toString(36)}`;
  const created = await page.request.post(`/api${HOME}/bots`, { headers: { "csrf-token": csrfToken }, data: { name, color: "#1E86FC" } });
  expect(created.ok()).toBe(true);
  const { bot } = await created.json();
  const knex = knexLib({ client: "pg", connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() } });
  try {
    const conversation = await knex("bot_conversations").where({ bot_id: bot.id }).whereNotNull("user_id").first();
    await knex("bot_conversations").where({ id: conversation.id }).update({ onboarding_step: null });
    const holding = new Set([5, 120, 200]);
    await knex("bot_messages").insert(Array.from({ length: 230 }, (_, index) => ({
      bot_id: bot.id,
      conversation_id: conversation.id,
      workspace_id: conversation.workspace_id,
      kind: "text",
      role: index % 2 ? "bot" : "user",
      body: { text: holding.has(index + 1) ? `Line ${index + 1} ${word}` : `Line ${index + 1}` }
    })));
    const olderPages: string[] = [];
    page.on("request", (request) => {
      if (/\/messages\?(.*&)?before=/u.test(request.url())) olderPages.push(request.url());
    });

    await openHome(page);
    await sidebarBot(page, name).click();
    await expect(chat(page).getByText("Line 230", { exact: true })).toBeVisible();
    await page.keyboard.press("Control+f");
    const find = chat(page).getByRole("search");
    const field = find.getByRole("searchbox", { name: "Find in chat" });
    const counter = find.locator(".mb-find__count");
    await field.fill(word);
    await expect(counter, "typing jumps to the last match, counting the whole chat").toHaveText("3/3");
    expect(olderPages, "finding reads no older page").toEqual([]);

    await field.press("Shift+Enter");
    await expect(counter).toHaveText("2/3");
    await expect(chat(page).getByText(`Line 120 ${word}`)).toBeInViewport();
    await field.press("Enter");
    await expect(counter).toHaveText("3/3");
    await expect(chat(page).getByText(`Line 200 ${word}`)).toBeInViewport();
    await field.press("Enter");
    await expect(counter, "next wraps round to the first match").toHaveText("1/3");
    await expect(chat(page).getByText(`Line 5 ${word}`)).toBeInViewport();
    await field.press("Shift+Enter");
    await expect(counter, "and previous wraps round to the last").toHaveText("3/3");
    await expect(chat(page).getByText(`Line 200 ${word}`)).toBeInViewport();
  } finally {
    await knex.destroy();
    // Left first, so the page doesn't go on reading the bot once it's gone (the API guard would see that).
    await page.goto("about:blank");
    await page.request.delete(`/api${HOME}/bots/${bot.id}`, { headers: { "csrf-token": csrfToken } });
  }
});

// Signing in from a bot's connect card: its button opens the explainer, then the app's sign-in, and tells
// the server, which marks the card so the bot finishes its task once the app is connected; a card whose app was
// connected shows Connected instead of its button. The sign-in window is the app's own page, so it's only recorded here.
test("signing in from a connect card marks it for the bot to carry on, and a connected card says so", async ({ page }) => {
  await page.addInitScript(() => {
    const opened: string[] = [];
    Object.assign(window, { openedSignIns: opened });
    window.open = ((url?: string | URL) => {
      opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
  await openHome(page);
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const { plugins } = await (await page.request.get(`/api${HOME}/plugins`)).json();
  const wasInstalled = Boolean(plugins.find((plugin: { id: string, installed?: boolean }) => plugin.id === "google-drive")?.installed);
  const name = `Connect card ${Date.now().toString(36)}`;
  const created = await page.request.post(`/api${HOME}/bots`, { headers: { "csrf-token": csrfToken }, data: { name, color: "#1E86FC" } });
  expect(created.ok()).toBe(true);
  const { bot } = await created.json();
  const knex = knexLib({ client: "pg", connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() } });
  try {
    const conversation = await knex("bot_conversations").where({ bot_id: bot.id }).whereNotNull("user_id").first();
    await knex("bot_conversations").where({ id: conversation.id }).update({ onboarding_step: null });
    const card = (status: string, task: string) => ({
      bot_id: bot.id,
      conversation_id: conversation.id,
      workspace_id: conversation.workspace_id,
      kind: "connect",
      role: "bot",
      body: {
        app: "Google Drive",
        plugin: { id: "google-drive", logo: "googledrive", color: "#4285F4", icon: "folder" },
        subtitle: "Let your bot use Google Drive for you",
        footnote: "Your bot always checks with you before changing anything, and you can disconnect at any time.",
        button: "Authorize",
        status,
        task
      }
    });
    const [, waiting] = await knex("bot_messages").insert([card("connected", "save the notes"), card("waiting", "save the list")]).returning("id");

    await openHome(page);
    await sidebarBot(page, name).click();
    const cards = chat(page).locator(".mb-connect");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).getByText("Connected")).toBeVisible();
    await expect(cards.nth(0).getByRole("button")).toHaveCount(0);
    await cards.nth(1).getByRole("button", { name: "Authorize" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect.poll(async () => (await knex("bot_messages").where({ id: waiting.id }).first()).body.status).toBe("connecting");
    const opened = await page.evaluate(() => (window as unknown as { openedSignIns: string[] }).openedSignIns);
    expect(opened).toEqual([expect.stringContaining("plugin=google-drive")]);
  } finally {
    await knex.destroy();
    await page.goto("about:blank");
    await page.request.delete(`/api${HOME}/bots/${bot.id}`, { headers: { "csrf-token": csrfToken } });
    if (!wasInstalled) await page.request.delete(`/api${HOME}/plugins/google-drive`, { headers: { "csrf-token": csrfToken } });
  }
});
