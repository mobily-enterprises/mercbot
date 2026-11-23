import type { TestInfo } from "@playwright/test";
import { connectTestDb, expect, HOME, homeApi, openShell, seedChat, shell, test, type Page } from "./harness";

// Archiving a chat (D-112), on the Test Preview target, with a chat of the test's own in the fixture home, made by the
// person, with Otto in it. Archive, from the chat's row, asks first; the chat is then read-only for everyone in it: a
// banner where the composer was ("This chat is archived, so it's read-only.", with Unarchive), no Invite, and the server
// refuses anything written to it. It moves to the list's Archived chats, collapsed with its count until opened, and
// Chat details says Public · Archived. Another page of the person's sees it at once. Unarchive, from the banner or the
// archived row's menu, makes it a chat to write in again. Screenshots light, dark and phone of the archived chat are the
// output. The test deletes the chat it makes.
// Run with: vibe64-helper playwright --target test-app test tests/e2e/chats-archive.spec.ts
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

const BANNER = "This chat is archived, so it's read-only.";
const banner = (page: Page) => shell.chat(page).getByRole("status").filter({ hasText: BANNER });
const archivedChats = (page: Page) => shell.sidebar(page).getByRole("region", { name: "Archived chats" });
const answered = (page: Page, method: string, path: string) =>
  page.waitForResponse((response) => response.request().method() === method && new URL(response.url()).pathname === path);

/** Light and dark, then light at a phone's width (390 by 844) once `atPhone` has shown the screen there. */
async function shots(page: Page, testInfo: TestInfo, name: string, atPhone?: () => Promise<unknown>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await expect(page.locator(".v-application")).toHaveClass(new RegExp(`\\bv-theme--(workspace-)?${scheme}\\b`, "u"));
    await page.screenshot({ path: testInfo.outputPath(`${name}-${scheme}.png`), animations: "disabled" });
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  const size = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await atPhone?.();
  await page.screenshot({ path: testInfo.outputPath(`${name}-phone.png`), animations: "disabled" });
  if (size) await page.setViewportSize(size);
}

