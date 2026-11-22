import type { TestInfo } from "@playwright/test";
import { connectTestDb, expect, HOME, homeApi, openShell, shell, sidebarEntry, test, type Page } from "./harness";

// A home's templates made and changed by drafting (D-98, amended 20 November; D-109): Add bots' new bot suggested for
// what One bot's search found nothing for, its template changed on Edit, and added to the home's Bots; Change template's Start
// from this bot, on the bot's card beside its direct chat; and Settings → Templates' Edit and Delete. The target's AI is
// the stand-in model (tools/standInModel.mjs), which answers a drafting call with a fixed draft: a suggested bot's from
// its name, tag and job, one from a bot's own template (its additions folded in when asked), and a change as the
// request appended to the instructions; it suggests one new bot named after a request's last word.
// Each test makes its own bots and templates in the owner's fixture home and deletes them. Run with:
// vibe64-helper playwright --target test-app test tests/e2e/template-drafts.spec.ts
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

type Draft = { tag: string; description: string; greeting: string; instructions: string; skills: Array<{ name: string; description: string; instructions: string }> };
const card = (page: Page, name: string) => shell.details(page, `${name}'s card`);
const drafted = (page: Page) => page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api${HOME}/bots/templates/draft`);
const stamp = () => Date.now().toString(36).slice(-5);

/** After a test: its bots, then its home's templates with these tags (another test's stay). */
async function cleanUp(page: Page, botIds: string[], tags: string[]) {
  if (page.url() !== "about:blank") await page.goto("about:blank");
  const api = await homeApi(page);
  for (const id of botIds) await api.del(`/bots/${id}`);
  const { templates } = await api.get("/home-templates");
  for (const template of templates.filter((entry: { tag: string }) => tags.includes(entry.tag))) await api.del(`/home-templates/${template.id}`);
}

/**
 * A bot made through the API, on `template` when given, else Mercbot's General helper; its direct chat with the
 * person, where it starts, past its introduction.
 */
async function makeBot(page: Page, name: string, template?: unknown) {
  const { bot } = await (await homeApi(page)).post("/bots", { name, color: "#1E86FC", ...(template ? { template } : {}) });
  const knex = connectTestDb();
  try {
    await knex("conversations").where({ direct_bot_id: bot.id }).update({ onboarding_step: null });
  } finally {
    await knex.destroy();
  }
  return { id: String(bot.id), name };
}

const shot = (page: Page, info: TestInfo, name: string) => page.screenshot({ path: info.outputPath(name) });

test("Add bots: Describe the bot you need, then Edit its template: Ask for changes, Undo, Use this; Add makes the template and the bot", async ({ page }, info) => {
  const botIds: string[] = [];
  let first: Draft | null = null;
  try {
    await openShell(page);
    await shell.section(page, "Bots").getByRole("button", { name: "Add bots", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add bots" });
    await dialog.getByRole("button", { name: /^One bot/u }).click();
    await expect(dialog.getByText("What will it do?")).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^General helper/u }), "the quick all-round choice leads").toBeVisible();
    await shot(page, info, "new-bot-what-will-it-do.png");

    // Nothing fits: the search's words go to Describe what you need, and the stand-in suggests one new bot for them.
    const sentence = `${stamp()} look after the koi pond`;
    await dialog.getByRole("searchbox", { name: "Search templates" }).fill(sentence);
    await dialog.getByRole("button", { name: "Describe the bot you need" }).click();
    await expect(dialog.getByRole("textbox", { name: "Describe what you need" })).toHaveValue(sentence);
    const answer = drafted(page);
    await dialog.getByRole("button", { name: "Suggest bots" }).click();
    const asked = (await answer).request().postDataJSON();
    expect([asked.purpose, asked.describe, asked.bot.name, asked.team]).toEqual(["plan-bot", sentence, "Pond", []]);
    first = ((await (await answer).json()) as { draft: Draft }).draft;
    expect(first.tag).toBe(asked.bot.tag);
    await dialog.getByRole("button", { name: "Edit" }).click();
    const instructions = dialog.getByRole("textbox", { name: "Instructions" });
    await expect(dialog.getByRole("textbox", { name: "Tag" })).toHaveValue(first.tag);
    await expect(instructions).toHaveValue(first.instructions);
    await expect(dialog.getByRole("textbox", { name: "Setup questions" })).toHaveValue(first.skills[0].instructions);

    // One call with the whole draft and the request; what changed is highlighted, word by word in the instructions.
    await dialog.getByRole("textbox", { name: "What should change?" }).fill("Feed the fish on Fridays too.");
    const changed = drafted(page);
    await dialog.getByRole("button", { name: "Ask for changes" }).click();
    expect((await changed).request().postDataJSON()).toEqual({ purpose: "change", draft: first, request: "Feed the fish on Fridays too." });
    await expect(dialog.getByText("1 change", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("What changed in Instructions").locator("ins")).toHaveText("Feed the fish on Fridays too.");
    await expect(instructions).toHaveValue(`${first.instructions}\n\nFeed the fish on Fridays too.`);
    await dialog.getByLabel("What changed in Instructions").scrollIntoViewIfNeeded();
    await shot(page, info, "new-bot-draft-changed.png");

    // Undo goes back to the draft before, on the page alone.
    let calls = 0;
    page.on("request", (request) => { if (request.url().includes("/templates/draft")) calls += 1; });
    await dialog.getByRole("button", { name: "Undo" }).click();
    await expect(instructions).toHaveValue(first.instructions);
    await expect(dialog.getByRole("button", { name: "Undo" })).toHaveCount(0);
    expect(calls, "Undo asks nothing").toBe(0);

    await dialog.getByRole("button", { name: "Use this" }).click();
    await expect(dialog.getByRole("checkbox", { name: "Add Pond" })).toBeChecked();
    const created = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api${HOME}/bots/batch`);
    await dialog.getByRole("button", { name: "Add 1 bot" }).click();
    const sent = (await created).request().postDataJSON();
    expect(sent, "no section").not.toHaveProperty("section");
    expect(sent.bots.map((bot: { draft: Draft }) => bot.draft)).toEqual([first]);
    const result = await (await created).json();
    botIds.push(...result.added.map(String));
    const bot = result.bots.find((entry: { id: string }) => String(entry.id) === String(result.added[0]));
    expect(bot.template).toEqual({ tag: first.tag, source: "home", description: first.description });
    await expect(dialog).toBeHidden();
    // It joins the sidebar's Bots, on its new template (above), with no chat of its own (D-112).
    await sidebarEntry(page, "Bots", "Pond");
    const chats = (await (await homeApi(page)).get("/chats?hidden=1&archived=1")).chats;
    expect(chats.filter((chat: { directBotId?: string | null }) => String(chat.directBotId) === String(bot.id)), "no chat of its own").toEqual([]);
  } finally {
    await cleanUp(page, botIds, first ? [first.tag] : []);
  }
});

