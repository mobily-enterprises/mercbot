import type { TestInfo } from "@playwright/test";
import { connectTestDb, expect, HOME, homeApi, openShell, seedChat, shell, test, type Page } from "./harness";

// A chat's computers (D14, D16), on the Test Preview target, with a public chat of the test's own in the fixture home
// with Otto and Vera in it. Each bot in a chat has its own computer, the chat's: Chat details → Computers lists
// "Otto's computer" and "Vera's computer", each saying it belongs to this chat and who can watch it and use what's
// signed in on it, its state, and what's signed in on it (Gmail and a coding tool on Otto's, as its saved browser
// lists them; nothing yet on Vera's). Take over gives the person control: the live view says so, the server keeps it
// and the chat has a line for it; Hand back gives it back, with its own line. Screenshots light, dark and phone of the
// Computers tab are the output. The test deletes the chat it makes, and the computers with it.
// Run with: vibe64-helper playwright --target test-app test tests/e2e/chat-computers.spec.ts
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

/** Light and dark, then light at a phone's width (390 by 844) once `atPhone` has shown the screen there. */
async function shots(page: Page, testInfo: TestInfo, name: string, atPhone?: () => Promise<unknown>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await expect(page.locator(".v-application")).toHaveClass(new RegExp(`\\bv-theme--${scheme}\\b`, "u"));
    await page.screenshot({ path: testInfo.outputPath(`${name}-${scheme}.png`), animations: "disabled" });
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  const size = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await atPhone?.();
  await page.screenshot({ path: testInfo.outputPath(`${name}-phone.png`), animations: "disabled" });
  if (size) await page.setViewportSize(size);
}

test("Chat details → Computers lists each bot's computer in the chat, and Take over then Hand back moves its control", async ({ page }, testInfo) => {
  const knex = connectTestDb();
  let chatId = "";
  try {
    const home = await knex("workspaces").where({ slug: HOME.split("/").pop() }).first();
    const homeId = String(home.id);
    const me = String(home.owner_user_id);
    const botId = async (name: string) => String((await knex("bots").where({ workspace_id: homeId, name }).first()).id);
    const [otto, vera] = [await botId("Otto"), await botId("Vera")];
    const title = `Errands ${Date.now().toString(36)}`;
    const made = await seedChat(knex, { homeId, title, people: [me], bots: [otto, vera], madeBy: me });
    chatId = made.id;
    const ottoSeat = String(made.chatBotIds.get(otto));
    // What Otto's saved browser in this chat lists as signed in: a website and a coding tool (C's sign_ins).
    const since = new Date().toISOString();
    await knex("bot_browser_state").insert({
      chat_bot_id: ottoSeat,
      workspace_id: homeId,
      sign_ins: JSON.stringify([{ label: "Gmail", kind: "site", since }, { label: "Claude Code", kind: "coding", since }])
    });

    await openShell(page, `?chat=${chatId}`);
    await shell.chat(page).getByRole("button", { name: `${title} details`, exact: true }).click();
    const details = shell.details(page, "Chat details");
    await details.getByRole("tab", { name: "Computers", exact: true }).click();
    const computers = details.getByRole("region", { name: "Computers" });

    // One computer for each bot in the chat, in the chat's order, each the chat's.
    const line = `It belongs to this chat. The chat is public, so everyone in ${home.name} can watch it and use what's signed in on it.`;
    await expect(computers.locator("li.mb-chat-computer")).toHaveCount(2);
    const ottos = computers.getByRole("listitem", { name: "Otto's computer", exact: true });
    const veras = computers.getByRole("listitem", { name: "Vera's computer", exact: true });
    for (const [computer, bot] of [[ottos, "Otto"], [veras, "Vera"]] as const) {
      await expect(computer.locator(".mb-chat-computer__name")).toHaveText(`${bot}'s computer`);
      await expect(computer.locator(".mb-chat-computer__line")).toHaveText(line);
      await expect(computer.locator(".mb-chat-computer__state")).toHaveText("Asleep");
      await expect(computer.getByText("Signed in on it", { exact: true })).toBeVisible();
      await expect(computer.getByRole("button", { name: "Watch", exact: true })).toBeEnabled();
      await expect(computer.getByRole("button", { name: "Take over", exact: true })).toBeEnabled();
    }
    await expect(ottos.locator(".mb-chat-computer__signins li")).toHaveText(["Gmail", "Claude Code (coding)"]);
    await expect(veras.locator(".mb-chat-computer__none")).toHaveText("Nothing yet.");
    await shots(page, testInfo, "chat-computers", async () => {
      if (!(await computers.isVisible())) await shell.chat(page).getByRole("button", { name: "Chat details" }).click();
      await expect(computers.locator("li.mb-chat-computer")).toHaveCount(2);
    });

    // Take over Otto's: the live view says the person has control, and the server keeps it.
    const tookOver = page.waitForResponse((response) => response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api${HOME}/bots/${otto}/computer/take-over`);
    await ottos.getByRole("button", { name: "Take over", exact: true }).click();
    const taken = await tookOver;
    expect(new URL(taken.url()).searchParams.get("chat")).toBe(chatId);
    const { control } = await taken.json();
    expect(String(control.userId)).toBe(me);
    const live = page.getByRole("dialog", { name: "Otto's computer" });
    await expect(live.getByText("You have control. Otto waits until you hand it back.")).toBeVisible();
    const held = await knex("bot_computers").where({ chat_bot_id: ottoSeat }).first();
    expect(String(held.controlled_by)).toBe(me);

    // Hand back, from the live view: the bot has it again, and Take over is offered again.
    const handedBack = page.waitForResponse((response) => response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api${HOME}/bots/${otto}/computer/hand-back`);
    await live.getByRole("button", { name: "Hand back", exact: true }).click();
    expect((await (await handedBack).json()).control).toBeNull();
    expect((await knex("bot_computers").where({ chat_bot_id: ottoSeat }).first()).controlled_by).toBeNull();
    await expect(live.getByText("You have control. Otto waits until you hand it back.")).toHaveCount(0);
    if (await live.isVisible()) await live.getByRole("button", { name: "Close the live view" }).click();
    await expect(ottos.getByRole("button", { name: "Take over", exact: true })).toBeEnabled();
    await expect(ottos.getByRole("button", { name: "Hand back", exact: true })).toHaveCount(0);

    // The chat has a line for each, as Mercbot's own.
    const lines = await knex("messages").where({ conversation_id: chatId, kind: "event" }).orderBy("id").select("role", "body");
    expect(lines.map((row) => [row.role, String(row.body.text)])).toEqual([
      ["system", expect.stringMatching(/^.+ took over Otto's computer\.$/u)],
      ["system", expect.stringMatching(/^.+ handed Otto's computer back\.$/u)]
    ]);
  } finally {
    if (page.url() !== "about:blank") await page.goto("about:blank");
    // Through the server first, so the computers it woke go to sleep with the chat (C); the rows go either way.
    if (chatId) {
      await (await homeApi(page)).answer("DELETE", `/chats/${chatId}`).catch(() => null);
      await knex("conversations").where({ id: chatId }).del();
    }
    await knex.destroy();
  }
});
