import { readFile } from "node:fs/promises";
import knexLib from "knex";
import { expect, test, testDatabaseName, type Page } from "./harness";

// Spending (D-73, D-76) on the Test Preview target: what the home's work cost at its AI providers, by kind, bot and
// person, for any period and as a CSV, with each bot's cost tag. Nothing is held and no work is ever refused: a bot's
// reply is recorded with its provider's cost. The home is this file's own, a new home of the copy's one person, so no
// other spec's use reaches its figures. The first two tests add their use straight to its daily and monthly totals,
// today (UTC), as recording does (the stand-in model's calls cost a small fraction of a cent), the person's and some for
// nobody in particular, and take it away again when they end. A member's own use is for a copy built on Mercbot that
// has members to test. Run with: vibe64-helper playwright --target test-app test tests/e2e/spending.spec.ts
// The test target's AI is the stand-in model (tools/standInModel.mjs): a reply says so in the chat.
const STAND_IN_REPLY = /runs on a stand-in model, which only plays the bot templates/u;
test.describe.configure({ mode: "serial" });
// Any refused API call from the page, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

const database = () => knexLib({
  client: "pg",
  connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() }
});

// The file's home's address, once a test has made it.
let ownHomeAddress = "";

/** The file's own home: a new home of the one person, made as the home switcher's New home makes it. */
async function ownHome(page: Page) {
  if (ownHomeAddress) return ownHomeAddress;
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const made = await page.request.post("/api/workspaces", {
    headers: { "csrf-token": csrfToken, "content-type": "application/vnd.api+json", accept: "application/vnd.api+json" },
    data: { data: { type: "workspaces", attributes: { name: `Spending ${Date.now().toString(36)}` } } }
  });
  expect(made.ok(), await made.text()).toBe(true);
  ownHomeAddress = `/w/${(await made.json()).data.attributes.slug}`;
  return ownHomeAddress;
}

// Whose use: the person's, or nobody in particular's (work for no one person, recorded as user 0).
type Use = [who: "person" | "nobody", kind: string, amounts: Record<string, number>];

/**
 * Adds a bot called `botName` to the home at `address`, and `uses` of it to the home's totals, today, and in
 * `monthsBack` more months back (monthly totals only). Answers the bot and how to take it all away again.
 */
async function writeUse(address: string, botName: string, uses: Use[], { monthsBack = [] as Array<{ months: number, uses: Use[] }> } = {}) {
  const knex = database();
  const home = await knex("workspaces").where({ slug: address.slice("/w/".length) }).first();
  const [bot] = await knex("bots").insert({ user_id: home.owner_user_id, workspace_id: home.id, name: botName, color: "#5C6BC0" }).returning("*");
  // The person's own chat with it, past the short introduction a bot starts on its first look: that is an AI call, made
  // a moment after the chat opens, which would add to the figures these tests read exactly.
  await knex("bot_conversations").insert({ workspace_id: home.id, bot_id: bot.id, user_id: home.owner_user_id, onboarding_step: null });
  const undo: Array<() => Promise<unknown>> = [() => knex("bots").where({ id: bot.id }).del()];
  async function add(table: string, key: Record<string, unknown>, amounts: Record<string, number>) {
    await knex(table).insert({ ...key, bot_name: bot.name, ...amounts });
    undo.push(() => knex(table).where(key).del());
  }
  const keyOf = ([who, kind]: Use) => ({ workspace_id: home.id, bot_id: bot.id, user_id: who === "person" ? home.owner_user_id : 0, kind });
  const today = new Date().toISOString().slice(0, 10);
  for (const use of uses) {
    await add("usage_daily", { ...keyOf(use), day: today }, use[2]);
    await add("usage_monthly", { ...keyOf(use), month: `${today.slice(0, 7)}-01` }, use[2]);
  }
  for (const { months, uses: old } of monthsBack) {
    const now = new Date();
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1)).toISOString().slice(0, 10);
    for (const use of old) await add("usage_monthly", { ...keyOf(use), month }, use[2]);
  }
  return {
    home: address,
    bot: { id: String(bot.id), name: String(bot.name) },
    async remove() {
      for (const step of undo.reverse()) await step();
      await knex.destroy();
    }
  };
}

