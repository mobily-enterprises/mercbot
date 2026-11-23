import type { Knex } from "knex";
import type { TestInfo } from "@playwright/test";
import { composerFits, connectTestDb, expect, homeApi, homeWithBen, openShell, seedChat, seedMessages, shell, test, type Page } from "./harness";

// People in chats (D-114, B3), on the Test Preview target, in a home of each test's own with a second person, Ben
// Rossi, and the owner's bot Chef. A person's own copy has one person who signs in (D-81), so what Ben writes is seeded
// as the server writes it, and what he sees is read from the server. @ in a chat with people offers them, a mention
// shows by name and waits for its person as the chat list's "@" until they read the chat; a file attached in a room
// with others, or in a room just made with New room, goes in the room's folder; the owner reacts to Ben's message as to
// a bot's, never to their own; and "Continue with others…" takes the owner's direct chat with Chef on into a new Public
// room, Chef coming along, starting from Chef's note (the stand-in model's) in its composer, which the owner changes and
// sends, the direct chat left as it was; on a phone the composer is as tall as the note needs. Screenshots light, dark
// and phone (390 by 844) are the output: the "@" in the list, a mention in a chat, a reaction on Ben's message, and
// Continue with others with its note. Each test deletes the home and the person it makes.
// Run with: vibe64-helper playwright --target test-app test tests/e2e/people-in-chats.spec.ts
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

type Home = Awaited<ReturnType<typeof homeWithBen>>;

/** Light and dark, then light at a phone's width (390 by 844) once `atPhone` has shown the screen there. */
async function shots(page: Page, testInfo: TestInfo, name: string, atPhone?: () => Promise<unknown>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await expect(page.locator(".v-application")).toHaveClass(new RegExp(`\\bv-theme--(workspace-)?${scheme}\\b`, "u"));
    await page.screenshot({ path: testInfo.outputPath(`${name}-${scheme}.png`), animations: "disabled" });
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await expect(page.locator(".v-application")).toHaveClass(/\bv-theme--(workspace-)?light\b/u);
  const size = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await atPhone?.();
  await page.screenshot({ path: testInfo.outputPath(`${name}-phone.png`), animations: "disabled" });
  if (size) await page.setViewportSize(size);
}

/** The page's next `method` call to `path` (under the home's API), once the server has answered it. */
const answered = (page: Page, method: string, path: RegExp) =>
  page.waitForResponse((response) => response.request().method() === method && path.test(new URL(response.url()).pathname));
const message = (page: Page, text: string) => shell.chat(page).locator("[data-message-id]").filter({ hasText: text }).last();
const mentionedAt = async (knex: Knex, chatId: string, userId: string) =>
  (await knex("chat_people").where({ conversation_id: chatId, user_id: userId }).first("mentioned_at"))?.mentioned_at ?? null;

