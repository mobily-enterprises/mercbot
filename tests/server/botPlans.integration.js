import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { PLANNER } from "../../packages/bots/src/server/botPlans.js";
import { LIBRARY } from "../../packages/bots/src/server/templates.js";
import { BOT_PALETTE } from "../../packages/bots/src/server/botPalette.js";
import { registerRoutes } from "../../packages/bots/src/server/registerRoutes.js";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotParts } from "../support/botRecords.mjs";

// Add bots' suggestions (D-109), against the disposable test database, each test in homes of its own: a plan is one
// billed call, metered like a reply, told the home's name, whether more than one person is in it, its bots and its own templates and what the
// person asked; it answers library bots, the home's templates and new bots, each with a look and why, marks a library
// bot the home has, and keeps nothing; an answer that can't be used is asked for once more, then refused; and it reads
// the same statements for a home of 4 bots as of 60. Add N bots makes a suggestion's bots together in the section named,
// new templates with them, all or none, within its limits; a suggested bot's template is written on the tag it was given
// and must say that nothing leaves the chat unasked. The model is a fake answering what each test says.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");

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
 * Pat and the bots service in homes of the test's own. The planning and drafting calls are answered from `plans` and
 * `drafts` in turn; each call's system prompt and messages are kept, and who each was metered to.
 */
async function setup(context, { plans = [], drafts = [] } = {}) {
  const knex = await connectTestDatabase();
  const pat = String((await knex("users").orderBy("id").first()).id);
  const stamp = randomBytes(4).toString("hex");
  const homes = [];
  context.after(async () => {
    await knex("bots").whereIn("workspace_id", homes).del();
    await knex("home_templates").whereIn("workspace_id", homes).del();
    await knex("bot_sections").whereIn("workspace_id", homes).del();
    await knex("workspace_settings").whereIn("workspace_id", homes).del();
    await knex("workspace_memberships").whereIn("workspace_id", homes).del();
    await knex("workspaces").whereIn("id", homes).del();
    await knex.destroy();
  });
  const parts = await startBotParts(knex, context);
  const calls = { plans: [], drafts: [] };
  const answer = (queue, kept) => async (system, messages) => {
    kept.push({ system, messages });
    const next = queue.shift();
    return typeof next === "function" ? next(messages) : next;
  };
  const tracked = [];
  const meter = { ...parts.meter, track: (who, work) => (tracked.push(who), parts.meter.track(who, work)) };
  const bots = createBotsService(serviceDoubles({
    knex,
    ...parts,
    meter,
    approvals: { decide: async () => "allow" },
    writePlan: answer(plans, calls.plans),
    writeTemplate: answer(drafts, calls.drafts)
  }));
  context.after(() => bots.drain(10000));
  const newHome = async (name = `Salon ${homes.length}`) => {
    const [home] = await knex("workspaces")
      .insert({ slug: `plans-${stamp}-${homes.length}`, name, owner_user_id: pat, is_personal: false })
      .returning("id");
    homes.push(String(home.id));
    await knex("workspace_memberships").insert({ workspace_id: home.id, user_id: pat, role_sid: "owner", status: "active" });
    await knex("workspace_settings").insert({ workspace_id: home.id });
    return String(home.id);
  };
  const as = (homeId) => memberOptions({ userId: pat, homeId, role: "owner", permissions: ["workspace.settings.update"] });
  const homeTemplate = async (homeId, tag, description = "Keeps each dog's coat and grooming notes.") => {
    const [row] = await knex("home_templates")
      .insert({ workspace_id: homeId, ...draftOf(tag, { description }), skills: JSON.stringify(draftOf(tag).skills), created_by: pat })
      .returning("*");
    return row;
  };
  const count = async (table, where) => Number((await knex(table).where(where).count("* as n").first()).n);
  return { knex, parts, bots, pat, newHome, as, homeTemplate, calls, tracked, count };
}

