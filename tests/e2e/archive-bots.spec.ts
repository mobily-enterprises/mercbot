import knexLib from "knex";
import { expect, test, testDatabaseName, type Page } from "./harness";

// Archiving a whole bot (D-108), on the Test Preview target: a bot filed in a section is archived from its sidebar menu,
// after the question; it leaves the section for Archived bots at the bottom of the sidebar, on this page and at once on
// another page that had it open, whose chat turns read-only with a banner saying who archived it and when, its routine
// paused with a line. Unarchive on the other page brings it back to its section on both, the composer back, the routine
// still paused. Light and dark, with screenshots of the menu, the question, the archived chat and its Details; at a
// phone's width Archived bots is in the drawer and Unarchive is on the banner. A person's own copy has one person
// (D-81), so "another person" here is another page of theirs; the server's tests (archiveBots.integration.js) show it
// for another person. Each test makes its own bot and section and deletes them. Run with:
// vibe64-helper playwright --target test-app test tests/e2e/archive-bots.spec.ts
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
const sidebar = (page: Page) => page.getByRole("navigation", { name: "Bots" });
const composer = (page: Page) => chat(page).locator("textarea.mb-composer__input");
const banner = (page: Page) => chat(page).getByRole("status", { name: "Archived" });
const details = (page: Page) => page.getByRole("complementary", { name: "Details" });
const menuItems = (page: Page) => page.locator(".v-overlay--active .mb-menu .mb-menu__text");
const question = (page: Page) => page.locator(".v-overlay--active .mb-confirm");
const archivedBots = (page: Page) => sidebar(page).getByRole("region", { name: "Archived bots" });
/** The sidebar group under a section's name. */
const filed = (page: Page, sectionName: string) => sidebar(page).locator(".mb-group").filter({ has: page.locator(".mb-header__label", { hasText: sectionName }) });

const connect = () => knexLib({
  client: "pg",
  connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() }
});

/**
 * A bot of the fixtures' home made for one test, past its introduction, with a chat and a routine, filed in a section of
 * its own; `remove` deletes both.
 */
async function filedBot(page: Page) {
  const knex = connect();
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const headers = { "csrf-token": csrfToken };
  const stamp = Date.now().toString(36);
  const name = `Ledger ${stamp}`;
  const made = await page.request.post(`/api${HOME}/bots`, { headers, data: { name, color: "#1E86FC" } });
  expect(made.ok()).toBe(true);
  const { bot } = await made.json();
  const home = await knex("workspaces").where({ slug: HOME.slice(3) }).first();
  const where = { workspace_id: home.id, bot_id: bot.id, user_id: home.owner_user_id };
  const seat = (await knex("bot_conversations").where(where).first()) ?? (await knex("bot_conversations").insert(where).returning("*"))[0];
  await knex("bot_conversations").where({ id: seat.id }).update({ onboarding_step: null, unread: false });
  await knex("bot_messages").insert([
    { workspace_id: home.id, bot_id: bot.id, conversation_id: seat.id, kind: "text", role: "user", body: { text: "The budget is 500" } },
    { workspace_id: home.id, bot_id: bot.id, conversation_id: seat.id, kind: "text", role: "bot", body: { text: "Noted: 500 for the month." } }
  ]);
  const [routine] = await knex("bot_routines").insert({
    workspace_id: home.id, bot_id: bot.id, conversation_id: seat.id, name: "Money brief", schedule: "Every morning", cron: "0 8 * * *",
    timezone: "UTC", instructions: "Say what's left", enabled: true, next_run_at: knex.raw("now() + interval '1 day'")
  }).returning("*");
  const sectionName = `Money ${stamp}`;
  const filing = await page.request.post(`/api${HOME}/bot-sections`, { headers, data: { name: sectionName, botId: bot.id } });
  expect(filing.ok()).toBe(true);
  const section = (await filing.json()).sections.find((entry: { name: string }) => entry.name === sectionName);
  const routineEnabled = async () => (await knex("bot_routines").where({ id: routine.id }).first()).enabled;
  const resumeRoutine = () => knex("bot_routines").where({ id: routine.id }).update({ enabled: true, next_run_at: knex.raw("now() + interval '1 day'") });
  const remove = async () => {
    for (const open of page.context().pages()) if (open.url() !== "about:blank") await open.goto("about:blank");
    expect((await page.request.delete(`/api${HOME}/bots/${bot.id}`, { headers })).ok()).toBe(true);
    expect((await page.request.delete(`/api${HOME}/bot-sections/${section.id}`, { headers })).ok()).toBe(true);
    await knex.destroy();
  };
  return { id: String(bot.id), name, sectionName, headers, routineEnabled, resumeRoutine, remove };
}

