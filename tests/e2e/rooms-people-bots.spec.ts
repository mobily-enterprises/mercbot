import type { Knex } from "knex";
import type { TestInfo } from "@playwright/test";
import { connectTestDb, expect, expectRefusal, homeApi, openShell, seedChat, seedMessage, shell, sidebarEntry, test, type Page } from "./harness";

// Rooms, People and Bots (D-117), on the Test Preview target, in a home of each test's own with a second person, Ben
// Rossi, and two bots, Chef and Shopper. A person's own copy has one person who signs in (D-81), so Ben never opens a
// page here: what he makes is seeded as the server writes it, and "another person" is the owner looking at Ben's.
// A public room made with New room has its maker in it and its start line, and its maker can leave it, empty and faded;
// Ben's public room is faded in the owner's Rooms until they open it, which joins them; Ben's chat with a bot and his chats with
// others aren't the owner's to open (404); a private room opens Invite at once, which brings a bot in; a person in
// People opens the owner's private chat with them; Bots' + opens Add bots. Then the density the sidebar is for: at
// 1280 by 800, a home of 8 people, 10 rooms and 20 bots shows most of itself on one screen, and folded sections show
// only what needs the person; screenshots of both are the output, with the rows counted in the test's annotations.
// Each test deletes the home and the people it makes.
// Run with: vibe64-helper playwright --target test-app test tests/e2e/rooms-people-bots.spec.ts
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

type Home = Awaited<ReturnType<typeof homeWith>>;

/**
 * A home of the test's own, made as New home makes it, with `people` more members (the first Ben Rossi) and `bots` of
 * the owner's (the first two Chef and Shopper, then Bot 3…), the first of them the home's main bot when `main`. `remove`
 * deletes it with everything in it, and the people.
 */
async function homeWith(page: Page, knex: Knex, { people = 1, bots = 2, main = false } = {}) {
  const stamp = Date.now().toString(36);
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const made = await page.request.post("/api/workspaces", {
    headers: { "csrf-token": csrfToken, "content-type": "application/vnd.api+json", accept: "application/vnd.api+json" },
    data: JSON.stringify({ data: { type: "workspaces", attributes: { name: `Riverside ${stamp}` } } })
  });
  expect(made.ok(), await made.text()).toBe(true);
  const slug = String((await made.json()).data.attributes.slug);
  const home = await knex("workspaces").where({ slug }).first();
  const homeId = String(home.id);
  const owner = String(home.owner_user_id);
  const PEOPLE = ["Ben Rossi", "Cara Bianchi", "Dario Conti", "Elena Greco", "Fabio Ricci", "Giulia Marino", "Hugo Bruno"];
  const peopleIds: string[] = [];
  for (let at = 0; at < people; at += 1) {
    const [row] = await knex("users").insert({
      auth_provider: "test", auth_provider_user_sid: `p${at}-${stamp}`, email: `p${at}-${stamp}@example.test`, username: `p${at}${stamp}`,
      display_name: PEOPLE[at] || `Person ${at + 1}`
    }).returning("id");
    peopleIds.push(String(row.id));
  }
  if (peopleIds.length) {
    await knex("workspace_memberships").insert(peopleIds.map((userId) => ({ workspace_id: homeId, user_id: userId, role_sid: "member", status: "active" })));
  }
  const BOTS = ["Chef", "Shopper"];
  const botIds: string[] = [];
  for (let at = 0; at < bots; at += 1) {
    const [row] = await knex("bots").insert({
      made_by: owner, workspace_id: homeId, name: BOTS[at] || `Bot ${String(at + 1).padStart(2, "0")}`, color: "#E65100", library_template: "general",
      is_main: main && at === 0
    }).returning("id");
    botIds.push(String(row.id));
  }
  const remove = async () => {
    if (!page.isClosed() && page.url() !== "about:blank") await page.goto("about:blank").catch(() => null);
    await knex("conversations").where({ workspace_id: homeId }).del();
    await knex("bots").where({ workspace_id: homeId }).del();
    for (const table of ["usage_events", "usage_daily", "usage_monthly", "workspace_settings", "workspace_memberships"]) {
      await knex(table).where({ workspace_id: homeId }).del();
    }
    await knex("workspaces").where({ id: homeId }).del();
    if (peopleIds.length) await knex("users").whereIn("id", peopleIds).del();
  };
  return { slug, path: `/w/${slug}`, homeId, name: String(home.name), owner, ben: peopleIds[0], people: peopleIds, chef: botIds[0], shopper: botIds[1], bots: botIds, stamp, remove };
}

