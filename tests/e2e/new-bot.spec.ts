import knexLib from "knex";
import { expect, test, testDatabaseName, type Page } from "./harness";

// New bot as a person first meets it: the home opened with no bot named in its address, so
// the chat shows the first bot in the list, and the new bot's "creating" row is the newest one there.
// The fixtures give the owner's home Otto and Vera; each test deletes the bot it makes. Run with:
// vibe64-helper playwright --target test-app test tests/e2e/new-bot.spec.ts
const HOME = "/w/you";
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

const chat = (page: Page) => page.getByRole("main", { name: "Chat" });
const bots = (page: Page) => page.getByRole("navigation", { name: "Bots" });

const newBotDialog = (page: Page) => page.getByRole("dialog", { name: "New bot" });
const created = (page: Page) => page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api${HOME}/bots`);

// New bot's dialog, from the sidebar, with `name` typed, up to Create.
async function startNewBot(page: Page, name: string) {
  await bots(page).getByRole("button", { name: "New bot", exact: true }).click();
  await newBotDialog(page).getByRole("textbox", { name: "Bot name" }).fill(name);
}

// New bot, named `name`, from the sidebar; resolves with the bot the server made.
async function createBot(page: Page, name: string) {
  await startNewBot(page, name);
  const answer = created(page);
  await newBotDialog(page).getByRole("button", { name: "Create" }).click();
  const { bot } = await (await answer).json();
  await expect(newBotDialog(page)).toBeHidden();
  return bot as { id: string };
}

// The page is left first: still open on the bot, it would go on reading it (and the API guard would
// see those reads refused once it's gone).
async function deleteBot(page: Page, botId: string) {
  if (page.url() !== "about:blank") await page.goto("about:blank");
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  expect((await page.request.delete(`/api${HOME}/bots/${botId}`, { headers: { "csrf-token": csrfToken } })).ok()).toBe(true);
}

// A new bot's first question is multi-select one time in two (packages/bots/src/server/onboarding.js).
// This makes it multi-select, both as the page receives it and as it is saved, so the test always
// meets that card. Resolves with the cleanup.
async function serveMultiSelect(page: Page) {
  const knex = knexLib({ client: "pg", connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() } });
  await page.route(`**/api${HOME}/bots/*/onboarding/advance`, async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    for (const message of json.messages || []) {
      if (message.kind !== "choice" || message.body.multi) continue;
      message.body = { ...message.body, multi: true, subline: "Pick as many as you like" };
      await knex("bot_messages").where({ id: message.id }).update({ body: JSON.stringify(message.body) });
    }
    await route.fulfill({ response, json });
  });
  return () => knex.destroy();
}

// 11-11 production: the chat opened the creating row, read its messages (404), and Vue's error dialog
// ("Attention required: Bot not found.") then took every click on the page until it was closed. The
// API guard fails the test on either; the creating row's calls are also listed, whatever their answer.
test("a new bot opens in its own chat once it exists, and its creating row asks the server nothing", async ({ page }) => {
  const creatingCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/bots/creating-")) creatingCalls.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  await openHome(page);
  const name = `Pip ${Date.now().toString(36)}`;
  const bot = await createBot(page, name);
  try {
    await expect(page, "the new bot is named in the address").toHaveURL(new RegExp(`[?&]bot=${bot.id}(&|$)`, "u"));
    await expect(bots(page).getByRole("button", { name, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(chat(page).getByRole("button", { name: `${name} details` })).toBeVisible();
    // Its greeting, onboarding's first step, comes into its chat.
    await expect(chat(page).getByText(`I'm ${name}.`)).toBeVisible();
    expect(creatingCalls).toEqual([]);
  } finally {
    await deleteBot(page, bot.id);
  }
});

// On a phone, the sidebar is a drawer: New bot is reached through "Your bots".
test("on a phone, a new bot's multi-select question takes picks, and Done answers with them", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const cleanup = await serveMultiSelect(page);
  await openHome(page);
  await page.getByRole("button", { name: "Your bots" }).click();
  const bot = await createBot(page, `Picky ${Date.now().toString(36)}`);
  try {
    const card = chat(page).locator(".mb-choice").filter({ hasText: "Pick as many as you like" });
    const options = card.locator(".mb-choice__option:not(.mb-choice__option--open)");
    const done = card.getByRole("button", { name: "Done" });
    await expect(options).toHaveCount(3);
    await expect(done).toBeDisabled();
    await options.nth(0).click();
    await options.nth(2).click();
    await expect(options.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(options.nth(2)).toHaveAttribute("aria-pressed", "true");
    await options.nth(0).click();
    await expect(options.nth(0), "a second click takes the pick back").toHaveAttribute("aria-pressed", "false");
    await expect(done).toBeEnabled();
    const picked = await options.nth(2).locator("span").last().innerText();
    const answer = page.waitForRequest((request) => request.method() === "POST" && /\/bots\/\d+\/choices\/\d+$/u.test(new URL(request.url()).pathname));
    const reply = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/bots/${bot.id}/reply`));
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

// Another bot of the home, made through the API, which tells no page about it. Changing its sharing is
// news about a bot the page doesn't know, so the page reads the whole list again (useBotEvents).
async function unseenBot(page: Page) {
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const headers = { "csrf-token": csrfToken };
  const name = `Elsewhere ${Date.now().toString(36)}`;
  const { bot } = await (await page.request.post(`/api${HOME}/bots`, { headers, data: { name, color: "#1E86FC" } })).json();
  const changeSharing = async () =>
    expect((await page.request.patch(`/api${HOME}/bots/${bot.id}`, { headers, data: { sharing: "private" } })).ok()).toBe(true);
  return { id: bot.id as string, name, changeSharing };
}

// A gate a held request waits at until the test opens it.
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

// News can read the whole list again while a bot is being made (useBotEvents): here another bot of the
// home, one this page hasn't seen, changes its sharing. The list as read leaves the placeholder out;
// the new bot still joins the list, once, and opens.
test("a new bot joins the list and opens when news reads the list again while it's being made", async ({ page }) => {
  await openHome(page);
  const other = await unseenBot(page);
  // The page's own create waits until the list has been read again.
  const create = gate();
  await page.route(`**/api${HOME}/bots`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await create.opened;
    return route.continue();
  });
  const name = `Pip ${Date.now().toString(36)}`;
  let made: { id: string } | null = null;
  try {
    await startNewBot(page, name);
    await newBotDialog(page).getByRole("button", { name: "Create" }).click();
    await expect(bots(page).getByRole("button", { name, exact: true }), "the placeholder row").toBeVisible();
    const reread = page.waitForResponse((response) => response.request().method() === "GET" && new URL(response.url()).pathname === `/api${HOME}/bots`);
    await other.changeSharing();
    await reread;
    await expect(bots(page).getByRole("button", { name: other.name, exact: true })).toBeVisible();
    await expect(bots(page).getByRole("button", { name, exact: true }), "the list as read has no placeholder").toHaveCount(0);
    const answer = created(page);
    create.open();
    made = (await (await answer).json()).bot;
    await expect(newBotDialog(page)).toBeHidden();
    await expect(bots(page).getByRole("button", { name, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page).toHaveURL(new RegExp(`[?&]bot=${made?.id}(&|$)`, "u"));
  } finally {
    create.open();
    if (made) await deleteBot(page, made.id);
    await deleteBot(page, other.id);
  }
});

// The other order: a list read that began before the new bot existed answers only after the bot has
// joined the list. That list doesn't have it, and the bot stays in the list and open (useBotMessages'
// mergeBots); before, it left the list while the address still named it.
test("a new bot stays listed and open when a list read begun before it existed answers after it", async ({ page }) => {
  await openHome(page);
  const other = await unseenBot(page);
  // The page's create waits until the list has been read; that read's answer waits until the bot has joined.
  const create = gate();
  const listRead = gate();
  const listAnswer = gate();
  let readHeld = false;
  await page.route((url) => url.pathname === `/api${HOME}/bots`, async (route) => {
    if (route.request().method() === "POST") {
      await create.opened;
      return route.continue();
    }
    if (readHeld) return route.fallback();
    readHeld = true;
    const response = await route.fetch();
    listRead.open();
    await listAnswer.opened;
    return route.fulfill({ response });
  });
  const name = `Pip ${Date.now().toString(36)}`;
  let made: { id: string } | null = null;
  try {
    await startNewBot(page, name);
    await newBotDialog(page).getByRole("button", { name: "Create" }).click();
    await expect(bots(page).getByRole("button", { name, exact: true }), "the placeholder row").toBeVisible();
    await other.changeSharing();
    await listRead.opened;
    const answer = created(page);
    create.open();
    made = (await (await answer).json()).bot;
    await expect(newBotDialog(page)).toBeHidden();
    await expect(bots(page).getByRole("button", { name, exact: true })).toHaveAttribute("aria-current", "page");
    listAnswer.open();
    await expect(bots(page).getByRole("button", { name: other.name, exact: true }), "the list as read, answered at last").toBeVisible();
    await expect(bots(page).getByRole("button", { name, exact: true }), "the new bot stays listed and open").toHaveAttribute("aria-current", "page");
    await expect(chat(page).getByRole("button", { name: `${name} details` })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]bot=${made?.id}(&|$)`, "u"));
  } finally {
    create.open();
    listAnswer.open();
    if (made) await deleteBot(page, made.id);
    await deleteBot(page, other.id);
  }
});
