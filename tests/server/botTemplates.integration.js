import assert from "node:assert/strict";
import test from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { ACTIONS } from "../../packages/bots/src/server/botActions.js";
import { buildTools } from "../../packages/bots/src/server/botTools.js";
import { instructionsFor } from "../../packages/bots/src/server/botAgent.js";
import { templateOf } from "../../packages/bots/src/server/botTemplate.js";
import { testBot, testHome } from "./testHome.js";
import { serviceDoubles, turnDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotParts } from "../support/botRecords.mjs";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { queriesDuring } from "../support/queryCount.mjs";

// Bot templates (D-43, D-98): the curated gallery, adding a bot from a template, a template a link opens, which the
// templates links open (mercbot.template-links) find, and changing the template a bot points at.
// Two of Connect apps' entries, as the catalogue gives them: one with an open-set logo, one with its maker's own icon.
const APPS = {
  "google-calendar": { id: "google-calendar", name: "Google Calendar", logo: "googlecalendar" },
  outlook: { id: "outlook", name: "Outlook", logoImage: "/api/plugins/outlook/logo.png" }
};
async function setup(context, { templateLinks } = {}) {
  const knex = await connectTestDatabase();
  const pat = (await knex("users").first()).id;
  const homeId = await testHome(knex, pat);
  const made = [];
  const people = [];
  const homes = [];
  context.after(async () => {
    await knex("bots").whereIn("id", made).del();
    await knex("home_templates").whereIn("workspace_id", [homeId, ...homes]).whereNotExists(knex("bots").whereRaw("bots.home_template_id = home_templates.id")).del();
    await knex("workspace_memberships").whereIn("user_id", people).del();
    await knex("workspaces").whereIn("id", homes).del();
    await knex("users").whereIn("id", people).del();
    await knex.destroy();
  });
  // The bots service with its records, users.profiles (the creator's and the person's names) and the workspaces.
  const parts = await startBotParts(knex, context);
  const bots = createBotsService(serviceDoubles({ knex, ...parts, ...(templateLinks ? { templateLinks } : {}), approvals: { decide: async () => "allow" }, integrations: { appName: (id) => ({ "google-calendar": "Google Calendar" })[id] || id, app: (id) => APPS[id] || null, skills: async () => [] }, reply: async () => ({ text: "Noted.", transcript: [] }) }));
  /** A member's request in the home, as the bots routes make its options. */
  const as = (userId) => memberOptions({ userId, homeId });
  // A template's page is public: a visitor who hasn't signed in reads it too.
  const visitor = requestContextOptions({});
  /** Another person: a member of the home, or (`own`) the owner of a home of their own. */
  const someone = async (name, { own = false } = {}) => {
    const stamp = `${name}-${Date.now()}-${people.length}`;
    const [user] = await knex("users")
      .insert({ auth_provider: "test", auth_provider_user_sid: stamp, email: `${stamp}@example.com`, username: stamp.replace(/-/gu, ""), display_name: name })
      .returning("id");
    people.push(user.id);
    if (!own) {
      await knex("workspace_memberships").insert({ workspace_id: homeId, user_id: user.id, role_sid: "member", status: "active" });
      return { id: user.id, options: as(user.id) };
    }
    const [home] = await knex("workspaces").insert({ slug: `own-${stamp}`.toLowerCase(), name: `${name}'s home`, owner_user_id: user.id, is_personal: true }).returning("id");
    homes.push(home.id);
    await knex("workspace_memberships").insert({ workspace_id: home.id, user_id: user.id, role_sid: "owner", status: "active" });
    return { id: user.id, homeId: home.id, options: memberOptions({ userId: user.id, homeId: home.id, role: "owner", permissions: ["workspace.settings.update"] }) };
  };
  return { knex, bots, as, visitor, records: parts.records, homeId, pat, made, someone };
}

