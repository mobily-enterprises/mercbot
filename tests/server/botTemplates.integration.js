import assert from "node:assert/strict";
import test, { after } from "node:test";
import { templateOf } from "../../packages/bots/src/server/botTemplate.js";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { seedChat } from "../support/chatFixtures.mjs";
import { seedHome, startSurfaces } from "./surfaceKit.mjs";

// Bot templates (D-43, D-98) on chats (D-112): the curated gallery, a bot made with New bot or added from a template,
// a template a link opens, and changing the template a bot points at. A new bot is a member of the home that greets
// its maker in their direct chat with it; a changed one says so in the changer's.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const knex = await connectTestDatabase();
after(() => knex.destroy());

// Two of Connect apps' entries, as the catalogue gives them: one with an open-set logo, one with its maker's own icon.
const APPS = {
  "google-calendar": { id: "google-calendar", name: "Google Calendar", logo: "googlecalendar" },
  outlook: { id: "outlook", name: "Outlook", logoImage: "/api/plugins/outlook/logo.png" }
};
const integrations = { app: (id) => APPS[id] || null };
// A template's page is public: a visitor who hasn't signed in reads it too.
const visitor = requestContextOptions({});

/** The person's direct chat with a bot and its messages, oldest first. */
async function directOf(person, botId) {
  const chat = await knex("conversations").where({ direct_user_id: person, direct_bot_id: botId }).first();
  const messages = chat ? await knex("messages").where({ conversation_id: chat.id }).orderBy("id") : [];
  return { chat, messages };
}

test("the gallery lists Mercbot's own templates, and a template's page shows all it gives a bot", async (context) => {
  const kit = await startSurfaces(knex, context, { integrations });
  const gallery = kit.templates.templateGallery();
  assert.ok(gallery.templates.length >= 1);
  assert.ok(gallery.templates.every((entry) => entry.creator === "the Mercbot team" && entry.team === true), "curated: the team's only");
  assert.equal(gallery.templates.some((entry) => "instructions" in entry), false, "the list carries summaries only");
  const planner = await kit.templates.templateDetails("weekly-meal-planner", visitor);
  assert.equal(planner.name, "Pantry");
  assert.match(planner.instructions, /allerg/u);
  assert.ok(planner.skills.every((skill) => skill.steps.length > 20), "every skill's full steps (D-43)");
  assert.deepEqual(planner.apps, [{ id: "google-calendar", name: "Google Calendar" }, { id: "outlook", name: "Outlook", logoImage: "/api/plugins/outlook/logo.png" }]);
  await assert.rejects(kit.templates.templateDetails("no-such-template", visitor), /no bot template/u);
});

