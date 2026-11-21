import type { Knex } from "knex";
import type { Locator, TestInfo } from "@playwright/test";
import { connectTestDb, expect, homeApi, openShell, shell, test, type Page } from "./harness";

// A person's first visit to a new home (plan 4.1, D4, D-109, D-112), on the Test Preview target, in a home of the test's
// own. Their welcome chat is made at once: their direct chat with the home's main bot, Mercbot, made with it, and
// nothing else in the list. Mercbot greets them, asks to be named and is renamed, then asks what the home is for: Show me
// ready-made teams opens Add bots on its teams, and Small shop's three bots ticked join the home, introduced in the
// welcome chat, with no chats of their own; then whether anyone else will use the home: Just me makes no everyone chat.
// Team lists the person and the four bots, and a bot's [Message] there opens the person's direct chat with it. The
// test deletes the home it makes. Screenshots light, dark and phone of the welcome, Mercbot asking to be named, are the
// output.
// Not covered here: the intro slides of a person's very first home, as the Test Preview's one person has a home already
// (D-81: a copy of one's own has one person, so no new person signs in); this home skips them, as a second home does.
// Run with: vibe64-helper playwright --target test-app test tests/e2e/chats-first-run.spec.ts
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

const answered = (page: Page, method: string, path: RegExp) =>
  page.waitForResponse((response) => response.request().method() === method && path.test(new URL(response.url()).pathname));

/** The choice card asking `question`, and its option buttons. */
function card(page: Page, question: string) {
  const found = shell.chat(page).locator(".mb-choice").filter({ has: page.locator(".mb-choice__question", { hasText: question }) });
  return { card: found, options: found.locator(".mb-choice__option") };
}