// $1.88 in all by Otto: $1.23 of premium AI, two pictures for $0.20 and a computer day (counted, with no cost) for the
// person, and $0.45 of economy AI for nobody in particular.
const OTTO_USE: Use[] = [
  ["person", "premium", { calls: 3, cost_nano: 1_230_000_000 }],
  ["person", "images", { calls: 2, images: 2, cost_nano: 200_000_000 }],
  ["person", "computer", { calls: 1 }],
  ["nobody", "economy", { calls: 5, cost_nano: 450_000_000 }]
];

// A home page, past the first-run introduction a new account sees there once.
async function openHome(page: Page, path: string) {
  await page.goto(path);
  const next = page.getByRole("button", { name: "Next" });
  const shell = page.locator(".mb-shell");
  await expect(shell.or(next).first()).toBeVisible();
  if (await next.isVisible()) {
    for (let slide = 0; slide < 3; slide += 1) await next.click();
  }
  await expect(shell).toBeVisible();
}


/** Settings → Spending, from the search palette. */
async function openSpending(page: Page) {
  await page.keyboard.press("Control+k");
  // Into the palette's own box: a page just loaded can hand the keys back to the message box.
  const search = page.getByRole("dialog", { name: "Search" }).getByRole("textbox", { name: "Search" });
  await search.fill("Settings: Spending");
  await search.press("Enter");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("heading", { name: "Spending", exact: true })).toBeVisible();
  return settings;
}

const costTag = (page: Page, name: string) => page.getByRole("navigation", { name: "Bots" })
  .getByRole("button", { name, exact: true }).locator('[title$=" all time"]').first();
const fitsTheWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

