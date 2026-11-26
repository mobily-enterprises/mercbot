import type { Knex } from "knex";
import { HOME, MADE_UP, botNamed, connectTestDb, directChat, expect, homeApi, makeChat, openShell, seedMessage, seedMessages, shell, sidebarEntry, test, type Page, type Route } from "./harness";

// The signed-in shell around a chat (D-112), on the Test Preview target: what it shows, the actions it offers and the
// calls they make. The fixtures give the owner's home the bots Otto and Vera; most tests use the person's direct chat
// with Otto, which its row in the chat list opens. The target's AI is the stand-in model, so Otto answers that it runs
// on one. Each test leaves the data as it found it, apart from the messages it sends in Otto's chat. Run with:
// vibe64-helper playwright --target test-app test tests/e2e/shell.spec.ts
// The test target's AI is the stand-in model (tools/standInModel.mjs): a reply says so in the chat.
const STAND_IN_REPLY = /runs on a stand-in model, which only plays the bot templates/u;
test.describe.configure({ mode: "serial" });
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

// The calls the page makes to the home's API, as "METHOD /path" with numeric ids as :id and no query; a PATCH also
// names the fields it changes ("PATCH /bots/:id name").
function homeCalls(page: Page) {
  const calls: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (!pathname.startsWith(`/api${HOME}/`)) return;
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

const composer = (page: Page) => shell.chat(page).getByRole("textbox", { name: "Message Otto" });
const sent = (calls: string[]) => calls.filter((call) => /\/(messages|activity|reply)$/u.test(call) && call.startsWith("POST"));
const chatNamed = (chatId: string) => new RegExp(`[?&]chat=${chatId}(&|$)`, "u");

// The person's direct chat with Otto, as its [Message] opens it (made the first time).
async function ottoChat(page: Page) {
  const otto = await botNamed(page, "Otto");
  return { otto, chat: await directChat(page, String(otto.id)) };
}

// How many of Otto's replies in its direct chat are the stand-in's.
async function standInReplies(page: Page) {
  const { chat } = await ottoChat(page);
  const { messages } = await (await homeApi(page)).get(`/chats/${chat.id}/messages`);
  return messages.filter((message: { body?: { text?: string } }) => STAND_IN_REPLY.test(message.body?.text || "")).length;
}

// A chat's home, as the database has it, for what a test writes straight into it.
async function homeOf(knex: Knex, chatId: string) {
  return String((await knex("conversations").where({ id: chatId }).first()).workspace_id);
}

// `count` text messages written straight into a chat in one statement (seedMessages): the person's and the bot's in
// turn, the person's first. Resolves with their ids, oldest first.
async function seedLines(knex: Knex, { chatId, userId, botId, count, text }: { chatId: string; userId: string; botId: string; count: number; text: (line: number) => string }) {
  const rows = Array.from({ length: count }, (_, index) => ({ ...(index % 2 ? { botId } : { userId }), body: { text: text(index + 1) } }));
  return seedMessages(knex, { homeId: await homeOf(knex, chatId), chatId, rows });
}

// Each test starts with Otto's direct chat in the chat list as a row, read, whichever specs ran before on this worker.
test.beforeEach(async ({ page }) => {
  const { chat } = await ottoChat(page);
  await (await homeApi(page)).patch(`/chats/${chat.id}/place`, { pinned: false, hidden: false, unread: false });
});

test("a message is sent and answered; a reply that can't be had offers Try again, which asks again", async ({ page }) => {
  const calls = homeCalls(page);
  await failNextPost(page, `**/api${HOME}/chats/*/reply`, 409);
  await openShell(page);
  await shell.chatRow(page, "Otto").click();
  const repliedBefore = await standInReplies(page);
  const text = `Pinned reply ${Date.now()}`;
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await expect(composer(page)).toHaveValue("");
  await expect(shell.chat(page).getByText(text)).toBeVisible();
  const failure = shell.chat(page).getByRole("alert").filter({ hasText: "Couldn't get a reply." });
  await expect(failure).toBeVisible();
  expect(sent(calls)).toEqual(["POST /chats/:id/messages", "POST /chats/:id/messages/:id/activity", "POST /chats/:id/reply"]);
  calls.length = 0;
  await failure.getByRole("button", { name: "Try again" }).click();
  await expect(failure).toBeHidden();
  await expect(shell.chat(page).getByText(STAND_IN_REPLY).last()).toBeVisible();
  expect(sent(calls)).toEqual(["POST /chats/:id/reply"]);
  // The answer to Try again arrives, so no reply is still on its way when the next test starts.
  await expect.poll(() => standInReplies(page)).toBe(repliedBefore + 1);
});

// A chat that's slow to load (a slow connection, a busy server) keeps what the person did meanwhile. Otto's chat is
// read before the message is sent, and that answer arrives only once the reply has failed, so it knows neither.
test("a message sent while its chat is loading stays, and so does Try again when its reply can't be had", async ({ page }) => {
  const { chat } = await ottoChat(page);
  // A message from before, which shows once the chat's read has arrived.
  const before = `Pinned before ${Date.now()}`;
  await (await homeApi(page)).post(`/chats/${chat.id}/messages`, { text: before });
  const repliedBefore = await standInReplies(page);
  await failNextPost(page, `**/api${HOME}/chats/*/reply`, 409);
  let arrive = () => {};
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  let held = false;
  await page.route(`**/api${HOME}/chats/${chat.id}/messages`, async (route) => {
    if (held || route.request().method() !== "GET") return route.fallback();
    held = true;
    const response = await route.fetch();
    await arrived;
    return route.fulfill({ response });
  });
  await openShell(page);
  await shell.chatRow(page, "Otto").click();
  const text = `Pinned while loading ${Date.now()}`;
  await composer(page).fill(text);
  await composer(page).press("Enter");
  const failure = shell.chat(page).getByRole("alert").filter({ hasText: "Couldn't get a reply." });
  await expect(failure).toBeVisible();
  await expect(shell.chat(page).getByText(before), "the chat's read hasn't arrived").toHaveCount(0);
  arrive();
  await expect(shell.chat(page).getByText(before)).toBeVisible();
  await expect(shell.chat(page).getByText(text)).toBeVisible();
  await expect(failure).toBeVisible();
  await failure.getByRole("button", { name: "Try again" }).click();
  await expect(failure).toBeHidden();
  // The answer to Try again arrives, so no reply is still on its way when the next test starts.
  await expect.poll(() => standInReplies(page)).toBe(repliedBefore + 1);
});

test("a message that doesn't send stays with Try again, which sends it", async ({ page }) => {
  const calls = homeCalls(page);
  await failNextPost(page, `**/api${HOME}/chats/*/messages`, 400);
  await openShell(page);
  await shell.chatRow(page, "Otto").click();
  const repliedBefore = await standInReplies(page);
  const text = `Pinned send ${Date.now()}`;
  await composer(page).fill(text);
  await composer(page).press("Enter");
  const retry = shell.chat(page).locator(".mb-timeline__retry").filter({ hasText: "Try again" });
  await expect(retry).toBeVisible();
  await expect(shell.chat(page).getByText(text)).toBeVisible();
  expect(sent(calls)).toEqual(["POST /chats/:id/messages"]);
  await retry.click();
  await expect(retry).toBeHidden();
  await expect(shell.chat(page).getByText(text)).toHaveCount(1);
  await expect.poll(() => sent(calls)).toEqual(["POST /chats/:id/messages", "POST /chats/:id/messages", "POST /chats/:id/messages/:id/activity", "POST /chats/:id/reply"]);
  // Its answer arrives, so no reply is still on its way when the next test starts.
  await expect.poll(() => standInReplies(page)).toBe(repliedBefore + 1);
});

// Acting on messages as soon as they show, Reply on the one just sent and a reaction on Otto's answer, uses
// the ids the server gave them, never one the page made up while a message was on its way.
test("a sent message and its answer can be acted on as soon as they show", async ({ page }) => {
  const sends: Array<{ replyTo?: { id: string } | null }> = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/chats\/\d+\/messages$/u.test(new URL(request.url()).pathname)) sends.push(request.postDataJSON());
  });
  await openShell(page);
  await shell.chatRow(page, "Otto").click();
  const repliedBefore = await standInReplies(page);
  const text = `Pinned act ${Date.now()}`;
  await composer(page).fill(text);
  await composer(page).press("Enter");
  // The sent message, as it shows: pending at first, then saved (when both briefly show, the saved one is last).
  const mine = shell.chat(page).locator("[data-message-id]").filter({ hasText: text }).last();
  await mine.getByRole("button", { name: "Reply" }).click();
  await expect(shell.chat(page).locator(".mb-composer__reply")).toHaveText(text);
  const mineId = await mine.getAttribute("data-message-id");
  expect(mineId, "Reply is offered once the message is saved").toMatch(/^\d+$/u);
  // Otto's answer to it, the first after it.
  const answer = shell.chat(page).locator(`[data-message-id="${mineId}"] ~ [data-message-id]`).filter({ hasText: STAND_IN_REPLY }).first();
  await answer.hover();
  await answer.getByRole("button", { name: "React" }).click();
  await page.getByRole("button", { name: "React with 👍" }).click();
  await expect(answer.locator(".mb-reaction")).toHaveText("👍");
  await composer(page).fill("Pinned reply to it");
  await composer(page).press("Enter");
  await expect(shell.chat(page).locator(".mb-bubble__quote").filter({ hasText: text })).toBeVisible();
  expect(sends.at(-1)?.replyTo?.id, "the reply names the sent message by its saved id").toBe(mineId);
  // Its answer arrives, so no reply is still on its way when the next test starts.
  await expect.poll(() => standInReplies(page)).toBe(repliedBefore + 2);
});

