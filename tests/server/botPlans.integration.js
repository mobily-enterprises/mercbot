import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test, { after } from "node:test";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { PLANNER } from "../../packages/bots/src/server/botPlans.js";
import { LIBRARY } from "../../packages/bots/src/server/templates.js";
import { BOT_PALETTE } from "../../packages/bots/src/server/botPalette.js";
import { registerRoutes } from "../../packages/bots/src/server/registerRoutes.js";
import { createTemplateDrafts } from "../../packages/bots/src/server/templateDrafts.js";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { seedHome, startSurfaces } from "./surfaceKit.mjs";

// Add bots' suggestions (D-109) on chats (D-112), against the disposable test database, each test in homes of its own:
// a plan is one billed call, metered like a reply, told the home's name, whether more than one person is in it, its
// bots and its own templates and what the person asked; it answers library bots, the home's templates and new bots,
// each with a look and why, marks a library bot the home has, and keeps nothing; an answer that can't be used is asked
// for once more, then refused; and it reads the same statements for a home of 4 bots as of 60. Add N bots makes a
// suggestion's bots together, members of the home on Team that the main bot introduces in the welcome chat, new
// templates with them, all or none, within its limits; a suggested bot's template is written on the tag it was given and
// must say that nothing leaves the chat unasked. The model is a fake answering what each test says.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const knex = await connectTestDatabase();
after(() => knex.destroy());

const COLOR = "#1E86FC";
/** A whole template, valid for a home, with this tag, as a suggested bot's is written. */
const draftOf = (tag, extra = {}) => ({
  tag,
  description: "Plans the staff rota.",
  greeting: "Hi {firstName}, I'll plan the rota.",
  instructions: "You plan the staff rota each week. Ask before anything leaves this chat.",
  skills: [{ name: "Setup interview", description: "What to ask first.", instructions: "1. Ask who works when." }],
  ...extra
});
const fresh = (letter = "r") => `${letter}${randomBytes(3).toString("hex")}`;

/**
 * The surfaces, and Anna's home of the test's own, Anna alone in it (Ben is added where a test says). The planning and
 * drafting calls are answered from `plans` and `drafts` in turn; each call's system prompt and messages are kept, and
 * who each was metered to.
 */
async function setup(context, { plans = [], drafts = [], name = "Salon" } = {}) {
  const calls = { plans: [], drafts: [] };
  const answer = (queue, kept) => async (system, messages) => {
    kept.push({ system, messages });
    const next = queue.shift();
    return typeof next === "function" ? next(messages) : next;
  };
  const tracked = [];
  const kit = await startSurfaces(knex, context, { write: answer(plans, calls.plans), track: (who) => tracked.push(who) });
  const drafting = createTemplateDrafts({ records: kit.records, conversations: null, meter: kit.meter, summaryOf: null, write: answer(drafts, calls.drafts) });
  const newHome = async (homeName = name) => {
    const home = await seedHome(knex, context, { name: homeName });
    await knex("workspace_memberships").where({ workspace_id: home.homeId, user_id: home.ben }).del();
    return home;
  };
  const homeTemplate = async (homeId, anna, tag, description = "Keeps each dog's coat and grooming notes.") => {
    const [row] = await knex("home_templates")
      .insert({ workspace_id: homeId, ...draftOf(tag, { description }), skills: JSON.stringify(draftOf(tag).skills), created_by: anna })
      .returning("*");
    return row;
  };
  const count = async (table, where) => Number((await knex(table).where(where).count("* as n").first()).n);
  return { kit, drafting, newHome, homeTemplate, calls, tracked, count };
}