test("adding from a template makes a member of the home pointing at it, greeting its maker in their direct chat", async (context) => {
  const kit = await startSurfaces(knex, context, { integrations });
  const { homeId, anna, ben, as } = await seedHome(knex, context);
  const bot = await kit.templates.addFromTemplate("weekly-meal-planner", "Anna Rossi", as("anna"));
  assert.equal(bot.name, "Pantry");
  assert.deepEqual(bot.template, { tag: "meals", source: "library", description: bot.template.description });
  assert.deepEqual([bot.hasAdditions, bot.madeBy, bot.madeByName, bot.isMain, bot.archivedAt], [false, anna, "you", false, null]);
  const row = await knex("bots").where({ id: bot.id }).first();
  assert.deepEqual([row.library_template, row.home_template_id, row.additions], ["weekly-meal-planner", null, ""], "it points at the template; nothing is copied");
  assert.ok(row.template_since);
  assert.ok((await templateOf(row, kit.records.homeTemplates, as("anna"))).skills.length >= 2);

  const { chat, messages } = await directOf(anna, bot.id);
  assert.deepEqual([chat.kind, chat.onboarding_step, String(chat.workspace_id)], ["public", null, homeId], "its direct chat: Public (D15), no generic script");
  assert.deepEqual(messages.map((message) => message.kind), ["timestamp", "text"]);
  assert.match(messages[1].body.text, /^Hi(?: [^,]+)?, I'm Pantry\./u, "the template's greeting, with a first name or none");
  assert.doesNotMatch(messages[1].body.text, /\{firstName\}/u);
  assert.equal(String(messages[1].author_bot_id), bot.id, "the bot's own message");
  assert.equal((await knex("chat_bots").where({ bot_id: bot.id })).length, 1, "it's in no other chat");
  assert.equal(await knex("conversations").where({ direct_user_id: ben, direct_bot_id: bot.id }).first(), undefined, "Ben's chat with it comes on his [Message]");
  const heard = kit.calls.told.find((notice) => notice.event.type === "bot");
  assert.deepEqual([heard.event, heard.keys.sort()], [{ type: "bot", botId: bot.id, change: "created" }, [anna, ben].sort()]);
});

test("New bot makes a general bot that introduces itself, or one on the template chosen, greeting", async (context) => {
  const kit = await startSurfaces(knex, context, { integrations });
  const { anna, as } = await seedHome(knex, context);
  const general = await kit.templates.createBot({ name: "Juno", shape: "cloud", color: "#14C16F" }, as("anna"));
  assert.deepEqual([general.name, general.template.tag, general.madeBy], ["Juno", "general", anna]);
  const first = await directOf(anna, general.id);
  assert.equal(first.chat.onboarding_step, "intro-greet", "it introduces itself when Anna first opens it");
  assert.deepEqual(first.messages.map((message) => message.kind), ["timestamp"]);

  const chef = await kit.templates.createBot({ name: "Chef", shape: "cloud", color: "#14C16F", template: { library: "weekly-meal-planner" } }, as("anna"));
  const second = await directOf(anna, chef.id);
  assert.equal(second.chat.onboarding_step, null);
  assert.match(second.messages.at(-1).body.text, /I'm Chef\./u, "its template's greeting, as the bot it is");
  await assert.rejects(kit.templates.createBot({ name: "Odd", shape: "cloud", color: "#123456" }, as("anna")), { statusCode: 400, code: "bots_colour_unknown" });
  await assert.rejects(kit.templates.createBot({ name: " ", shape: "cloud", color: "#14C16F" }, as("anna")), { statusCode: 400, code: "bots_name_missing" });
});

test("a template a link opens is found through the templates links open, and adding from it makes a home template", async (context) => {
  const asked = [];
  const linked = {
    slug: "a1b2c3", name: "Pantry", color: "#14C16F", shape: "puff", description: "Plans meals.", creator: "The Mercbot Team",
    greeting: "", instructions: "Plan the evening meals.", skills: [], routines: [], apps: [], updatedAt: "2026-11-12T10:00:00.000Z"
  };
  const templateLinks = { find: async (code, options) => (asked.push([code, Boolean(options.context)]), code === linked.slug ? linked : null) };
  const kit = await startSurfaces(knex, context, { integrations, templateLinks });
  const { anna, as } = await seedHome(knex, context);
  assert.equal((await kit.templates.templateDetails("pantry", visitor)).slug, "weekly-meal-planner", "a template's bot name works in its address");
  const shown = await kit.templates.templateDetails("a1b2c3", visitor);
  assert.deepEqual([shown.name, shown.creator, "team" in shown, shown.tested, shown.updatedAt], ["Pantry", "The Mercbot Team", false, null, linked.updatedAt]);
  assert.equal(kit.templates.templateGallery().templates.some((entry) => entry.slug === "a1b2c3"), false, "never listed in the gallery");
  await assert.rejects(kit.templates.templateDetails("no-such-link", visitor), { statusCode: 404, code: "bots_template_not_found" });
  const bot = await kit.templates.addFromTemplate("a1b2c3", "Anna", as("anna"));
  assert.deepEqual([bot.name, bot.template.source, bot.template.tag, bot.template.description], ["Pantry", "home", "pantry", "Plans meals."]);
  assert.deepEqual(asked, [["a1b2c3", true], ["no-such-link", true], ["a1b2c3", true]], "asked only for codes that aren't Mercbot's own");
  const row = await knex("bots").where({ id: bot.id }).first();
  const home = await knex("home_templates").where({ id: row.home_template_id }).first();
  assert.deepEqual([String(home.workspace_id), home.tag, home.instructions, String(home.created_by)], [String(row.workspace_id), "pantry", "Plan the evening meals.", anna]);
  const again = await kit.templates.addFromTemplate("a1b2c3", "Anna", as("anna"));
  assert.equal(again.template.tag, "pantry2", "a second one gets a free tag of its own");
  const listed = (await kit.templates.homeTemplates(as("anna"))).templates.filter((entry) => ["pantry", "pantry2"].includes(entry.tag));
  assert.deepEqual(listed.map((entry) => [entry.tag, entry.usedBy]), [["pantry", 1], ["pantry2", 1]]);
});

test("without the templates links open, a code that's none of Mercbot's own is no template", async (context) => {
  const kit = await startSurfaces(knex, context, { integrations });
  await assert.rejects(kit.templates.templateDetails("a1b2c3", visitor), { statusCode: 404, code: "bots_template_not_found" });
});

test("changing a bot's template keeps its name, look and additions, and the bot says so in the changer's chat with it", async (context) => {
  const kit = await startSurfaces(knex, context, { integrations });
  const { homeId, anna, ben, as, bot } = await seedHome(knex, context);
  const helper = await bot("Kitchen helper", { additions: "We're vegetarian.", made_by: ben });
  const kitchen = await seedChat(knex, { homeId, title: "Kitchen", people: [anna, ben], bots: [helper] });

  const changed = await kit.templates.changeTemplate(helper, { library: "weekly-meal-planner" }, "Ben Rossi", as("ben"));
  assert.deepEqual([changed.name, changed.color, changed.template.tag, changed.template.source, changed.hasAdditions], ["Kitchen helper", "#1E86FC", "meals", "library", true]);
  const row = await knex("bots").where({ id: helper }).first();
  assert.deepEqual([row.library_template, row.home_template_id, row.additions], ["weekly-meal-planner", null, "We're vegetarian."], "its additions stay");
  const { messages } = await directOf(ben, helper);
  const [event, greeting] = messages.slice(-2);
  assert.deepEqual([event.kind, event.body.text], ["event", "Now a meals bot"]);
  assert.equal(event.body.detail, "Kitchen helper now follows Mercbot's meals template, with its own additions on top.");
  assert.match(greeting.body.text, /^Hi(?: [^,]+)?, I'm Kitchen helper\. I plan your family's dinners/u, "the new template's greeting, as the bot it is");
  assert.equal((await knex("messages").where({ conversation_id: kitchen.id })).length, 0, "the home's other chats are left alone");
  assert.ok(kit.calls.told.some((notice) => notice.event.type === "bot" && notice.event.botId === helper && notice.event.change === "changed"));
  const read = await kit.templates.instructionsOf(helper, as("ben"));
  assert.deepEqual([read.template.tag, read.template.slug, read.additions, read.canChange], ["meals", "weekly-meal-planner", "We're vegetarian.", true]);

  // Choosing the template it has changes nothing and says nothing.
  const count = messages.length;
  await kit.templates.changeTemplate(helper, { library: "weekly-meal-planner" }, "Ben Rossi", as("ben"));
  assert.equal((await directOf(ben, helper)).messages.length, count);

  // A home template, by its id.
  const [home] = await knex("home_templates")
    .insert({ workspace_id: homeId, tag: `kit${Date.now() % 100000}`, description: "Our kitchen.", instructions: "Plan our dinners.", created_by: anna })
    .returning("*");
  const toHome = await kit.templates.changeTemplate(helper, { home: String(home.id) }, "Anna", as("anna"));
  assert.deepEqual([toHome.template.source, toHome.template.tag], ["home", home.tag]);
  assert.equal((await kit.templates.homeTemplate(String(home.id), as("anna"))).usedBy, 1);
});

test("Change template refuses another member, another home's template or bot, a template that isn't there and no choice", async (context) => {
  const kit = await startSurfaces(knex, context, { integrations });
  const { as, bot } = await seedHome(knex, context);
  const guarded = await bot("Guarded");
  await assert.rejects(kit.templates.changeTemplate(guarded, { library: "weekly-meal-planner" }, "Ben", as("ben")), (error) => {
    assert.deepEqual([error.statusCode, error.code], [403, "bots_template_forbidden"]);
    assert.equal(error.message, "Only the person who made Guarded and the home's owners and admins can change its template or additions.");
    return true;
  });
  assert.equal((await kit.templates.instructionsOf(guarded, as("ben"))).canChange, false);

  const other = await seedHome(knex, context);
  const [theirs] = await knex("home_templates")
    .insert({ workspace_id: other.homeId, tag: "theirs", description: "Theirs.", instructions: "Their rules.", created_by: other.anna })
    .returning("id");
  const theirsId = String(theirs.id ?? theirs);
  await assert.rejects(kit.templates.changeTemplate(guarded, { home: theirsId }, "Anna", as("anna")), { statusCode: 404, code: "bots_template_not_found" });
  await assert.rejects(kit.templates.homeTemplate(theirsId, as("anna")), { statusCode: 404, code: "bots_template_not_found" });
  await assert.rejects(kit.templates.changeTemplate(guarded, { library: "weekly-meal-planner" }, "Anna", other.as("anna")), { statusCode: 404, code: "bots_bot_not_found" });
  await assert.rejects(kit.templates.changeTemplate(guarded, { library: "no-such-template" }, "Anna", as("anna")), { statusCode: 404, code: "bots_template_not_found" });
  await assert.rejects(kit.templates.changeTemplate(guarded, {}, "Anna", as("anna")), { statusCode: 400, code: "bots_template_missing_choice" });
  // A body a client wrote is never a template: only a choice of one.
  await assert.rejects(kit.templates.changeTemplate(guarded, { instructions: "Mine." }, "Anna", as("anna")), { statusCode: 400, code: "bots_template_missing_choice" });
  assert.deepEqual(await knex("bots").where({ id: guarded }).first("library_template", "home_template_id"), { library_template: "general", home_template_id: null }, "nothing changed");
});

test("the Team list and one bot cost the same with 4 bots on templates as with 60", async (context) => {
  const kit = await startSurfaces(knex, context, { integrations });
  const { homeId, anna, as, bot } = await seedHome(knex, context);
  const made = [];
  const grow = async (size) => {
    const templates = await knex("home_templates")
      .insert(Array.from({ length: size - made.length }, (_, index) => ({
        workspace_id: homeId, tag: `n${String(made.length + index).padStart(3, "0")}`, description: "Counted.", instructions: "Count.", created_by: anna
      })))
      .returning("id");
    for (const [index, template] of templates.entries()) {
      // Every other one of Mercbot's library, the rest their home's own.
      const pointer = index % 2 ? { library_template: "weekly-meal-planner" } : { library_template: null, home_template_id: template.id };
      made.push(await bot(`Counted ${made.length}`, pointer));
    }
  };
  const measured = async (size) => {
    await grow(size);
    let list = null;
    const all = await queriesDuring(knex, async () => { list = await kit.botList.listBots(as("anna")); });
    const one = await queriesDuring(knex, () => kit.botList.listedBot(made.at(-2), as("anna")));
    assert.equal(list.bots.length, size);
    assert.ok(list.bots.every((entry) => entry.template?.tag), "every one shows its template's tag");
    return { all, one };
  };
  await measured(3);
  const few = await measured(4);
  const many = await measured(60);
  assert.deepEqual(many, few, `with 60 bots: ${JSON.stringify(many)} queries, with 4: ${JSON.stringify(few)}`);
});
