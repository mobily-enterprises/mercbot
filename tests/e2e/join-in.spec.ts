import knexLib from "knex";
import { expect, test, testDatabaseName, type Page } from "./harness";

// Bots decide when to join in (D-102), on the Test Preview target, whose AI is the stand-in model (it says yes to
// joining in only when the message decided on ends with a question mark): in a home of its own with two people, its
// Shared bot's General tab already holds a conversation with Kim; the owner's "Great, see you at 7." gets no reply, no
// working line and no status read, is marked as left to the people and costs one recorded AI call; naming the bot gets
// its answer; and Settings → General's switch turns joining in off. Screenshots light and dark are the test's output.
// The test deletes the home and the person it makes. Run with: vibe64-helper playwright --target test-app test
// tests/e2e/join-in.spec.ts
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

// The shell, past the introduction a person sees in a home where they have no bots yet.
async function pastIntro(page: Page) {
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
const composer = (page: Page) => page.locator("textarea.mb-composer__input");
const connect = () => knexLib({
  client: "pg",
  connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() }
});
const KIM_ASKED = "Ledger, will it rain on Saturday?";
const BOT_SAID = "Sunny all day on Saturday.";
const KIM_SAID = "Dinner at mine on Saturday, everyone.";
const CHAT = "Great, see you at 7.";
const CALLED = "Ledger, what should I bring for dessert?";

