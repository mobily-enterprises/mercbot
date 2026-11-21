import type { Knex } from "knex";
import type { TestInfo } from "@playwright/test";
import { connectTestDb, expect, expectRefusal, homeApi, openShell, seedChat, seedMessages, shell, test, type Page } from "./harness";

// Chats with people in them (D-112), on the Test Preview target, in a home of each test's own with a second person, Ben
// Rossi, and two bots, Chef and Shopper. A person's own copy has one person who signs in (D-81), so Ben is a member of the
// home who never opens a page here: what he may open is checked from the owner's side, as the person a chat of his
// isn't shared with, and through the server (the server's tests read it as him, chatMembers.integration.js and
// chatVisibility.integration.js). The home's everyone chat is the first tile for everyone in it, and no one leaves it; a
// public chat of Ben's opens for the owner to read and join, and a private one is a 404 and never listed; New chat is
// Public unless Private is picked, and the chat's header, composer and details say who can read it; + Add puts a person
// and a bot in a chat; Team lists people and bots alike, each with a card and [Message]; leaving a public chat keeps it
// readable, and deleting the last chat leaves the list empty, with Start a chat. Screenshots light, dark and phone (390
// by 844) are the output: the list with the everyone chat, New chat, a private chat of people and a bot with their
// messages under their names, its header and composer, Chat details' three tabs, Team, a member's card and the empty
// list. Each test deletes the home and the person it makes.
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
  public: (home: Home) => `Everyone in ${home.name} can open it, and its bots can use what's said here in other chats.`,
  private: "Only its members can open it, and nothing in it reaches other chats."
};
const addMenu = (page: Page) => shell.chat(page).getByRole("button", { name: "Add people or bots" });
const chip = (page: Page, title: string) => shell.chat(page).getByRole("button", { name: `${title} details`, exact: true });
/** The names Chat details lists under People or Bots, the person looking first as "<name> (you)". */
const memberNames = (details: ReturnType<typeof shell.details>, group: "People" | "Bots") =>
  details.getByRole("region", { name: group }).locator(".mb-chat-details__member-name");