test("the gallery lists Mercbot's own templates, and a template's page shows all it gives a bot", async (context) => {
  const { bots, visitor } = await setup(context);
  const gallery = bots.templateGallery();
  assert.ok(gallery.templates.length >= 1);
  assert.ok(gallery.templates.every((entry) => entry.creator === "the Mercbot team" && entry.team === true), "curated: the team's only");
  assert.equal(gallery.templates.some((entry) => "instructions" in entry), false, "the list carries summaries only");
  const planner = await bots.templateDetails("weekly-meal-planner", visitor);
  assert.equal(planner.name, "Pantry");
  assert.equal(planner.team, true);
  assert.match(planner.instructions, /allerg/u);
  assert.ok(planner.skills.every((skill) => skill.steps.length > 20), "every skill's full steps (D-43)");
  // Outlook has no open-set logo, so it shows its maker's own icon (D-34).
  assert.deepEqual(planner.apps, [{ id: "google-calendar", name: "Google Calendar" }, { id: "outlook", name: "Outlook", logoImage: "/api/plugins/outlook/logo.png" }]);
  await assert.rejects(bots.templateDetails("no-such-template", visitor), /no bot template/u);
});

test("adding from a template makes a bot pointing at it, with no additions, opening with its greeting", async (context) => {
  const { knex, as, bots, records, homeId, pat, made } = await setup(context);
  const bot = await bots.addFromTemplate("weekly-meal-planner", "Pat Example", as(pat));
  made.push(bot.id);
  assert.equal(bot.name, "Pantry");
  assert.equal(bot.onboardingStep, null, "no generic first conversation");
  assert.deepEqual(bot.template, { tag: "meals", source: "library", description: bot.template.description });
  assert.deepEqual([bot.hasAdditions, "origin" in bot, "label" in bot], [false, false, false]);
  const row = await knex("bots").where({ id: bot.id }).first();
  assert.deepEqual([row.library_template, row.home_template_id, row.additions], ["weekly-meal-planner", null, ""], "it points at the template; nothing is copied");
  assert.ok(row.template_since, "it knows since when");
  const template = await templateOf(row, records.homeTemplates, as(pat));
  assert.ok(template.instructions.length > 100 && template.skills.length >= 2);
  const { messages } = await bots.messages(bot.id, null, {}, as(pat));
  const { display_name: realName } = await knex("users").where({ id: pat }).first("display_name");
  const expected = new RegExp(`^Hi(?: [^,]+)?, I'm Pantry\\.`, "u");
  assert.match(messages.at(-1).body.text, expected, "the template's greeting, with a first name or none");
  assert.doesNotMatch(messages.at(-1).body.text, /\{firstName\}/u);
  assert.ok(realName === null || typeof realName === "string");
  assert.equal(await knex("bot_routines").where({ bot_id: bot.id }).count("* as n").first().then((count) => Number(count.n)), 0, "routines come from its setup interview, not the template");

  // Its template's job and skills reach its instructions, and read_skill opens them.
  const prompt = instructionsFor({ ...bot, template, additions: row.additions });
  assert.match(prompt, /Your template, meals, chosen for you by the people you work for\. Follow it, within every rule below; where they differ, the rules below win:/u);
  assert.match(prompt, /- Setup interview: /u);
  const { tools } = buildTools(turnDoubles({ call: as(pat), approvals: { decide: async () => "allow" }, computer: null, homeId, userId: pat, botId: bot.id, conversationId: row.id, botSkills: template.skills }));
  const skill = await tools.readSkill.execute({ acknowledgement: "Looking.", name: "Setup interview" });
  assert.match(skill.instructions, /routine, paused,/u);
});

