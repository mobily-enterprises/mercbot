import path from "node:path";
import type { Knex } from "knex";
import type { TestInfo } from "@playwright/test";
import { connectTestDb, expect, openShell, seedChat, shell, test, type Page } from "./harness";

// Bots together (D-115), on the Test Preview target, whose AI is the stand-in model (tools/standInModel.mjs): its join-in
// judge names the chat's first bot for a question and no bot otherwise, and in a discussion each bot makes one point in
// round 1, passes after, and one sums it up. In a home of each test's own with a second person, Ben Rossi (who never
// opens a page here), and two bots, Chef and Shopper:
// - Chat details shows "Bots join in when useful", off, a switch for the chat's maker; on, a question nobody calls a bot
//   for gets one bot's answer (Chef's), and chatter gets none.
// - Discuss with the bots, from the composer's +, puts a card in the chat that says what it may cost; Start runs round 1,
//   the card waits for One more round or Wrap up, and Wrap up has one bot sum it up and ends it.
// Screenshots light, dark and phone (390 by 844): the switch in Chat details, the chat with Chef joining in, and the
// discussion card proposed, waiting and ended. Each test deletes the home and the person it makes.
// Run with: vibe64-helper playwright --target test-app test tests/e2e/chats-together.spec.ts
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

type Home = Awaited<ReturnType<typeof homeWithBen>>;

/** A home of the test's own, made as New home makes it, with Ben Rossi a member and the owner's bots Chef and Shopper. */
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
    if (!page.isClosed() && page.url() !== "about:blank") await page.goto("about:blank");
    await knex("conversations").where({ workspace_id: homeId }).del();
    await knex("bots").where({ workspace_id: homeId }).del();
    for (const table of ["usage_events", "usage_daily", "usage_monthly", "workspace_settings", "workspace_memberships"]) {
      await knex(table).where({ workspace_id: homeId }).del();
    }
    await knex("workspaces").where({ id: homeId }).del();
    await knex("users").where({ id: benId }).del();
  };
  return { path: `/w/${slug}`, homeId, owner, ben: benId, chef, shopper, stamp, remove };
}

/** Where a screenshot goes: SHOTS_DIR when a run collects them, else the test's own output folder. */
const shotPath = (info: TestInfo, name: string) => (process.env.SHOTS_DIR ? path.join(process.env.SHOTS_DIR, name) : info.outputPath(name));

/** Light and dark, then light at a phone's width (390 by 844) once `atPhone` has shown the screen there. */
async function shots(page: Page, testInfo: TestInfo, name: string, atPhone?: () => Promise<unknown>) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await expect(page.locator(".v-application")).toHaveClass(new RegExp(`\\bv-theme--(workspace-)?${scheme}\\b`, "u"));
    await page.screenshot({ path: shotPath(testInfo, `${name}-${scheme}.png`), animations: "disabled" });
  }
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  const size = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await atPhone?.();
  await page.screenshot({ path: shotPath(testInfo, `${name}-phone.png`), animations: "disabled" });
  if (size) await page.setViewportSize(size);
}

/** How many messages a bot wrote in a chat (its words, cards or files: the stand-in may play a setup interview). */
const botMessages = async (knex: Knex, chatId: string, botId: string) =>
  Number((await knex("messages").where({ conversation_id: chatId, author_bot_id: botId }).whereNot({ kind: "event" }).count({ count: "*" }))[0].count);

/** `text` sent from the composer. */
async function say(page: Page, text: string) {
  await shell.composer(page).fill(text);
  await page.keyboard.press("Enter");
}