test("a plan is one call, told the home, its bots, its templates and the request, with nothing kept", async (context) => {
  const tag = fresh();
  const { kit, newHome, homeTemplate, calls, tracked, count } = await setup(context, {
    plans: [(messages) => JSON.stringify({
      name: "Salon",
      summary: "Bookings, notes and a rota",
      bots: [
        { library: "appointment-bookings", why: "You take appointments." },
        { library: "review-replies", why: "Reviews matter." },
        { home: "HOME", name: "Coat Notes", why: "Your own template keeps the notes." },
        { new: { name: "Rota", tag, description: "Plans the staff rota each week." }, why: "No library bot plans shifts." }
      ].map((bot) => (bot.home ? { ...bot, home: /(\d+) \| coat/u.exec(messages[0].content)[1] } : bot)),
      covered: [{ bot: "Kindly", why: "It already answers reviews." }, { bot: "Nobody", why: "Not a bot here." }]
    }), JSON.stringify({ name: "Salon", bots: [{ library: "review-replies", why: "Reviews matter." }] })]
  });
  const { homeId, anna, ben, as } = await newHome("Grooming room");
  const owner = as("anna");
  await kit.onboarding.welcome(owner);
  const coat = await homeTemplate(homeId, anna, `coat${randomBytes(2).toString("hex")}`);
  const kindly = await kit.templates.createBot({ name: "Kindly", color: COLOR, template: { library: "review-replies" } }, owner);
  const before = { bots: await count("bots", { workspace_id: homeId }), templates: await count("home_templates", { workspace_id: homeId }) };

  const { plan } = await kit.plans.propose({ describe: "I run a dog-grooming salon with two staff" }, owner);
  assert.equal(calls.plans.length, 1, "one call");
  const [{ system, messages }] = calls.plans;
  assert.ok(system.startsWith(PLANNER));
  assert.match(system, /^appointment-bookings \| bookings \| Slotwise \| Small business \| /mu, "the library, one bot a line");
  assert.doesNotMatch(system, /^general \|/mu, "never the general helper");
  const user = messages[0].content;
  assert.match(user, /^The home: Grooming room, used by one person\.$/mu);
  assert.match(user, /^- Kindly \| reviews \| /mu, "its bots, with their templates' tags");
  assert.match(user, new RegExp(`^- ${coat.id} \\| ${coat.tag} \\| Keeps each dog's coat`, "mu"), "its own templates, by id");
  assert.match(user, /^What the person asked: I run a dog-grooming salon with two staff$/mu);
  assert.deepEqual(tracked, [{ work: "chat" }], "the chat kind of work, for the request's person and home");

  assert.deepEqual([plan.name, plan.summary, plan.question], ["Salon", "Bookings, notes and a rota", null]);
  assert.deepEqual(plan.bots.map((bot) => [bot.key, bot.name, bot.tag, bot.inHome]), [
    ["library:appointment-bookings", "Slotwise", "bookings", false],
    ["library:review-replies", "Kindly", "reviews", true],
    [`home:${coat.id}`, "Coat Notes", coat.tag, false],
    [`new:${tag}`, "Rota", tag, false]
  ]);
  const slotwise = LIBRARY.get("appointment-bookings");
  assert.deepEqual([plan.bots[0].shape, plan.bots[0].color, plan.bots[0].appTemplate], [slotwise.shape, slotwise.color, "bookings"], "a library bot's own look and app");
  const picked = plan.bots.slice(2);
  assert.ok(picked.every((bot) => bot.shape && bot.shape !== "mercbot" && BOT_PALETTE.includes(bot.color)), "a look of the palette's for the rest");
  assert.deepEqual(plan.covered, [{ botId: kindly.id, name: "Kindly", why: "It already answers reviews." }], "a bot the home hasn't got is left out");
  assert.deepEqual({ bots: await count("bots", { workspace_id: homeId }), templates: await count("home_templates", { workspace_id: homeId }) }, before, "nothing is kept");

  await assert.rejects(kit.plans.propose({ describe: "  " }, owner), { statusCode: 400, code: "bots_plan_describe_missing" });
  await assert.rejects(kit.plans.propose({ describe: "x".repeat(601) }, owner), { statusCode: 400, code: "bots_plan_describe_too_long" });
  await assert.rejects(kit.plans.propose({ describe: "a salon", change: "y".repeat(601) }, owner), { statusCode: 400, code: "bots_plan_change_too_long" });
  assert.equal(calls.plans.length, 1, "a refused request asks nothing");

  // A second person in the home: it's told the home is used by several people; and a library bot whose bots are all
  // archived (D-108) is still in the home, archived, as the team screen says.
  await knex("workspace_memberships").insert({ workspace_id: homeId, user_id: ben, role_sid: "member", status: "active" });
  await knex("bots").where({ id: kindly.id }).update({ archived_at: knex.fn.now() });
  const again = await kit.plans.propose({ describe: "a dog-grooming salon" }, owner);
  assert.match(calls.plans[1].messages[0].content, /^The home: Grooming room, used by several people\.$/mu);
  assert.deepEqual(again.plan.bots.map((bot) => [bot.key, bot.inHome, bot.archivedInHome]), [["library:review-replies", true, true]]);
  assert.equal(plan.bots[1].archivedInHome, undefined, "not while it wasn't archived");
});

