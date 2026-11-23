import type { Knex } from "knex";
import type { TestInfo } from "@playwright/test";
import { connectTestDb, expect, expectRefusal, homeApi, openShell, seedChat, seedMessages, shell, sidebarEntry, test, type Page } from "./harness";

// Chats with people in them (D-112), on the Test Preview target, in a home of each test's own with a second person, Ben
// Rossi, and two bots, Chef and Shopper. A person's own copy has one person who signs in (D-81), so Ben is a member of the
// home who never opens a page here: what he may open is checked from the owner's side, as the person a chat of his
// isn't shared with, and through the server (the server's tests read it as him, chatMembers.integration.js and
// chatVisibility.integration.js). The home's everyone chat is the first tile for everyone in it, and no one leaves it; a
// public room of Ben's is listed faded in the owner's Rooms and opening it joins them, and a
// private one is a 404 and never listed; New room is Public unless Private is picked, needs a name, and a private room
// opens Invite at once; its header, composer and details say who can read it; Invite puts people and bots in a public
// room its people are in, and Invite a bot only bots, for someone reading it from outside;
// People and Bots list the home's other people and its bots, each opening the person's private chat with them, with
// their card in the details; leaving a public room leaves it faded, and deleting the last room leaves Rooms empty, with
// + New room. Screenshots light, dark and phone (390 by 844) are the output: the list with the everyone chat, New room,
// a private room of people and a bot with their messages under their names, its header and composer, Chat details'
// three tabs, People and Bots, a member's card and the empty list. Each test deletes the home and the person it makes.
// Run with: vibe64-helper playwright --target test-app test tests/e2e/chats-people.spec.ts
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

type Home = Awaited<ReturnType<typeof homeWithBen>>;

/**
 * A home of the test's own, made as New home makes it, with Ben Rossi a member and two bots of the owner's, Chef and
 * Shopper. `remove` deletes it with everything in it, and Ben.
 */
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
  const bot = async (name: string, color: string) =>
    String((await knex("bots").insert({ made_by: owner, workspace_id: homeId, name, color, library_template: "general" }).returning("id"))[0].id);
  const chef = await bot("Chef", "#E65100");
  const shopper = await bot("Shopper", "#1E86FC");
  const remove = async () => {
    if (page.url() !== "about:blank") await page.goto("about:blank");
    await knex("conversations").where({ workspace_id: homeId }).del();
    await knex("bots").where({ workspace_id: homeId }).del();
    for (const table of ["usage_events", "usage_daily", "usage_monthly", "workspace_settings", "workspace_memberships"]) {
      await knex(table).where({ workspace_id: homeId }).del();
    }
    await knex("workspaces").where({ id: homeId }).del();
    await knex("users").where({ id: benId }).del();
  };
  return { slug, path: `/w/${slug}`, homeId, name: String(home.name), owner, ben: benId, chef, shopper, stamp, remove };
}

/** The home's everyone chat (O9): public, named after the home, with everyone in it and Chef, as the welcome chat makes it. */
const everyoneChat = (knex: Knex, home: Home) =>
  seedChat(knex, { homeId: home.homeId, everyone: true, title: home.name, people: [home.owner, home.ben], bots: [home.chef] });

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

const kindLine = {
  public: (home: Home) => `Everyone in ${home.name} can open it, and its bots remember what's said here in their other chats.`,
  private: "Only its members can open it, and nothing in it reaches other chats."
};
const inviteButton = (page: Page) => shell.chat(page).getByRole("button", { name: /^Invite/u });
const chip = (page: Page, title: string) => shell.chat(page).getByRole("button", { name: `${title} details`, exact: true });
/** The names Chat details lists under People or Bots, the person looking first as "<name> (you)". */
const memberNames = (details: ReturnType<typeof shell.details>, group: "People" | "Bots") =>
  details.getByRole("region", { name: group }).locator(".mb-chat-details__member-name");

