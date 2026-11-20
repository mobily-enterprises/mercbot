import knexLib from "knex";
import { expect, test, testDatabaseName, type Page } from "./harness";

// A home's default for new bots (D-100) as a person sets it, on the Test Preview target: New home, from the home menu,
// asks "Who's it for?" (Just me preselected); A team makes the home's new bots Shared, so a bot made there opens with
// General for everyone and the person's own You only, open, while the home's main bot keeps its mode. Then, with the
// home's new bots Mixed, a second person joining shows its owner the question at the top of the bot list, which Keep
// Mixed answers for good, and Settings → General changes the default. The test deletes the home and the person it
// makes. Run with: vibe64-helper playwright --target test-app test tests/e2e/home-default.spec.ts
const HOME = "/w/you";
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

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Bots" });
const tabs = (page: Page) => page.getByRole("navigation", { name: "Conversations" }).getByRole("tab");
const newBotDialog = (page: Page) => page.getByRole("dialog", { name: "New bot" });
const connect = () => knexLib({
  client: "pg",
  connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() }
});

test("a New home for A team makes its new bots Shared: General for everyone, and You only open", async ({ page }, testInfo) => {
  const knex = connect();
  const stamp = Date.now().toString(36);
  const name = `Team ${stamp}`;
  let slug = "";
  let joinerId: string | null = null;
  try {
    await page.goto(HOME);
    await pastIntro(page);
    await sidebar(page).getByRole("button", { name: /^Home: .+\. Switch home$/u }).click();
    await page.getByText("Create a home").click();
    await page.getByRole("textbox", { name: "Name of the new home" }).fill(name);
    const forWhom = page.getByRole("group", { name: "Who's it for?" });
    await expect(forWhom.getByRole("radio", { name: "Just me" })).toBeChecked();
    await forWhom.getByRole("radio", { name: "A team" }).check({ timeout: 10_000 });
    await page.screenshot({ path: testInfo.outputPath("new-home-a-team.png") });

    const chosen = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname.endsWith("/home-settings"));
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const answer = await chosen;
    expect(answer.ok()).toBe(true);
    expect((await answer.json()).newBotSharing).toBe("shared");
    slug = decodeURIComponent(new URL(answer.url()).pathname.split("/")[3]);
    await expect(page).toHaveURL(new RegExp(`/w/${slug}(?:[/?]|$)`, "u"));
    await pastIntro(page);
    await expect(sidebar(page).getByRole("button", { name: `Home: ${name}. Switch home` })).toBeVisible();

    // A new bot there is Shared: General, then the person's own You only, which is open, with its intro.
    const created = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api/w/${slug}/bots`);
    await sidebar(page).getByRole("button", { name: "New bot", exact: true }).click();
    await newBotDialog(page).getByRole("textbox", { name: "Bot name" }).fill("Crew");
    await newBotDialog(page).getByRole("button", { name: "Create" }).click();
    const { bot } = await (await created).json();
    expect(bot.sharing).toBe("shared");
    await expect(newBotDialog(page)).toBeHidden();
    await expect(tabs(page)).toHaveText(["General", "You only"]);
    await expect(tabs(page).last()).toHaveAttribute("aria-selected", "true");
    await page.screenshot({ path: testInfo.outputPath("new-bot-shared.png") });

    const home = await knex("workspaces").where({ slug }).first();
    const kept = await knex("bots").where({ workspace_id: home.id }).orderBy("id").select("name", "sharing", "is_main");
    expect(kept.find((row) => row.name === "Crew")?.sharing).toBe("shared");
    expect(kept.filter((row) => row.is_main).map((row) => row.sharing), "the home's main bot keeps its mode").toEqual(["mixed"]);

    // New bots Mixed, then a second person joins: the owner is asked once, at the top of the bot list.
    await knex("home_settings").where({ workspace_id: home.id }).update({ new_bot_sharing: "mixed" });
    const [joiner] = await knex("users").insert({
      auth_provider: "test", auth_provider_user_sid: `kim-${stamp}`, email: `kim-${stamp}@example.com`, username: `kim${stamp}`, display_name: "Kim"
    }).returning("id");
    joinerId = String(joiner.id);
    await knex("workspace_memberships").insert({ workspace_id: home.id, user_id: joinerId, role_sid: "member", status: "active" });
    await page.reload();
    await pastIntro(page);
    const question = sidebar(page).getByRole("region", { name: "New bots in this home" });
    await expect(question).toContainText(
      "Kim joined. New bots here are Mixed: each person's own chat, plus the home's notebook. Make new bots Shared, for the whole home?"
    );
    await expect(question).toContainText("Bots you already have keep their mode");
    await page.screenshot({ path: testInfo.outputPath("team-question.png") });
    const answered = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/w/${slug}/home-settings/team-question`);
    await question.getByRole("button", { name: "Keep Mixed" }).click();
    expect((await answered).ok()).toBe(true);
    await expect(question).toHaveCount(0);
    expect((await knex("home_settings").where({ workspace_id: home.id }).first()).team_question_answered_at).not.toBeNull();
    expect((await knex("bots").where({ id: bot.id }).first()).sharing, "answering changes no bot").toBe("shared");
    await page.reload();
    await pastIntro(page);
    await expect(sidebar(page).getByText("Kim joined.")).toHaveCount(0);

    // Settings → General, the home's part: the default, changed there.
    await page.keyboard.press("Control+k");
    await page.keyboard.type("Settings: General");
    await page.keyboard.press("Enter");
    const settings = page.getByRole("dialog", { name: "Settings" });
    const choice = settings.getByRole("button", { name: "New bots in this home" });
    await expect(choice).toHaveText("Mixed");
    await expect(settings.getByText("Bots you already have keep their mode; change one in its Details → Who sees what.")).toBeVisible();
    const changed = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/w/${slug}/home-settings`);
    await choice.click();
    await page.getByRole("listbox", { name: "New bots in this home" }).getByRole("option", { name: /^Private/u }).click();
    expect((await (await changed).json()).newBotSharing).toBe("private");
    await expect(choice).toHaveText("Private");
    await page.screenshot({ path: testInfo.outputPath("settings-new-bots.png") });
    expect((await knex("home_settings").where({ workspace_id: home.id }).first()).new_bot_sharing).toBe("private");
  } finally {
    if (page.url() !== "about:blank") await page.goto("about:blank");
    if (slug) {
      const home = await knex("workspaces").where({ slug }).first();
      if (home) {
        await knex("bots").where({ workspace_id: home.id }).del();
        await knex("workspace_settings").where({ workspace_id: home.id }).del();
        await knex("workspace_memberships").where({ workspace_id: home.id }).del();
        await knex("workspaces").where({ id: home.id }).del();
      }
    }
    if (joinerId) await knex("users").where({ id: joinerId }).del();
    await knex.destroy();
  }
});