test("an archived chat is read-only for everyone in it, sits in Archived chats, and Unarchive opens it again", async ({ page, context }, testInfo) => {
  const knex = connectTestDb();
  let chatId = "";
  try {
    const home = await knex("workspaces").where({ slug: HOME.split("/").pop() }).first();
    const me = String(home.owner_user_id);
    const otto = String((await knex("bots").where({ workspace_id: home.id, name: "Otto" }).first()).id);
    const title = `Trip ${Date.now().toString(36)}`;
    chatId = (await seedChat(knex, { homeId: String(home.id), title, people: [me], bots: [otto], madeBy: me })).id;
    const path = `/api${HOME}/chats/${chatId}`;
    await openShell(page, `?chat=${chatId}`);
    await expect(shell.composer(page)).toBeVisible();
    // Its people invite people and bots, in a public room too (8ccf7bd).
    await expect(shell.chat(page).getByRole("button", { name: "Invite", exact: true })).toBeVisible();

    // Another page of the person's, with the same chat open.
    const other = await context.newPage();
    await openShell(other, `?chat=${chatId}`);
    await expect(shell.composer(other)).toBeVisible();

    // Archive, from the chat's row, asks first.
    await shell.chatRow(page, title).click({ button: "right" });
    await shell.menuItems(page).filter({ hasText: /^Archive$/u }).click();
    const question = shell.question(page);
    await expect(question.locator(".mb-confirm__title")).toHaveText(`Archive “${title}”?`);
    await expect(question.locator(".mb-confirm__text")).toHaveText("It stays readable for everyone in it, and no one can write in it until it's unarchived.");
    const archived = answered(page, "POST", `${path}/archive`);
    await question.getByRole("button", { name: "Archive", exact: true }).click();
    const { chat } = await (await archived).json();
    expect(chat.archivedAt).toBeTruthy();
    const row = await knex("conversations").where({ id: chatId }).first();
    expect([Boolean(row.archived_at), String(row.archived_by)]).toEqual([true, me]);

    // Read-only, with Unarchive where the composer was, on both pages.
    for (const shown of [page, other]) {
      await expect(banner(shown)).toBeVisible();
      await expect(banner(shown).getByRole("button", { name: "Unarchive", exact: true })).toBeVisible();
      await expect(shell.composer(shown)).toHaveCount(0);
      await expect(shell.chat(shown).getByRole("button", { name: /^Invite/u })).toHaveCount(0);
    }
    await shots(page, testInfo, "archived-banner", () => expect(banner(page)).toBeVisible());

    // The server refuses anything written to it: a message, a person, a new title.
    const api = await homeApi(page);
    const refusals = [
      await api.answer("POST", `/chats/${chatId}/messages`, { text: "Still here?" }),
      await api.answer("POST", `/chats/${chatId}/people`, { userId: me }),
      await api.answer("PATCH", `/chats/${chatId}`, { title: "Renamed" })
    ];
    expect(await Promise.all(refusals.map(async (answer) => [answer.status(), (await answer.json()).code])))
      .toEqual([[409, "bots_chat_archived"], [409, "bots_chat_archived"], [409, "bots_chat_archived"]]);
    expect((await knex("conversations").where({ id: chatId }).first()).title).toBe(title);

    // Archived chats: last in the list, collapsed with its count; opened, the chat's row says it's read-only.
    await expect(shell.chatRow(page, title)).toHaveCount(0);
    const section = archivedChats(page);
    const toggle = section.getByRole("button", { name: /^Archived chats/u });
    if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(section.locator(".mb-header__count")).toHaveText("1");
    await toggle.click();
    const archivedRow = section.getByRole("button", { name: `${title}, archived`, exact: true });
    await expect(archivedRow, "its tooltip").toHaveAttribute("title", `${title}\nArchived · read-only`);
    await expect(archivedChats(other).getByRole("button", { name: /^Archived chats/u })).toBeVisible();

    // Chat details: Public · Archived, and Unarchive in place of Archive.
    await shell.chat(page).getByRole("button", { name: `${title} details`, exact: true }).click();
    const details = shell.details(page, "Chat details");
    await expect(details.locator(".mb-chat-details__kind > span")).toHaveText("Public · Archived");
    await expect(details.getByRole("button", { name: "Unarchive", exact: true })).toBeVisible();
    await expect(details.getByRole("button", { name: "Archive", exact: true })).toHaveCount(0);

    // Unarchive from the banner: a chat to write in again, back in the list, on both pages.
    const unarchived = answered(page, "POST", `${path}/unarchive`);
    await banner(page).getByRole("button", { name: "Unarchive", exact: true }).click();
    expect((await (await unarchived).json()).chat.archivedAt).toBeNull();
    for (const shown of [page, other]) {
      await expect(banner(shown)).toHaveCount(0);
      await expect(shell.composer(shown)).toBeVisible();
      await expect(shell.chatRow(shown, title)).toBeVisible();
      await expect(archivedChats(shown)).toHaveCount(0);
    }
    expect((await knex("conversations").where({ id: chatId }).first()).archived_at).toBeNull();

    // Archived again, from the other page this time, and unarchived from the archived row's own menu.
    await (await homeApi(other)).post(`/chats/${chatId}/archive`);
    await expect(banner(page)).toBeVisible();
    await archivedChats(page).getByRole("button", { name: `${title}, archived`, exact: true }).click({ button: "right" });
    await expect(shell.menuItems(page).filter({ hasText: /^Unarchive$/u })).toBeVisible();
    await expect(shell.menuItems(page).filter({ hasText: /^(Archive|Pin|Rename chat)$/u })).toHaveCount(0);
    const again = answered(page, "POST", `${path}/unarchive`);
    await shell.menuItems(page).filter({ hasText: /^Unarchive$/u }).click();
    expect((await again).ok()).toBe(true);
    await expect(shell.composer(page)).toBeVisible();
    await expect(shell.chatRow(page, title)).toBeVisible();
    await other.close();
  } finally {
    if (page.url() !== "about:blank") await page.goto("about:blank");
    if (chatId) await knex("conversations").where({ id: chatId }).del();
    await knex.destroy();
  }
});