test("a plan the model can't give is asked for once more with its problems, then refused; a change is told the plan before", async (context) => {
  const tag = fresh();
  const { kit, newHome, calls } = await setup(context, {
    plans: [
      "Sure, here are some bots.",
      JSON.stringify({ name: "Shop", bots: [{ library: "shop-stock-keeper", why: "Stock." }] }),
      JSON.stringify({ name: "Shop", bots: [{ library: "dog-walker" }] }),
      JSON.stringify({ name: "Shop", bots: Array.from({ length: 5 }, (_, index) => ({ new: { name: `Helper ${index}`, tag: `${tag}${index}`, description: "Helps." } })) }),
      JSON.stringify({ name: "Shop", question: "What do you sell?", bots: [] })
    ]
  });
  const owner = (await newHome()).as("anna");
  const first = await kit.plans.propose({ describe: "help with my shop" }, owner);
  assert.deepEqual(first.plan.bots.map((bot) => bot.key), ["library:shop-stock-keeper"]);
  assert.equal(calls.plans.length, 2, "asked once more");
  assert.deepEqual(calls.plans[1].messages[1], { role: "assistant", content: "Sure, here are some bots." });
  assert.match(calls.plans[1].messages[2].content, /^That plan can't be used: The answer isn't one JSON object\. Answer again/u);

  await assert.rejects(kit.plans.propose({ describe: "help with my shop", plan: first.plan, change: "more help" }, owner), (error) => {
    assert.deepEqual([error.statusCode, error.code], [422, "bots_plan_failed"]);
    return true;
  });
  assert.equal(calls.plans.length, 4, "two calls, then refused");
  assert.match(calls.plans[2].messages[0].content, /^The bots suggested before: library shop-stock-keeper$/mu, "the plan before, as the server knows it");
  assert.match(calls.plans[2].messages[0].content, /^What to change: more help$/mu);
  assert.match(calls.plans[3].messages[2].content, /there's no library bot "dog-walker"\./u);

  // A question, with no bots, is a plan too.
  const asked = await kit.plans.propose({ describe: "my business" }, owner);
  assert.deepEqual([asked.plan.question, asked.plan.bots], ["What do you sell?", []]);
});

test("a plan reads the same statements for a home of 4 bots as of 60, and tells the call of 60 by name and tag", async (context) => {
  const answers = Array.from({ length: 2 }, () => JSON.stringify({ name: "Team", bots: [{ library: "habit-tracker", why: "Habits." }] }));
  const { kit, newHome, calls } = await setup(context, { plans: answers });
  const statements = async (size) => {
    const { homeId, anna, as } = await newHome();
    await knex("bots").insert(Array.from({ length: size }, (_, index) => ({ made_by: anna, workspace_id: homeId, name: `Bot ${index}`, color: COLOR, library_template: "general" })));
    return queriesDuring(knex, () => kit.plans.propose({ describe: "help with my habits" }, as("anna")));
  };
  const counts = { 4: await statements(4), 60: await statements(61) };
  assert.equal(counts[4], counts[60], JSON.stringify(counts));
  context.diagnostic(`statements: ${JSON.stringify(counts)}`);
  assert.match(calls.plans[0].messages[0].content, /^- Bot 3 \| general \| An all-round helper/mu, "a few bots in full");
  assert.match(calls.plans[1].messages[0].content, /^- Bot 60 \| general$/mu, "past 60, by name and tag only");
});

test("Add N bots makes a suggestion's library, home and new bots, with the new templates, introduced in the welcome chat", async (context) => {
  const tag = fresh();
  const { kit, newHome, homeTemplate, count } = await setup(context);
  const { homeId, anna, as } = await newHome();
  const owner = as("anna");
  const { chat: welcome } = await kit.onboarding.welcome(owner);
  const coat = await homeTemplate(homeId, anna, `coat${randomBytes(2).toString("hex")}`);
  const added = await kit.teams.addBots({
    bots: [
      { library: "appointment-bookings" },
      { home: String(coat.id), name: "Coat Notes", shape: "tuft", color: "#8F59F9" },
      { draft: draftOf(tag), name: "Rota", shape: "storm", color: "#F59312" },
      { library: "appointment-bookings" }
    ]
  }, owner);
  const made = added.added.map((id) => added.bots.find((bot) => bot.id === id));
  assert.deepEqual(made.map((bot) => [bot.name, bot.template.tag, bot.template.source, bot.madeBy]), [
    ["Slotwise", "bookings", "library", anna],
    ["Coat Notes", coat.tag, "home", anna],
    ["Rota", tag, "home", anna]
  ], "in the order given, a library bot named twice made once");
  const rota = await knex("home_templates").where({ workspace_id: homeId, tag }).first();
  assert.equal(rota.instructions, draftOf(tag).instructions, "the new template, from its five parts");
  assert.deepEqual(await knex("chat_bots").whereIn("bot_id", added.added), [], "no chats of their own: they're on Team");
  assert.equal(added.chatId, welcome.id);
  const [intro] = await knex("messages").where({ conversation_id: welcome.id, kind: "text" }).orderBy("id", "desc").limit(1);
  assert.deepEqual(intro.body.team.map((entry) => entry.botId), added.added, "the main bot introduces them, a [Message] for each");

  // Again: the library bot it has is left out, and choosing only that is refused, with nothing made.
  const again = await kit.teams.addBots({ bots: [{ library: "appointment-bookings" }, { library: "review-replies" }] }, owner);
  assert.deepEqual([again.added.length, again.skipped], [1, ["appointment-bookings"]]);
  const before = await count("bots", { workspace_id: homeId });
  await assert.rejects(kit.teams.addBots({ bots: [{ library: "review-replies" }] }, owner), { statusCode: 409, code: "bots_team_all_in_home" });
  assert.equal(await count("bots", { workspace_id: homeId }), before);
});

test("Add N bots is all or none, within its limits, and refuses what isn't a bot of a suggestion", async (context) => {
  const tag = fresh();
  const { kit, newHome, homeTemplate, count } = await setup(context);
  const { homeId, as } = await newHome();
  const owner = as("anna");
  const other = await newHome();
  const theirs = await homeTemplate(other.homeId, other.anna, fresh("t"));
  const look = (name) => ({ name, shape: "cloud", color: COLOR });
  const nothing = async () => ({ bots: await count("bots", { workspace_id: homeId }), templates: await count("home_templates", { workspace_id: homeId }) });
  const empty = await nothing();
  const refused = async (input, expected) => {
    await assert.rejects(kit.teams.addBots(input, owner), expected);
    assert.deepEqual(await nothing(), empty, JSON.stringify(expected));
  };
  // A second new template on the first one's tag is refused with its problems, and the first isn't kept either.
  await refused({ bots: [{ library: "habit-tracker" }, { draft: draftOf(tag), ...look("Rota") }, { draft: draftOf(tag), ...look("Shifts") }] },
    { statusCode: 422, code: "bots_template_draft_invalid" });
  await refused({ bots: [{ draft: draftOf(fresh(), { greeting: "Hello." }), ...look("Rota") }] }, { statusCode: 422, code: "bots_template_draft_invalid" });
  await refused({ bots: [] }, { statusCode: 400, code: "bots_add_empty" });
  const nine = ["habit-tracker", "plant-care", "money-check-in", "job-search-helper", "language-practice-partner", "family-chores-rota", "weekly-meal-planner",
    "school-admin-helper", "kids-activities-planner"].map((slug) => ({ library: slug }));
  await refused({ bots: nine }, { statusCode: 400, code: "bots_add_too_many" });
  await refused({ bots: Array.from({ length: 5 }, (_, index) => ({ draft: draftOf(`${tag}${index}`), ...look(`New ${index}`) })) },
    { statusCode: 400, code: "bots_add_too_many_new" });
  await refused({ bots: [{ library: "dog-walker" }] }, { statusCode: 400, code: "bots_add_template_unknown" });
  await refused({ bots: [{ library: "general" }] }, { statusCode: 400, code: "bots_add_template_unknown" });
  await refused({ bots: [{ library: "habit-tracker", home: "1" }] }, { statusCode: 400, code: "bots_add_template" });
  await refused({ bots: [{ home: String(theirs.id), ...look("Theirs") }] }, (error) => error.statusCode === 404 || error.statusCode === 400);
  await refused({ bots: [{ draft: draftOf(fresh()), name: "Rota", shape: "cloud", color: "#123456" }] }, { statusCode: 400, code: "bots_colour_unknown" });
});

test("a suggested bot's template is written on its tag, told the others' jobs, and must say nothing leaves unasked", async (context) => {
  const tag = fresh();
  const { drafting, newHome, homeTemplate, calls, tracked } = await setup(context, {
    drafts: [
      JSON.stringify(draftOf("other", { instructions: "You plan the rota." })),
      JSON.stringify(draftOf("other"))
    ]
  });
  const { homeId, anna, as } = await newHome();
  const owner = as("anna");
  const input = {
    purpose: "plan-bot",
    describe: "I run a dog-grooming salon with two staff",
    bot: { name: "Rota", tag, description: "Plans the staff rota each week." },
    team: [{ name: "Slotwise", description: "Keeps the appointment book." }]
  };
  const { draft, problems } = await drafting.draftTemplate(input, owner);
  assert.deepEqual([draft.tag, problems], [tag, []], "its own tag, whatever the answer said");
  assert.equal(calls.drafts.length, 2, "asked once more: the first didn't say it asks first");
  assert.match(calls.drafts[0].messages[0].content, new RegExp(`^Write a template for a bot named Rota, tag ${tag}, whose job is: Plans the staff rota each week\\.$`, "mu"));
  assert.match(calls.drafts[0].messages[0].content, /^The others suggested with it do these jobs, so leave them out: Slotwise: Keeps the appointment book\.$/mu);
  assert.match(calls.drafts[0].system, /in so many words, "Ask before anything leaves this chat\."/u, "the writer is told how Mercbot's are written");
  assert.match(calls.drafts[1].messages[2].content, /instructions: Say, in so many words: "Ask before anything leaves this chat\."/u);
  assert.deepEqual(tracked, [{ work: "chat" }]);

  const taken = await homeTemplate(homeId, anna, fresh("h"));
  await assert.rejects(drafting.draftTemplate({ ...input, bot: { ...input.bot, tag: taken.tag } }, owner), { statusCode: 400, code: "bots_template_draft_tag_taken" });
  await assert.rejects(drafting.draftTemplate({ ...input, bot: { ...input.bot, tag: "meals" } }, owner), { statusCode: 400, code: "bots_template_draft_tag_taken" });
  await assert.rejects(drafting.draftTemplate({ ...input, bot: { ...input.bot, tag: "Rota!" } }, owner), { statusCode: 400, code: "bots_template_draft_bot" });
  await assert.rejects(drafting.draftTemplate({ ...input, bot: { name: "Rota", tag } }, owner), { statusCode: 400, code: "bots_template_draft_bot" });
  await assert.rejects(drafting.draftTemplate({ ...input, team: Array.from({ length: 8 }, () => input.team[0]) }, owner), { statusCode: 400, code: "bots_template_draft_team" });
  assert.equal(calls.drafts.length, 2, "a refused request asks nothing");
});

// Making bots asks no model, so a paused home may still add them (the batch route has no pause check), as it may add a
// team; a plan is refused there before the model is asked.
test("a paused home's plan is refused with its message, before the model is asked", async (context) => {
  const { kit, newHome, calls } = await setup(context);
  const { homeId, anna } = await newHome();
  const paused = "This home's work is paused, so I can't start anything new.";
  const routes = new Map();
  registerRoutes(
    { router: { register: (method, path, _options, handler) => routes.set(`${method} ${path}`, handler) } },
    {
      bots: { proposeBots: kit.plans.propose },
      approvals: {},
      notices: {},
      meter: { pausedMessage: async () => paused, track: (_who, work) => work() },
      records: kit.records,
      streams: new Set()
    }
  );
  const answer = {};
  const reply = {
    code(status) {
      answer.status = status;
      return reply;
    },
    send(sent) {
      answer.body = sent;
      return reply;
    }
  };
  const request = {
    params: { workspaceSlug: `home-${homeId}` },
    body: { describe: "help with my shop" },
    user: { id: anna, displayName: "Anna" },
    workspace: { id: homeId },
    membership: { roleSid: "owner" },
    permissions: ["workspace.settings.update"]
  };
  request.callOptions = async () => requestContextOptions(request);
  await routes.get("POST /api/w/:workspaceSlug/bots/plan")(request, reply);
  assert.equal(answer.status, 402);
  assert.deepEqual([answer.body.code, answer.body.error], ["work_paused", paused]);
  assert.equal(calls.plans.length, 0, "the model isn't asked");
});
