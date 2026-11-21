import type { Knex } from "knex";
import type { TestInfo } from "@playwright/test";
import { connectTestDb, expect, homeApi, openShell, seedChat, seedMessages, shell, test, type Page } from "./harness";

// People in chats (D-114, B3), on the Test Preview target, in a home of each test's own with a second person, Ben
// Rossi, and the owner's bot Chef. A person's own copy has one person who signs in (D-81), so what Ben writes is seeded
// as the server writes it, and what he sees is read from the server. @ in a chat with people offers them, a mention
// shows by name and waits for its person as the chat list's "@" until they read the chat; a file attached in a chat
// with others, or in New chat before it starts, goes in the chat's folder; the owner reacts to Ben's message as to a
// bot's, never to their own; and "Continue with others…" takes the owner's direct chat with Chef on into a new Public
// chat with Ben, starting from Chef's note (the stand-in model's), which the owner changes and sends, the direct chat
// left as it was. Screenshots light, dark and phone (390 by 844) are the output: the "@" in the list, a mention in a
// chat, a reaction on Ben's message, and Continue with others with its note. Each test deletes the home and the person
// it makes.
// Run with: vibe64-helper playwright --target test-app test tests/e2e/people-in-chats.spec.ts
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

type Home = Awaited<ReturnType<typeof homeWithBen>>;

/** A home of the test's own, made as New home makes it, with Ben Rossi a member and the owner's bot Chef. */
async function homeWithBen(page: Page, knex: Knex) {
  const stamp = Date.now().toString(36);
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const made = await page.request.post("/api/workspaces", {
    headers: { "csrf-token": csrfToken, "content-type": "application/vnd.api+json", accept: "application/vnd.api+json" },
    data: JSON.stringify({ data: { type: "workspaces", attributes: { name: `Hilltop ${stamp}` } } })
  });
  expect(made.ok(), await made.text()).toBe(true);
  const slug = String((await made.json()).data.attributes.slug);
  const home = await knex("workspaces").where({ slug }).first();
  const homeId = String(home.id);
  const owner = String(home.owner_user_id);
  const [ben] = await knex("users").insert({
    auth_provider: "test", auth_provider_user_sid: `ben-${stamp}`, email: `ben-${stamp}@example.test`, username: `ben${stamp}`, display_name: "Ben Rossi"
  }).returning("id");
  const benId = String(ben.id);
  await knex("workspace_memberships").insert({ workspace_id: homeId, user_id: benId, role_sid: "member", status: "active" });
  const chef = String((await knex("bots").insert({ made_by: owner, workspace_id: homeId, name: "Chef", color: "#E65100", library_template: "general" }).returning("id"))[0].id);
  const remove = async () => {
    // Away from the home first, so the page reads nothing of it while it goes; a test that timed out has no page left.
    if (!page.isClosed() && page.url() !== "about:blank") await page.goto("about:blank").catch(() => null);
    await knex("conversations").where({ workspace_id: homeId }).del();
    await knex("bots").where({ workspace_id: homeId }).del();
    for (const table of ["usage_events", "usage_daily", "usage_monthly", "workspace_settings", "workspace_memberships"]) {
      await knex(table).where({ workspace_id: homeId }).del();
    }
    await knex("workspaces").where({ id: homeId }).del();
    await knex("users").where({ id: benId }).del();
  };
  return { slug, path: `/w/${slug}`, homeId, name: String(home.name), owner, ben: benId, chef, stamp, remove };
}

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