/** A home of the test's own, made as New home makes it, with no chats and no bots; `remove` deletes it and all in it. */
async function newHome(page: Page, knex: Knex) {
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const made = await page.request.post("/api/workspaces", {
    headers: { "csrf-token": csrfToken, "content-type": "application/vnd.api+json", accept: "application/vnd.api+json" },
    data: JSON.stringify({ data: { type: "workspaces", attributes: { name: `Lakeside ${Date.now().toString(36)}` } } })
  });
  expect(made.ok(), await made.text()).toBe(true);
  const slug = String((await made.json()).data.attributes.slug);
  const home = await knex("workspaces").where({ slug }).first();
  const homeId = String(home.id);
  const remove = async () => {
    if (page.url() !== "about:blank") await page.goto("about:blank");
    await knex("conversations").where({ workspace_id: homeId }).del();
    await knex("bots").where({ workspace_id: homeId }).del();
    for (const table of ["usage_events", "usage_daily", "usage_monthly", "workspace_settings", "workspace_memberships"]) {
      await knex(table).where({ workspace_id: homeId }).del();
    }
    await knex("workspaces").where({ id: homeId }).del();
  };
  return { slug, path: `/w/${slug}`, homeId, owner: String(home.owner_user_id), remove };
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

/** Leaves every app a team screen offers to set up unticked, once the apps it works with are read. */
async function noApps(dialog: Locator) {
  for (const box of await dialog.getByRole("checkbox", { name: /^Also set up its .+ app/u }).all()) await box.uncheck();
}

test("a new home's welcome chat names its main bot, picks a ready-made team for Team, and a bot's Message opens its direct chat", async ({ page }, testInfo) => {
  // The welcome chat's steps come at the pace a person reads them (ONBOARDING_TIMING, about 20 seconds in all).
  test.setTimeout(150_000);
  const knex = connectTestDb();
  let home: Awaited<ReturnType<typeof newHome>> | null = null;
  try {
    home = await newHome(page, knex);
    const api = await homeApi(page, home.path);

    // The first visit makes the welcome chat: the person's direct chat with Mercbot, made with it, and the only chat.
    const welcomed = answered(page, "POST", new RegExp(`^/api${home.path}/chats/welcome$`, "u"));
    await openShell(page, "", home.path);
    const { chat: welcome } = await (await welcomed).json();
    expect([welcome.kind, welcome.onboardingStep, welcome.title, welcome.people.map((person: { userId: string }) => String(person.userId))])
      .toEqual(["public", "start", null, [home.owner]]);
    const main = await knex("bots").where({ workspace_id: home.homeId }).select("id", "name", "is_main");
    expect(main.map((bot) => [bot.name, bot.is_main])).toEqual([["Mercbot", true]]);
    const mainId = String(main[0].id);
    expect(welcome.directBotId).toBe(mainId);
    expect((await api.get("/chats?hidden=1&archived=1")).chats.map((chat: { id: string }) => String(chat.id))).toEqual([String(welcome.id)]);
    await expect(shell.chatRow(page, "Mercbot")).toBeVisible();
    await expect(shell.chat(page)).toHaveAttribute("aria-label", "Mercbot");

    // Mercbot greets the person and asks to be named: two names to pick from, or Mercbot.
    await expect(shell.chat(page).getByText(/^Good to have you here, .+\. From now on I'll be looking after things for you, at work and at home\.$/u))
      .toBeVisible({ timeout: 20_000 });
    const naming = card(page, "First things first: pick a name for me. You're free to rename me any time.");
    await expect(naming.options).toHaveCount(3);
    await expect(naming.options.last()).toHaveText(/Mercbot$/u);
    const name = String((await naming.options.first().locator("span").last().textContent()) || "").trim();
    expect(name).toMatch(/^[A-Z][a-z]+$/u);
    await shots(page, testInfo, "first-run-welcome", () => expect(naming.options.last()).toBeVisible());
    await naming.options.first().click();

    // It takes the name, is renamed everywhere, and asks what the home is for.
    await expect(shell.chat(page).getByText(new RegExp(`^${name} it is\\. Nice to meet you properly, .+!$`, "u"))).toBeVisible({ timeout: 20_000 });
    await expect(shell.chat(page).getByText(`Renamed to ${name}`, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(shell.chatRow(page, name)).toBeVisible();
    expect((await knex("bots").where({ id: mainId }).first()).name).toBe(name);
    const homeFor = card(page, "What's this home for? I can suggest a few bots to help with it.");
    await expect(homeFor.options).toHaveText([/Describe what I need$/u, /Show me ready-made teams$/u, /Not now$/u], { timeout: 20_000 });
    await expect(homeFor.card.locator(".mb-choice__subline")).toHaveText("You see them before anything is added, or just type to skip.");

    // Show me ready-made teams: Add bots on its teams, where nothing is added until Add.
    await homeFor.options.filter({ hasText: "Show me ready-made teams" }).click();
    const dialog = page.getByRole("dialog", { name: "Add bots" });
    await expect(dialog.getByRole("heading", { name: "A ready-made team" })).toBeVisible();
    expect(await knex("bots").where({ workspace_id: home.homeId }).count({ count: "*" }).first()).toEqual({ count: "1" });
    const appsRead = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/apps-templates"));
    await dialog.getByRole("button", { name: /^Small shop/u }).click();
    await appsRead;
    await dialog.getByRole("checkbox", { name: "Add Kindly" }).uncheck();
    await dialog.getByRole("checkbox", { name: "Add Rapport" }).uncheck();
    await noApps(dialog);
    const teamAdded = answered(page, "POST", /\/teams\/shop$/u);
    await dialog.getByRole("button", { name: "Add 3 bots" }).click();
    const added = await (await teamAdded).json();
    expect([added.added.length, added.skipped, String(added.chatId)]).toEqual([3, [], String(welcome.id)]);
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Added 3 bots to your team.")).toBeVisible();

    // The welcome chat introduces them, a [Message] for each, and they make no chats of their own.
    await expect(shell.chat(page).getByText("Your team's here: Restock, Chorus and Docket. Start a chat with one of them whenever you like."))
      .toBeVisible();
    await expect(shell.chat(page).locator(".mb-bubble__team-member")).toHaveText([/Restock/u, /Chorus/u, /Docket/u]);
    expect((await api.get("/chats?hidden=1&archived=1")).chats.map((chat: { id: string }) => String(chat.id))).toEqual([String(welcome.id)]);

    // Then whether anyone else will use the home: Just me makes no everyone chat, and the welcome chat carries on.
    const people = card(page, "Will anyone else use this home?");
    await expect(people.options).toHaveText([/Just me$/u, /Me and other people$/u], { timeout: 20_000 });
    await people.options.filter({ hasText: "Just me" }).click();
    await expect(shell.chat(page).getByText("A bit about how I work:")).toBeVisible({ timeout: 20_000 });
    expect(await knex("conversations").where({ workspace_id: home.homeId, everyone: true }).first()).toBeUndefined();

    // Team: the person, then the main bot and the three, each bot with Message.
    await shell.sidebar(page).getByRole("button", { name: "Team", exact: true }).click();
    const members = shell.team(page).getByRole("list", { name: "Members" });
    await expect(members.locator('li[data-member="person"]')).toHaveCount(1);
    await expect(members.locator('li[data-member="bot"] .mb-team-row__name')).toHaveText([new RegExp(`^${name}`, "u"), /^Restock/u, /^Chorus/u, /^Docket/u]);
    for (const bot of [name, "Restock", "Chorus", "Docket"]) await expect(members.getByRole("button", { name: `Message ${bot}` })).toBeVisible();

    // Restock's Message: the person's direct chat with it, made now, open and listed.
    const restock = String((await knex("bots").where({ workspace_id: home.homeId, name: "Restock" }).first()).id);
    const direct = answered(page, "POST", new RegExp(`^/api${home.path}/bots/${restock}/direct$`, "u"));
    await members.getByRole("button", { name: "Message Restock" }).click();
    const { chat } = await (await direct).json();
    expect([String(chat.directBotId), chat.kind, chat.people.map((person: { userId: string }) => String(person.userId))])
      .toEqual([restock, "public", [home.owner]]);
    await expect(page).toHaveURL(new RegExp(`[?&]chat=${chat.id}\\b`, "u"));
    await expect(shell.chat(page)).toHaveAttribute("aria-label", "Restock");
    await expect(shell.chatRow(page, "Restock")).toBeVisible();
    const row = await knex("conversations").where({ id: chat.id }).first();
    expect([String(row.direct_bot_id), String(row.direct_user_id)]).toEqual([restock, home.owner]);
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});