test("in General with two people, a chat between them gets no reply and naming the bot gets one", async ({ page }, testInfo) => {
  const knex = connect();
  const stamp = Date.now().toString(36);
  let homeId: string | null = null;
  let kimId: string | null = null;
  try {
    // A home of its own whose new bots are Shared, its owner past the question a second person brings (D-100).
    const { csrfToken } = await (await page.request.get("/api/session")).json();
    const headers = { "csrf-token": csrfToken };
    const made = await page.request.post("/api/workspaces", {
      headers: { ...headers, "content-type": "application/vnd.api+json", accept: "application/vnd.api+json" },
      data: JSON.stringify({ data: { type: "workspaces", attributes: { name: `Hilltop ${stamp}` } } })
    });
    expect(made.ok(), await made.text()).toBe(true);
    const slug = String((await made.json()).data.attributes.slug);
    const home = await knex("workspaces").where({ slug }).first();
    homeId = String(home.id);
    const owner = String(home.owner_user_id);
    expect((await page.request.patch(`/api/w/${slug}/home-settings`, { headers, data: { newBotSharing: "shared" } })).ok()).toBe(true);
    await knex("home_settings").where({ workspace_id: homeId }).update({ team_question_answered_at: knex.fn.now() });
    const created = await page.request.post(`/api/w/${slug}/bots`, { headers, data: { name: "Ledger", color: "#1E86FC" } });
    expect(created.ok()).toBe(true);
    const { bot } = await created.json();
    expect(bot.sharing).toBe("shared");

    // Kim joins, and General holds her question, the bot's answer and her word to everyone, which it left to them.
    const [kim] = await knex("users").insert({
      auth_provider: "test", auth_provider_user_sid: `kim-${stamp}`, email: `kim-${stamp}@example.com`, username: `kim${stamp}`, display_name: "Kim"
    }).returning("id");
    kimId = String(kim.id);
    await knex("workspace_memberships").insert({ workspace_id: homeId, user_id: kimId, role_sid: "member", status: "active" });
    const general = String((await knex("bot_conversations").where({ bot_id: bot.id, title: "General" }).whereNull("user_id").first()).id);
    const line = (role: string, body: Record<string, unknown>) => ({ workspace_id: homeId, bot_id: bot.id, conversation_id: general, kind: "text", role, body });
    const from = { id: kimId, name: "Kim" };
    const [asked] = await knex("bot_messages").insert(line("user", { text: KIM_ASKED, from })).returning("id");
    await knex("bot_messages").insert(line("bot", { text: BOT_SAID, answers: Number(asked.id) }));
    await knex("bot_messages").insert(line("user", { text: KIM_SAID, from, judged: "quiet" }));
    // The owner's page opens on General, past the bot's introduction.
    await knex("bot_conversations").where({ bot_id: bot.id, user_id: owner }).update({ onboarding_step: null, unread: false, room_id: general });

    /** The home open on the bot's General tab, in `colorScheme`. */
    const openGeneral = async (colorScheme: "light" | "dark") => {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto(`/w/${slug}?bot=${bot.id}`);
      await pastIntro(page);
      await expect(page.locator(".v-application")).toHaveClass(new RegExp(`\\bv-theme--(workspace-)?${colorScheme}\\b`, "u"));
      await tabs(page).filter({ hasText: "General" }).click();
      await expect(tabs(page).first()).toHaveAttribute("aria-selected", "true");
      await expect(chat(page).getByText(KIM_SAID)).toBeVisible();
    };
    /** Sends `text` in the open tab; resolves with the page's reply request's answer, once it isn't still going. */
    const send = async (text: string) => {
      const replied = page.waitForResponse(async (response) =>
        response.request().method() === "POST" && new URL(response.url()).pathname === `/api/w/${slug}/bots/${bot.id}/reply` &&
        !(await response.json().catch(() => ({}))).pending);
      await composer(page).fill(text);
      await composer(page).press("Enter");
      const answer = await replied;
      expect(answer.ok()).toBe(true);
      return answer.json();
    };
    const calls = async () => (await knex("usage_events").where({ bot_id: bot.id }).orderBy("id")).map((row) => [String(row.user_id), String(row.workspace_id)]);
    const statusReads: string[] = [];
    page.on("request", (request) => {
      if (/\/messages\/\d+\/activity$/u.test(new URL(request.url()).pathname)) statusReads.push(request.url());
    });

    await openGeneral("light");
    await expect(chat(page).getByText(KIM_ASKED)).toBeVisible();
    const before = await calls();

    // Chat between the two of them: one judging call, and no reply.
    const quiet = await send(CHAT);
    expect(quiet.messages, "no reply").toEqual([]);
    await expect(chat(page).getByText(CHAT)).toBeVisible();
    await expect(page.getByText("Thinking it over")).toHaveCount(0);
    expect(statusReads, "nothing asked what the bot is doing").toEqual([]);
    const said = await knex("bot_messages").where({ conversation_id: general, role: "user" }).whereRaw("body->>'text' = ?", [CHAT]).first();
    expect(said.body.judged, "left to the people, so nothing takes it up again").toBe("quiet");
    await expect.poll(calls, { message: "the judging call is recorded for the owner, in this home" }).toEqual([...before, [owner, homeId]]);
    expect(await knex("bot_messages").where({ conversation_id: general, role: "bot" }).count({ count: "*" }).first()).toEqual({ count: "1" });
    await page.screenshot({ path: testInfo.outputPath("join-in-quiet-light.png") });
    await openGeneral("dark");
    await expect(chat(page).getByText(CHAT)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("join-in-quiet-dark.png") });

    // Naming the bot calls it: it answers.
    const answered = await send(CALLED);
    expect(answered.messages.filter((message: { role: string; kind: string }) => message.role === "bot" && message.kind === "text").length).toBe(1);
    await expect(chat(page).getByText(/runs on a stand-in model/u)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("join-in-called-dark.png") });
    await openGeneral("light");
    await expect(chat(page).getByText(/runs on a stand-in model/u)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("join-in-called-light.png") });

    // Settings → General, the home's part: the switch, on, and off.
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Settings: General");
    await page.keyboard.press("Enter");
    const settings = page.getByRole("dialog", { name: "Settings" });
    const joinIn = settings.getByRole("switch", { name: "Bots decide when to join in" });
    await expect(joinIn).toHaveAttribute("aria-checked", "true");
    await expect(settings.getByText("In shared tabs, bots answer when it makes sense, without being called.")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("join-in-settings-on-light.png"), animations: "disabled" });
    const changed = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/w/${slug}/home-settings`);
    await joinIn.click();
    const kept = await (await changed).json();
    expect([kept.botsJoinIn, kept.newBotSharing]).toEqual([false, "shared"]);
    await expect(joinIn).toHaveAttribute("aria-checked", "false");
    await expect(settings.getByText("In shared tabs, bots answer only when named, @-mentioned or replied to.")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("join-in-settings-off-light.png"), animations: "disabled" });
    expect((await knex("home_settings").where({ workspace_id: homeId }).first()).bots_join_in).toBe(false);
  } finally {
    if (page.url() !== "about:blank") await page.goto("about:blank");
    if (homeId) {
      await knex("bots").where({ workspace_id: homeId }).del();
      for (const table of ["usage_events", "usage_daily", "usage_monthly", "workspace_settings", "workspace_memberships"]) {
        await knex(table).where({ workspace_id: homeId }).del();
      }
      await knex("workspaces").where({ id: homeId }).del();
    }
    if (kimId) await knex("users").where({ id: kimId }).del();
    await knex.destroy();
  }
});