test("Change template: Start from this bot drafts from it, folds its additions in when ticked, and Save and use points it there", async ({ page }, info) => {
  const bot = await makeBot(page, `Quill ${stamp()}`);
  const tags: string[] = [];
  try {
    await (await homeApi(page)).patch(`/bots/${bot.id}`, { additions: "We're vegetarian." });
    await openShell(page, `?bot=${bot.id}`);
    await shell.chat(page).getByRole("button", { name: `${bot.name} details` }).click();
    await card(page, bot.name).getByRole("tab", { name: "Details" }).click();
    await card(page, bot.name).getByRole("button", { name: "Change template" }).click();
    const dialog = page.getByRole("dialog", { name: `Change ${bot.name}'s template` });
    const answer = drafted(page);
    await dialog.getByRole("button", { name: "Start from this bot" }).click();
    const asked = (await answer).request().postDataJSON();
    expect([asked.purpose, String(asked.botId), asked.foldAdditions]).toEqual(["from-bot", bot.id, false]);
    const plain = ((await (await answer).json()) as { draft: Draft }).draft;
    tags.push(plain.tag);
    const instructions = dialog.getByRole("textbox", { name: "Instructions" });
    await expect(instructions).toHaveValue(plain.instructions);
    expect(plain.instructions).not.toContain("We're vegetarian.");

    const folded = drafted(page);
    await dialog.getByRole("checkbox", { name: `Fold in ${bot.name}'s additions` }).check();
    const askedAgain = (await folded).request().postDataJSON();
    expect([askedAgain.purpose, String(askedAgain.botId), askedAgain.foldAdditions]).toEqual(["from-bot", bot.id, true]);
    const draft = ((await (await folded).json()) as { draft: Draft }).draft;
    await expect(instructions).toHaveValue(/We're vegetarian\.$/u);
    await shot(page, info, "change-template-start-from-bot.png");

    const saved = page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname.endsWith(`/bots/${bot.id}/template`));
    await dialog.getByRole("button", { name: "Save and use" }).click();
    expect((await saved).request().postDataJSON()).toEqual({ draft, foldAdditions: true });
    const changed = (await (await saved).json()).bot;
    expect([changed.template.tag, changed.template.source, changed.hasAdditions]).toEqual([draft.tag, "home", false]);
    await expect(dialog).toBeHidden();
    // It says so in the person's direct chat with it, the chat open here.
    await expect(shell.chat(page).getByText(`Now a ${draft.tag} bot`)).toBeVisible();
  } finally {
    await cleanUp(page, [bot.id], tags);
  }
});