/** A chat between two people of the home, as the server makes one: Private, untitled, the pair in one order. */
async function personChat(knex: Knex, home: Home, one: string, other: string) {
  const [low, high] = [one, other].sort((a, b) => Number(a) - Number(b));
  const [chat] = await knex("conversations").insert({
    workspace_id: home.homeId, kind: "private", title: null, made_by: one, direct_user_id: low, direct_person_id: high
  }).returning("id");
  await knex("chat_people").insert([one, other].map((userId) => ({ conversation_id: chat.id, workspace_id: home.homeId, user_id: userId })));
  return String(chat.id);
}

const chip = (page: Page, title: string) => shell.chat(page).getByRole("button", { name: `${title} details`, exact: true });
const answered = (page: Page, method: string, path: string) =>
  page.waitForResponse((response) => response.request().method() === method && new URL(response.url()).pathname === path);
const FADED = /\bmb-row--faded\b/u;

/** New room from Rooms' +, `kind` chosen and named `name`, then Create: resolves with the room the server made. */
async function newRoom(page: Page, home: Home, kind: "Public" | "Private", name: string) {
  await shell.section(page, "Rooms").getByRole("button", { name: "New room", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New room" });
  await dialog.getByRole("radiogroup", { name: "Who can open it" }).locator("label").filter({ hasText: kind }).click();
  await dialog.getByRole("textbox", { name: "Name" }).fill(name);
  const made = answered(page, "POST", `/api${home.path}/chats`);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  const { chat } = await (await made).json();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`[?&]chat=${chat.id}\\b`, "u"));
  return chat;
}

test("a public room starts with its maker and their start line, its maker leaves it from its header, and another's public room is faded until you open it", async ({ page }) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWith(page, knex);
    // Ben's public room, with his start line, as New room makes it for him.
    const bens = await seedChat(knex, { homeId: home.homeId, title: `Allotment ${home.stamp}`, people: [home.ben], madeBy: home.ben });
    await seedMessage(knex, { homeId: home.homeId, chatId: bens.id, kind: "event", userId: home.ben, body: { event: "room_started", text: "Ben Rossi started this room.", authorName: "Ben Rossi" } });
    await openShell(page, "", home.path);
    const api = await homeApi(page, home.path);

    // The owner's public room: them alone in it, no bots, and their start line, the room's first message.
    const title = `Picnic ${home.stamp}`;
    const room = await newRoom(page, home, "Public", title);
    expect([room.kind, room.title, room.people.map((person: { userId: string }) => String(person.userId)), room.bots]).toEqual(["public", title, [home.owner], []]);
    const [first] = await knex("messages").where({ conversation_id: room.id }).orderBy("id");
    expect([first.kind, String(first.author_user_id), first.body.event]).toEqual(["event", home.owner, "room_started"]);
    await expect(shell.chat(page).getByText(first.body.text, { exact: true })).toBeVisible();
    expect(first.body.text).toMatch(/ started this room\.$/u);
    const row = shell.chatRow(page, title);
    await expect(row).toHaveAttribute("aria-current", "page");
    await expect(row).not.toHaveClass(FADED);
    // Its people invite people and bots, in a public room too (8ccf7bd).
    await expect(shell.chat(page).getByRole("button", { name: "Invite", exact: true })).toBeVisible();

    // Its maker leaves with the header's Leave room: the room stays, with nobody in it, faded in their Rooms, and stays
    // left while it's still open.
    await shell.chat(page).getByRole("button", { name: "Leave room", exact: true }).click();
    await expect(shell.question(page).locator(".mb-confirm__text")).toHaveText("It's public, so it stays in Rooms, faded, and opening it again brings you back.");
    const left = answered(page, "POST", `/api${home.path}/chats/${room.id}/leave`);
    await shell.question(page).getByRole("button", { name: "Leave", exact: true }).click();
    expect((await left).ok()).toBe(true);
    expect(await knex("chat_people").where({ conversation_id: room.id }).count({ count: "*" }).first(), "nobody in it").toEqual({ count: "0" });
    expect(await knex("conversations").where({ id: room.id }).first(), "it stays").toBeTruthy();
    await expect(row).toHaveClass(FADED);
    expect((await api.get("/chats/public")).chats.map((chat: { id: string }) => String(chat.id)).sort()).toEqual([String(room.id), bens.id].sort());

    await expect(row).toHaveAttribute("aria-current", "page");
    await expect(shell.chat(page).getByRole("button", { name: "Leave room", exact: true })).toHaveCount(0);

    // Ben's public room: faded in the owner's Rooms; opening it joins it: no longer faded, the owner among its people,
    // its start line and the composer as usual, and its Leave room in the header.
    const bensRow = shell.chatRow(page, `Allotment ${home.stamp}`);
    await expect(bensRow).toHaveClass(FADED);
    const joined = answered(page, "POST", `/api${home.path}/chats/${bens.id}/join`);
    await bensRow.click();
    expect((await joined).ok()).toBe(true);
    await expect(shell.chat(page).getByText("Ben Rossi started this room.", { exact: true })).toBeVisible();
    await expect(bensRow).not.toHaveClass(FADED);
    await expect(shell.chat(page).getByRole("button", { name: "Leave room", exact: true })).toBeVisible();
    expect(await knex("chat_people").where({ conversation_id: bens.id }).pluck("user_id").then((ids) => ids.map(String).sort())).toEqual([home.owner, home.ben].sort());
    expect((await api.get("/chats/public")).chats.map((chat: { id: string }) => String(chat.id))).toEqual([String(room.id)]);
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});