test("a plan is one call, told the home, its bots, its templates and the request, with nothing kept", async (context) => {
  const tag = fresh();
  const { knex, bots, newHome, as, homeTemplate, calls, tracked, count } = await setup(context, {
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
  const homeId = await newHome("Grooming room");
  const owner = as(homeId);
  await bots.ensureFirstBot(owner);
  const coat = await homeTemplate(homeId, `coat${randomBytes(2).toString("hex")}`);
  const kindly = await bots.createBot({ name: "Kindly", color: COLOR, template: { library: "review-replies" } }, owner);
  const before = { bots: await count("bots", { workspace_id: homeId }), templates: await count("home_templates", { workspace_id: homeId }) };

  const { plan } = await bots.proposeBots({ describe: "I run a dog-grooming salon with two staff" }, owner);
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

  await assert.rejects(bots.proposeBots({ describe: "  " }, owner), { statusCode: 400, code: "bots_plan_describe_missing" });
  await assert.rejects(bots.proposeBots({ describe: "x".repeat(601) }, owner), { statusCode: 400, code: "bots_plan_describe_too_long" });
  await assert.rejects(bots.proposeBots({ describe: "a salon", change: "y".repeat(601) }, owner), { statusCode: 400, code: "bots_plan_change_too_long" });
  assert.equal(calls.plans.length, 1, "a refused request asks nothing");

  // A second person in the home: it's told the home is used by several people, whatever its mode for new bots; and a
  // library bot whose bots are all archived (D-108) is still in the home, archived, as the team screen says.
  const [kim] = await knex("users")
    .insert({ auth_provider: "test", auth_provider_user_sid: `kim-${tag}`, email: `kim-${tag}@example.com`, username: `kim${tag}`, display_name: "Kim" })
    .returning("id");
  try {
    await knex("workspace_memberships").insert({ workspace_id: homeId, user_id: kim.id, role_sid: "member", status: "active" });
    await knex("bots").where({ id: kindly.id }).update({ archived_at: knex.fn.now() });
    const again = await bots.proposeBots({ describe: "a dog-grooming salon" }, owner);
    assert.match(calls.plans[1].messages[0].content, /^The home: Grooming room, used by several people\.$/mu);
    assert.deepEqual(again.plan.bots.map((bot) => [bot.key, bot.inHome, bot.archivedInHome]), [["library:review-replies", true, true]]);
    assert.equal(plan.bots[1].archivedInHome, undefined, "not while it wasn't archived");
  } finally {
    await knex("workspace_memberships").where({ user_id: kim.id }).del();
    await knex("users").where({ id: kim.id }).del();
  }
});

test("a plan the model can't give is asked for once more with its problems, then refused; a change is told the plan before", async (context) => {
  const tag = fresh();
  const { bots, newHome, as, calls } = await setup(context, {
    plans: [
      "Sure, here are some bots.",
      JSON.stringify({ name: "Shop", bots: [{ library: "shop-stock-keeper", why: "Stock." }] }),
      JSON.stringify({ name: "Shop", bots: [{ library: "dog-walker" }] }),
      JSON.stringify({ name: "Shop", bots: Array.from({ length: 5 }, (_, index) => ({ new: { name: `Helper ${index}`, tag: `${tag}${index}`, description: "Helps." } })) }),
      JSON.stringify({ name: "Shop", question: "What do you sell?", bots: [] })
    ]
  });
  const owner = as(await newHome());
  const first = await bots.proposeBots({ describe: "help with my shop" }, owner);
  assert.deepEqual(first.plan.bots.map((bot) => bot.key), ["library:shop-stock-keeper"]);
  assert.equal(calls.plans.length, 2, "asked once more");
  assert.deepEqual(calls.plans[1].messages[1], { role: "assistant", content: "Sure, here are some bots." });
  assert.match(calls.plans[1].messages[2].content, /^That plan can't be used: The answer isn't one JSON object\. Answer again/u);

  await assert.rejects(bots.proposeBots({ describe: "help with my shop", plan: first.plan, change: "more help" }, owner), (error) => {
    assert.deepEqual([error.statusCode, error.code], [422, "bots_plan_failed"]);
    return true;
  });
  assert.equal(calls.plans.length, 4, "two calls, then refused");
  assert.match(calls.plans[2].messages[0].content, /^The bots suggested before: library shop-stock-keeper$/mu, "the plan before, as the server knows it");
  assert.match(calls.plans[2].messages[0].content, /^What to change: more help$/mu);
  assert.match(calls.plans[3].messages[2].content, /there's no library bot "dog-walker"\./u);

  // A question, with no bots, is a plan too.
  const asked = await bots.proposeBots({ describe: "my business" }, owner);
  assert.deepEqual([asked.plan.question, asked.plan.bots], ["What do you sell?", []]);
});

test("a plan reads the same statements for a home of 4 bots as of 60, and tells the call of 60 by name and tag", async (context) => {
  const answers = Array.from({ length: 2 }, () => JSON.stringify({ name: "Team", bots: [{ library: "habit-tracker", why: "Habits." }] }));
  const { knex, bots, pat, newHome, as, calls } = await setup(context, { plans: answers });
  const statements = async (size) => {
    const homeId = await newHome();
    await knex("bots").insert(Array.from({ length: size }, (_, index) => ({ user_id: pat, workspace_id: homeId, name: `Bot ${index}`, color: COLOR })));
    return queriesDuring(knex, () => bots.proposeBots({ describe: "help with my habits" }, as(homeId)));
  };
  const counts = { 4: await statements(4), 60: await statements(61) };
  assert.equal(counts[4], counts[60], JSON.stringify(counts));
  context.diagnostic(`statements: ${JSON.stringify(counts)}`);
  assert.match(calls.plans[0].messages[0].content, /^- Bot 3 \| general \| An all-round helper/mu, "a few bots in full");
  assert.match(calls.plans[1].messages[0].content, /^- Bot 60 \| general$/mu, "past 60, by name and tag only");
});

test("Add N bots makes a suggestion's library, home and new bots in the section named, with the new templates", async (context) => {
  const tag = fresh();
  const { knex, bots, newHome, as, homeTemplate, count } = await setup(context);
  const homeId = await newHome();
  const owner = as(homeId);
  await bots.ensureFirstBot(owner);
  const coat = await homeTemplate(homeId, `coat${randomBytes(2).toString("hex")}`);
  const added = await bots.addBots({
    section: "Salon",
    bots: [
      { library: "appointment-bookings" },
      { home: String(coat.id), name: "Coat Notes", shape: "tuft", color: "#8F59F9" },
      { draft: draftOf(tag), name: "Rota", shape: "storm", color: "#F59312" },
      { library: "appointment-bookings" }
    ]
  }, "Pat Example", owner);
  const made = added.added.map((id) => added.bots.find((bot) => bot.id === id));
  assert.deepEqual(made.map((bot) => [bot.name, bot.template.tag, bot.template.source]), [
    ["Slotwise", "bookings", "library"],
    ["Coat Notes", coat.tag, "home"],
    ["Rota", tag, "home"]
  ], "in the order given, a library bot named twice made once");
  assert.equal(added.sections.find((section) => section.id === added.sectionId)?.name, "Salon");
  assert.ok(made.every((bot) => bot.sectionId === added.sectionId));
  const rota = await knex("home_templates").where({ workspace_id: homeId, tag }).first();
  assert.equal(rota.instructions, draftOf(tag).instructions, "the new template, from its five parts");
  for (const bot of made) {
    const { messages } = await bots.messages(bot.id, null, {}, owner);
    assert.equal(messages.at(-1).kind, "text", `${bot.name} greets`);
  }

  // Again: the library bot it has is left out, and choosing only that is refused, with nothing made.
  const again = await bots.addBots({ section: "Salon", bots: [{ library: "appointment-bookings" }, { library: "review-replies" }] }, "Pat", owner);
  assert.deepEqual([again.added.length, again.skipped, again.sectionId], [1, ["appointment-bookings"], added.sectionId]);
  const before = await count("bots", { workspace_id: homeId });
  await assert.rejects(bots.addBots({ section: "Salon", bots: [{ library: "review-replies" }] }, "Pat", owner), { statusCode: 409, code: "bots_team_all_in_home" });
  assert.equal(await count("bots", { workspace_id: homeId }), before);
});

test("Add N bots is all or none, within its limits, and refuses what isn't a bot of a suggestion", async (context) => {
  const tag = fresh();
  const { bots, newHome, as, homeTemplate, count } = await setup(context);
  const homeId = await newHome();
  const owner = as(homeId);
  const otherHome = await newHome();
  const theirs = await homeTemplate(otherHome, fresh("t"));
  const look = (name) => ({ name, shape: "cloud", color: COLOR });
  const nothing = async () => ({ bots: await count("bots", { workspace_id: homeId }), templates: await count("home_templates", { workspace_id: homeId }) });
  const empty = await nothing();
  const refused = async (input, expected) => {
    await assert.rejects(bots.addBots(input, "Pat", owner), expected);
    assert.deepEqual(await nothing(), empty, JSON.stringify(expected));
  };
  // A second new template on the first one's tag is refused with its problems, and the first isn't kept either.
  await refused({ section: "Salon", bots: [{ library: "habit-tracker" }, { draft: draftOf(tag), ...look("Rota") }, { draft: draftOf(tag), ...look("Shifts") }] },
    { statusCode: 422, code: "bots_template_draft_invalid" });
  await refused({ section: "Salon", bots: [{ draft: draftOf(fresh(), { greeting: "Hello." }), ...look("Rota") }] }, { statusCode: 422, code: "bots_template_draft_invalid" });
  await refused({ section: "", bots: [{ library: "habit-tracker" }] }, { statusCode: 400, code: "bots_add_section" });
  await refused({ section: "Salon", bots: [] }, { statusCode: 400, code: "bots_add_empty" });
  const nine = ["habit-tracker", "plant-care", "money-check-in", "job-search-helper", "language-practice-partner", "family-chores-rota", "weekly-meal-planner",
    "school-admin-helper", "kids-activities-planner"].map((slug) => ({ library: slug }));
  await refused({ section: "Salon", bots: nine }, { statusCode: 400, code: "bots_add_too_many" });
  await refused({ section: "Salon", bots: Array.from({ length: 5 }, (_, index) => ({ draft: draftOf(`${tag}${index}`), ...look(`New ${index}`) })) },
    { statusCode: 400, code: "bots_add_too_many_new" });
  await refused({ section: "Salon", bots: [{ library: "dog-walker" }] }, { statusCode: 400, code: "bots_add_template_unknown" });
  await refused({ section: "Salon", bots: [{ library: "general" }] }, { statusCode: 400, code: "bots_add_template_unknown" });
  await refused({ section: "Salon", bots: [{ library: "habit-tracker", home: "1" }] }, { statusCode: 400, code: "bots_add_template" });
  await refused({ section: "Salon", bots: [{ home: String(theirs.id), ...look("Theirs") }] }, (error) => error.statusCode === 404 || error.statusCode === 400);
  await refused({ section: "Salon", bots: [{ draft: draftOf(fresh()), name: "Rota", shape: "cloud", color: "#123456" }] }, { statusCode: 400, code: "bots_colour_unknown" });
});

test("a suggested bot's template is written on its tag, told the others' jobs, and must say nothing leaves unasked", async (context) => {
  const tag = fresh();
  const { bots, newHome, as, homeTemplate, calls, tracked } = await setup(context, {
    drafts: [
      JSON.stringify(draftOf("other", { instructions: "You plan the rota." })),
      JSON.stringify(draftOf("other"))
    ]
  });
  const homeId = await newHome();
  const owner = as(homeId);
  const input = {
    purpose: "plan-bot",
    describe: "I run a dog-grooming salon with two staff",
    bot: { name: "Rota", tag, description: "Plans the staff rota each week." },
    team: [{ name: "Slotwise", description: "Keeps the appointment book." }]
  };
  const { draft, problems } = await bots.draftTemplate(input, owner);
  assert.deepEqual([draft.tag, problems], [tag, []], "its own tag, whatever the answer said");
  assert.equal(calls.drafts.length, 2, "asked once more: the first didn't say it asks first");
  assert.match(calls.drafts[0].messages[0].content, new RegExp(`^Write a template for a bot named Rota, tag ${tag}, whose job is: Plans the staff rota each week\\.$`, "mu"));
  assert.match(calls.drafts[0].messages[0].content, /^The others suggested with it do these jobs, so leave them out: Slotwise: Keeps the appointment book\.$/mu);
  assert.match(calls.drafts[0].system, /in so many words, "Ask before anything leaves this chat\."/u, "the writer is told how Mercbot's are written");
  assert.match(calls.drafts[1].messages[2].content, /instructions: Say, in so many words: "Ask before anything leaves this chat\."/u);
  assert.deepEqual(tracked, [{ work: "chat" }]);

  const taken = await homeTemplate(homeId, fresh("h"));
  await assert.rejects(bots.draftTemplate({ ...input, bot: { ...input.bot, tag: taken.tag } }, owner), { statusCode: 400, code: "bots_template_draft_tag_taken" });
  await assert.rejects(bots.draftTemplate({ ...input, bot: { ...input.bot, tag: "meals" } }, owner), { statusCode: 400, code: "bots_template_draft_tag_taken" });
  await assert.rejects(bots.draftTemplate({ ...input, bot: { ...input.bot, tag: "Rota!" } }, owner), { statusCode: 400, code: "bots_template_draft_bot" });
  await assert.rejects(bots.draftTemplate({ ...input, bot: { name: "Rota", tag } }, owner), { statusCode: 400, code: "bots_template_draft_bot" });
  await assert.rejects(bots.draftTemplate({ ...input, team: Array.from({ length: 8 }, () => input.team[0]) }, owner), { statusCode: 400, code: "bots_template_draft_team" });
  assert.equal(calls.drafts.length, 2, "a refused request asks nothing");
});

test("a paused home's plan is refused with its message, before the model is asked; Add N bots goes through its route", async (context) => {
  const { parts, bots, newHome, pat, calls } = await setup(context);
  const homeId = await newHome();
  const paused = "This home's work is paused, so I can't start anything new.";
  const routes = new Map();
  registerRoutes(
    { router: { register: (method, path, _options, handler) => routes.set(`${method} ${path}`, handler) } },
    {
      bots,
      approvals: {},
      notices: {},
      meter: { pausedMessage: async () => paused, track: (_who, work) => work() },
      records: parts.records,
      streams: new Set()
    }
  );
  const call = async (route, body) => {
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
      body,
      user: { id: pat, displayName: "Pat" },
      workspace: { id: homeId },
      membership: { roleSid: "owner" },
      permissions: ["workspace.settings.update"]
    };
    request.callOptions = async () => requestContextOptions(request);
    await routes.get(route)(request, reply);
    return answer;
  };
  const planned = await call("POST /api/w/:workspaceSlug/bots/plan", { describe: "help with my shop" });
  assert.equal(planned.status, 402);
  assert.deepEqual([planned.body.code, planned.body.error], ["work_paused", paused]);
  assert.equal(calls.plans.length, 0, "the model isn't asked");
  // Making bots asks no model, so a paused home may still add them, as it may add a team.
  const added = await call("POST /api/w/:workspaceSlug/bots/batch", { section: "Shop", bots: [{ library: "shop-stock-keeper" }] });
  assert.equal(added.status, 200);
  assert.equal(added.body.added.length, 1);
});
