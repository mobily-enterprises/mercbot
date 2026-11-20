import type { TestInfo } from "@playwright/test";
import knexLib from "knex";
import { expect, test, testDatabaseName, type Page } from "./harness";

// A home's templates made and changed by drafting (D-98, amended 20 November): New bot's Make a new template, Change
// template's Start from this bot, and Settings → Templates' Edit and Delete. The target's AI is the stand-in model
// (tools/standInModel.mjs), which answers a drafting call with a fixed draft: a new template from the sentence, one from
// a bot's own template (its additions folded in when asked), and a change as the request appended to the instructions.
// Each test makes its own bots and templates in the owner's fixture home and deletes them. Run with:
// vibe64-helper playwright --target test-app test tests/e2e/template-drafts.spec.ts
const HOME = "/w/you";
// Any refused API call from the page, one with no answer, or JSKIT's error dialog, fails the test (harness.ts).
test.use({ apiGuard: true });

type Draft = { tag: string; description: string; greeting: string; instructions: string; skills: Array<{ name: string; description: string; instructions: string }> };
const chat = (page: Page) => page.getByRole("main", { name: "Chat" });
const details = (page: Page) => page.getByRole("complementary", { name: "Details" });
const drafted = (page: Page) => page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api${HOME}/bots/templates/draft`);
const stamp = () => Date.now().toString(36).slice(-5);

/** Mercbot's home, past the first-run introduction a new account sees once; `query` opens something with it. */
async function openHome(page: Page, query = "") {
  await page.goto(`${HOME}${query}`);
  const next = page.locator(".mb-intro").getByRole("button", { name: "Next" });
  const shell = page.locator(".mb-shell");
  await expect(shell.or(next).first()).toBeVisible();
  if (await next.isVisible()) {
    for (let slide = 0; slide < 3; slide += 1) await next.click();
  }
  await expect(shell).toBeVisible();
}

/** The API, as the page's own person: its CSRF token read once. */
async function api(page: Page) {
  const { csrfToken } = await (await page.request.get("/api/session")).json();
  const headers = { "csrf-token": csrfToken as string };
  return {
    post: (path: string, data: unknown) => page.request.post(`/api${HOME}${path}`, { data, headers }),
    patch: (path: string, data: unknown) => page.request.patch(`/api${HOME}${path}`, { data, headers }),
    remove: (path: string) => page.request.delete(`/api${HOME}${path}`, { headers }),
    get: async (path: string) => (await page.request.get(`/api${HOME}${path}`)).json()
  };
}

/** After a test: its bots, then its home's templates with these tags (another test's stay). */
async function cleanUp(page: Page, botIds: string[], tags: string[]) {
  if (page.url() !== "about:blank") await page.goto("about:blank");
  const call = await api(page);
  for (const id of botIds) expect((await call.remove(`/bots/${id}`)).ok()).toBe(true);
  const { templates } = await call.get("/home-templates");
  for (const template of templates.filter((entry: { tag: string }) => tags.includes(entry.tag))) {
    expect((await call.remove(`/home-templates/${template.id}`)).ok()).toBe(true);
  }
}

/** A bot made through the API, past its introduction: on `template` when given, else Mercbot's General helper. */
async function makeBot(page: Page, name: string, template?: unknown) {
  const answer = await (await api(page)).post("/bots", { name, color: "#1E86FC", ...(template ? { template } : {}) });
  expect(answer.ok()).toBe(true);
  const { bot } = await answer.json();
  const knex = knexLib({ client: "pg", connection: { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: testDatabaseName() } });
  try {
    await knex("bot_conversations").where({ bot_id: bot.id }).update({ onboarding_step: null });
  } finally {
    await knex.destroy();
  }
  return { id: String(bot.id), name };
}

const shot = (page: Page, info: TestInfo, name: string) => page.screenshot({ path: info.outputPath(name) });

test("New bot: Make a new template, Draft it, Ask for changes, Undo, then Save and use makes the template and the bot", async ({ page }, info) => {
  const botIds: string[] = [];
  let first: Draft | null = null;
  try {
    await openHome(page);
    await page.getByRole("navigation", { name: "Bots" }).getByRole("button", { name: "New bot", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New bot" });
    await expect(dialog.getByText("What will it do?")).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^General helper/u }), "the quick all-round choice leads").toBeVisible();
    await shot(page, info, "new-bot-what-will-it-do.png");
    await dialog.getByRole("button", { name: "Make a new template" }).click();

    const sentence = `water ${stamp()} garden plants and the pond each week`;
    await dialog.getByRole("textbox", { name: "What will bots with this template do?" }).fill(sentence);
    const answer = drafted(page);
    await dialog.getByRole("button", { name: "Draft it" }).click();
    expect((await answer).request().postDataJSON()).toEqual({ purpose: "new", describe: sentence });
    first = ((await (await answer).json()) as { draft: Draft }).draft;
    const instructions = dialog.getByRole("textbox", { name: "Instructions" });
    await expect(dialog.getByRole("textbox", { name: "Tag" })).toHaveValue(first.tag);
    await expect(instructions).toHaveValue(first.instructions);
    await expect(dialog.getByRole("textbox", { name: "Setup questions" })).toHaveValue(first.skills[0].instructions);

    // One call with the whole draft and the request; what changed is highlighted, word by word in the instructions.
    await dialog.getByRole("textbox", { name: "What should change?" }).fill("Water on Fridays too.");
    const changed = drafted(page);
    await dialog.getByRole("button", { name: "Ask for changes" }).click();
    expect((await changed).request().postDataJSON()).toEqual({ purpose: "change", draft: first, request: "Water on Fridays too." });
    await expect(dialog.getByText("1 change", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("What changed in Instructions").locator("ins")).toHaveText("Water on Fridays too.");
    await expect(instructions).toHaveValue(`${first.instructions}\n\nWater on Fridays too.`);
    await dialog.getByLabel("What changed in Instructions").scrollIntoViewIfNeeded();
    await shot(page, info, "new-bot-draft-changed.png");

    // Undo goes back to the draft before, on the page alone.
    let asked = 0;
    page.on("request", (request) => { if (request.url().includes("/templates/draft")) asked += 1; });
    await dialog.getByRole("button", { name: "Undo" }).click();
    await expect(instructions).toHaveValue(first.instructions);
    await expect(dialog.getByRole("button", { name: "Undo" })).toHaveCount(0);
    expect(asked, "Undo asks nothing").toBe(0);

    await dialog.getByRole("button", { name: "Save and use" }).click();
    await expect(dialog.getByText(`On ${first.tag}, a new template of your home's`)).toBeVisible();
    await dialog.getByRole("textbox", { name: "Bot name" }).fill(`Gardener ${stamp()}`);
    const created = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `/api${HOME}/bots`);
    await dialog.getByRole("button", { name: "Create" }).click();
    expect((await created).request().postDataJSON().template).toEqual({ draft: first });
    const { bot } = await (await created).json();
    botIds.push(String(bot.id));
    expect(bot.template).toEqual({ tag: first.tag, source: "home", description: first.description });
    await expect(dialog).toBeHidden();
    await expect(chat(page)).toContainText("I'm here to help with this job.");
  } finally {
    await cleanUp(page, botIds, first ? [first.tag] : []);
  }
});

test("Change template: Start from this bot drafts from it, folds its additions in when ticked, and Save and use points it there", async ({ page }, info) => {
  const bot = await makeBot(page, `Quill ${stamp()}`);
  const tags: string[] = [];
  try {
    expect((await (await api(page)).patch(`/bots/${bot.id}`, { additions: "We're vegetarian." })).ok()).toBe(true);
    await openHome(page, `?bot=${bot.id}`);
    await chat(page).getByRole("button", { name: `${bot.name} details` }).click();
    await details(page).getByRole("button", { name: "Change template" }).click();
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
    await expect(chat(page).getByText(`Now a ${draft.tag} bot`)).toBeVisible();
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
    await openHome(page, "?settings=templates");
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
    const read = await (await api(page)).get(`/bots/${bot.id}/instructions`);
    expect(read.template.instructions).toBe("You keep the pond clean and the fish fed.");
    expect(read.template.changed.text).toMatch(/^Instructions changed by /u);

    // Once no bot uses it, Delete asks, then it's gone.
    await page.goto("about:blank");
    expect((await (await api(page)).remove(`/bots/${bot.id}`)).ok()).toBe(true);
    botIds.length = 0;
    await openHome(page, "?settings=templates");
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