test("another person's chat with a bot, and their chat with someone else, aren't yours to open; a person in People opens your private chat with them", async ({ page }) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWith(page, knex, { people: 2 });
    const [ben, cara] = home.people;
    // Ben's chat with Chef, and Ben's chat with Cara.
    const bensChef = await seedChat(knex, { homeId: home.homeId, direct: { userId: ben, botId: home.chef } });
    await seedMessage(knex, { homeId: home.homeId, chatId: bensChef.id, userId: ben, body: { text: "Something only Chef should hear" } });
    const benCara = await personChat(knex, home, ben, cara);
    const api = await homeApi(page, home.path);

    // The server: 404 for the chat and its messages, and neither is among the public rooms.
    for (const chatId of [bensChef.id, benCara]) {
      expect((await api.answer("GET", `/chats/${chatId}`)).status()).toBe(404);
      expect((await api.answer("GET", `/chats/${chatId}/messages`)).status()).toBe(404);
    }
    expect((await api.get("/chats/public")).chats).toEqual([]);

    // By its address, Ben's chat with Chef isn't there for the owner, and the first chat opens instead.
    await openShell(page, "", home.path);
    expectRefusal(`404 GET /api${home.path}/chats/${bensChef.id}`);
    await page.goto(`${home.path}?chat=${bensChef.id}`);
    await expect(page.getByText("That chat isn't there, or it's private.")).toBeVisible();
    await expect(page).not.toHaveURL(new RegExp(`[?&]chat=${bensChef.id}\\b`, "u"));
    await expect(shell.sidebar(page)).not.toContainText("Something only Chef should hear");

    // Ben in People: the owner's own private chat with him, made now, the two of them and no bot, taking no one else.
    const made = answered(page, "POST", `/api${home.path}/people/${ben}/direct`);
    await (await sidebarEntry(page, "People", "Ben Rossi")).click();
    const { chat } = await (await made).json();
    expect([chat.kind, chat.title, String(chat.directPerson?.userId), chat.people.map((person: { userId: string }) => String(person.userId)).sort(), chat.bots])
      .toEqual(["private", null, ben, [home.owner, ben].sort(), []]);
    expect(String(chat.id)).not.toBe(benCara);
    await expect(page).toHaveURL(new RegExp(`[?&]chat=${chat.id}\\b`, "u"));
    await expect(chip(page, "Ben Rossi")).toContainText("Private · only you and Ben Rossi");
    await expect(shell.chatRow(page, "Ben Rossi")).toHaveAttribute("aria-current", "page");
    await expect(shell.chat(page).getByRole("button", { name: /^Invite/u })).toHaveCount(0);
    const bot = await api.answer("POST", `/chats/${chat.id}/bots`, { botId: home.chef });
    expect([bot.status(), (await bot.json()).code], "nobody else comes into it").toEqual([409, "bots_chat_direct"]);
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});