test("Settings → Templates: Edit saves after its warning and records the change; Delete only once no bot uses it", async ({ page }, info) => {
  const tag = `p${stamp()}`;
  const body: Draft = {
    tag,
    description: "Keeps the pond clean.",
    greeting: "Hi {firstName}, I keep your pond clean.",
    instructions: "You keep the pond clean.",
    skills: [{ name: "Setup interview", description: "What to ask first.", instructions: "1. Ask how big the pond is." }]
  };
  const bot = await makeBot(page, `Pond ${stamp()}`, { draft: body });
  const botIds = [bot.id];
  try {
    await openShell(page, "?settings=templates");
    const settings = page.getByRole("dialog", { name: "Settings" });
    const row = settings.getByRole("listitem").filter({ hasText: tag });
    await expect(row).toContainText("Used by 1 bot");
    await expect(row).toContainText("Keeps the pond clean.");
    await expect(row.getByRole("button", { name: `Delete ${tag}` }), "a template a bot uses can't be deleted").toBeDisabled();
    await shot(page, info, "settings-templates.png");

    await row.getByRole("button", { name: `Edit ${tag}` }).click();
    const editor = page.getByRole("dialog", { name: `Edit ${tag}` });
    await editor.getByRole("textbox", { name: "Instructions" }).fill("You keep the pond clean and the fish fed.");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Changes reach 1 bot from its next reply.")).toBeVisible();
    await shot(page, info, "settings-templates-save-warning.png");
    const saved = page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname.includes("/home-templates/"));
    await page.locator(".mb-confirm").getByRole("button", { name: "Save" }).click();
    expect((await saved).request().postDataJSON().draft.instructions).toBe("You keep the pond clean and the fish fed.");
    expect((await (await saved).json()).changed).toEqual(["instructions"]);
    await expect(editor).toBeHidden();
    const read = await (await homeApi(page)).get(`/bots/${bot.id}/instructions`);
    expect(read.template.instructions).toBe("You keep the pond clean and the fish fed.");
    expect(read.template.changed.text).toMatch(/^Instructions changed by /u);

    // Once no bot uses it, Delete asks, then it's gone.
    await page.goto("about:blank");
    await (await homeApi(page)).del(`/bots/${bot.id}`);
    botIds.length = 0;
    await openShell(page, "?settings=templates");
    const unused = page.getByRole("dialog", { name: "Settings" }).getByRole("listitem").filter({ hasText: tag });
    await expect(unused).toContainText("Used by 0 bots");
    await unused.getByRole("button", { name: `Delete ${tag}` }).click();
    const removed = page.waitForResponse((response) => response.request().method() === "DELETE" && new URL(response.url()).pathname.includes("/home-templates/"));
    await page.locator(".mb-confirm").getByRole("button", { name: "Delete" }).click();
    expect((await removed).ok()).toBe(true);
    await expect(unused).toHaveCount(0);
  } finally {
    await cleanUp(page, botIds, [tag]);
  }
});