test("the person sees what the home's work cost by kind, bot and person, and each bot's cost tag", async ({ page }, testInfo) => {
  const home = await ownHome(page);
  const use = await writeUse(home, "Otto", OTTO_USE);
  try {
    // The chart drawn at once, so the screenshots show its bars at their height rather than growing.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHome(page, use.home);
    await expect(costTag(page, "Otto")).toHaveText("$1.88");
    await expect(costTag(page, "Otto")).toHaveAttribute("title", "$1.88 this month · $1.88 all time");

    // The account menu's first row is this month's spending, whose it is, and the way to Settings → Spending.
    await page.locator(".mb-account").click();
    await page.getByText("Spending", { exact: true }).hover();
    const menu = page.locator(".mb-spending");
    await expect(menu).toContainText("$1.88");
    await expect(menu.locator(".mb-spending__note")).toHaveText("Everyone in this home");
    await expect(menu.locator(".v-list-item")).toHaveText(["See spending"]);
    await page.screenshot({ path: testInfo.outputPath("menu.png") });
    await menu.getByText("See spending", { exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings.getByRole("heading", { name: "Spending", exact: true })).toBeVisible();

    // This month, the report and how it's counted: nothing else.
    await expect(settings.locator(".mb-set-group")).toHaveText(["This month", "Spending", "How spending is counted"]);
    await expect(settings.getByTestId("month-spending")).toHaveText("$1.88");
    await expect(settings.getByText(/^This home in /u)).toBeVisible();
    const spending = settings.getByTestId("spending");
    await expect(spending.getByTestId("report-total")).toHaveText("$1.88");
    await expect(spending.locator(".mb-report__line").filter({ hasText: "Otto" }).first()).toContainText("$1.88");
    await expect(spending.locator(".mb-report__line").filter({ hasText: "Premium AI" })).toContainText("$1.23");
    await expect(spending.locator(".mb-report__line").filter({ hasText: "Economy AI" })).toContainText("$0.45");
    await expect(spending.locator(".mb-report__line").filter({ hasText: "Pictures" })).toContainText("2 pictures");
    await expect(spending.locator(".mb-report__line").filter({ hasText: "Pictures" })).toContainText("$0.20");
    await expect(spending.locator(".mb-report__line").filter({ hasText: "Computer days" })).toContainText("1 day");
    await expect(spending.locator(".mb-report__line").filter({ hasText: "Computer days" })).toContainText("$0.00");
    await expect(spending.getByTestId("report-person")).toHaveCount(2);
    await expect(spending.getByTestId("report-person").filter({ hasText: "Nobody in particular" })).toContainText("$0.45");
    await expect(settings.getByText("Spending is what your own keys' work costs at the AI providers, as each provider reports it", { exact: false })).toBeVisible();
    await expect(settings.getByText("A bot's computer days and its commands are counted as use, with no cost.", { exact: false })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("spending-wide.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(spending).toBeVisible();
    expect(await fitsTheWidth(page)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("spending-phone.png"), fullPage: true });
  } finally {
    await use.remove();
  }
});

test("the person reads what was spent by day, week and range, and downloads it as a CSV", async ({ page }, testInfo) => {
  // $21 today by a bot of the test's own: premium AI and pictures for the person, economy AI for nobody in particular;
  // and a month whose day-by-day totals are gone (14 months back): only its monthly totals, the person's premium AI.
  const home = await ownHome(page);
  const use = await writeUse(home, `Ledger ${Date.now().toString(36)}`, [
    ["person", "premium", { calls: 30, cost_nano: 15_000_000_000 }],
    ["person", "images", { calls: 10, images: 10, cost_nano: 1_550_000_000 }],
    ["nobody", "economy", { calls: 40, cost_nano: 4_450_000_000 }]
  ], { monthsBack: [{ months: 14, uses: [["person", "premium", { calls: 30, cost_nano: 15_000_000_000 }]] }] });
  try {
    // The chart drawn at once, so its screenshot shows the bars at their height rather than growing.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHome(page, use.home);
    const settings = await openSpending(page);
    const report = settings.getByTestId("spending");
    await expect(report.getByTestId("report-total")).toHaveText("$21.00");
    await expect(report.locator(".mb-report__line").filter({ hasText: "Premium AI" })).toContainText("$15.00");
    await expect(report.locator(".mb-report__line").filter({ hasText: "Pictures" })).toContainText("10 pictures");
    await expect(report.locator(".mb-report__line").filter({ hasText: use.bot.name })).toContainText("$21.00");
    await expect(report.getByTestId("report-person")).toHaveCount(2);
    await expect(report.getByTestId("report-person").filter({ hasText: "$4.45" })).toHaveCount(1);
    await expect(report.getByRole("img", { name: /^Bar chart of spending by day/u })).toBeVisible();
    await report.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("report-month.png") });

    // The same day alone, its week, then a range of days.
    await settings.getByRole("button", { name: "Period" }).click();
    await page.getByRole("option", { name: "Day" }).click();
    await expect(report.getByTestId("report-total")).toHaveText("$21.00");
    await expect(report.getByRole("button", { name: "Later" })).toBeDisabled();
    await report.getByRole("button", { name: "Earlier" }).click();
    await expect(report.getByText("Nothing was spent in this period.")).toBeVisible();
    await settings.getByRole("button", { name: "Period" }).click();
    await page.getByRole("option", { name: "Week" }).click();
    await expect(report.getByTestId("report-total")).toHaveText("$21.00");
    await settings.getByRole("button", { name: "Period" }).click();
    await page.getByRole("option", { name: "Custom range" }).click();
    await report.getByLabel("First day").fill("2026-01-02");
    await report.getByLabel("Last day").fill("2026-01-01");
    await expect(report.getByRole("alert")).toHaveText("The last day comes before the first.");
    // From the first day whose daily totals are still kept (the first of the month a year before this one), whenever
    // this runs.
    const now = new Date();
    const kept = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1));
    await report.getByLabel("Last day").fill(new Date(kept.getTime() + 30 * 86_400_000).toISOString().slice(0, 10));
    await report.getByLabel("First day").fill(kept.toISOString().slice(0, 10));
    await expect(report.getByRole("alert")).toHaveCount(0);

    // The CSV of this month: a line per day (UTC), bot, person and kind; the test's bot has three.
    await settings.getByRole("button", { name: "Period" }).click();
    await page.getByRole("option", { name: "Month" }).click();
    const [download] = await Promise.all([page.waitForEvent("download"), report.getByTestId("spending-csv").click()]);
    expect(download.suggestedFilename()).toMatch(/^mercbot-spending-\d{4}-\d{2}-01-to-\d{4}-\d{2}-\d{2}\.csv$/u);
    const csv = (await readFile(await download.path(), "utf8")).trim().split("\r\n");
    expect(csv[0]).toBe("Day,Bot,Person,Kind,Uses,Pictures,Seconds,Spent (USD)");
    const lines = csv.slice(1).filter((line) => line.includes(`,${use.bot.name},`));
    expect(lines).toHaveLength(3);
    const lineOf = (kind: string) => lines.find((line) => line.includes(`,${kind},`));
    const bot = use.bot.name;
    expect(lineOf("Premium AI")).toMatch(new RegExp(`^\\d{4}-\\d{2}-\\d{2},${bot},[^,]+,Premium AI,30,0,0,15$`, "u"));
    expect(lineOf("Pictures")).toMatch(new RegExp(`^\\d{4}-\\d{2}-\\d{2},${bot},[^,]+,Pictures,10,10,0,1\\.55$`, "u"));
    expect(lineOf("Economy AI")).toMatch(new RegExp(`^\\d{4}-\\d{2}-\\d{2},${bot},Nobody in particular,Economy AI,40,0,0,4\\.45$`, "u"));

    // A month older than the day-by-day totals: its monthly totals, described as the whole month, without a chart.
    for (let back = 0; back < 14; back += 1) await report.getByRole("button", { name: "Earlier" }).click();
    await expect(report.getByTestId("report-total")).toHaveText("$15.00");
    await expect(report).toContainText("Everyone in this home, the whole month in UTC.");
    await expect(report.getByText("Day-by-day totals are kept 13 months; older months keep only their monthly totals, so there's no chart.")).toBeVisible();
    await expect(report.getByRole("img", { name: /^Bar chart of spending by day/u })).toHaveCount(0);
    await report.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("report-old-month.png") });
    for (let back = 0; back < 14; back += 1) await report.getByRole("button", { name: "Later" }).click();
    await expect(report.getByTestId("report-total")).toHaveText("$21.00");
    await expect(report).toContainText("Everyone in this home, by day in UTC.");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(report).toBeVisible();
    expect(await fitsTheWidth(page)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("phone-report.png") });
  } finally {
    // Left first, so the page doesn't go on reading the bot once it's gone (the API guard would see that).
    await page.goto("about:blank");
    await use.remove();
  }
});

