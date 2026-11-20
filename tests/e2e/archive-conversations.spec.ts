import knexLib from "knex";
import { expect, test, testDatabaseName, type Page } from "./harness";

// Archiving a conversation (D-101), on the Test Preview target: a Shared bot's tab is archived from its right-click
// menu, after the question; it goes at once from another page that had it open, which lands on General; Archived (1)
// lists it, with who archived it, and Resume brings it back in its place with its messages. Light and dark, with
// screenshots of the menu, the question and the list; at a phone's width a long press opens the same menu. A person's
// own copy has one person (D-81), so "another person" here is another page of theirs; the server's tests show it for
// another person. Screenshots are taken with transitions finished. Each test makes its own bot and deletes it. Run with:
// vibe64-helper playwright --target test-app test tests/e2e/archive-conversations.spec.ts
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
const tab = (page: Page, title: string) => tabs(page).filter({ hasText: title });
const menuItems = (page: Page) => page.locator(".v-overlay--active .mb-menu .mb-menu__text");
const question = (page: Page) => page.locator(".v-overlay--active .mb-confirm");
const archivedButton = (page: Page) => page.getByRole("navigation", { name: "Conversations" }).getByRole("button", { name: /^Archived \(/u });
const archivedList = (page: Page) => page.locator(".v-overlay--active").getByRole("list", { name: "Archived conversations" });

const connect = () => knexLib({
  client: "pg",
  connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() }
});

/** A Shared bot of the fixtures' home made for one test, with General and Plans, a message in Plans; `remove` deletes it. */
async function sharedBotWithPlans(page: Page) {
  const knex = connect();
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
  expect((await page.request.patch(`/api${HOME}/bots/${bot.id}`, { headers, data: { sharing: "shared" } })).ok()).toBe(true);
  expect((await page.request.get(`/api${HOME}/bots/${bot.id}/messages`)).ok()).toBe(true);
  const plans = await page.request.post(`/api${HOME}/bots/${bot.id}/rooms`, { headers, data: { title: "Plans" } });
  expect(plans.ok()).toBe(true);
  const { room } = await plans.json();
  await knex("bot_messages").insert({
    workspace_id: home.id, bot_id: bot.id, conversation_id: room.id, kind: "text", role: "bot", body: { text: "The plan for Saturday is ready." }
  });
  const general = (await knex("bot_conversations").where({ bot_id: bot.id, title: "General" }).whereNull("user_id").first()).id;
  // General opens first, as for anyone coming to the bot.
  expect((await page.request.patch(`/api${HOME}/bots/${bot.id}`, { headers, data: { roomId: String(general), unread: false } })).ok()).toBe(true);
  const remove = async () => {
    for (const open of page.context().pages()) if (open.url() !== "about:blank") await open.goto("about:blank");
    expect((await page.request.delete(`/api${HOME}/bots/${bot.id}`, { headers })).ok()).toBe(true);
    await knex.destroy();
  };
  return { id: String(bot.id), name, planId: String(room.id), remove };
}