test("a bot archived from its menu goes to Archived bots on another page too, and Unarchive brings it back to its section, light and dark", async ({ page }, testInfo) => {
  const bot = await filedBot(page);
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await bot.resumeRoutine();
      await openHome(page, `?bot=${bot.id}`);
      await expect(page.locator(".v-application")).toHaveClass(new RegExp(`\\bv-theme--(workspace-)?${colorScheme}\\b`, "u"));
      const row = filed(page, bot.sectionName).getByRole("button", { name: bot.name, exact: true });
      await expect(row).toBeVisible();
      await expect(archivedBots(page)).toHaveCount(0);
      await expect(composer(page)).toBeVisible();

      // Another page has it open.
      const other = await page.context().newPage();
      await other.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await other.setViewportSize({ width: 1280, height: 800 });
      await openHome(other, `?bot=${bot.id}`);
      await expect(chat(other).getByText("Noted: 500 for the month.")).toBeVisible();
      await expect(composer(other)).toBeVisible();

      // Its menu has Archive; the question first.
      await row.click({ button: "right" });
      await expect(menuItems(page).filter({ hasText: /^Archive$/u })).toHaveCount(1);
      await page.screenshot({ path: testInfo.outputPath(`menu-${colorScheme}.png`), animations: "disabled" });
      await menuItems(page).filter({ hasText: /^Archive$/u }).click();
      await expect(question(page).locator(".mb-confirm__title")).toHaveText(`Archive ${bot.name}?`);
      await expect(question(page).locator(".mb-confirm__text")).toHaveText(
        "It moves to Archived bots for everyone in this home: its chats become read-only, and its routines and watches pause. " +
          "Nothing is deleted. Whoever made it, or an owner or admin, can unarchive it."
      );
      await page.screenshot({ path: testInfo.outputPath(`question-${colorScheme}.png`), animations: "disabled" });
      const archived = page.waitForResponse((response) => new URL(response.url()).pathname === `/api${HOME}/bots/${bot.id}/archive`);
      await question(page).getByRole("button", { name: "Archive" }).click();
      expect((await archived).ok()).toBe(true);

      // Here and on the other page: out of its section, in Archived bots (closed, with its count), its chat read-only.
      for (const seen of [page, other]) {
        await expect(filed(seen, bot.sectionName).getByRole("button", { name: bot.name, exact: true })).toHaveCount(0);
        await expect(archivedBots(seen).locator(".mb-header__count")).toHaveText("1");
        await expect(banner(seen)).toContainText("Archived by you on");
        await expect(banner(seen)).toContainText("Its chats are read-only, and its routines and watches are paused.");
        await expect(composer(seen)).toHaveCount(0);
        await expect(chat(seen).getByText("Noted: 500 for the month."), "its chat is kept").toBeVisible();
        await expect(chat(seen).getByText("Paused while archived", { exact: true }).last()).toBeVisible();
      }
      expect(await bot.routineEnabled(), "its routine paused").toBe(false);
      await other.screenshot({ path: testInfo.outputPath(`archived-elsewhere-${colorScheme}.png`), animations: "disabled" });

      // Opened, Archived bots lists it with who archived it; its Details say so too.
      await archivedBots(page).getByRole("button", { name: /^Archived bots/u }).click();
      const archivedRow = archivedBots(page).getByRole("button", { name: `${bot.name}, archived` });
      await expect(archivedRow).toContainText("Archived by you on");
      if (!(await details(page).isVisible())) await chat(page).getByRole("button", { name: `${bot.name} details` }).click();
      await details(page).getByRole("tab", { name: "Details" }).click();
      const section = details(page).getByRole("region", { name: "Archive" });
      await expect(section).toContainText("Its routines and watches stay paused when it's unarchived");
      await expect(section.getByRole("button", { name: "Unarchive" })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`archived-${colorScheme}.png`), animations: "disabled" });
      await archivedRow.click({ button: "right" });
      await expect(menuItems(page)).toHaveText(["Unarchive", "Copy conversation ID", "Delete"]);
      await page.keyboard.press("Escape");
      await expect(menuItems(page)).toHaveCount(0);
      await archivedBots(page).getByRole("button", { name: /^Archived bots/u }).click();
      await expect(archivedBots(page).locator(".mb-header__count"), "closed again").toHaveText("1");

      // Unarchive on the other page: back in its section on both, the composer back, the routine still paused.
      const unarchived = other.waitForResponse((response) => new URL(response.url()).pathname === `/api${HOME}/bots/${bot.id}/unarchive`);
      await banner(other).getByRole("button", { name: "Unarchive" }).click();
      expect((await unarchived).ok()).toBe(true);
      for (const seen of [page, other]) {
        await expect(filed(seen, bot.sectionName).getByRole("button", { name: bot.name, exact: true })).toBeVisible();
        await expect(archivedBots(seen)).toHaveCount(0);
        await expect(banner(seen)).toHaveCount(0);
        await expect(composer(seen)).toBeVisible();
      }
      await expect(details(page).getByRole("region", { name: "Archive" }).getByRole("button", { name: `Archive ${bot.name}` })).toBeVisible();
      expect(await bot.routineEnabled(), "its routine stays paused until someone resumes it").toBe(false);
      await other.close();
    }
  } finally {
    await bot.remove();
  }
});

test("on a phone Archived bots is at the bottom of the drawer, and an archived bot's banner unarchives it", async ({ page }, testInfo) => {
  const bot = await filedBot(page);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    expect((await page.request.post(`/api${HOME}/bots/${bot.id}/archive`, { headers: bot.headers })).ok()).toBe(true);
    await openHome(page);
    await page.getByRole("button", { name: "Your bots" }).click();
    await expect(archivedBots(page)).toBeVisible();
    await archivedBots(page).getByRole("button", { name: /^Archived bots/u }).click();
    await archivedBots(page).getByRole("button", { name: `${bot.name}, archived` }).click();
    await expect(banner(page)).toContainText("Archived by you on");
    await expect(composer(page)).toHaveCount(0);
    const box = (await banner(page).boundingBox())!;
    expect(box.x + box.width, "the banner fits the phone's width").toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath("archived-phone.png"), animations: "disabled" });
    await banner(page).getByRole("button", { name: "Unarchive" }).click();
    await expect(banner(page)).toHaveCount(0);
    await expect(composer(page)).toBeVisible();
    await page.getByRole("button", { name: "Your bots" }).click();
    await expect(filed(page, bot.sectionName).getByRole("button", { name: bot.name, exact: true })).toBeVisible();
    await expect(archivedBots(page)).toHaveCount(0);
  } finally {
    await bot.remove();
  }
});