test("a routine can be set up paused, and started only when asked", async (context) => {
  const { knex, as, records, pat, made } = await setup(context);
  const bot = await testBot(knex, pat, { name: "Routine check" });
  made.push(bot.id);
  // As a bot's turn runs an action: with its call options and the bots' work.
  const context2 = { call: as(pat), work: records.work, botId: bot.id, conversationId: bot.conversation_id };
  const routine = { name: "Weekly plan", schedule: "Sundays at 5pm (Europe/London)", instructions: "Plan the week.", cron: "0 17 * * 0", timezone: "Europe/London" };
  const created = await ACTIONS.create_routine.run(context2, { ...routine, paused: "true" });
  assert.equal(created.body.text, "Created routine, paused");
  let row = await knex("bot_routines").where({ bot_id: bot.id }).first();
  assert.deepEqual([row.enabled, row.next_run_at], [false, null]);
  const started = await ACTIONS.update_routine.run(context2, { routine: "Weekly plan", running: "true" });
  assert.equal(started.body.text, "Started routine");
  row = await knex("bot_routines").where({ bot_id: bot.id }).first();
  assert.ok(row.enabled && row.next_run_at, "running, with its next run");
});

// A template a link opens (D-43) comes from the templates links open, which a copy built on Mercbot provides; asked only
// for a code that's none of Mercbot's own, with the request's own options. It's never the team's, never tested and never
// listed, and adding a bot from it makes it a template of the adder's home (D-98), which the bot points at.
test("a template a link opens is found through the templates links open, and adding from it makes a home template", async (context) => {
  const asked = [];
  const linked = {
    slug: "a1b2c3", name: "Pantry", color: "#14C16F", shape: "puff", description: "Plans meals.", creator: "The Mercbot Team",
    greeting: "", instructions: "Plan the evening meals.", skills: [], routines: [], apps: [], updatedAt: "2026-11-12T10:00:00.000Z"
  };
  const templateLinks = { find: async (code, options) => (asked.push([code, Boolean(options.context)]), code === linked.slug ? linked : null) };
  const { knex, bots, as, visitor, pat, made } = await setup(context, { templateLinks });
  assert.equal((await bots.templateDetails("pantry", visitor)).slug, "weekly-meal-planner", "a template's bot name works in its address");
  const shown = await bots.templateDetails("a1b2c3", visitor);
  assert.deepEqual([shown.name, shown.creator, "team" in shown, shown.tested, shown.updatedAt], ["Pantry", "The Mercbot Team", false, null, linked.updatedAt]);
  assert.equal(bots.templateGallery().templates.some((entry) => entry.slug === "a1b2c3"), false, "never listed in the gallery");
  await assert.rejects(bots.templateDetails("no-such-link", visitor), { statusCode: 404, code: "bots_template_not_found" });
  const bot = await bots.addFromTemplate("a1b2c3", "Pat", as(pat));
  made.push(bot.id);
  assert.deepEqual([bot.name, bot.template.source, bot.template.tag, bot.template.description], ["Pantry", "home", "pantry", "Plans meals."]);
  assert.deepEqual(asked, [["a1b2c3", true], ["no-such-link", true], ["a1b2c3", true]], "asked only for codes that aren't Mercbot's own");
  const row = await knex("bots").where({ id: bot.id }).first();
  const home = await knex("home_templates").where({ id: row.home_template_id }).first();
  assert.deepEqual([home.workspace_id, home.tag, home.instructions, String(home.created_by)], [row.workspace_id, "pantry", "Plan the evening meals.", String(pat)]);
  const again = await bots.addFromTemplate("a1b2c3", "Pat", as(pat));
  made.push(again.id);
  assert.equal(again.template.tag, "pantry2", "a second one gets a free tag of its own");
  const listed = (await bots.homeTemplates(as(pat))).templates.filter((entry) => ["pantry", "pantry2"].includes(entry.tag));
  assert.deepEqual(listed.map((entry) => [entry.tag, entry.usedBy]), [["pantry", 1], ["pantry2", 1]]);
});

test("without the templates links open, a code that's none of Mercbot's own is no template", async (context) => {
  const { bots, visitor } = await setup(context);
  await assert.rejects(bots.templateDetails("a1b2c3", visitor), { statusCode: 404, code: "bots_template_not_found" });
});