/** New room, from Rooms' +. */
async function openNewRoom(page: Page) {
  await shell.section(page, "Rooms").getByRole("button", { name: "New room", exact: true }).click();
  const newRoom = page.getByRole("dialog", { name: "New room" });
  await expect(newRoom.getByRole("heading", { name: "New room" })).toBeVisible();
  return newRoom;
}

/** Picks `names` in an open Invite dialog's field, then Add. */
async function invite(page: Page, dialog: ReturnType<Page["getByRole"]>, field: string, names: string[]) {
  for (const name of names) {
    await dialog.getByLabel(field).fill(name);
    await page.getByRole("option", { name: new RegExp(name, "u") }).click();
  }
  // The field's menu closes, so it covers nothing, then Add.
  await dialog.locator(".mb-invite__note").click();
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("the home's everyone chat is the first tile for everyone in it, and no one leaves it", async ({ page }, testInfo) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWithBen(page, knex);
    const everyone = await everyoneChat(knex, home);
    await seedChat(knex, { homeId: home.homeId, title: `Garden ${home.stamp}`, people: [home.owner], bots: [home.chef] });
    await openShell(page, "", home.path);

    // First among the pinned chats, and what opens with no chat named.
    const tiles = shell.sidebar(page).getByRole("region", { name: "Pinned chats" }).locator("button.mb-tile");
    await expect(tiles.first()).toHaveAccessibleName(home.name);
    await expect(tiles.first()).toHaveAttribute("aria-current", "page");
    await expect(chip(page, home.name)).toBeVisible();
    await expect(shell.chatRow(page, `Garden ${home.stamp}`)).toBeVisible();
    await shots(page, testInfo, "everyone-list", async () => {
      await shell.chat(page).getByRole("button", { name: "Your chats" }).click();
      await expect(tiles.first()).toBeVisible();
    });
    await openShell(page, "", home.path);

    // Its menu has no Leave, Unpin, Archive or Delete.
    await tiles.first().click({ button: "right" });
    await expect(shell.menuItems(page).first()).toBeVisible();
    for (const absent of ["Leave chat", "Unpin", "Archive", "Delete"]) await expect(shell.menuItems(page).filter({ hasText: new RegExp(`^${absent}$`, "u") })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Chat details: everyone in the home, none of them to take out, and no Leave.
    await chip(page, home.name).click();
    const details = shell.details(page, "Chat details");
    await expect(details.getByText(`Everyone in ${home.name} is in this chat, for as long as they're in the home.`)).toBeVisible();
    await expect(memberNames(details, "People")).toHaveText([/ \(you\)$/u, "Ben Rossi"]);
    await expect(details.getByRole("button", { name: "Take Ben Rossi out of this chat" })).toHaveCount(0);
    for (const absent of ["Leave chat", "Archive", "Delete chat"]) await expect(details.getByRole("button", { name: absent, exact: true })).toHaveCount(0);

    // The server agrees: no one leaves it but by leaving the home.
    const left = await (await homeApi(page, home.path)).answer("POST", `/chats/${everyone.id}/leave`);
    expect(left.status()).toBe(409);
    expect((await left.json()).code).toBe("bots_chat_everyone");
    expect(await knex("chat_people").where({ conversation_id: everyone.id }).pluck("user_id").then((ids) => ids.map(String).sort()))
      .toEqual([home.owner, home.ben].sort());
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});

test("a public room is anyone's in the home to open, faded until they open it, which joins them; a private one is only its members'", async ({ page }) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWithBen(page, knex);
    await everyoneChat(knex, home);
    const garden = await seedChat(knex, { homeId: home.homeId, title: `Garden ${home.stamp}`, people: [home.ben], bots: [home.chef] });
    const surprise = await seedChat(knex, { homeId: home.homeId, kind: "private", title: `Surprise ${home.stamp}`, people: [home.ben], bots: [home.chef] });
    const api = await homeApi(page, home.path);

    // The server: the owner opens Ben's public chat, and his private one isn't there for them.
    expect((await api.get(`/chats/${garden.id}`)).chat.place).toBeNull();
    expect((await api.answer("GET", `/chats/${surprise.id}`)).status()).toBe(404);
    const listed = (await api.get("/chats")).chats.map((chat: { id: string }) => chat.id);
    expect(listed).not.toContain(garden.id);
    expect(listed).not.toContain(surprise.id);
    const unjoined = await api.get("/chats/public");
    expect([unjoined.chats.map((chat: { id: string }) => chat.id), unjoined.next ?? null]).toEqual([[garden.id], null]);

    // In the owner's Rooms the public one is listed faded, saying opening it joins them; the private one isn't there.
    await openShell(page, "", home.path);
    const gardenRow = shell.chatRow(page, `Garden ${home.stamp}`);
    await expect(gardenRow).toHaveClass(/\bmb-row--faded\b/u);
    await expect(gardenRow).toHaveAttribute("title", /You're not in it yet: opening it joins you\.$/u);
    await expect(shell.chatRow(page, `Surprise ${home.stamp}, private`)).toHaveCount(0);
    await expect(shell.section(page, "Rooms").getByText(`Surprise ${home.stamp}`)).toHaveCount(0);

    // Opened, it joins them: no Join step, the row isn't faded, and they're among its people.
    const joined = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api${home!.path}/chats/${garden.id}/join`);
    await gardenRow.click();
    expect((await joined).ok()).toBe(true);
    await expect(page).toHaveURL(new RegExp(`[?&]chat=${garden.id}\\b`, "u"));
    await expect(chip(page, `Garden ${home.stamp}`)).toBeVisible();
    await expect(shell.chat(page).getByRole("button", { name: "Join", exact: true })).toHaveCount(0);
    await expect(gardenRow).not.toHaveClass(/\bmb-row--faded\b/u);
    expect(await knex("chat_people").where({ conversation_id: garden.id }).pluck("user_id").then((ids) => ids.map(String).sort()))
      .toEqual([home.owner, home.ben].sort());
    expect((await api.get("/chats/public")).chats).toEqual([]);

    // The private one, by its address: it isn't there for them, and the first chat opens instead.
    expectRefusal(`404 GET /api${home.path}/chats/${surprise.id}`);
    await page.goto(`${home.path}?chat=${surprise.id}`);
    await expect(page.getByText("That chat isn't there, or it's private.")).toBeVisible();
    await expect(page).not.toHaveURL(new RegExp(`[?&]chat=${surprise.id}\\b`, "u"));
    await expect(chip(page, `Surprise ${home.stamp}`)).toHaveCount(0);
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});

test("New room is Public unless Private is picked and needs a name; a private room opens Invite, and its header, composer and details say who can read it", async ({ page }, testInfo) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWithBen(page, knex);
    await everyoneChat(knex, home);
    await openShell(page, "", home.path);

    // New room: Public is chosen, each kind says what it means, and the kind is for good; no To: and no bots.
    const newRoom = await openNewRoom(page);
    const kinds = newRoom.getByRole("radiogroup", { name: "Who can open it" });
    await expect(kinds.getByRole("radio", { name: /^Public/u })).toBeChecked();
    await expect(kinds.getByRole("radio", { name: /^Private/u })).not.toBeChecked();
    await expect(kinds.getByText(kindLine.public(home))).toBeVisible();
    await expect(kinds.getByText(kindLine.private)).toBeVisible();
    await expect(newRoom.getByText("You can't change this once the room has started.")).toBeVisible();
    await expect(newRoom.getByRole("textbox", { name: "Add people and bots" })).toHaveCount(0);
    await shots(page, testInfo, "new-room");

    // A room needs a name: said under the field, and nothing is made; the server refuses one without a name too.
    const making = () => page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api${home!.path}/chats`);
    await newRoom.getByRole("button", { name: "Create", exact: true }).click();
    await expect(newRoom.getByRole("alert")).toHaveText("Give the room a name.");
    await expect(newRoom.getByRole("textbox", { name: "Name" })).toHaveAttribute("aria-invalid", "true");
    const unnamed = await (await homeApi(page, home.path)).answer("POST", "/chats", { kind: "public", title: "  ", people: [], bots: [] });
    expect([unnamed.status(), (await unnamed.json()).code]).toEqual([400, "bots_chat_needs_title"]);
    expect(await knex("conversations").where({ workspace_id: home.homeId }).count({ count: "*" }).first(), "only the everyone chat").toEqual({ count: "1" });

    // Private, called Kitchen reno: made with its maker alone and its start line, then Invite opens by itself.
    await kinds.locator("label").filter({ hasText: "Private" }).click();
    await expect(kinds.getByRole("radio", { name: /^Private/u })).toBeChecked();
    await newRoom.getByRole("textbox", { name: "Name" }).fill("Kitchen reno");
    const started = making();
    await newRoom.getByRole("button", { name: "Create", exact: true }).click();
    const { chat } = await (await started).json();
    expect([chat.kind, chat.title, chat.people.map((person: { userId: string }) => String(person.userId)), chat.bots])
      .toEqual(["private", "Kitchen reno", [home.owner], []]);
    const row = await knex("conversations").where({ id: chat.id }).first();
    expect([row.kind, row.title, String(row.made_by)]).toEqual(["private", "Kitchen reno", home.owner]);
    await expect(newRoom).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`[?&]chat=${chat.id}\\b`, "u"));
    // Unanchored: a regular expression is tried on the line's text as it stands, with the space before its (absent) link.
    await expect(shell.chat(page).getByText(/ started this room\./u)).toBeVisible();

    // Invite: the home's people and bots not in it yet; Ben and Chef.
    const inviting = page.getByRole("dialog", { name: "Invite", exact: true });
    await expect(inviting.getByRole("heading", { name: "Invite", exact: true })).toBeVisible();
    await expect(inviting.getByText("Whoever you invite to “Kitchen reno” sees everything said here, from its start.")).toBeVisible();
    await invite(page, inviting, "People and bots", ["Ben Rossi", "Chef"]);
    await expect.poll(async () => (await knex("chat_people").where({ conversation_id: chat.id }).pluck("user_id")).map(String).sort())
      .toEqual([home.owner, home.ben].sort());
    await expect.poll(async () => (await knex("chat_bots").where({ conversation_id: chat.id }).pluck("bot_id")).map(String)).toEqual([home.chef]);

    // Its header and composer: Private, and who exactly can read it; its row has the lock; Invite stays in its header.
    await expect(chip(page, "Kitchen reno")).toContainText("Private · You, Ben and Chef");
    await expect(shell.composer(page)).toHaveAttribute("placeholder", "Only you, Ben and Chef can read this");
    await expect(shell.chat(page).getByLabel(`Private: ${kindLine.private}`)).toBeVisible();
    await expect(shell.chatRow(page, "Kitchen reno, private")).toBeVisible();
    await expect(inviteButton(page)).toHaveAccessibleName("Invite");
    await expect(shell.chat(page).getByRole("note")).toHaveCount(0);

    // Said in it by Ben, the person and Chef: each other member's words under their name, the person's own unlabelled.
    await seedMessages(knex, { homeId: home.homeId, chatId: chat.id, rows: [
      { userId: home.ben, body: { text: "Shall we keep the old tiles?" } },
      { userId: home.owner, body: { text: "Only if they come off cleanly." } },
      { botId: home.chef, body: { text: "I can price new ones for you both by Friday." } }
    ] });
    await page.reload();
    await expect(shell.chat(page).getByText("I can price new ones for you both by Friday.")).toBeVisible();
    await expect(shell.chat(page).locator(".mb-speaker")).toHaveText(["Ben Rossi", "Chef"]);
    await shots(page, testInfo, "group-chat", async () => {
      await expect(shell.chat(page).getByRole("button", { name: "Kitchen reno details" })).toContainText("You, Ben and Chef · Private");
      await expect(shell.composer(page)).toHaveAttribute("placeholder", "Only its members can read this");
    });

    // Chat details: its name, Private and what that means, its people and bots, and Leave, Hide from sidebar and Delete.
    // A private chat isn't archived for everyone, so it has no Archive (plan 5.1): each person hides it for themselves.
    await chip(page, "Kitchen reno").click();
    const details = shell.details(page, "Chat details");
    await expect(details.getByRole("heading", { name: "Kitchen reno" })).toBeVisible();
    await expect(details.locator(".mb-chat-details__kind > span")).toHaveText("Private");
    await expect(details.getByText(kindLine.private)).toBeVisible();
    await expect(memberNames(details, "People")).toHaveText([/ \(you\)$/u, "Ben Rossi"]);
    await expect(details.getByRole("button", { name: "Take Ben Rossi out of this chat" })).toBeVisible();
    await expect(memberNames(details, "Bots")).toHaveText(["Chef"]);
    for (const action of ["Leave chat", "Hide from sidebar", "Delete chat"]) await expect(details.getByRole("button", { name: action, exact: true })).toBeVisible();
    await expect(details.getByRole("button", { name: "Archive", exact: true })).toHaveCount(0);
    const detailsAtPhone = async () => {
      if (!(await details.isVisible())) await shell.chat(page).getByRole("button", { name: "Chat details" }).click();
      await expect(details).toBeVisible();
    };
    await shots(page, testInfo, "chat-details-chat", detailsAtPhone);

    // Its other tabs: the file browser at the room's own folder, and Chef's computer in it.
    await details.getByRole("tab", { name: "Files", exact: true }).click();
    await expect(details.locator(".mb-files__crumb--here")).toHaveText("This room");
    await shots(page, testInfo, "chat-details-files", detailsAtPhone);
    await details.getByRole("tab", { name: "Computers", exact: true }).click();
    await expect(details.getByRole("region", { name: "Computers" }).getByRole("listitem", { name: "Chef's computer", exact: true })).toBeVisible();
    await expect(details.getByText("It belongs to this chat. Only the chat's members can watch it and use what's signed in on it.")).toBeVisible();
    await shots(page, testInfo, "chat-details-computers", detailsAtPhone);
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});

