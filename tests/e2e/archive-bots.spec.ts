import type { TestInfo } from "@playwright/test";
import { connectTestDb, directChat, expect, HOME, homeApi, openShell, seedMessage, shell, test, type Page } from "./harness";

// Archiving a whole bot (D-108 under D-112: a member of the home who has left), on the Test Preview target: a bot in
// the sidebar's Bots is archived from its card's Archive section, after the question; it leaves Bots for its folded
// "Archived bots", its card saying so with Resume, on this page, and at once on another page that had its direct chat
// open, which turns read-only with a banner saying it has left and who archived it when, its routine paused with a line
// in that chat. Resume on the other page's banner brings it back to Bots, the composer back, the routine still paused.
// Light and dark, with screenshots of its card's Archive section, the question, the archived chat and its card; at a
// phone's width the archived bot is under Archived bots in the drawer, its row opening its card, and Resume is on its
// chat's banner. A person's own copy has
// one person (D-81), so "another person" here is another page of theirs; the server's tests (archiveBots.integration.js)
// show it for another person. Each test makes its own bot, its direct chat and a routine there, and deletes them. Run
// with: vibe64-helper playwright --target test-app test tests/e2e/archive-bots.spec.ts
test.describe.configure({ mode: "serial" });
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

const banner = (page: Page) => shell.chat(page).getByRole("status", { name: "Left the home" });
/** The bot's row in the sidebar's Bots, by its name (its direct chat has messages, so it's in view). */
const botRow = (page: Page, name: string) => shell.section(page, "Bots").getByRole("button", { name, exact: true });
const archivedList = (page: Page) => shell.section(page, "Bots").getByRole("list", { name: "Archived bots" });
/** Bots' folded "Archived bots", opened. */
async function openArchived(page: Page) {
  const toggle = shell.section(page, "Bots").locator("button.mb-more", { hasText: "Archived bots" });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}
const card = (page: Page, name: string) => shell.details(page, `${name}'s card`);
const shot = (page: Page, info: TestInfo, name: string) => page.screenshot({ path: info.outputPath(name), animations: "disabled" });

/**
 * A bot of the fixtures' home made for one test: its direct chat with the person, past its introduction, with two
 * messages, and a routine in that chat. `remove` deletes the bot, and with it (ON DELETE CASCADE) its chat and routine.
 */
async function botWithRoutine(page: Page) {
  const knex = connectTestDb();
  const api = await homeApi(page);
  const name = `Ledger ${Date.now().toString(36)}`;
  const { bot } = await api.post("/bots", { name, color: "#1E86FC" });
  const chat = await directChat(page, String(bot.id));
  const home = await knex("workspaces").where({ slug: HOME.slice(3) }).first();
  await knex("conversations").where({ id: chat.id }).update({ onboarding_step: null });
  await knex("chat_people").where({ conversation_id: chat.id }).update({ unread: false });
  await seedMessage(knex, { homeId: home.id, chatId: chat.id, body: { text: "The budget is 500" }, userId: home.owner_user_id });
  await seedMessage(knex, { homeId: home.id, chatId: chat.id, body: { text: "Noted: 500 for the month." }, botId: bot.id });
  const seat = chat.bots.find((entry: { botId: string }) => String(entry.botId) === String(bot.id));
  const [routine] = await knex("bot_routines").insert({
    workspace_id: home.id, chat_bot_id: seat.chatBotId, made_by: home.owner_user_id, name: "Money brief", schedule: "Every morning",
    cron: "0 8 * * *", timezone: "UTC", instructions: "Say what's left", enabled: true, next_run_at: knex.raw("now() + interval '1 day'")
  }).returning("*");
  const routineEnabled = async () => (await knex("bot_routines").where({ id: routine.id }).first()).enabled;
  const resumeRoutine = () => knex("bot_routines").where({ id: routine.id }).update({ enabled: true, next_run_at: knex.raw("now() + interval '1 day'") });
  const remove = async () => {
    for (const open of page.context().pages()) if (open.url() !== "about:blank") await open.goto("about:blank");
    try {
      await knex("bots").where({ id: bot.id }).del();
    } finally {
      await knex.destroy();
    }
  };
  return { id: String(bot.id), name, chatId: String(chat.id), api, routineEnabled, resumeRoutine, remove };
}