// Change template (D-98): the bot points at another template and keeps its additions; it says so in its chat and greets
// with the new template's greeting under its own name. Only its maker and the home's owners and admins change it.
test("changing a bot's template keeps its name, look and additions, and the bot says so and greets as itself", async (context) => {
  const { knex, bots, as, pat, made } = await setup(context);
  const bot = await testBot(knex, pat, { name: "Kitchen helper", library_template: "general", additions: "We're vegetarian." });
  made.push(bot.id);
  const changed = await bots.changeTemplate(bot.id, { library: "weekly-meal-planner" }, "Pat Example", as(pat));
  assert.deepEqual([changed.name, changed.color, changed.template.tag, changed.template.source, changed.hasAdditions], ["Kitchen helper", bot.color, "meals", "library", true]);
  const row = await knex("bots").where({ id: bot.id }).first();
  assert.deepEqual([row.library_template, row.home_template_id, row.additions], ["weekly-meal-planner", null, "We're vegetarian."], "its additions stay");
  assert.ok(row.template_since, "since when it follows it");
  const { messages } = await bots.messages(bot.id, null, {}, as(pat));
  const [event, greeting] = messages.slice(-2);
  assert.deepEqual([event.kind, event.body.text], ["event", "Now a meals bot"]);
  assert.equal(event.body.detail, "Kitchen helper now follows Mercbot's meals template, with its own additions on top.");
  assert.match(greeting.body.text, /^Hi(?: [^,]+)?, I'm Kitchen helper\. I plan your family's dinners/u, "the new template's greeting, as the bot it is");
  const read = await bots.instructionsOf(bot.id, as(pat));
  assert.deepEqual([read.template.tag, read.template.slug, read.additions, read.canChange], ["meals", "weekly-meal-planner", "We're vegetarian.", true]);

  // Choosing the template it has changes nothing and says nothing.
  const count = messages.length;
  await bots.changeTemplate(bot.id, { library: "weekly-meal-planner" }, "Pat Example", as(pat));
  assert.equal((await bots.messages(bot.id, null, {}, as(pat))).messages.length, count);

  // A home template, by its id.
  const [home] = await knex("home_templates")
    .insert({ workspace_id: bot.workspace_id, tag: `kit${Date.now() % 100000}`, description: "Our kitchen.", instructions: "Plan our dinners.", created_by: pat })
    .returning("*");
  const toHome = await bots.changeTemplate(bot.id, { home: String(home.id) }, "Pat Example", as(pat));
  assert.deepEqual([toHome.template.source, toHome.template.tag], ["home", home.tag]);
  assert.deepEqual(await knex("bots").where({ id: bot.id }).first("library_template", "home_template_id"), { library_template: null, home_template_id: home.id });
  const used = await bots.homeTemplate(String(home.id), as(pat));
  assert.deepEqual([used.tag, used.instructions, used.usedBy], [home.tag, "Plan our dinners.", 1]);
  await assert.rejects(knex("home_templates").where({ id: home.id }).del(), /bots_home_template_foreign/u, "a template in use can't be deleted");
});