// A direct chat, a bot's row in Bots, takes no title (its bot's name is its name), no section and no archive, and can't
// be left; its maker, as the home's owner too, deletes it (chatMenus.js). Pinned, it's a tile too.
test("a chat's menu offers its actions, and Pin pins it until Unpin", async ({ page }) => {
  const calls = homeCalls(page);
  await ottoChat(page);
  await openShell(page);
  await (await sidebarEntry(page, "Bots", "Otto")).click({ button: "right" });
  await expect(shell.menuItems(page)).toHaveText(["Pin", "Mark as unread", "Copy chat ID", "Delete"]);
  await shell.menuItems(page).filter({ hasText: /^Pin$/u }).click();
  const tile = shell.sidebar(page).getByRole("region", { name: "Pinned chats" }).getByRole("button", { name: "Otto", exact: true });
  await expect(tile).toBeVisible();
  await tile.click({ button: "right" });
  // A direct chat offers no Hide from sidebar, pinned or not (fc5b8b2).
  await expect(shell.menuItems(page)).toHaveText(["Unpin", "Mark as unread", "Copy chat ID", "Delete"]);
  await shell.menuItems(page).filter({ hasText: "Unpin" }).click();
  await expect(tile).toHaveCount(0);
  await expect(shell.chatRow(page, "Otto")).toBeVisible();
  expect(calls.filter((call) => call.includes("pinned"))).toEqual(["PATCH /chats/:id/place pinned", "PATCH /chats/:id/place pinned"]);
});