test("Chat details' switch lets bots join in when useful: one bot answers a question nobody called it for", async ({ page }, testInfo) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWithBen(page, knex);
    const title = `Kitchen ${home.stamp}`;
    const chat = await seedChat(knex, { homeId: home.homeId, title, people: [home.owner, home.ben], bots: [home.chef, home.shopper] });
    await openShell(page, `?chat=${chat.id}`, home.path);
    const openDetails = () => shell.chat(page).getByRole("button", { name: `${title} details` }).click();
    await openDetails();
    const details = shell.details(page, "Chat details");
    const joinIn = details.getByRole("switch", { name: "Bots join in when useful" }).or(details.getByRole("checkbox", { name: "Bots join in when useful" }));
    await expect(joinIn).not.toBeChecked();
    await expect(joinIn).toBeEnabled();
    await expect(details.getByText("On: a bot may reply without being called. Off: only when called.")).toBeVisible();

    await joinIn.click();
    await expect(joinIn).toBeChecked();
    await expect.poll(async () => (await knex("conversations").where({ id: chat.id }).first()).bots_join_in).toBe(true);
    await shots(page, testInfo, "join-in-switch", async () => {
      if (!(await details.isVisible())) await openDetails();
      await expect(joinIn).toBeChecked();
    });
    await openShell(page, `?chat=${chat.id}`, home.path);

    // A question for nobody in particular: the judge names Chef, who answers; Shopper stays quiet.
    await say(page, "Does anyone know when the hardware shop opens on Sundays?");
    await expect.poll(() => botMessages(knex, chat.id, home!.chef), { timeout: 20_000 }).toBeGreaterThan(0);
    const [asked] = await knex("messages").where({ conversation_id: chat.id, role: "user" }).orderBy("id", "desc").limit(1);
    expect(asked.body.judged).toBe(home.chef);
    expect(await botMessages(knex, chat.id, home.shopper)).toBe(0);

    // Chatter: judged, and left to the people.
    await say(page, "Thanks, see you there.");
    const chatter = () => knex("messages").where({ conversation_id: chat.id, role: "user" }).orderBy("id", "desc").first();
    await expect.poll(async () => (await chatter()).body.judged, { timeout: 20_000 }).toBe("quiet");
    const answered = await knex("messages").where({ conversation_id: chat.id, role: "bot" }).whereRaw("(body->>'answers')::bigint >= ?", [(await chatter()).id]);
    expect(answered, "no bot answered the chatter").toEqual([]);
    expect(await botMessages(knex, chat.id, home.shopper)).toBe(0);
    await shots(page, testInfo, "join-in-chat");
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});

test("Discuss with the bots: a card says what it may cost, Start runs a round, and Wrap up has one bot sum it up", async ({ page }, testInfo) => {
  const knex = connectTestDb();
  let home: Home | null = null;
  try {
    home = await homeWithBen(page, knex);
    const chat = await seedChat(knex, { homeId: home.homeId, title: `Kitchen ${home.stamp}`, people: [home.owner], bots: [home.chef, home.shopper] });
    await openShell(page, `?chat=${chat.id}`, home.path);

    await shell.composer(page).fill("Should we repaint the kitchen now, or wait until spring?");
    await shell.chat(page).getByRole("button", { name: "Add files and more" }).click();
    await page.locator(".v-overlay--active").getByText("Discuss with the bots", { exact: true }).click();
    const card = shell.chat(page).getByRole("region", { name: "Discussion" });
    await expect(card).toBeVisible();
    await expect(shell.composer(page)).toHaveValue("");
    await expect(card).toContainText("Should we repaint the kitchen now, or wait until spring?");
    await expect(card).toContainText("Chef, Shopper · started by you");
    await expect(card.getByRole("radio", { name: "2 rounds" })).toHaveAttribute("aria-checked", "true");
    await expect(card.getByText(/^Up to about \$[\d.,]+, as your work in this home\.$/u)).toBeVisible();
    const two = await card.getByText(/^Up to about/u).textContent();
    await card.getByRole("radio", { name: "1 round" }).click();
    expect(await card.getByText(/^Up to about/u).textContent(), "fewer rounds, less").not.toBe(two);
    await card.getByRole("radio", { name: "2 rounds" }).click();
    await shots(page, testInfo, "discuss-proposed", () => expect(card).toBeVisible());

    // Start: each bot makes its point, and the card waits for the person.
    await card.getByRole("button", { name: "Start" }).click();
    await expect(card.getByRole("button", { name: "Wrap up" })).toBeVisible({ timeout: 20_000 });
    await expect(card.getByRole("button", { name: "One more round" })).toBeVisible();
    await expect(card.getByText(/^Round 1 of 2 done · \$[\d.,]+ so far$/u)).toBeVisible();
    await expect(shell.chat(page).getByText("One placeholder point", { exact: false })).toHaveCount(2);
    await shots(page, testInfo, "discuss-waiting", () => expect(card).toBeVisible());

    // Wrap up: Chef, the chat's first bot, sums it up, and it ends.
    await card.getByRole("button", { name: "Wrap up" }).click();
    await expect(card.getByText(/^Chef wrapped it up\. It cost \$[\d.,]+\.$/u)).toBeVisible({ timeout: 20_000 });
    await expect(card.getByRole("button")).toHaveCount(0);
    await expect(shell.chat(page).getByText("To sum up:", { exact: false })).toBeVisible();
    const [{ body }] = await knex("messages").where({ conversation_id: chat.id, kind: "discussion" });
    expect([body.status, body.ended, body.round, String(body.wrappedBy)]).toEqual(["ended", "wrapped", 1, home.chef]);
    await shots(page, testInfo, "discuss-ended", () => expect(card).toBeVisible());
  } finally {
    await home?.remove();
    await knex.destroy();
  }
});