test("a private room opens Invite at once, which invites a bot; Bots' + opens Add bots", async ({ page }) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWith(page, knex);
    await openShell(page, "", home.path);

    // A private room: made with its maker alone, then Invite, for its people and bots, opens by itself.
    const title = `Budget ${home.stamp}`;
    const room = await newRoom(page, home, "Private", title);
    expect([room.kind, room.people.map((person: { userId: string }) => String(person.userId)), room.bots]).toEqual(["private", [home.owner], []]);
    const invite = page.getByRole("dialog", { name: "Invite", exact: true });
    await expect(invite.getByRole("heading", { name: "Invite", exact: true })).toBeVisible();
    await invite.getByRole("combobox", { name: "People and bots" }).fill("Chef");
    await page.getByRole("option", { name: /Chef/u }).click();
    await invite.locator(".mb-invite__note").click();
    const added = answered(page, "POST", `/api${home.path}/chats/${room.id}/bots`);
    await invite.getByRole("button", { name: "Add", exact: true }).click();
    expect((await added).ok()).toBe(true);
    await expect(invite).toBeHidden();
    await expect(chip(page, title)).toContainText("Private · You and Chef");
    expect(await knex("chat_bots").where({ conversation_id: room.id }).pluck("bot_id").then((ids) => ids.map(String))).toEqual([home.chef]);
    await expect(shell.chatRow(page, `${title}, private`)).toBeVisible();
    // Its header keeps Invite for its people.
    await expect(shell.chat(page).getByRole("button", { name: "Invite", exact: true })).toBeVisible();
    // On a phone Invite fills the screen, and its picker stays one field high, never stretched to the screen's height.
    await page.setViewportSize({ width: 390, height: 844 });
    await shell.chat(page).getByRole("button", { name: "Invite", exact: true }).click();
    await expect(invite.getByRole("combobox", { name: "People and bots" })).toBeVisible();
    expect((await invite.locator(".v-input").first().boundingBox())?.height).toBeLessThan(80);
    await invite.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(invite).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 800 });

    // Bots' +: Add bots, on Describe what you need.
    await shell.section(page, "Bots").getByRole("button", { name: "Add bots", exact: true }).click();
    const addBots = page.getByRole("dialog", { name: "Add bots" });
    await expect(addBots.getByRole("textbox", { name: "Describe what you need" })).toBeVisible();
    await expect(addBots.getByRole("button", { name: /^A ready-made set/u })).toBeVisible();
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});

/** The sidebar's rows, and how many of them show whole in its scrolling part, as the page lays them out. */
const sidebarRows = (page: Page) => shell.sidebar(page).evaluate((nav) => {
  const area = nav.querySelector(".mb-sidebar__bots")!.getBoundingClientRect();
  const rows = [...nav.querySelectorAll(".mb-sidebar__bots .mb-row")].map((row) => row.getBoundingClientRect()).filter((box) => box.height > 0);
  return {
    rows: rows.length,
    visible: rows.filter((box) => box.top >= area.top && box.bottom <= area.bottom).length,
    tallest: Math.max(0, ...rows.map((box) => box.height))
  };
});

async function densityShot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: "disabled" });
  const counted = await sidebarRows(page);
  testInfo.annotations.push({ type: "sidebar rows", description: `${name}: ${counted.visible} of ${counted.rows} rows in view, each at most ${counted.tallest}px` });
  return counted;
}