test("@ offers the chat's people; a mention shows by name and waits as the chat list's \"@\" until it's read", async ({ page }, testInfo) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWithBen(page, knex);
    const title = `Kitchen ${home.stamp}`;
    const kitchen = await seedChat(knex, { homeId: home.homeId, title, people: [home.owner, home.ben], bots: [home.chef] });
    const garden = await seedChat(knex, { homeId: home.homeId, title: `Garden ${home.stamp}`, people: [home.owner, home.ben] });
    await openShell(page, `?chat=${garden.id}`, home.path);

    // @ in Garden offers Ben (never the owner); picked, he's sent as his marker and kept on the message by name.
    await shell.composer(page).click();
    await shell.composer(page).pressSequentially("@Be");
    const menu = shell.chat(page).getByRole("listbox", { name: "Mention" });
    await expect(menu.getByRole("option")).toHaveText([/Ben Rossi\s*person/u]);
    await menu.getByRole("option", { name: /Ben Rossi/u }).click();
    await expect(shell.composer(page)).toHaveValue("@Ben Rossi ");
    const sent = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api${home!.path}/chats/${garden.id}/messages`);
    await shell.composer(page).pressSequentially("can you bring the tiles?");
    await shell.composer(page).press("Enter");
    const body = (await (await sent).request().postDataJSON()) as { text: string };
    expect(body.text).toBe(`<@person:${home.ben}> can you bring the tiles?`);
    await expect(message(page, "can you bring the tiles?").locator(".mb-bubble__mention--person")).toHaveText("@Ben Rossi");
    expect(await mentionedAt(knex, garden.id, home.ben), "it waits for Ben").not.toBeNull();
    expect(await mentionedAt(knex, garden.id, home.owner), "not for the owner who wrote it").toBeNull();

    // Ben mentions the owner in Kitchen, as the server writes it: the owner's list shows "@" on Kitchen.
    const api = await homeApi(page, home.path);
    const ownerName = String((await api.get(`/chats/${kitchen.id}`)).chat.people.find((person: { userId: string }) => String(person.userId) === home!.owner).name);
    await seedMessages(knex, { homeId: home.homeId, chatId: kitchen.id, rows: [{ userId: home.ben, body: {
      text: `<@person:${home.owner}> oak or walnut for the shelves?`, authorName: "Ben Rossi", mentionedPeople: [{ id: home.owner, name: ownerName }]
    } }] });
    await knex("chat_people").where({ conversation_id: kitchen.id, user_id: home.owner }).update({ unread: true, mentioned_at: knex.fn.now() });
    await openShell(page, `?chat=${garden.id}`, home.path);
    const row = shell.chatRow(page, title);
    await expect(row.getByLabel("Mentioned you")).toHaveText("@");
    expect((await api.get(`/chats/${kitchen.id}`)).chat.place.mentioned).toBe(true);
    await shots(page, testInfo, "mention-list", async () => {
      await shell.chat(page).getByRole("button", { name: "Your chats" }).click();
      await expect(shell.chatRow(page, title).getByLabel("Mentioned you")).toBeVisible();
    });

    // Opened, the mention is marked as the owner's, and reading it clears the "@".
    await openShell(page, `?chat=${kitchen.id}`, home.path);
    await expect(message(page, "oak or walnut").locator(".mb-bubble__mention--me")).toHaveText(`@${ownerName}`);
    await expect.poll(() => mentionedAt(knex, kitchen.id, home!.owner)).toBeNull();
    await expect(shell.chatRow(page, title).getByLabel("Mentioned you")).toHaveCount(0);
    await shots(page, testInfo, "mention-chat");
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});

test("a file attached in a room with people, or in a room just made, goes in the room's folder", async ({ page }) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWithBen(page, knex);
    const garden = await seedChat(knex, { homeId: home.homeId, title: `Garden ${home.stamp}`, people: [home.owner, home.ben] });
    await openShell(page, `?chat=${garden.id}`, home.path);
    const uploads = (chatId: string) => page.waitForResponse((response) => response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api${home!.path}/files/upload` && new URL(response.url()).searchParams.get("chat") === chatId);

    // In a chat of people alone: into its folder at once, and Ben's place there can open it.
    const kept = uploads(garden.id);
    await shell.chat(page).locator("input[type=file]").setInputFiles({ name: "beds.md", mimeType: "text/markdown", buffer: Buffer.from("# Beds\n- tomatoes\n") });
    expect(await (await kept).json()).toMatchObject({ path: "/files/chat/Uploads/beds.md" });
    await shell.composer(page).fill("the plan for the beds");
    await shell.composer(page).press("Enter");
    await expect(message(page, "the plan for the beds").locator(".mb-bubble__file-name")).toHaveText("beds.md");
    const api = await homeApi(page, home.path);
    expect((await api.get(`/files?chat=${garden.id}&folder=${encodeURIComponent("/files/chat/Uploads")}`)).entries.map((entry: { path: string }) => entry.path))
      .toEqual(["/files/chat/Uploads/beds.md"]);

    // A room made with New room (it needs a name): a file attached there goes in its own folder, with the message.
    await shell.section(page, "Rooms").getByRole("button", { name: "New room", exact: true }).click();
    const newRoom = page.getByRole("dialog", { name: "New room" });
    await newRoom.getByRole("textbox", { name: "Name" }).fill(`Shed ${home.stamp}`);
    const started = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api${home!.path}/chats`);
    await newRoom.getByRole("button", { name: "Create", exact: true }).click();
    const { chat } = await (await started).json();
    await expect(page).toHaveURL(new RegExp(`[?&]chat=${chat.id}\\b`, "u"));
    const later = uploads(String(chat.id));
    await shell.chat(page).locator("input[type=file]").setInputFiles({ name: "shed.md", mimeType: "text/markdown", buffer: Buffer.from("# Shed\n") });
    expect(await (await later).json()).toMatchObject({ path: "/files/chat/Uploads/shed.md" });
    const firstSent = answered(page, "POST", new RegExp(`/chats/${chat.id}/messages$`, "u"));
    await shell.composer(page).fill("the shed's list");
    await shell.composer(page).press("Enter");
    await expect(message(page, "the shed's list").locator(".mb-bubble__file-name")).toHaveText("shed.md");
    expect((await firstSent).ok()).toBe(true);
    const [first] = await knex("messages").where({ conversation_id: chat.id, role: "user", kind: "text" }).orderBy("id");
    expect(first.body.attachments.map((file: { path: string }) => file.path)).toEqual(["/files/chat/Uploads/shed.md"]);
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});

test("the owner reacts to Ben's message as to a bot's, and never to their own", async ({ page }, testInfo) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWithBen(page, knex);
    const garden = await seedChat(knex, { homeId: home.homeId, title: `Garden ${home.stamp}`, people: [home.owner, home.ben] });
    // Ben's message, and the owner's with Ben's reaction on it, as the server keeps one.
    await seedMessages(knex, { homeId: home.homeId, chatId: garden.id, rows: [
      { userId: home.ben, body: { text: "The tomatoes are in.", authorName: "Ben Rossi" } },
      { userId: home.owner, body: { text: "Lovely, thank you.", reactions: { [`user:${home.ben}`]: "❤️" } } }
    ] });
    await openShell(page, `?chat=${garden.id}`, home.path);
    const bens = message(page, "The tomatoes are in.");
    await bens.hover();
    await bens.getByRole("button", { name: "React" }).click();
    const reacted = answered(page, "PUT", /\/reaction$/u);
    await page.getByRole("button", { name: "React with 👍" }).click();
    await expect(bens.locator(".mb-reaction__one--mine")).toHaveText("👍");
    expect((await reacted).ok()).toBe(true);
    const [row] = await knex("messages").where({ conversation_id: garden.id, author_user_id: home.ben });
    expect(row.body.reactions).toEqual({ [`user:${home.owner}`]: "👍" });
    // On the owner's own message, Ben's reaction shows, not as theirs, and there's none for them to make.
    const mine = message(page, "Lovely, thank you.");
    await expect(mine.locator(".mb-reaction__one")).toHaveText(["❤️"]);
    await expect(mine.locator(".mb-reaction__one--mine")).toHaveCount(0);
    await mine.hover();
    await expect(mine.getByRole("button", { name: "React" })).toHaveCount(0);
    await mine.locator(".mb-bubble").click({ button: "right" });
    await expect(page.getByRole("button", { name: "React with 👍" }), "no reactions row on your own message").toHaveCount(0);
    await page.keyboard.press("Escape");
    await shots(page, testInfo, "reaction-person");
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});

test("Continue with others takes a direct chat on into a new Public room, the bot coming along, starting from its note", async ({ page }, testInfo) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWithBen(page, knex);
    const direct = await seedChat(knex, { homeId: home.homeId, direct: { userId: home.owner, botId: home.chef } });
    await seedMessages(knex, { homeId: home.homeId, chatId: direct.id, rows: [
      { userId: home.owner, body: { text: "Dinner for six on Saturday" } },
      { botId: home.chef, body: { text: "Risotto, then a lemon tart?", authorName: "Chef" } }
    ] });
    await openShell(page, `?chat=${direct.id}`, home.path);

    // A direct chat has no Invite: it goes on with others instead.
    await expect(shell.chat(page).getByRole("button", { name: /^Invite/u })).toHaveCount(0);
    const noted = page.waitForResponse((response) => new URL(response.url()).pathname === `/api${home!.path}/chats/${direct.id}/hand-over-note`);
    await shell.chat(page).getByRole("button", { name: "Continue with others…" }).click();
    expect((await noted).status()).toBe(200);
    // New room, Public, saying Chef comes along with its note; the room needs a name.
    const newRoom = page.getByRole("dialog", { name: "New room" });
    await expect(newRoom.getByRole("status")).toHaveText("Chef comes along, and its note for the others is ready to send.");
    await expect(newRoom.getByRole("radio", { name: /^Public/u })).toBeChecked();
    await newRoom.getByRole("textbox", { name: "Name" }).fill(`Dinner ${home.stamp}`);
    await shots(page, testInfo, "continue-with-others", () => expect(newRoom.getByRole("status")).toBeVisible());

    // Create: the room, with its maker and Chef, opens with the note in its composer, which the owner adds a line to
    // and sends as their own message after the start line.
    const started = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api${home!.path}/chats`);
    await newRoom.getByRole("button", { name: "Create", exact: true }).click();
    const { chat } = await (await started).json();
    expect([chat.kind, chat.title]).toEqual(["public", `Dinner ${home.stamp}`]);
    expect(chat.people.map((person: { userId: string }) => String(person.userId))).toEqual([home.owner]);
    expect(chat.bots.map((bot: { botId: string }) => String(bot.botId))).toEqual([home.chef]);
    await expect(page).toHaveURL(new RegExp(`[?&]chat=${chat.id}\\b`, "u"));
    const note = "Continuing from my chat with Chef: we were on \"Dinner for six on Saturday\". Can you all help from here?";
    await expect(shell.composer(page)).toHaveValue(note);
    await expect.poll(() => composerFits(page)).toBe(true);
    await shell.composer(page).fill(`${note} Ben, can you bring wine?`);
    const noteSent = answered(page, "POST", new RegExp(`/chats/${chat.id}/messages$`, "u"));
    await shell.composer(page).press("Enter");
    await expect(message(page, "Ben, can you bring wine?")).toBeVisible();
    expect((await noteSent).ok()).toBe(true);
    const said = await knex("messages").where({ conversation_id: chat.id, role: "user" }).orderBy("id");
    expect(said.map((row) => [String(row.author_user_id), row.kind, row.body.text]).slice(0, 2), "the start line, then the note")
      .toEqual([[home.owner, "event", expect.stringMatching(/ started this room\.$/u)], [home.owner, "text", `${note} Ben, can you bring wine?`]]);

    // The direct chat is as it was: the owner's with Chef alone.
    expect(await knex("chat_people").where({ conversation_id: direct.id }).pluck("user_id").then((ids) => ids.map(String))).toEqual([home.owner]);
    expect(await knex("messages").where({ conversation_id: direct.id }).count("* as count").first()).toEqual({ count: "2" });
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});