test("Invite puts the home's people and bots into a public room its people are in; Invite a bot, for someone reading it from outside, never a person", async ({ page }) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWithBen(page, knex);
    const plans = await seedChat(knex, { homeId: home.homeId, title: `Plans ${home.stamp}`, people: [home.owner], bots: [home.chef] });
    await openShell(page, `?chat=${plans.id}`, home.path);
    const title = `Plans ${home.stamp}`;

    // A public room says so once above its composer, and the composer says who reads it.
    const notice = shell.chat(page).getByRole("note");
    await expect(notice).toContainText(`This room is public. Everyone in ${home.name} can read this · Chef remembers it. Its bots remember what's said here in every chat they're in.`);
    await notice.getByRole("button", { name: "Got it" }).click();
    await expect(notice).toHaveCount(0);
    await expect(shell.composer(page)).toHaveAttribute("placeholder", `Everyone in ${home.name} can read this · Chef remembers it`);
    await expect(chip(page, title)).toContainText("Public · You and Chef");

    // Invite, for its people (8ccf7bd): everyone in the home can open the room already, and whoever is invited joins it,
    // so it offers the home's people and bots not in it: Ben, then Shopper.
    await expect(inviteButton(page)).toHaveAccessibleName("Invite");
    await inviteButton(page).click();
    const inviting = page.getByRole("dialog", { name: "Invite", exact: true });
    await expect(inviting.getByText(`Everyone in the home can open “${title}” already. Whoever you invite joins it, so it's in their list; a bot answers here.`)).toBeVisible();
    await inviting.getByLabel("People and bots").click();
    await expect(page.getByRole("option")).toHaveText([/Ben Rossi/u, /Shopper/u]);
    await invite(page, inviting, "People and bots", ["Shopper"]);
    await expect(chip(page, title)).toContainText("Public · You, Chef and Shopper");

    // Its maker leaves it, so they read it from outside: Invite a bot, which offers bots only, never a person, and every
    // bot is in it already.
    await shell.chat(page).getByRole("button", { name: "Leave room", exact: true }).click();
    await shell.question(page).getByRole("button", { name: "Leave", exact: true }).click();
    await expect(inviteButton(page)).toHaveAccessibleName("Invite a bot");
    await inviteButton(page).click();
    const fromOutside = page.getByRole("dialog", { name: "Invite a bot" });
    await expect(fromOutside.getByText(`Everyone in the home can open “${title}” already. A bot you invite answers here, and can be taken out again.`)).toBeVisible();
    await fromOutside.getByLabel("Bots").click();
    await expect(page.getByText("Every bot is in this room already.")).toBeVisible();
    await page.keyboard.press("Escape");
    if (await fromOutside.isVisible()) await fromOutside.getByRole("button", { name: "Cancel" }).click();
    await expect(fromOutside).toBeHidden();

    expect(await knex("chat_people").where({ conversation_id: plans.id }).pluck("user_id").then((ids) => ids.map(String))).toEqual([]);
    expect(await knex("chat_bots").where({ conversation_id: plans.id }).orderBy("position").pluck("bot_id").then((ids) => ids.map(String)))
      .toEqual([home.chef, home.shopper]);
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});