// The person's ask (plan 4.1, density): a realistic home, 8 people, 10 rooms and 20 bots, mostly on one laptop screen.
test("at 1280 by 800, a home of 8 people, 10 rooms and 20 bots shows most of itself, and folded sections only what needs you", async ({ page }, testInfo) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    home = await homeWith(page, knex, { people: 7, bots: 20, main: true });
    const h = home;
    // Ten rooms the owner is in, one with unread news for them.
    const rooms: string[] = [];
    for (let at = 0; at < 10; at += 1) {
      rooms.push((await seedChat(knex, { homeId: h.homeId, title: `Room ${at + 1} ${h.stamp}`, people: [h.owner, h.people[at % 7]], madeBy: h.owner })).id);
    }
    await knex("chat_people").where({ conversation_id: rooms[9], user_id: h.owner }).update({ unread: true });
    // Talked with lately: three people and five bots (the main bot among them); two people and a bot a month ago.
    for (const person of h.people.slice(0, 3)) await personChat(knex, h, h.owner, person);
    const old = await Promise.all(h.people.slice(3, 5).map((person) => personChat(knex, h, h.owner, person)));
    for (const bot of h.bots.slice(0, 5)) await seedChat(knex, { homeId: h.homeId, direct: { userId: h.owner, botId: bot } });
    // The bots were made a month ago, as in a home in use: a bot made in the last 14 days always shows (4c94837).
    await knex("bots").where({ workspace_id: h.homeId }).update({ created_at: knex.raw("now() - interval '30 days'") });
    old.push((await seedChat(knex, { homeId: h.homeId, direct: { userId: h.owner, botId: h.bots[5] } })).id);
    await knex("conversations").whereIn("id", old).update({ last_activity_at: knex.raw("now() - interval '30 days'") });

    await openShell(page, `?chat=${rooms[0]}`, h.path);
    const rooms_ = shell.section(page, "Rooms");
    const people = shell.section(page, "People");
    const bots = shell.section(page, "Bots");
    await expect(rooms_.locator(".mb-row")).toHaveCount(10);
    // People: all seven, as a section of seven or fewer shows every entry (4c94837); Bots: the five talked with lately,
    // then "15 more".
    await expect(people.locator(".mb-row")).toHaveCount(7);
    await expect(people.getByRole("button", { name: /^\d+ more$/u })).toHaveCount(0);
    await expect(bots.locator(".mb-row")).toHaveCount(5);
    await expect(bots.getByRole("button", { name: "15 more" })).toBeVisible();

    const expanded = await densityShot(page, testInfo, "density-expanded");
    expect(expanded.rows, "10 rooms, 7 people and 5 bots").toBe(22);
    expect(expanded.tallest, "single-line rows").toBeLessThanOrEqual(36);
    expect(expanded.visible, "most of the home on one screen").toBeGreaterThanOrEqual(15);

    // Each section folded by its title: only what needs the person shows, the open room and the unread one, with the
    // count of what each hides.
    for (const section of [rooms_, people, bots]) {
      const title = section.locator(".mb-section__title");
      await title.click();
      await expect(title).toHaveAttribute("aria-expanded", "false");
    }
    await expect(rooms_.locator(".mb-row")).toHaveCount(2);
    await expect(rooms_.locator(".mb-header__count")).toHaveText("8");
    await expect(people.locator(".mb-row")).toHaveCount(0);
    await expect(people.locator(".mb-header__count")).toHaveText("7");
    await expect(bots.locator(".mb-row")).toHaveCount(0);
    await expect(bots.locator(".mb-header__count")).toHaveText("20");
    const folded = await densityShot(page, testInfo, "density-folded");
    expect(folded.rows).toBe(2);
    expect(folded.visible, "everything shown is in view").toBe(folded.rows);

    // Folding is kept on the device for the home: a reload shows the sections folded still.
    await page.reload();
    await expect(rooms_.locator(".mb-section__title")).toHaveAttribute("aria-expanded", "false");
    for (const section of [rooms_, people, bots]) await section.locator(".mb-section__title").click();
    await expect(rooms_.locator(".mb-row")).toHaveCount(10);
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});