test("on a phone, the composer is as tall as Continue with others' note needs", async ({ page }, testInfo) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWithBen(page, knex);
    const direct = await seedChat(knex, { homeId: home.homeId, direct: { userId: home.owner, botId: home.chef } });
    await seedMessages(knex, { homeId: home.homeId, chatId: direct.id, rows: [
      { userId: home.owner, body: { text: "Dinner for six on Saturday" } },
      { botId: home.chef, body: { text: "Risotto, then a lemon tart?", authorName: "Chef" } }
    ] });
    await openShell(page, `?chat=${direct.id}`, home.path);
    await shell.chat(page).getByRole("button", { name: "Continue with others…" }).click();
    const newRoom = page.getByRole("dialog", { name: "New room" });
    await newRoom.getByRole("textbox", { name: "Name" }).fill(`Dinner ${home.stamp}`);
    await newRoom.getByRole("button", { name: "Create", exact: true }).click();
    await expect(shell.composer(page)).toHaveValue(/^Continuing from my chat with Chef:/u);
    // On a wide window the box is as tall as the note needs there.
    await expect.poll(() => composerFits(page)).toBe(true);
    const wide = await shell.composer(page).evaluate((field: HTMLTextAreaElement) => field.offsetHeight);

    // The window narrowed to a phone's: the box takes the lines the note needs there, more than on the wide window, no
    // more; widened again, it's as it was.
    const size = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => shell.composer(page).evaluate((field: HTMLTextAreaElement) => field.offsetHeight)).toBeGreaterThan(wide);
    await expect.poll(() => composerFits(page), "as tall as the note needs at a phone's width").toBe(true);
    if (size) await page.setViewportSize(size);
    await expect.poll(() => shell.composer(page).evaluate((field: HTMLTextAreaElement) => field.offsetHeight)).toBe(wide);

    // On the phone, the person makes the note longer: as tall as it needs, up to six lines, and in view.
    await page.setViewportSize({ width: 390, height: 844 });
    const longer = `${await shell.composer(page).inputValue()} Ben, can you bring the wine and the bread? Carla said she'd do a salad, ` +
      "and I'll ask Chef for a shopping list for the risotto and the tart once we know who's coming. Starts at eight.";
    await shell.composer(page).fill(longer);
    await expect.poll(() => composerFits(page), "as tall as the longer note needs").toBe(true);
    await expect(shell.composer(page)).toBeInViewport();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await expect(page.locator(".v-application")).toHaveClass(new RegExp(`\\bv-theme--(workspace-)?${scheme}\\b`, "u"));
      await page.screenshot({ path: testInfo.outputPath(`continue-tall-note-phone-${scheme}.png`), animations: "disabled" });
    }
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});