test("People and Bots list the home's other people and its bots; each opens the person's private chat with them, with their card", async ({ page }, testInfo) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWithBen(page, knex);
    const everyone = await everyoneChat(knex, home);
    await openShell(page, "", home.path);

    // People: Ben; Bots: Chef and Shopper, by name. The two haven't talked, and still each section shows every entry, with
    // none under "N more", as it has seven or fewer (4c94837). The person themselves isn't listed.
    const people = shell.section(page, "People");
    await expect(people.locator(".mb-row__name")).toHaveText(["Ben Rossi"]);
    const bots = shell.section(page, "Bots");
    await expect(bots.locator(".mb-row__name")).toHaveText(["Chef", "Shopper"]);
    for (const section of [people, bots]) await expect(section.getByRole("button", { name: /^\d+ more$/u })).toHaveCount(0);
    await expect(shell.section(page, "Bots").getByRole("button", { name: "Add bots", exact: true })).toBeVisible();
    await shots(page, testInfo, "people-and-bots", async () => {
      await shell.chat(page).getByRole("button", { name: "Your chats" }).click();
      await expect(shell.section(page, "Bots")).toBeVisible();
    });
    await openShell(page, "", home.path);

    // Chef's row: the person's direct chat with Chef, made the first time, Private, named after it, taking no one else.
    const direct = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api${home!.path}/bots/${home!.chef}/direct`);
    await (await sidebarEntry(page, "Bots", "Chef")).click();
    const { chat } = await (await direct).json();
    expect([chat.directBotId, chat.kind, chat.title]).toEqual([home.chef, "private", null]);
    await expect(page).toHaveURL(new RegExp(`[?&]chat=${chat.id}\\b`, "u"));
    await expect(chip(page, "Chef")).toContainText("Private · only you and Chef");
    await expect(shell.chatRow(page, "Chef")).toHaveAttribute("aria-current", "page");
    await expect(inviteButton(page), "a direct chat takes no one else").toHaveCount(0);

    // Its details are Chef's card: who made it, the chats you share, and its sections; no Message, as its chat is open.
    await chip(page, "Chef").click();
    const chefCard = shell.details(page, "Chef's card");
    await expect(chefCard.getByText("Bot · made by you")).toBeVisible();
    await expect(chefCard.getByRole("tablist", { name: "Chef's sections" }).getByRole("tab")).toHaveText(["Details", "Files", "Library", "Computer"]);
    await expect(chefCard.getByRole("button", { name: `${home.name}, Public` })).toBeVisible();
    await expect(chefCard.getByRole("button", { name: "Message Chef" })).toHaveCount(0);
    await shots(page, testInfo, "member-card", async () => {
      if (!(await shell.details(page, "Chef's card").isVisible())) await shell.chat(page).getByRole("button", { name: "Chef details" }).click();
      await expect(shell.details(page, "Chef's card")).toBeVisible();
    });

    // Ben's row (plan 4.2): the private chat of just the two of them, made the first time, with his card.
    const personDirect = `/api${home.path}/people/${home.ben}/direct`;
    const madeWithBen = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === personDirect);
    await (await sidebarEntry(page, "People", "Ben Rossi")).click();
    const { chat: withBen } = await (await madeWithBen).json();
    expect([withBen.kind, withBen.directBotId ?? null, String(withBen.directPerson?.userId), withBen.people.map((person: { userId: string }) => String(person.userId)).sort(), withBen.bots])
      .toEqual(["private", null, home.ben, [String(home.owner), String(home.ben)].sort(), []]);
    await expect(page).toHaveURL(new RegExp(`[?&]chat=${withBen.id}\\b`, "u"));
    await expect(chip(page, "Ben Rossi")).toContainText("Private · only you and Ben Rossi");
    await expect(inviteButton(page), "a chat between two people takes no one else").toHaveCount(0);
    await chip(page, "Ben Rossi").click();
    const benCard = shell.details(page, "Ben Rossi's card");
    await expect(benCard.getByRole("heading", { name: "Ben Rossi" })).toBeVisible();
    await expect(benCard.getByText("Member", { exact: true })).toBeVisible();
    await expect(benCard.getByRole("button", { name: `${home.name}, Public` })).toBeVisible();

    // His card beside another chat has Message, which opens the same chat again: none is made.
    let madeAgain = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === personDirect) madeAgain += 1;
    });
    await page.goto(`${home.path}?chat=${everyone.id}&member=person:${home.ben}`);
    await shell.details(page, "Ben Rossi's card").getByRole("button", { name: "Message Ben Rossi" }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]chat=${withBen.id}\\b`, "u"));
    await shell.chatRow(page, "Ben Rossi").click();
    await expect(shell.chatRow(page, "Ben Rossi")).toHaveAttribute("aria-current", "page");
    expect(await knex("conversations").where({ workspace_id: home.homeId, direct_person_id: home.ben }).orWhere({ workspace_id: home.homeId, direct_user_id: home.ben }).count({ count: "*" }).first(), "one chat of the two")
      .toEqual({ count: "1" });
    expect(madeAgain, "Message asks for the chat, which is there already; its row, once made, asks for nothing").toBe(1);
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});