test("a bot archived from its card leaves Bots for Archived bots on another page too, and Resume brings it back, light and dark", async ({ page }, testInfo) => {
  const bot = await botWithRoutine(page);
  const archivedRow = (shown: Page) => archivedList(shown).getByRole("button", { name: `${bot.name}, archived`, exact: true });
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await bot.resumeRoutine();
      await openShell(page, `?member=bot:${bot.id}`);
      await expect(page.locator(".v-application")).toHaveClass(new RegExp(`\\bv-theme--(workspace-)?${colorScheme}\\b`, "u"));
      await expect(botRow(page, bot.name)).toBeVisible();
      await expect(card(page, bot.name).getByText("Bot · made by you")).toBeVisible();
      await expect(archivedRow(page)).toHaveCount(0);

      // Another page has its direct chat open.
      const other = await page.context().newPage();
      await other.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await other.setViewportSize({ width: 1280, height: 800 });
      await openShell(other, `?chat=${bot.chatId}`);
      await expect(shell.chat(other).getByText("Noted: 500 for the month.")).toBeVisible();
      await expect(shell.composer(other)).toBeVisible();

      // Its card's Archive section has Archive; the question first.
      await card(page, bot.name).getByRole("tab", { name: "Details" }).click();
      const section = card(page, bot.name).getByRole("region", { name: "Archive" });
      await expect(section).toContainText(`Archiving ${bot.name} takes it out of the home's bots for everyone in this home.`);
      await section.scrollIntoViewIfNeeded();
      await shot(page, testInfo, `archive-section-${colorScheme}.png`);
      await section.getByRole("button", { name: `Archive ${bot.name}` }).click();
      await expect(shell.question(page).locator(".mb-confirm__title")).toHaveText(`Archive ${bot.name}?`);
      await expect(shell.question(page).locator(".mb-confirm__text")).toHaveText(
        "It leaves the home's bots for everyone in this home. It stays in its chats but no longer answers there, and its routines and " +
          "watches pause. Nothing is deleted. Whoever made it, or an owner or admin, can resume it."
      );
      await shot(page, testInfo, `question-${colorScheme}.png`);
      const archived = page.waitForResponse((response) => new URL(response.url()).pathname === `/api${HOME}/bots/${bot.id}/archive`);
      await shell.question(page).getByRole("button", { name: "Archive" }).click();
      expect((await archived).ok()).toBe(true);

      // Here: off Bots, under Archived bots, saying when it left; its card says who archived it and when, with Resume.
      await expect(botRow(page, bot.name)).toHaveCount(0);
      await openArchived(page);
      await expect(archivedRow(page)).toHaveAttribute("title", new RegExp(`^${bot.name}\\nBot · left `, "u"));
      await expect(section).toContainText("Archived by you on");
      await expect(section).toContainText("It's under Archived bots in Bots, and its chats are kept.");
      await expect(section).toContainText("Its routines and watches stay paused when it's resumed");
      await expect(section.getByRole("button", { name: `Resume ${bot.name}` })).toBeVisible();
      await shot(page, testInfo, `archived-${colorScheme}.png`);

      // On the other page, at once: its direct chat read-only and kept, with the line where its routine paused.
      await expect(banner(other)).toContainText(`${bot.name} has left`);
      await expect(banner(other)).toContainText("Archived by you on");
      await expect(banner(other)).toContainText("Resume it to talk again.");
      await expect(shell.composer(other)).toHaveCount(0);
      await expect(shell.chat(other).getByText("Noted: 500 for the month."), "its chat is kept").toBeVisible();
      await expect(shell.chat(other).getByText("Paused while archived", { exact: true }).last()).toBeVisible();
      expect(await bot.routineEnabled(), "its routine paused").toBe(false);
      await shot(other, testInfo, `archived-elsewhere-${colorScheme}.png`);

      // Resume on the other page: the composer back there, back in Bots here, the routine still paused.
      const unarchived = other.waitForResponse((response) => new URL(response.url()).pathname === `/api${HOME}/bots/${bot.id}/unarchive`);
      await banner(other).getByRole("button", { name: `Resume ${bot.name}` }).click();
      expect((await unarchived).ok()).toBe(true);
      await expect(banner(other)).toHaveCount(0);
      await expect(shell.composer(other)).toBeVisible();
      await expect(botRow(page, bot.name)).toBeVisible();
      await expect(archivedRow(page)).toHaveCount(0);
      await expect(section.getByRole("button", { name: `Archive ${bot.name}` })).toBeVisible();
      expect(await bot.routineEnabled(), "its routine stays paused until someone resumes it").toBe(false);
      await other.close();
    }
  } finally {
    await bot.remove();
  }
});

test("on a phone an archived bot is under Archived bots in the drawer, its row opens its card, and its chat's banner resumes it", async ({ page }, testInfo) => {
  const bot = await botWithRoutine(page);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await bot.api.post(`/bots/${bot.id}/archive`);
    await openShell(page);
    await page.getByRole("button", { name: "Your chats" }).click();
    await openArchived(page);
    const archived = archivedList(page).getByRole("button", { name: `${bot.name}, archived`, exact: true });
    await expect(archived).toHaveAttribute("title", new RegExp(`^${bot.name}\\nBot · left `, "u"));

    // Its row opens its card, which says it has left. Its direct chat, by its address (an archived bot's chat isn't in
    // Bots): read-only, the banner within the phone's width.
    await archived.click();
    await expect(card(page, bot.name).getByText(/^Bot · left /u)).toBeVisible();
    await page.goto(`${HOME}?chat=${bot.chatId}`);
    await expect(banner(page)).toContainText("Archived by you on");
    await expect(shell.composer(page)).toHaveCount(0);
    const box = (await banner(page).boundingBox())!;
    expect(box.x + box.width, "the banner fits the phone's width").toBeLessThanOrEqual(390);
    await shot(page, testInfo, "archived-phone.png");
    await banner(page).getByRole("button", { name: `Resume ${bot.name}` }).click();
    await expect(banner(page)).toHaveCount(0);
    await expect(shell.composer(page)).toBeVisible();
    await page.getByRole("button", { name: "Your chats" }).click();
    await expect(botRow(page, bot.name)).toBeVisible();
    await expect(shell.section(page, "Bots").locator("button.mb-more", { hasText: "Archived bots" })).toHaveCount(0);
  } finally {
    await bot.remove();
  }
});