test("a tab archived from its menu goes for another page that had it open, and Resume brings it back, light and dark", async ({ page }, testInfo) => {
  const bot = await sharedBotWithPlans(page);
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await openHome(page, `?bot=${bot.id}`);
      await expect(page.locator(".v-application")).toHaveClass(new RegExp(`\\bv-theme--(workspace-)?${colorScheme}\\b`, "u"));
      await expect(tabs(page)).toHaveText(["General", "Plans", "You only"]);
      await expect(archivedButton(page)).toHaveCount(0);

      // Another page has Plans open.
      const other = await page.context().newPage();
      await other.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await openHome(other, `?bot=${bot.id}`);
      await tab(other, "Plans").click();
      await expect(tab(other, "Plans")).toHaveAttribute("aria-selected", "true");
      await expect(chat(other).getByText("The plan for Saturday is ready.")).toBeVisible();

      // Right-click: Rename and Archive; General's menu has no Archive.
      await tab(page, "General").click({ button: "right" });
      await expect(menuItems(page)).toHaveText(["Rename"]);
      await page.keyboard.press("Escape");
      await expect(menuItems(page)).toHaveCount(0);
      await tab(page, "Plans").click({ button: "right" });
      await expect(menuItems(page)).toHaveText(["Rename", "Archive"]);
      await page.screenshot({ path: testInfo.outputPath(`menu-${colorScheme}.png`), animations: "disabled" });
      await menuItems(page).filter({ hasText: "Archive" }).click();

      // The question first.
      await expect(question(page).locator(".mb-confirm__title")).toHaveText("Archive Plans?");
      await expect(question(page).locator(".mb-confirm__text")).toHaveText(
        "It's hidden for everyone in the home, and its routines and watches pause. Anyone who started it, or an owner or admin, " +
          "can resume it from Archived conversations."
      );
      await page.screenshot({ path: testInfo.outputPath(`question-${colorScheme}.png`), animations: "disabled" });
      const archived = page.waitForResponse((response) => new URL(response.url()).pathname === `/api${HOME}/bots/${bot.id}/rooms/${bot.planId}/archive`);
      await question(page).getByRole("button", { name: "Archive" }).click();
      expect((await archived).ok()).toBe(true);
      await expect(tabs(page)).toHaveText(["General", "You only"]);
      await expect(archivedButton(page)).toHaveText("Archived (1)");

      // Gone for the other page too, which lands on General.
      await expect(tabs(other)).toHaveText(["General", "You only"]);
      await expect(tab(other, "General")).toHaveAttribute("aria-selected", "true");
      await expect(chat(other).getByText("The plan for Saturday is ready.")).toHaveCount(0);
      await expect(archivedButton(other)).toHaveText("Archived (1)");
      await other.screenshot({ path: testInfo.outputPath(`gone-elsewhere-${colorScheme}.png`), animations: "disabled" });
      await other.close();

      // Archived (1) lists it, with who archived it; Resume brings it back in its place, open, as it was.
      await archivedButton(page).click();
      const row = archivedList(page).getByRole("listitem").filter({ hasText: "Plans" });
      await expect(row).toContainText("Archived by you");
      await page.screenshot({ path: testInfo.outputPath(`archived-list-${colorScheme}.png`), animations: "disabled" });
      const resumed = page.waitForResponse((response) => new URL(response.url()).pathname === `/api${HOME}/bots/${bot.id}/rooms/${bot.planId}/resume`);
      await row.getByRole("button", { name: "Resume Plans" }).click();
      expect((await resumed).ok()).toBe(true);
      await expect(tabs(page)).toHaveText(["General", "Plans", "You only"]);
      await expect(tab(page, "Plans")).toHaveAttribute("aria-selected", "true");
      await expect(chat(page).getByText("The plan for Saturday is ready.")).toBeVisible();
      await expect(archivedButton(page)).toHaveCount(0);

      // Back on General for the next round.
      await tab(page, "General").click();
      await expect(tab(page, "General")).toHaveAttribute("aria-selected", "true");
    }
  } finally {
    await bot.remove();
  }
});

test("on a phone a long press opens a tab's menu, and You only is archived for its person", async ({ page }, testInfo) => {
  const bot = await sharedBotWithPlans(page);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await openHome(page, `?bot=${bot.id}`);
    await expect(tabs(page)).toHaveText(["General", "Plans", "You only"]);

    // A long press: a touch held for half a second.
    const own = tab(page, "You only");
    const box = (await own.boundingBox())!;
    const at = { pointerType: "touch", isPrimary: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, bubbles: true };
    await own.dispatchEvent("pointerdown", at);
    await expect(menuItems(page)).toHaveText(["Archive"]);
    await own.dispatchEvent("pointerup", at);
    await page.screenshot({ path: testInfo.outputPath("long-press-phone.png"), animations: "disabled" });
    await menuItems(page).filter({ hasText: "Archive" }).click();
    await expect(question(page).locator(".mb-confirm__title")).toHaveText("Archive You only?");
    await expect(question(page).locator(".mb-confirm__text")).toContainText("hidden for you only");
    await question(page).getByRole("button", { name: "Archive" }).click();
    await expect(tabs(page)).toHaveText(["General", "Plans"]);
    await expect(archivedButton(page)).toHaveText("Archived (1)");
    await page.screenshot({ path: testInfo.outputPath("you-only-archived-phone.png"), animations: "disabled" });

    // Details → Conversations lists it too, and resumes it.
    const details = page.getByRole("complementary", { name: "Details" });
    if (!(await details.isVisible())) await chat(page).getByRole("button", { name: `${bot.name} details` }).click();
    await details.getByRole("tab", { name: "Details" }).click();
    const listed = details.getByRole("list", { name: "Archived conversations" }).getByRole("listitem").filter({ hasText: "You only" });
    await expect(listed).toContainText("Archived by you");
    await listed.getByRole("button", { name: "Resume You only" }).click();
    await expect(details.getByRole("list", { name: "Archived conversations" })).toContainText("Nothing archived");
  } finally {
    await bot.remove();
  }
});