test("leaving a public room leaves it faded, and writing there brings you back; deleting the last room leaves Rooms empty, with + New room", async ({ page }, testInfo) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWithBen(page, knex);
    const title = `Hello ${home.stamp}`;
    const hello = await seedChat(knex, { homeId: home.homeId, title, people: [home.owner, home.ben], madeBy: home.owner });
    await openShell(page, `?chat=${hello.id}`, home.path);
    const details = shell.details(page, "Chat details");
    const question = shell.question(page);
    const row = shell.chatRow(page, title);

    // Leave, asked first: a public room stays in Rooms, faded, and still open, with its composer.
    await chip(page, title).click();
    await details.getByRole("button", { name: "Leave chat", exact: true }).click();
    await expect(question.locator(".mb-confirm__title")).toHaveText(`Leave “${title}”?`);
    await expect(question.locator(".mb-confirm__text")).toHaveText("It's public, so it stays in Rooms, faded, and opening it again brings you back.");
    const left = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api${home!.path}/chats/${hello.id}/leave`);
    // Its row moves to the faded ones drawn once, never beside the row it was: the leave's answer and the chat read
    // again on its news are held until the faded rooms are read again, so the row moves in one change, and every
    // change to the page meanwhile counts the rows named after the room.
    const chatPath = `/api${home.path}/chats/${hello.id}`;
    const roomsRead = page.waitForResponse((response) => new URL(response.url()).pathname === `/api${home!.path}/chats/public`);
    const held = (url: URL) => url.pathname === chatPath || url.pathname === `${chatPath}/leave`;
    await page.route(held, async (route) => {
      const response = await route.fetch();
      await roomsRead;
      await route.fulfill({ response });
    });
    await page.evaluate((name) => {
      const rows = () => [...document.querySelectorAll(".mb-row")].filter((element) => element.getAttribute("aria-label") === name).length;
      const seen = window as unknown as { mbRowsSeen: number };
      seen.mbRowsSeen = rows();
      new MutationObserver(() => { seen.mbRowsSeen = Math.max(seen.mbRowsSeen, rows()); }).observe(document.body, { childList: true, subtree: true });
    }, title);
    await question.getByRole("button", { name: "Leave", exact: true }).click();
    expect((await left).ok()).toBe(true);
    expect(await knex("chat_people").where({ conversation_id: hello.id }).pluck("user_id").then((ids) => ids.map(String))).toEqual([home.ben]);
    await expect(shell.sidebar(page).locator(".mb-row--faded").filter({ hasText: title })).toHaveCount(1);
    await page.unroute(held);
    expect(await page.evaluate(() => (window as unknown as { mbRowsSeen: number }).mbRowsSeen), "the room's rows at any moment").toBe(1);
    await expect(row).toHaveClass(/\bmb-row--faded\b/u);
    await expect(shell.composer(page)).toBeVisible();
    await expect(shell.chat(page).getByRole("button", { name: "Join", exact: true })).toHaveCount(0);

    // Writing there brings them back, then Delete, asked first: the room goes for everyone in it.
    await shell.composer(page).fill("Back again.");
    await shell.composer(page).press("Enter");
    await expect(row).not.toHaveClass(/\bmb-row--faded\b/u);
    await expect.poll(async () => (await knex("chat_people").where({ conversation_id: hello.id }).pluck("user_id")).map(String).sort())
      .toEqual([home.owner, home.ben].sort());
    if (!(await details.isVisible())) await chip(page, title).click();
    await details.getByRole("button", { name: "Delete chat", exact: true }).click();
    await expect(question.locator(".mb-confirm__title")).toHaveText(`Delete “${title}”?`);
    await expect(question.locator(".mb-confirm__text")).toHaveText("This chat goes for everyone in it, with its whole history, its files and its bots' computers. Its bots stay in the home. This can't be undone.");
    const deleted = page.waitForResponse((response) => response.request().method() === "DELETE" && new URL(response.url()).pathname === `/api${home!.path}/chats/${hello.id}`);
    await question.getByRole("button", { name: "Delete", exact: true }).click();
    expect((await deleted).ok()).toBe(true);
    expect(await knex("conversations").where({ id: hello.id }).first()).toBeUndefined();

    // Rooms is empty, with + New room at its foot, and the chat panel says where to start (D4). No reload: a person with
    // no chats at all is given their welcome chat when the page next opens (index.vue).
    await expect(row).toHaveCount(0);
    const rooms = shell.section(page, "Rooms");
    await expect(rooms.getByRole("button", { name: "+ New room", exact: true })).toBeVisible();
    const start = shell.chat(page).locator(".mb-chat__start");
    await expect(start.getByRole("heading", { name: "No chats yet" })).toBeVisible();
    await expect(start).toContainText(`Start a room in ${home.name}, or open a person or a bot in the sidebar to talk with them.`);
    for (const action of ["New room", "Add bots"]) await expect(start.getByRole("button", { name: action, exact: true })).toBeVisible();
    // At a phone's width the sidebar is a closed drawer, so the chat panel's start is what shows.
    await shots(page, testInfo, "empty-list", async () => {
      await expect(start.getByRole("heading", { name: "No chats yet" })).toBeVisible();
    });

    // + New room: New room, Public to begin with.
    await rooms.getByRole("button", { name: "+ New room", exact: true }).click();
    const newRoom = page.getByRole("dialog", { name: "New room" });
    await expect(newRoom.getByRole("radio", { name: /^Public/u })).toBeChecked();
    await expect(newRoom.getByRole("textbox", { name: "Name" })).toHaveValue("");
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});
