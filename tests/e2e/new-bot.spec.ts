import { HOME, connectTestDb, expect, homeApi, openShell, shell, skipPause, test, type Page } from "./harness";

// Add bots (D-109, which was New bot) as a person first meets it (D-112): from the + of the sidebar's Bots, it
// opens on two ways to choose, and One bot's templates are calm: an area menu, no featured cards, no byline, and no
// "Not tested yet". A bot made there joins the home's bots, and the person's direct chat with it opens, where it greets
// them. The fixtures give the owner's home Otto and Vera; each test deletes the bots it makes, and their chats with them.
// Run with: vibe64-helper playwright --target test-app test tests/e2e/new-bot.spec.ts
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

const newBotDialog = (page: Page) => page.getByRole("dialog", { name: "Add bots" });
const created = (page: Page) => page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api${HOME}/bots`);
// The person's direct chat with a bot, as the page opens it after making the bot.
const directOpened = (page: Page) => page.waitForResponse((response) =>
  response.request().method() === "POST" && new RegExp(`^/api${HOME}/bots/\\d+/direct$`, "u").test(new URL(response.url()).pathname));
const teamRead = (page: Page) => page.waitForResponse((response) => response.request().method() === "GET" && new URL(response.url()).pathname === `/api${HOME}/bots`);
const chatNamed = (chatId: string) => new RegExp(`[?&]chat=${chatId}(&|$)`, "u");

// Add bots, from the + of the sidebar's Bots.
async function openAddBots(page: Page) {
  await shell.section(page, "Bots").getByRole("button", { name: "Add bots", exact: true }).click();
  await expect(newBotDialog(page)).toBeVisible();
}

// One bot, a General helper (20 November: it asks what the bot will do first), with `name` typed, up to Create.
async function startNewBot(page: Page, name: string) {
  await openAddBots(page);
  await newBotDialog(page).getByRole("button", { name: /^One bot/u }).click();
  await newBotDialog(page).getByRole("button", { name: /^General helper/u }).click();
  await newBotDialog(page).getByRole("textbox", { name: "Bot name" }).fill(name);
}

// One bot, named `name`, from the sidebar; resolves with the bot the server made and the direct chat that opened.
async function createBot(page: Page, name: string) {
  await startNewBot(page, name);
  const answer = created(page);
  const opened = directOpened(page);
  await newBotDialog(page).getByRole("button", { name: "Create" }).click();
  const { bot } = await (await answer).json();
  const { chat } = await (await opened).json();
  await expect(newBotDialog(page)).toBeHidden();
  return { bot: bot as { id: string }, chat: chat as { id: string } };
}

// The page is left first: still open on the bot's chat, it would go on reading it (and the API guard would
// see those reads refused once it's gone). The bot's direct chats go with it.
async function deleteBot(page: Page, botId: string) {
  if (page.url() !== "about:blank") await page.goto("about:blank");
  await (await homeApi(page)).del(`/bots/${botId}`);
}

// A new bot's first question is multi-select one time in two (packages/bots/src/server/onboarding.js).
// This makes it multi-select, both as the page receives it and as it is saved, so the test always
// meets that card. Resolves with the cleanup.
async function serveMultiSelect(page: Page) {
  const knex = connectTestDb();
  await page.route(`**/api${HOME}/chats/*/onboarding/advance`, async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    for (const message of json.messages || []) {
      if (message.kind !== "choice" || message.body.multi) continue;
      message.body = { ...message.body, multi: true, subline: "Pick as many as you like" };
      await knex("messages").where({ id: message.id }).update({ body: JSON.stringify(message.body) });
    }
    await route.fulfill({ response, json });
  });
  return () => knex.destroy();
}

// 21 November (D-109): the screen was too busy. It opens on One bot and A ready-made set; One bot has the search and
// an area menu, General helper first, no featured cards, no "by the Mercbot team" and no "Not tested yet" (every
// template is the team's, and the check results are empty); Back returns to the two ways.
test("Add bots opens on two ways to choose, and One bot's templates are calm", async ({ page }) => {
  await openShell(page);
  await openAddBots(page);
  const dialog = newBotDialog(page);
  await expect(dialog.getByRole("heading", { name: "Add bots" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^One bot/u })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^A ready-made set/u })).toBeVisible();
  await dialog.getByRole("button", { name: /^One bot/u }).click();
  await expect(dialog.getByRole("heading", { name: "One bot" })).toBeVisible();
  await expect(dialog.getByRole("searchbox", { name: "Search templates" })).toBeFocused();
  const area = dialog.getByRole("combobox", { name: "Area" });
  await expect(area.locator("option").first()).toHaveText("All areas");
  await expect(area.locator("option", { hasText: "Mercbot team" })).toHaveCount(0);
  const rows = dialog.locator(".mb-tbrowse__row");
  await expect(rows.first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^General helper/u })).toBeVisible();
  await expect(dialog.locator(".mb-tbrowse__card"), "no featured cards").toHaveCount(0);
  await expect(dialog.locator(".mb-tbrowse__list"), "no byline").not.toContainText("by the Mercbot team");
  await expect(dialog.locator(".mb-tbrowse__list")).not.toContainText("Not tested yet");
  // An area shows only its own.
  await area.selectOption({ label: "Home and family" });
  await expect(dialog.getByRole("region", { name: "Home and family" })).toBeVisible();
  await expect(dialog.locator(".mb-tbrowse__section")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Add bots", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Add bots" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
});

// 11-11 production: the chat opened a bot still being made, read its messages (404), and Vue's error dialog
// ("Attention required: Bot not found.") then took every click on the page until it was closed. The API guard fails
// the test on either; any call naming a bot or chat that doesn't exist yet is also listed, whatever its answer.
test("a new bot's direct chat opens once the bot exists, and it greets the person there", async ({ page }) => {
  const earlyCalls: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (/\/creating-|\/(bots|chats)\/(undefined|null)(\/|$)/u.test(pathname)) earlyCalls.push(`${request.method()} ${pathname}`);
  });
  await page.clock.install();
  await openShell(page);
  const name = `Pip ${Date.now().toString(36)}`;
  const { bot, chat } = await createBot(page, name);
  try {
    await expect(page, "its chat is named in the address").toHaveURL(chatNamed(String(chat.id)));
    await expect(shell.chatRow(page, name)).toHaveAttribute("aria-current", "page");
    await expect(shell.chat(page).getByRole("button", { name: `${name} details` })).toBeVisible();
    // Its greeting, onboarding's first step, comes into its chat after its pause (intro-greet, 2.5 s).
    await skipPause(page, 2500, () => expect(shell.chat(page).getByText(`I'm ${name}.`)).toBeVisible({ timeout: 1_000 }));
    expect(earlyCalls).toEqual([]);
  } finally {
    await deleteBot(page, bot.id);
  }
});

// On a phone, the sidebar is a drawer: Add bots is reached through "Your chats", and the new bot's chat shows once
// it's made.
test("on a phone, a new bot's multi-select question takes picks, and Done answers with them", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const cleanup = await serveMultiSelect(page);
  await page.clock.install();
  await openShell(page);
  await page.getByRole("button", { name: "Your chats" }).click();
  const { bot, chat } = await createBot(page, `Picky ${Date.now().toString(36)}`);
  try {
    const card = shell.chat(page).locator(".mb-choice").filter({ hasText: "Pick as many as you like" });
    const options = card.locator(".mb-choice__option:not(.mb-choice__option--open)");
    const done = card.getByRole("button", { name: "Done" });
    // The question comes after the greeting, each after its pause (intro-greet, 2.5 s, then intro-ask, 1.5 s).
    await skipPause(page, 2500, () => expect(options).toHaveCount(3, { timeout: 1_000 }));
    await expect(done).toBeDisabled();
    await options.nth(0).click();
    await options.nth(2).click();
    await expect(options.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(options.nth(2)).toHaveAttribute("aria-pressed", "true");
    await options.nth(0).click();
    await expect(options.nth(0), "a second click takes the pick back").toHaveAttribute("aria-pressed", "false");
    await expect(done).toBeEnabled();
    const picked = await options.nth(2).locator("span").last().innerText();
    const answer = page.waitForRequest((request) => request.method() === "POST" && /\/chats\/\d+\/choices\/\d+$/u.test(new URL(request.url()).pathname));
    const reply = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/chats/${chat.id}/reply`));
    await done.click();
    expect((await answer).postDataJSON()).toEqual({ selected: [picked] });
    await expect(card).toHaveClass(/mb-choice--answered/u);
    await expect(card.locator(".mb-choice__option"), "an answered card shows only the pick").toHaveCount(1);
    await expect(card.locator(".mb-choice__option")).toContainText(picked);
    // The answer asks the bot to reply; that's done before the bot goes.
    await reply;
  } finally {
    await deleteBot(page, bot.id);
    await cleanup();
  }
});

// Another bot of the home, made through the API, which this page doesn't make: the home hears of it ("bot",
// created), so the page reads the home's bots again (useChatEvents).
async function anotherBot(page: Page) {
  const name = `Elsewhere ${Date.now().toString(36)}`;
  const { bot } = await (await homeApi(page)).post("/bots", { name, color: "#1E86FC" });
  return { id: String(bot.id), name };
}

// A gate a held request waits at until the test opens it.
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

// News can read the home's bots again while a bot is being made: here another bot of the home, one this page hasn't seen,
// is made meanwhile. The new bot still joins them, its chat is listed once and opens, and its details are its card.
test("a new bot joins the home's bots and its chat opens when news reads them again while it's being made", async ({ page }) => {
  await openShell(page);
  // The page's own create waits until the home's bots have been read again.
  const create = gate();
  await page.route(`**/api${HOME}/bots`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await create.opened;
    return route.continue();
  });
  const name = `Pip ${Date.now().toString(36)}`;
  let made: { id: string } | null = null;
  let other: { id: string } | null = null;
  try {
    await startNewBot(page, name);
    await newBotDialog(page).getByRole("button", { name: "Create" }).click();
    const reread = teamRead(page);
    other = await anotherBot(page);
    await reread;
    const answer = created(page);
    const opened = directOpened(page);
    create.open();
    made = (await (await answer).json()).bot;
    const { chat } = await (await opened).json();
    await expect(newBotDialog(page)).toBeHidden();
    await expect(shell.chatRow(page, name)).toHaveCount(1);
    await expect(shell.chatRow(page, name)).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveURL(chatNamed(String(chat.id)));
    await shell.chat(page).getByRole("button", { name: `${name} details` }).click();
    await expect(shell.details(page, `${name}'s card`), "the bots as read have the new bot").toBeVisible();
  } finally {
    create.open();
    if (made) await deleteBot(page, made.id);
    if (other) await deleteBot(page, other.id);
  }
});

