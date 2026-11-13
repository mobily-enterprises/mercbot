import assert from "node:assert/strict";
import test from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { ACTIONS } from "../../packages/bots/src/server/botActions.js";
import { buildTools } from "../../packages/bots/src/server/botTools.js";
import { instructionsFor } from "../../packages/bots/src/server/botAgent.js";
import { testBot, testHome } from "./testHome.js";
import { serviceDoubles, turnDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotParts } from "../support/botRecords.mjs";
import { requestContextOptions } from "../support/requestContextOptions.mjs";

// Bot templates (D-43): the curated gallery, adding a bot from a template, and a template a link opens, which
// the templates links open (mercbot.template-links) find.
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
  context.after(async () => {
    await knex("bots").whereIn("id", made).del();
    await knex.destroy();
  });
  // The bots service with its records, users.profiles (the creator's and the person's names) and the workspaces.
  const parts = await startBotParts(knex, context);
  const bots = createBotsService(serviceDoubles({ knex, ...parts, ...(templateLinks ? { templateLinks } : {}), approvals: { decide: async () => "allow" }, integrations: { appName: (id) => ({ "google-calendar": "Google Calendar" })[id] || id, app: (id) => APPS[id] || null, skills: async () => [] }, reply: async () => ({ text: "Noted.", transcript: [] }) }));
  /** A member's request in the home, as the bots routes make its options. */
  const as = (userId) => memberOptions({ userId, homeId });
  // A template's page is public: a visitor who hasn't signed in reads it too.
  const visitor = requestContextOptions({});
  return { knex, bots, as, visitor, records: parts.records, homeId, pat, made };
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

test("adding from a template makes a bot with its job, skills and origin, opening with its greeting", async (context) => {
  const { knex, as, bots, homeId, pat, made } = await setup(context);
  const bot = await bots.addFromTemplate("weekly-meal-planner", "Pat Example", as(pat));
  made.push(bot.id);
  assert.equal(bot.name, "Pantry");
  assert.equal(bot.onboardingStep, null, "no generic first conversation");
  assert.deepEqual([bot.origin.slug, bot.origin.kind, bot.origin.creator], ["weekly-meal-planner", "gallery", "the Mercbot team"]);
  const row = await knex("bots").where({ id: bot.id }).first();
  assert.ok(row.instructions.length > 100 && row.skills.length >= 2);
  const { messages } = await bots.messages(bot.id, null, {}, as(pat));
  const { display_name: realName } = await knex("users").where({ id: pat }).first("display_name");
  const expected = new RegExp(`^Hi(?: [^,]+)?, I'm Pantry\\.`, "u");
  assert.match(messages.at(-1).body.text, expected, "the template's greeting, with a first name or none");
  assert.doesNotMatch(messages.at(-1).body.text, /\{firstName\}/u);
  assert.ok(realName === null || typeof realName === "string");
  assert.equal(await knex("bot_routines").where({ bot_id: bot.id }).count("* as n").first().then((count) => Number(count.n)), 0, "routines come from its setup interview, not the template");

  // Its own job and skills reach its instructions, and read_skill opens them.
  const prompt = instructionsFor({ ...bot, instructions: row.instructions, skills: row.skills });
  assert.match(prompt, /Your own job, from the template/u);
  assert.match(prompt, /- Setup interview: /u);
  const { tools } = buildTools(turnDoubles({ call: as(pat), approvals: { decide: async () => "allow" }, computer: null, homeId, userId: pat, botId: bot.id, conversationId: row.id, botSkills: row.skills }));
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
// listed, and a bot added from it says it came from a link.
test("a template a link opens is found through the templates links open, and a bot added from it came from a link", async (context) => {
  const asked = [];
  const linked = {
    slug: "a1b2c3", name: "Pantry", color: "#14C16F", shape: "puff", description: "Plans meals.", creator: "The Mercbot Team",
    greeting: "", instructions: "Plan the evening meals.", skills: [], routines: [], apps: [], updatedAt: "2026-11-12T10:00:00.000Z"
  };
  const templateLinks = { find: async (code, options) => (asked.push([code, Boolean(options.context)]), code === linked.slug ? linked : null) };
  const { bots, as, visitor, pat, made } = await setup(context, { templateLinks });
  assert.equal((await bots.templateDetails("pantry", visitor)).slug, "weekly-meal-planner", "a template's bot name works in its address");
  const shown = await bots.templateDetails("a1b2c3", visitor);
  assert.deepEqual([shown.name, shown.creator, "team" in shown, shown.tested, shown.updatedAt], ["Pantry", "The Mercbot Team", false, null, linked.updatedAt]);
  assert.equal(bots.templateGallery().templates.some((entry) => entry.slug === "a1b2c3"), false, "never listed in the gallery");
  await assert.rejects(bots.templateDetails("no-such-link", visitor), { statusCode: 404, code: "bots_template_not_found" });
  const bot = await bots.addFromTemplate("a1b2c3", "Pat", as(pat));
  made.push(bot.id);
  assert.deepEqual([bot.name, bot.origin.kind, bot.origin.creator], ["Pantry", "link", "The Mercbot Team"]);
  assert.deepEqual(asked, [["a1b2c3", true], ["no-such-link", true], ["a1b2c3", true]], "asked only for codes that aren't Mercbot's own");
});

test("without the templates links open, a code that's none of Mercbot's own is no template", async (context) => {
  const { bots, visitor } = await setup(context);
  await assert.rejects(bots.templateDetails("a1b2c3", visitor), { statusCode: 404, code: "bots_template_not_found" });
});