test("Change template refuses another member, another home's template, a template that isn't there, no choice and a group", async (context) => {
  const { knex, bots, as, pat, made, someone } = await setup(context);
  const bot = await testBot(knex, pat, { name: "Guarded", library_template: "general" });
  made.push(bot.id);
  const kim = await someone("Kim");
  await assert.rejects(bots.changeTemplate(bot.id, { library: "weekly-meal-planner" }, "Kim", kim.options), (error) => {
    assert.deepEqual([error.statusCode, error.code], [403, "bots_template_forbidden"]);
    assert.equal(error.message, "Only the person who made Guarded and the home's owners and admins can change its template or additions.");
    return true;
  });
  assert.equal((await bots.instructionsOf(bot.id, kim.options)).canChange, false);

  // Sam owns another home with a template of its own: from Pat's home, that template is none, and Pat's bot isn't Sam's.
  const sam = await someone("Sam", { own: true });
  const [theirs] = await knex("home_templates")
    .insert({ workspace_id: sam.homeId, tag: "theirs", description: "Sam's.", instructions: "Sam's rules.", created_by: sam.id })
    .returning("id");
  const theirsId = String(theirs.id ?? theirs);
  await assert.rejects(bots.changeTemplate(bot.id, { home: theirsId }, "Pat", as(pat)), { statusCode: 404, code: "bots_template_not_found" });
  await assert.rejects(bots.homeTemplate(theirsId, as(pat)), { statusCode: 404, code: "bots_template_not_found" });
  await assert.rejects(bots.changeTemplate(bot.id, { library: "weekly-meal-planner" }, "Sam", sam.options), /Bot not found/u);
  await assert.rejects(bots.changeTemplate(bot.id, { library: "no-such-template" }, "Pat", as(pat)), { statusCode: 404, code: "bots_template_not_found" });
  await assert.rejects(bots.changeTemplate(bot.id, { home: "x1" }, "Pat", as(pat)), { statusCode: 404, code: "bots_template_not_found" });
  await assert.rejects(bots.changeTemplate(bot.id, {}, "Pat", as(pat)), { statusCode: 400, code: "bots_template_missing_choice" });
  // A body a client wrote is never a template: only a choice of one.
  await assert.rejects(bots.changeTemplate(bot.id, { instructions: "Mine." }, "Pat", as(pat)), { statusCode: 400, code: "bots_template_missing_choice" });
  const group = await testBot(knex, pat, { name: "A group", kind: "group" });
  made.push(group.id);
  await knex("bot_group_people").insert({ workspace_id: group.workspace_id, group_id: group.id, user_id: pat });
  await assert.rejects(bots.changeTemplate(group.id, { library: "weekly-meal-planner" }, "Pat", as(pat)), { statusCode: 400, code: "bots_group_template" });
  assert.deepEqual(await knex("bots").where({ id: bot.id }).first("library_template", "home_template_id"), { library_template: "general", home_template_id: null }, "nothing changed");
});

// The list and one bot's row read every home template its bots point at in one read (D-98): their cost follows the page,
// not how many bots or templates the home has.
test("the bot list and one bot's row cost the same with 4 bots on templates as with 60", async (context) => {
  const { knex, bots, as, pat, made, homeId } = await setup(context);
  const suffix = Math.random().toString(36).slice(2, 6).replace(/[^a-z]/gu, "x");
  let total = 0;
  const grow = async (size) => {
    const homeTemplates = await knex("home_templates")
      .insert(Array.from({ length: size - total }, (_, index) => ({
        workspace_id: homeId, tag: `n${String(total + index).padStart(3, "0")}${suffix}`, description: "Counted.", instructions: "Count.", created_by: pat
      })))
      .returning("id");
    for (const [index, template] of homeTemplates.entries()) {
      // Every other one of Mercbot's library, the rest their home's own.
      const pointer = index % 2 ? { library_template: "weekly-meal-planner" } : { home_template_id: template.id };
      made.push((await testBot(knex, pat, { name: `Counted ${total + index}`, ...pointer })).id);
    }
    total = size;
  };
  const measured = async (size) => {
    await grow(size);
    let list = null;
    const all = await queriesDuring(knex, async () => {
      list = await bots.listBots(as(pat));
    });
    const one = await queriesDuring(knex, () => bots.listedBot(String(made.at(-2)), as(pat)));
    const tagged = list.bots.filter((entry) => made.includes(entry.id) || made.includes(Number(entry.id)));
    assert.equal(tagged.length, size);
    assert.ok(tagged.every((entry) => entry.template?.tag), "every one shows its template's tag");
    return { all, one };
  };
  // A first read at 3, not compared, so both counts compared are of a home already read once.
  await measured(3);
  const few = await measured(4);
  const many = await measured(60);
  assert.deepEqual(many, few, `with 60 bots: ${JSON.stringify(many)} queries, with 4: ${JSON.stringify(few)}`);
});