test("a file attached in a chat with people, or in New chat before it starts, goes in the chat's folder", async ({ page }) => {
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

    // In New chat, the file waits until the chat is made, then goes in its folder with the first message.
    await shell.sidebar(page).getByRole("button", { name: "New chat or bots" }).click();
    await shell.menuItems(page).filter({ hasText: /^New chat$/u }).click();
    const newChat = page.getByRole("region", { name: "New chat" });
    await newChat.getByRole("textbox", { name: "Add people and bots" }).fill("Ben");
    await newChat.getByRole("listbox", { name: "People and bots" }).getByRole("option", { name: /Ben Rossi/u }).click();
    await newChat.getByLabel("Title (optional)").fill(`Shed ${home.stamp}`);
    await shell.chat(page).locator("input[type=file]").setInputFiles({ name: "shed.md", mimeType: "text/markdown", buffer: Buffer.from("# Shed\n") });
    await expect(shell.chat(page).locator(".mb-file-card__name")).toHaveText("shed.md");
    const started = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api${home!.path}/chats`);
    const later = page.waitForResponse((response) => response.request().method() === "POST" &&
      new URL(response.url()).pathname === `/api${home!.path}/files/upload` && new URL(response.url()).searchParams.get("chat") !== garden.id);
    const firstSent = answered(page, "POST", /\/chats\/\d+\/messages$/u);
    await shell.composer(page).fill("the shed's list");
    await shell.composer(page).press("Enter");
    const { chat } = await (await started).json();
    const upload = await later;
    expect(new URL(upload.url()).searchParams.get("chat"), "into the new chat, once it's made").toBe(String(chat.id));
    expect(await upload.json()).toMatchObject({ path: "/files/chat/Uploads/shed.md" });
    await expect(message(page, "the shed's list").locator(".mb-bubble__file-name")).toHaveText("shed.md");
    expect((await firstSent).ok()).toBe(true);
    const [first] = await knex("messages").where({ conversation_id: chat.id, role: "user" }).orderBy("id");
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

test("Continue with others takes a direct chat on into a new Public chat, starting from the bot's note", async ({ page }, testInfo) => {
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

    // A direct chat has no + Add: it goes on with others instead.
    await expect(shell.chat(page).getByRole("button", { name: "Add people or bots" })).toHaveCount(0);
    const noted = page.waitForResponse((response) => new URL(response.url()).pathname === `/api${home!.path}/chats/${direct.id}/hand-over-note`);
    await shell.chat(page).getByRole("button", { name: "Continue with others…" }).click();
    expect((await noted).status()).toBe(200);
    const newChat = page.getByRole("region", { name: "New chat" });
    await expect(newChat.getByRole("heading", { name: "Continue with others" })).toBeVisible();
    await expect(newChat.getByText("Your chat with Chef stays as it is.", { exact: false })).toBeVisible();
    const note = "Continuing from my chat with Chef: we were on \"Dinner for six on Saturday\". Can you all help from here?";
    await expect(shell.composer(page)).toHaveValue(note);
    await expect(newChat.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
    await expect(newChat.locator(".mb-new-chat__chip")).toHaveText([/Chef/u]);
    await expect(newChat.getByRole("radio", { name: /^Public/u })).toBeChecked();

    // Ben joins the To: line; the owner adds a line to the note and sends it as their own first message.
    await newChat.getByRole("textbox", { name: "Add people and bots" }).fill("Ben");
    await newChat.getByRole("listbox", { name: "People and bots" }).getByRole("option", { name: /Ben Rossi/u }).click();
    await expect(newChat.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
    await shots(page, testInfo, "continue-with-others", async () => {
      // As the note arrives on a phone: the composer measures its lines when its text changes, not when the window does.
      await shell.composer(page).press("End");
      await shell.composer(page).pressSequentially(" ");
      await shell.composer(page).press("Backspace");
    });
    await shell.composer(page).fill(`${note} Ben, can you bring wine?`);
    const started = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api${home!.path}/chats`);
    const noteSent = answered(page, "POST", /\/chats\/\d+\/messages$/u);
    await shell.composer(page).press("Enter");
    const { chat } = await (await started).json();
    expect(chat.kind).toBe("public");
    expect(chat.people.map((person: { userId: string }) => String(person.userId)).sort()).toEqual([home.owner, home.ben].sort());
    expect(chat.bots.map((bot: { botId: string }) => String(bot.botId))).toEqual([home.chef]);
    await expect(message(page, "Ben, can you bring wine?")).toBeVisible();
    expect((await noteSent).ok()).toBe(true);
    const [first] = await knex("messages").where({ conversation_id: chat.id, role: "user" }).orderBy("id");
    expect([String(first.author_user_id), first.body.text]).toEqual([home.owner, `${note} Ben, can you bring wine?`]);

    // The direct chat is as it was: the owner's with Chef alone.
    expect(await knex("chat_people").where({ conversation_id: direct.id }).pluck("user_id").then((ids) => ids.map(String))).toEqual([home.owner]);
    expect(await knex("messages").where({ conversation_id: direct.id }).count("* as count").first()).toEqual({ count: "2" });
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});