/** New chat, from the sidebar's (+). */
async function openNewChat(page: Page) {
  await shell.sidebar(page).getByRole("button", { name: "New chat or bots" }).click();
  await shell.menuItems(page).filter({ hasText: /^New chat$/u }).click();
  const newChat = page.getByRole("region", { name: "New chat" });
  await expect(newChat).toBeVisible();
  return newChat;
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

test("a public chat is anyone's in the home to read and join; a private one is only its members'", async ({ page }) => {
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
    expect((await api.get("/chats/public")).chats.map((chat: { id: string }) => chat.id)).toEqual([garden.id]);

    // Neither is in the owner's list; New chat offers the public one to join, never the private one.
    await openShell(page, "", home.path);
    await expect(shell.chatRow(page, `Garden ${home.stamp}`)).toHaveCount(0);
    await expect(shell.chatRow(page, `Surprise ${home.stamp}, private`)).toHaveCount(0);
    const newChat = await openNewChat(page);
    await expect(newChat.getByRole("button", { name: `Join Garden ${home.stamp}` })).toBeVisible();
    await expect(newChat.getByText(`Surprise ${home.stamp}`)).toHaveCount(0);
    await newChat.getByRole("button", { name: "Close New chat" }).click();

    // Opened by its address, the public chat reads, with Join where the composer would be.
    await page.goto(`${home.path}?chat=${garden.id}`);
    await expect(chip(page, `Garden ${home.stamp}`)).toBeVisible();
    const banner = shell.chat(page).getByRole("status").filter({ hasText: "You're reading a public chat you're not in. Join it to write here." });
    await expect(banner).toBeVisible();
    await expect(shell.composer(page)).toHaveCount(0);
    await banner.getByRole("button", { name: "Join" }).click();
    await expect(shell.composer(page)).toBeVisible();
    await expect(shell.chatRow(page, `Garden ${home.stamp}`)).toBeVisible();
    expect(await knex("chat_people").where({ conversation_id: garden.id }).pluck("user_id").then((ids) => ids.map(String).sort()))
      .toEqual([home.owner, home.ben].sort());

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

test("New chat is Public unless Private is picked; a private chat's header, composer and details say who can read it", async ({ page }, testInfo) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWithBen(page, knex);
    await everyoneChat(knex, home);
    await openShell(page, "", home.path);

    // New chat: Public is chosen, each kind says what it means, and the kind is for good.
    const newChat = await openNewChat(page);
    const kinds = newChat.getByRole("radiogroup", { name: "Who can open it" });
    await expect(kinds.getByRole("radio", { name: /^Public/u })).toBeChecked();
    await expect(kinds.getByRole("radio", { name: /^Private/u })).not.toBeChecked();
    await expect(kinds.getByText(kindLine.public(home))).toBeVisible();
    await expect(kinds.getByText(kindLine.private)).toBeVisible();
    await expect(newChat.getByText("You can't change this once the chat has started.")).toBeVisible();
    await expect(newChat.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
    await shots(page, testInfo, "new-chat");

    // Private, with Ben and Chef, called Kitchen reno.
    await kinds.locator("label").filter({ hasText: "Private" }).click();
    await expect(kinds.getByRole("radio", { name: /^Private/u })).toBeChecked();
    const to = newChat.getByRole("textbox", { name: "Add people and bots" });
    await to.fill("Ben");
    await newChat.getByRole("listbox", { name: "People and bots" }).getByRole("option", { name: /Ben Rossi/u }).click();
    await to.fill("Chef");
    await newChat.getByRole("listbox", { name: "People and bots" }).getByRole("option", { name: /Chef/u }).click();
    await newChat.getByLabel("Title (optional)").fill("Kitchen reno");
    const started = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api${home!.path}/chats`);
    await newChat.getByRole("button", { name: "Start", exact: true }).click();
    const { chat } = await (await started).json();
    expect([chat.kind, chat.title]).toEqual(["private", "Kitchen reno"]);
    expect(chat.people.map((person: { userId: string }) => String(person.userId)).sort()).toEqual([home.owner, home.ben].sort());
    expect(chat.bots.map((bot: { botId: string }) => String(bot.botId))).toEqual([home.chef]);
    const row = await knex("conversations").where({ id: chat.id }).first();
    expect([row.kind, row.title, String(row.made_by)]).toEqual(["private", "Kitchen reno", home.owner]);

    // Its header and composer: Private, and who exactly can read it; its row has the lock.
    await expect(page).toHaveURL(new RegExp(`[?&]chat=${chat.id}\\b`, "u"));
    await expect(chip(page, "Kitchen reno")).toContainText("Private · You, Ben and Chef");
    await expect(shell.composer(page)).toHaveAttribute("placeholder", "Only you, Ben and Chef can read this");
    await expect(shell.chat(page).getByLabel(`Private: ${kindLine.private}`)).toBeVisible();
    await expect(shell.chatRow(page, "Kitchen reno, private")).toBeVisible();
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

    // Its other tabs: the chat's own folder, and Chef's computer in it.
    await details.getByRole("tab", { name: "Files", exact: true }).click();
    await expect(details.getByText("This chat", { exact: true }).first()).toBeVisible();
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

test("+ Add puts a person and a bot of the home into a public chat", async ({ page }) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWithBen(page, knex);
    const plans = await seedChat(knex, { homeId: home.homeId, title: `Plans ${home.stamp}`, people: [home.owner], bots: [home.chef] });
    await openShell(page, `?chat=${plans.id}`, home.path);
    const title = `Plans ${home.stamp}`;

    // A public chat says so once above its composer, and the composer says who reads it.
    const notice = shell.chat(page).getByRole("note");
    await expect(notice).toContainText(`This chat is public. Everyone in ${home.name} can read it, and its bots can use what's said here in other chats.`);
    await notice.getByRole("button", { name: "Got it" }).click();
    await expect(notice).toHaveCount(0);
    await expect(shell.composer(page)).toHaveAttribute("placeholder", `Everyone in ${home.name} can read this, and bots can use it in other chats`);
    await expect(chip(page, title)).toContainText("Public · You and Chef");

    // + Add offers the home's people and bots not in it yet: Ben, then Shopper.
    await addMenu(page).click();
    await expect(shell.menuItems(page)).toHaveText(["Ben Rossi", "Shopper"]);
    await shell.menuItems(page).filter({ hasText: "Ben Rossi" }).click();
    await expect(chip(page, title)).toContainText("Public · You, Ben and Chef");
    await addMenu(page).click();
    await expect(shell.menuItems(page)).toHaveText(["Shopper"]);
    await shell.menuItems(page).filter({ hasText: "Shopper" }).click();
    await expect(chip(page, title)).toContainText("Public · You, Ben, Chef and Shopper");
    await addMenu(page).click();
    await expect(shell.menuItems(page)).toHaveText(["Everyone's in this chat already"]);
    await page.keyboard.press("Escape");

    expect(await knex("chat_people").where({ conversation_id: plans.id }).pluck("user_id").then((ids) => ids.map(String).sort()))
      .toEqual([home.owner, home.ben].sort());
    expect(await knex("chat_bots").where({ conversation_id: plans.id }).orderBy("position").pluck("bot_id").then((ids) => ids.map(String)))
      .toEqual([home.chef, home.shopper]);
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});

test("Team lists the home's people and bots alike, each with a card; a bot's Message opens its direct chat", async ({ page }, testInfo) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWithBen(page, knex);
    await everyoneChat(knex, home);
    await openShell(page, "", home.path);
    await shell.sidebar(page).getByRole("button", { name: "Team", exact: true }).click();
    await expect(page).toHaveURL(/[?&]team=1\b/u);

    // People first, then bots, each with Message but the person themselves.
    const team = shell.team(page);
    await expect(team.getByRole("heading", { name: `Team · ${home.name}` })).toBeVisible();
    const members = team.getByRole("list", { name: "Members" });
    await expect(members.locator("[data-member]")).toHaveCount(4);
    await expect(members.locator("[data-member]").first()).toHaveAttribute("data-member", "person");
    await expect(members.getByRole("button", { name: /\(you\), Owner$/u })).toBeVisible();
    await expect(members.getByRole("button", { name: "Ben Rossi, Member" })).toBeVisible();
    await expect(members.getByRole("button", { name: "Chef, Bot · made by you" })).toBeVisible();
    await expect(members.getByRole("button", { name: "Shopper, Bot · made by you" })).toBeVisible();
    for (const name of ["Ben Rossi", "Chef", "Shopper"]) await expect(members.getByRole("button", { name: `Message ${name}` })).toBeVisible();
    await expect(members.getByRole("button", { name: /^Message .+ \(you\)/u })).toHaveCount(0);
    await shots(page, testInfo, "team");

    // A person's card: their role, Message, and the chats you share.
    await members.getByRole("button", { name: "Ben Rossi, Member" }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]member=person(%3A|:)${home.ben}\\b`, "u"));
    const benCard = shell.details(page, "Ben Rossi's card");
    await expect(benCard.getByRole("heading", { name: "Ben Rossi" })).toBeVisible();
    await expect(benCard.getByText("Member", { exact: true })).toBeVisible();
    await expect(benCard.getByRole("button", { name: "Message Ben Rossi" })).toBeVisible();
    await expect(benCard.getByRole("button", { name: `${home.name}, Public` })).toBeVisible();

    // A bot's card: who made it, Message, the chats you share, and its sections.
    await members.getByRole("button", { name: "Chef, Bot · made by you" }).click();
    const chefCard = shell.details(page, "Chef's card");
    await expect(chefCard.getByText("Bot · made by you")).toBeVisible();
    await expect(chefCard.getByRole("tablist", { name: "Chef's sections" }).getByRole("tab")).toHaveText(["Details", "Files", "Library", "Computer"]);
    await expect(chefCard.getByRole("button", { name: `${home.name}, Public` })).toBeVisible();
    // At a phone's width the card isn't docked beside Team: it slides over it when a member is tapped.
    await shots(page, testInfo, "member-card", async () => {
      await members.getByRole("button", { name: "Chef, Bot · made by you" }).click();
      await expect(shell.details(page, "Chef's card")).toBeVisible();
    });

    // Chef's Message: the person's direct chat with Chef, made the first time, named after it.
    const direct = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api${home!.path}/bots/${home!.chef}/direct`);
    await page.goto(`${home.path}?team=1`);
    await shell.team(page).getByRole("button", { name: "Message Chef" }).click();
    const { chat } = await (await direct).json();
    expect([chat.directBotId, chat.kind, chat.title]).toEqual([home.chef, "public", null]);
    await expect(page).toHaveURL(new RegExp(`[?&]chat=${chat.id}\\b`, "u"));
    await expect(chip(page, "Chef")).toContainText("Public");
    await expect(shell.chatRow(page, "Chef")).toBeVisible();
    await expect(shell.chat(page).getByRole("button", { name: "Add people or bots" }), "a direct chat takes no one else").toHaveCount(0);

    // Ben's Message (plan 4.2): the private chat of just the two of them, made the first time, opened again after.
    const making = (request: { method: () => string, url: () => string }) => request.method() === "POST" && new URL(request.url()).pathname === `/api${home!.path}/chats`;
    const made = page.waitForResponse((response) => making(response.request()));
    await page.goto(`${home.path}?team=1`);
    await shell.team(page).getByRole("button", { name: "Message Ben Rossi" }).click();
    const { chat: withBen } = await (await made).json();
    expect([withBen.kind, withBen.directBotId ?? null, withBen.people.map((person: { userId: string }) => String(person.userId)).sort(), withBen.bots])
      .toEqual(["private", null, [String(home.owner), String(home.ben)].sort(), []]);
    await expect(page).toHaveURL(new RegExp(`[?&]chat=${withBen.id}\\b`, "u"));
    await expect(chip(page, "Ben")).toContainText("Private");
    let madeAgain = 0;
    page.on("request", (request) => {
      if (making(request)) madeAgain += 1;
    });
    await page.goto(`${home.path}?team=1`);
    await shell.team(page).getByRole("button", { name: "Message Ben Rossi" }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]chat=${withBen.id}\\b`, "u"));
    expect(madeAgain, "the same chat, none made").toBe(0);
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});

test("leaving a public chat keeps it readable; deleting the last chat leaves the list empty, with Start a chat", async ({ page }, testInfo) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWithBen(page, knex);
    const title = `Hello ${home.stamp}`;
    const hello = await seedChat(knex, { homeId: home.homeId, title, people: [home.owner, home.ben], bots: [home.chef], madeBy: home.owner });
    await openShell(page, `?chat=${hello.id}`, home.path);
    const details = shell.details(page, "Chat details");
    const question = shell.question(page);

    // Leave, asked first: a public chat stays open to them, read-only with Join, and off their list.
    await chip(page, title).click();
    await details.getByRole("button", { name: "Leave chat", exact: true }).click();
    await expect(question.locator(".mb-confirm__title")).toHaveText(`Leave “${title}”?`);
    await expect(question.locator(".mb-confirm__text")).toHaveText("It's public, so you can still open it from New chat and join it again.");
    const left = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api${home!.path}/chats/${hello.id}/leave`);
    await question.getByRole("button", { name: "Leave", exact: true }).click();
    expect((await left).ok()).toBe(true);
    expect(await knex("chat_people").where({ conversation_id: hello.id }).pluck("user_id").then((ids) => ids.map(String))).toEqual([home.ben]);
    await expect(shell.chatRow(page, title)).toHaveCount(0);
    await expect(shell.sidebar(page).getByText("No chats yet.")).toBeVisible();
    const visiting = shell.chat(page).getByRole("status").filter({ hasText: "You're reading a public chat you're not in. Join it to write here." });
    await expect(visiting).toBeVisible();
    await expect(shell.composer(page)).toHaveCount(0);

    // Join again, then Delete, asked first: the chat goes for everyone in it, and nothing is left open.
    await visiting.getByRole("button", { name: "Join", exact: true }).click();
    await expect(shell.chatRow(page, title)).toBeVisible();
    if (!(await details.isVisible())) await chip(page, title).click();
    await details.getByRole("button", { name: "Delete chat", exact: true }).click();
    await expect(question.locator(".mb-confirm__title")).toHaveText(`Delete “${title}”?`);
    const deleted = page.waitForResponse((response) => response.request().method() === "DELETE" && new URL(response.url()).pathname === `/api${home!.path}/chats/${hello.id}`);
    await question.getByRole("button", { name: "Delete", exact: true }).click();
    expect((await deleted).ok()).toBe(true);
    expect(await knex("conversations").where({ id: hello.id }).first()).toBeUndefined();

    // The list is empty, saying where to start, and so is the chat panel (D4). No reload: a person with no chats at all
    // is given their welcome chat when the page next opens (index.vue).
    await expect(shell.chatRow(page, title)).toHaveCount(0);
    await expect(shell.sidebar(page).getByText("No chats yet.")).toBeVisible();
    await expect(shell.sidebar(page).getByRole("button", { name: "Start a chat", exact: true })).toBeVisible();
    const start = shell.chat(page).locator(".mb-chat__start");
    await expect(start.getByRole("heading", { name: "No chats yet" })).toBeVisible();
    await expect(start).toContainText(`Start a chat with people and bots in ${home.name}, or message someone on your team.`);
    for (const action of ["New chat", "Team", "Add bots"]) await expect(start.getByRole("button", { name: action, exact: true })).toBeVisible();
    // At a phone's width the sidebar is a closed drawer, so the chat panel's start is what shows.
    await shots(page, testInfo, "empty-list", async () => {
      await expect(start.getByRole("heading", { name: "No chats yet" })).toBeVisible();
    });

    // Start a chat: New chat, Public to begin with.
    await shell.sidebar(page).getByRole("button", { name: "Start a chat", exact: true }).click();
    const newChat = page.getByRole("region", { name: "New chat" });
    await expect(newChat.getByRole("radio", { name: /^Public/u })).toBeChecked();
    await expect(newChat.getByRole("button", { name: `Join ${title}` })).toHaveCount(0);
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});