// In a direct chat, Details is its bot's card with this chat's computer (MercbotShell.vue details). The rename is the
// team's: the chat's row and header, named after the bot, follow it.
test("a direct chat's details are its bot's card: its tabs read each, and it renames the bot in place", async ({ page }) => {
  const calls = homeCalls(page);
  const { otto } = await ottoChat(page);
  await openShell(page);
  await shell.chatRow(page, "Otto").click();
  calls.length = 0;
  await shell.chat(page).getByRole("button", { name: "Otto details" }).click();
  // The card is named after its bot, so it follows the rename. A dot stands for the apostrophe: Playwright 1.61 misreads a
  // regular expression with one in a selector.
  const details = shell.details(page, /^Otto( Pinned)?.s card$/u);
  await expect(details.getByRole("tab")).toHaveText(["Details", "Files", "Library", "Computer"]);
  await expect(details.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");
  // No routines yet: no Routines section (D-119), but its Archive.
  await expect(details.getByRole("region", { name: "Archive" })).toBeVisible();
  // The chat stays in the sidebar, Otto's row in Bots: nothing here hides it (fc5b8b2, help/chats.md).
  await expect(details.getByRole("button", { name: /Hide from sidebar/u })).toHaveCount(0);
  // Its instructions, and its routines in this chat.
  await expect.poll(() => calls.filter((call) => /\/(instructions|routines)$/u.test(call)).sort()).toEqual(["GET /bots/:id/instructions", "GET /chats/:id/routines"]);
  calls.length = 0;
  for (const [tab, call] of [["Files", "GET /files"], ["Library", "GET /bots/:id/library"], ["Computer", "GET /bots/:id/computer"]]) {
    await details.getByRole("tab", { name: tab }).click();
    await expect(details.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => calls).toContain(call);
  }
  await details.getByRole("tab", { name: "Details" }).click();
  calls.length = 0;
  try {
    await details.getByRole("button", { name: "Rename Otto", exact: true }).click();
    const name = details.getByRole("textbox", { name: "Bot name" });
    await name.fill("Otto Pinned");
    await name.press("Enter");
    await expect(details.getByRole("button", { name: "Rename Otto Pinned", exact: true })).toBeVisible();
    await expect.soft(shell.chatRow(page, "Otto Pinned"), "the direct chat's row takes the bot's new name").toBeVisible();
    await expect.soft(shell.chat(page).getByRole("button", { name: "Otto Pinned details" }), "and so does its header").toBeVisible();
    await details.getByRole("button", { name: "Rename Otto Pinned", exact: true }).click();
    await name.fill("Otto");
    await name.press("Escape");
    await expect(details.getByRole("button", { name: "Rename Otto Pinned", exact: true })).toBeVisible();
    await details.getByRole("button", { name: "Rename Otto Pinned", exact: true }).click();
    await name.fill("Otto");
    await name.press("Enter");
    await expect(details.getByRole("button", { name: "Rename Otto", exact: true })).toBeVisible();
    await expect.soft(shell.chatRow(page, "Otto")).toBeVisible();
    expect(calls.filter((call) => call.endsWith(" name"))).toEqual(["PATCH /bots/:id name", "PATCH /bots/:id name"]);
  } finally {
    // Otto keeps its name for the tests after, whatever failed here.
    await (await homeApi(page)).patch(`/bots/${otto.id}`, { name: "Otto" });
  }
});

test("the search palette lists chats then commands, and runs what is chosen", async ({ page }) => {
  await openShell(page);
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Search" });
  const options = palette.getByRole("listbox", { name: "Results" }).getByRole("option");
  const commands = [
    "Add bots", "New room", "Keyboard shortcuts", "Settings: General", "Settings: Computer",
    "Settings: Permissions", "Settings: Files", "Settings: Website", "Settings: Templates",
    // The home's main bot and Builder and its common knowledge are Settings sections (D-119: dfc16f7, 4c94837), and so
    // are its recurring tasks (D-132).
    "Settings: Main bot and Builder", "Settings: Bots' common knowledge", "Settings: Recurring tasks", "Settings: Vault",
    "Settings: Spending", "Settings: Mercbot account", "Settings: About", "Connect Apps", "Skills",
    "Theme: System", "Theme: Light", "Theme: Dark"
  ];
  await expect(options.filter({ hasText: "Theme: Dark" })).toBeVisible();
  const all = await options.allTextContents();
  const texts = all.slice(-commands.length);
  expect(texts.map((entry, index) => entry.includes(commands[index]) ? commands[index] : entry)).toEqual(commands);
  // Before typing, the person's chats come first: Otto's direct chat is named after its bot.
  expect(all.slice(0, -commands.length).map((entry) => entry.trim()), "the chats before the commands").toContain("Otto");
  await page.keyboard.type("Keyboard");
  await expect(options.first()).toContainText("Keyboard shortcuts");
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");

  // A chat by its name comes first, then the bot of that name, which carries its template's tag (D-98).
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Otto");
  await expect(options.first()).toHaveText(/^\s*Otto\s*$/u);
  await expect(options.filter({ hasText: /^\s*Otto\s*general\s*Bot\s*$/u })).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(shell.chatRow(page, "Otto")).toHaveAttribute("aria-current", "page");
  // A bot's row opens the person's direct chat with it.
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Vera");
  await options.filter({ hasText: /^\s*Vera\s*general\s*Bot\s*$/u }).click();
  await expect(palette).toBeHidden();
  await expect(shell.chatRow(page, "Vera")).toHaveAttribute("aria-current", "page");

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
  await openShell(page);
  await page.keyboard.press("Control+Shift+m");
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

test("Skills opens Your apps and skills at Private skills, from its shortcut, the sidebar and the search palette", async ({ page }) => {
  await openShell(page);
  const modal = page.locator(".mb-apps-modal");
  // Closed with its button: Escape goes to the overlay on top, which may be a tooltip the pointer left behind.
  const close = async () => {
    await modal.getByRole("button", { name: "Close", exact: true }).click();
    await expect(modal).toBeHidden();
  };
  const atSkills = async () => {
    await expect(modal.getByRole("heading", { name: "Your apps and skills", level: 2 })).toBeVisible();
    await expect(modal.getByRole("heading", { name: "Private skills", level: 3 })).toBeInViewport();
    await expect(modal.getByText("Open a skill to change its name, description or instructions.")).toBeVisible();
    await expect(modal.getByRole("button", { name: /Weekly report/u })).toBeVisible();
    await close();
  };
  // One private skill, as a bot makes one, so Private skills lists it under its hint.
  await page.route(`**/api${HOME}/plugins`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const json = await response.json();
    json.skills = [...(json.skills || []), { id: "weekly-report", name: "Weekly report", description: "Sums up the week" }];
    await route.fulfill({ response, json });
  });
  await page.keyboard.press("Control+Alt+w");
  await atSkills();
  await shell.sidebar(page).getByRole("button", { name: "Skills", exact: true }).click();
  await atSkills();
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Skills");
  await page.getByRole("dialog", { name: "Search" }).getByRole("option").filter({ hasText: "Your private skills" }).click();
  await atSkills();
  // Connect apps itself still opens on its catalogue.
  await page.keyboard.press("Control+Shift+m");
  await expect(modal.getByRole("heading", { name: "Connect apps", level: 2 })).toBeVisible();
  await close();
});

// New room (D15), which took New chat's place, from its shortcut: Public unless the person picks Private, a name and
// Create, with no To: line and no bots; nothing is made until Create.
test("New room starts Public, asks for a name, and makes nothing when it's closed", async ({ page }) => {
  const calls = homeCalls(page);
  await openShell(page);
  await page.keyboard.press("Control+Alt+g");
  const newRoom = page.getByRole("dialog", { name: "New room" });
  await expect(newRoom.getByRole("heading", { name: "New room" })).toBeVisible();
  await expect(newRoom.getByRole("radiogroup", { name: "Who can open it" }).getByRole("radio", { name: /^Public/u })).toBeChecked();
  const name = newRoom.getByRole("textbox", { name: "Name" });
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("placeholder", "For example, Kitchen renovation");
  await expect(newRoom.getByRole("textbox", { name: "Add people and bots" })).toHaveCount(0);
  await expect(newRoom.getByRole("button", { name: "Create", exact: true })).toBeVisible();
  await name.fill("Pinned nobody");
  await newRoom.getByRole("button", { name: "Close", exact: true }).click();
  await expect(newRoom).toBeHidden();
  expect(calls.filter((call) => call === "POST /chats"), "closed before Create, no room is made").toEqual([]);
});

// Two chats made for one test through the API, of the person alone (no bot answers what's written there), the second
// the newer and so the first in the list. `news` writes in the older one, which puts it first; `remove` leaves the
// page first, so it doesn't go on reading them once they're gone (the API guard would see that). The newer opens first
// with no chat in the address only when nothing is pinned and the person has no sections, as in the fixtures' home.
async function twoNewChats(page: Page) {
  const api = await homeApi(page);
  const { chats, sections } = await api.get("/chats");
  const pinned = chats.filter((chat: { everyone?: boolean; place?: { pinPosition?: number | null } }) => chat.everyone || (chat.place?.pinPosition ?? null) !== null);
  expect({ pinned: pinned.length, sections: sections.length }, "nothing pinned and no sections, so the newest chat is first").toEqual({ pinned: 0, sections: 0 });
  const stamp = Date.now().toString(36);
  const older = await makeChat(page, { title: `Older ${stamp}` });
  const newer = await makeChat(page, { title: `Newer ${stamp}` });
  return {
    older: { id: String(older.id), name: String(older.title) },
    newer: { id: String(newer.id), name: String(newer.title) },
    async news() {
      await api.post(`/chats/${older.id}/messages`, { text: "Anything new?" });
    },
    async remove() {
      await page.goto("about:blank");
      for (const chat of [older, newer]) await api.del(`/chats/${chat.id}`);
    }
  };
}

// 2026-11-11 review: with nothing named in the address, the chat shown was whichever was first in the list, so another
// one's news moved it there until the person picked one.
test("with no chat in the address, the chat it opened on stays open when another chat's news puts that one first", async ({ page }) => {
  const made = await twoNewChats(page);
  try {
    await openShell(page);
    const rows = shell.sidebar(page).locator(".mb-row");
    await expect(rows.first()).toHaveAttribute("aria-label", made.newer.name);
    await expect(shell.chatRow(page, made.newer.name)).toHaveAttribute("aria-current", "page");
    await made.news();
    await expect(rows.first(), "the older chat's news puts it first").toHaveAttribute("aria-label", made.older.name);
    await expect(shell.chatRow(page, made.newer.name), "the chat stays where it opened").toHaveAttribute("aria-current", "page");
    await expect(shell.chat(page)).toHaveAttribute("aria-label", made.newer.name);
    expect(new URL(page.url()).searchParams.has("chat")).toBe(false);
  } finally {
    await made.remove();
  }
});

// 2026-11-11 review: picking the one already shown added a history entry, so Back could land on an address with
// nothing named, which showed whichever was first by then.
test("picking the chat already shown names it in place, adding no history entry, so Back returns to it", async ({ page }) => {
  const made = await twoNewChats(page);
  try {
    await openShell(page);
    await expect(shell.chatRow(page, made.newer.name)).toHaveAttribute("aria-current", "page");
    const entries = await page.evaluate(() => history.length);
    await shell.chatRow(page, made.newer.name).click();
    await expect(page).toHaveURL(chatNamed(made.newer.id));
    const named = await page.evaluate(() => history.length);
    expect.soft(named, "no new history entry").toBe(entries);
    await shell.chatRow(page, made.older.name).click();
    await expect(page).toHaveURL(chatNamed(made.older.id));
    expect(await page.evaluate(() => history.length)).toBe(named + 1);
    await page.goBack();
    await expect(page).toHaveURL(chatNamed(made.newer.id));
    await expect(shell.chatRow(page, made.newer.name)).toHaveAttribute("aria-current", "page");
  } finally {
    await made.remove();
  }
});

// A long chat opens on its newest 100 messages; scrolling up brings the older ones above, a page at a time, in order
// and each once. Its 230 messages, the person's and Otto's in turn, are written straight to the database.
test("a long chat opens on its newest messages, and scrolling up brings the older ones in order", async ({ page }) => {
  const otto = await botNamed(page, "Otto");
  const made = await makeChat(page, { title: `Long chat ${Date.now().toString(36)}`, bots: [String(otto.id)] });
  const knex = connectTestDb();
  try {
    const written = await seedLines(knex, { chatId: String(made.id), userId: String(made.madeBy), botId: String(otto.id), count: 230, text: (line) => `Line ${line}` });
    const ours = new Set(written);
    const shown = async () => (await shell.chat(page).locator("[data-message-id]").evaluateAll((items) => items.map((item) => item.getAttribute("data-message-id")))).filter((id) => ours.has(String(id)));

    await openShell(page);
    await shell.chatRow(page, made.title).click();
    await expect(shell.chat(page).getByText("Line 230", { exact: true })).toBeVisible();
    expect(await shown()).toEqual(written.slice(-100));

    const scroller = shell.chat(page).locator(".mb-chat__scroller");
    await expect.poll(async () => {
      await scroller.evaluate((element) => element.scrollTo({ top: 0 }));
      return (await shown()).length;
    }).toBe(written.length);
    expect(await shown(), "every message once, in order, across the page boundaries").toEqual(written);
  } finally {
    await knex.destroy();
    // Left first, so the page doesn't go on reading the chat once it's gone (the API guard would see that).
    await page.goto("about:blank");
    await (await homeApi(page)).del(`/chats/${made.id}`);
  }
});

// Find in chat on a long chat: the server counts the matches in the pages not loaded yet, so opening find
// reads no older page, and the pages come down to a match only when the person goes to it. Of 230 messages, lines 5,
// 120 and 200 hold the word; the chat opens on lines 131 to 230.
test("find in chat counts the whole chat and brings older pages down only to the match it goes to", async ({ page }) => {
  const otto = await botNamed(page, "Otto");
  const made = await makeChat(page, { title: `Find chat ${Date.now().toString(36)}`, bots: [String(otto.id)] });
  const word = `zq${Date.now().toString(36)}`;
  const holding = new Set([5, 120, 200]);
  const knex = connectTestDb();
  try {
    await seedLines(knex, { chatId: String(made.id), userId: String(made.madeBy), botId: String(otto.id), count: 230, text: (line) => (holding.has(line) ? `Line ${line} ${word}` : `Line ${line}`) });
    const olderPages: string[] = [];
    page.on("request", (request) => {
      if (/\/messages\?(.*&)?before=/u.test(request.url())) olderPages.push(request.url());
    });

    await openShell(page);
    await shell.chatRow(page, made.title).click();
    await expect(shell.chat(page).getByText("Line 230", { exact: true })).toBeVisible();
    await page.keyboard.press("Control+f");
    const find = shell.chat(page).getByRole("search");
    const field = find.getByRole("searchbox", { name: "Find in chat" });
    const counter = find.locator(".mb-find__count");
    await field.fill(word);
    await expect(counter, "typing jumps to the last match, counting the whole chat").toHaveText("3/3");
    expect(olderPages, "finding reads no older page").toEqual([]);

    await field.press("Shift+Enter");
    await expect(counter).toHaveText("2/3");
    await expect(shell.chat(page).getByText(`Line 120 ${word}`)).toBeInViewport();
    await field.press("Enter");
    await expect(counter).toHaveText("3/3");
    await expect(shell.chat(page).getByText(`Line 200 ${word}`)).toBeInViewport();
    await field.press("Enter");
    await expect(counter, "next wraps round to the first match").toHaveText("1/3");
    await expect(shell.chat(page).getByText(`Line 5 ${word}`)).toBeInViewport();
    await field.press("Shift+Enter");
    await expect(counter, "and previous wraps round to the last").toHaveText("3/3");
    await expect(shell.chat(page).getByText(`Line 200 ${word}`)).toBeInViewport();
  } finally {
    await knex.destroy();
    // Left first, so the page doesn't go on reading the chat once it's gone (the API guard would see that).
    await page.goto("about:blank");
    await (await homeApi(page)).del(`/chats/${made.id}`);
  }
});

// Signing in from a bot's connect card: its button opens the explainer, which ends in the same Add account step as
// Connect apps (D-110), saying a Google window opens and who will use the account (D-111); its button makes the account,
// the home's, opens the app's sign-in for it, and tells the server, which marks the card so the bot finishes its task
// once the app is connected; a card whose app was connected shows Connected instead of its button. The sign-in window
// is the app's own page, so it's only recorded here. The cards are Otto's, in a chat made for the test.
test("signing in from a connect card marks it for the bot to carry on, and a connected card says so", async ({ page }) => {
  await page.addInitScript(() => {
    const opened: string[] = [];
    Object.assign(window, { openedSignIns: opened });
    window.open = ((url?: string | URL) => {
      opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
  const api = await homeApi(page);
  const { plugins } = await api.get("/plugins");
  const wasInstalled = Boolean(plugins.find((plugin: { id: string, installed?: boolean }) => plugin.id === "google-drive")?.installed);
  const otto = await botNamed(page, "Otto");
  const made = await makeChat(page, { title: `Connect card ${Date.now().toString(36)}`, bots: [String(otto.id)] });
  const knex = connectTestDb();
  let added = "";
  try {
    const homeId = await homeOf(knex, String(made.id));
    const card = (status: string, task: string) => seedMessage(knex, {
      homeId,
      chatId: String(made.id),
      kind: "connect",
      botId: String(otto.id),
      body: {
        app: "Google Drive",
        plugin: { id: "google-drive", logo: "googledrive", color: "#4285F4", icon: "folder" },
        subtitle: "Let your bot use Google Drive for you",
        footnote: "Your bot always checks with you before changing anything, and you can remove the account at any time.",
        button: "Authorize",
        status,
        task
      }
    });
    await card("connected", "save the notes");
    const waiting = await card("waiting", "save the list");

    await openShell(page);
    await shell.chatRow(page, made.title).click();
    const cards = shell.chat(page).locator(".mb-connect");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).getByText("Connected")).toBeVisible();
    await expect(cards.nth(0).getByRole("button")).toHaveCount(0);
    await cards.nth(1).getByRole("button", { name: "Authorize" }).click();
    const step = page.locator(".mb-explainer .mb-add-account");
    await expect(step).toContainText("A Google window opens so you can pick the account.");
    await expect(step).toContainText(/Everyone in .+, and their bots, can use the account you connect\./u);
    await expect(step.getByRole("radio")).toHaveCount(0);
    await expect(step.getByRole("button", { name: "Sign in with Google" })).toBeEnabled();
    await step.getByRole("textbox", { name: "Label for the new account (optional)" }).fill("Card");
    await step.getByRole("button", { name: "Sign in with Google" }).click();
    await expect.poll(async () => (await knex("messages").where({ id: waiting }).first()).body.status).toBe("connecting");
    const opened = await page.evaluate(() => (window as unknown as { openedSignIns: string[] }).openedSignIns);
    expect(opened).toEqual([expect.stringContaining("plugin=google-drive")]);
    added = new URL(opened[0], "http://mercbot.test").searchParams.get("account") || "";
    const account = await knex("plugin_accounts").where({ id: added }).first();
    expect([account.plugin_id, account.name, String(account.workspace_id)]).toEqual(["google-drive", "Card", homeId]);
  } finally {
    if (added) await knex("plugin_accounts").where({ id: added }).del();
    await knex.destroy();
    await page.goto("about:blank");
    await api.del(`/chats/${made.id}`);
    if (!wasInstalled) await api.answer("DELETE", "/plugins/google-drive");
  }
});