test("a bot's reply is recorded with its provider's cost, and nothing is held or refused", async ({ page }) => {
  const home = await ownHome(page);
  await openHome(page, home);
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const headers = { "csrf-token": csrfToken };
  const name = `Counted ${Date.now().toString(36)}`;
  const created = await page.request.post(`/api${home}/bots`, { headers, data: { name, color: "#1E86FC" } });
  expect(created.ok()).toBe(true);
  const { bot } = await created.json();
  const knex = database();
  try {
    await knex("bot_conversations").where({ bot_id: bot.id }).whereNotNull("user_id").update({ onboarding_step: null });
    const sent = await page.request.post(`/api${home}/bots/${bot.id}/messages`, { headers, data: { text: "What can you do?" } });
    expect(sent.ok()).toBe(true);
    const [question] = (await sent.json()).messages;
    const replied = await page.request.post(`/api${home}/bots/${bot.id}/reply`, { headers, data: { afterMessageId: question.id, timeZone: "UTC", language: "en" } });
    expect(replied.ok(), await replied.text()).toBe(true);
    const { messages } = await (await page.request.get(`/api${home}/bots/${bot.id}/messages`)).json();
    expect(messages.some((message: { body?: { text?: string } }) => STAND_IN_REPLY.test(message.body?.text || "")), "the bot replied").toBe(true);

    // Its AI calls, each with what it cost at the provider's list rates, in the day's totals as the reply ends.
    const today = new Date().toISOString().slice(0, 10);
    const totals = async () => (await knex("usage_daily").where({ bot_id: bot.id, day: today }).sum({ calls: "calls", cost: "cost_nano" }).first()) as { calls: string | null, cost: string | null };
    await expect.poll(async () => Number((await totals()).calls)).toBeGreaterThan(0);
    expect(Number((await totals()).cost), "its provider's cost").toBeGreaterThan(0);

    // Settings → Spending counts it under the bot.
    await openHome(page, home);
    const settings = await openSpending(page);
    await expect(settings.getByTestId("spending").locator(".mb-report__line").filter({ hasText: name })).toBeVisible();
  } finally {
    await knex.destroy();
    await page.goto("about:blank");
    await page.request.delete(`/api${home}/bots/${bot.id}`, { headers });
  }
});