// The other order: a read of the bots that began before the new bot existed answers only after the bot has joined.
// That read doesn't have it, and the bot stays, its chat listed and open; before, it left the list while
// the address still named it.
test("a new bot stays in the home's bots, its chat open, when a read of them begun before it existed answers after it", async ({ page }) => {
  await openShell(page);
  // The page's create waits until the bots have been read; that read's answer waits until the bot has joined.
  const create = gate();
  const teamReadStarted = gate();
  const teamAnswer = gate();
  const held: { read: import("@playwright/test").Request | null } = { read: null };
  await page.route((url) => url.pathname === `/api${HOME}/bots`, async (route) => {
    if (route.request().method() === "POST") {
      await create.opened;
      return route.continue();
    }
    if (held.read) return route.fallback();
    held.read = route.request();
    const response = await route.fetch();
    teamReadStarted.open();
    await teamAnswer.opened;
    return route.fulfill({ response });
  });
  const name = `Pip ${Date.now().toString(36)}`;
  let made: { id: string } | null = null;
  let other: { id: string } | null = null;
  try {
    await startNewBot(page, name);
    await newBotDialog(page).getByRole("button", { name: "Create" }).click();
    other = await anotherBot(page);
    await teamReadStarted.opened;
    const answer = created(page);
    const opened = directOpened(page);
    create.open();
    made = (await (await answer).json()).bot;
    const { chat } = await (await opened).json();
    await expect(newBotDialog(page)).toBeHidden();
    await expect(shell.chatRow(page, name)).toHaveAttribute("aria-current", "page");
    teamAnswer.open();
    // The held read's answer, as the page receives it.
    await (await held.read?.response())?.finished();
    await expect(shell.chatRow(page, name), "the new bot's chat stays listed and open").toHaveAttribute("aria-current", "page");
    await expect(page).toHaveURL(chatNamed(String(chat.id)));
    await shell.chat(page).getByRole("button", { name: `${name} details` }).click();
    await expect(shell.details(page, `${name}'s card`), "the new bot stays in the home's bots").toBeVisible();
  } finally {
    create.open();
    teamAnswer.open();
    if (made) await deleteBot(page, made.id);
    if (other) await deleteBot(page, other.id);
  }
});
