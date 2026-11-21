import assert from "node:assert/strict";
import test from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { registerRoutes } from "../../packages/bots/src/server/registerRoutes.js";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { testBot, testHome } from "./testHome.js";
import { serviceDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotParts } from "../support/botRecords.mjs";
import { seedChat } from "../support/chatFixtures.mjs";
import { queriesDuring } from "../support/queryCount.mjs";

// A home's templates made and edited by drafting (D-98, amended 20 November): one billed call per draft, metered like a
// reply, with nothing kept; Save and use in New bot and Change template; Settings → Templates' Edit and Delete for the
// home's owners and admins; and every refusal, decided on the server. The model is a fake answering what each test says.

/** A whole template, valid for a home, with this tag. */
const draftOf = (tag, extra = {}) => ({
  tag,
  description: "Keeps the garden watered.",
  greeting: "Hi {firstName}, I'll keep your garden watered.",
  instructions: "You keep the garden watered. Ask before buying anything.",
  skills: [{ name: "Setup interview", description: "What to ask a new person first.", instructions: "1. Ask which plants they have." }],
  ...extra
});
/** A tag no other test's template has: a letter, then letters and digits. */
const freshTag = (letter = "g") => `${letter}${Math.random().toString(36).slice(2, 8)}`;

async function setup(context, { answers = null } = {}) {
  const knex = await connectTestDatabase();
  const pat = (await knex("users").first()).id;
  const homeId = await testHome(knex, pat);
  const made = [];
  const templates = [];
  const people = [];
  const homes = [];
  context.after(async () => {
    // The templates this test made, and the ones its bots point at; another test's in the same home stay.
    templates.push(...(await knex("bots").whereIn("id", made).pluck("home_template_id")).filter(Boolean));
    await knex("bots").whereIn("id", made).del();
    await knex("home_templates").whereIn("id", templates).whereNotExists(knex("bots").whereRaw("bots.home_template_id = home_templates.id")).del();
    await knex("conversations").whereIn("direct_user_id", people).del();
    await knex("workspace_memberships").whereIn("user_id", people).del();
    await knex("workspaces").whereIn("id", homes).del();
    await knex("users").whereIn("id", people).del();
    await knex.destroy();
  });
  const parts = await startBotParts(knex, context);
  // Each drafting call's system prompt and messages, answered from `answers` in turn, else with a valid draft.
  const writes = [];
  const queue = [...(answers || [])];
  const writeTemplate = async (system, messages) => {
    writes.push({ system, messages });
    return queue.length ? queue.shift() : JSON.stringify(draftOf(freshTag()));
  };
  // Who each drafting call was metered to (meter.track's `who`), around the real meter.
  const tracked = [];
  const meter = { ...parts.meter, track: (who, work) => (tracked.push(who), parts.meter.track(who, work)) };
  const bots = createBotsService(serviceDoubles({ knex, ...parts, meter, writeTemplate, approvals: { decide: async () => "allow" } }));
  /** A member's request in the home; `manages`, an owner's or admin's. */
  const as = (userId, { manages = false } = {}) =>
    memberOptions({ userId, homeId, ...(manages ? { role: "admin", permissions: ["workspace.settings.update"] } : {}) });
  /** Another person: a member of the home, or (`own`) the owner of a home of their own. */
  const someone = async (name, { own = false } = {}) => {
    const stamp = `${name}-${Date.now()}-${people.length}`;
    const [user] = await knex("users")
      .insert({ auth_provider: "test", auth_provider_user_sid: stamp, email: `${stamp}@example.com`, username: stamp.replace(/-/gu, ""), display_name: name })
      .returning("id");
    people.push(user.id);
    if (!own) {
      await knex("workspace_memberships").insert({ workspace_id: homeId, user_id: user.id, role_sid: "member", status: "active" });
      return { id: user.id };
    }
    const [home] = await knex("workspaces").insert({ slug: `own-${stamp}`.toLowerCase(), name: `${name}'s home`, owner_user_id: user.id, is_personal: true }).returning("id");
    homes.push(home.id);
    await knex("workspace_memberships").insert({ workspace_id: home.id, user_id: user.id, role_sid: "owner", status: "active" });
    return { id: user.id, homeId: home.id, options: memberOptions({ userId: user.id, homeId: home.id, role: "owner", permissions: ["workspace.settings.update"] }) };
  };
  /** A bot of the home, removed when the test ends. */
  const bot = async (fields) => {
    const row = await testBot(knex, pat, fields);
    made.push(row.id);
    return row;
  };
  /** One of the home's templates, made straight in the database. */
  const homeTemplate = async (tag = freshTag("h"), workspaceId = homeId) => {
    const [template] = await knex("home_templates").insert({ workspace_id: workspaceId, ...draftOf(tag), skills: JSON.stringify(draftOf(tag).skills), created_by: pat }).returning("*");
    templates.push(template.id);
    return template;
  };
  const count = async (table, where) => Number((await knex(table).where(where).count("* as n").first()).n);
  /** What Pat's direct chat with a bot shows, where a new bot greets its maker and a changed template says so (D-112). */
  const patsChatWith = async (botId) => (await bots.chat.messages((await bots.chats.direct(botId, as(pat))).chat.id, {}, as(pat))).messages;
  return { knex, parts, bots, as, pat, homeId, made, someone, bot, homeTemplate, count, writes, tracked, patsChatWith };
}

test("a new template is drafted in one call, metered to the person and home like a reply, and nothing is kept", async (context) => {
  const tag = freshTag();
  const { bots, as, pat, homeId, writes, tracked, count } = await setup(context, { answers: [`\`\`\`json\n${JSON.stringify(draftOf(tag))}\n\`\`\``] });
  const before = await count("home_templates", { workspace_id: homeId });
  const answer = await bots.draftTemplate({ purpose: "new", describe: "keep our garden watered" }, as(pat));
  assert.deepEqual(answer, { draft: draftOf(tag), problems: [] });
  assert.equal(writes.length, 1, "one call");
  const [{ system, messages }] = writes;
  assert.ok(system.startsWith("You write bot templates for Mercbot."));
  assert.match(system, /Not one of: [^\n]*\bmeals\b/u, "the library's tags are taken");
  assert.match(system, /"tag":"blog"/u, "Mercbot's blog-article-desk is the example");
  assert.deepEqual(messages, [{ role: "user", content: "Write a template for bots that will: keep our garden watered" }]);
  assert.deepEqual(tracked, [{ work: "chat" }], "the chat kind of work, for the request's person and home");
  assert.equal(await count("home_templates", { workspace_id: homeId }), before, "nothing is kept");
  await assert.rejects(bots.draftTemplate({ purpose: "new", describe: "  " }, as(pat)), { statusCode: 400, code: "bots_template_draft_describe_missing" });
  await assert.rejects(bots.draftTemplate({ purpose: "teach", describe: "x" }, as(pat)), { statusCode: 400, code: "bots_template_draft_purpose" });
  assert.equal(writes.length, 1, "a refused request asks nothing");
});

test("a bot's draft reads its template, the person's own newest summary and its routines; additions only when folded", async (context) => {
  const { knex, bots, as, pat, bot, someone, writes, tracked } = await setup(context);
  const kitchen = await bot({ name: "Kitchen", library_template: "weekly-meal-planner", additions: "We're vegetarian." });
  // A conversation's summaries are a chain, each following the one before it.
  const [older] = await knex("agent_summaries")
    .insert({ conversation_id: kitchen.conversation_id, covers_up_to: 1, summary: "AN OLDER SUMMARY", messages: 1 })
    .returning("id");
  await knex("agent_summaries").insert({
    conversation_id: kitchen.conversation_id, covers_up_to: 2, summary: "Pat plans vegetarian dinners for four.", messages: 2, follows: older.id
  });
  // Kim's own chat with the same bot: never read for Pat's draft.
  const kim = await someone("Kim");
  const kims = await seedChat(knex, { homeId: kitchen.workspace_id, direct: { userId: kim.id, botId: kitchen.id } });
  await knex("agent_summaries").insert({ conversation_id: kims.id, covers_up_to: 5, summary: "KIM'S OWN CHAT", messages: 5 });
  await knex("bot_routines").insert({
    workspace_id: kitchen.workspace_id, chat_bot_id: kitchen.chat_bot_id, made_by: pat, name: "Weekly plan", schedule: "Sundays at 5pm"
  });

  await bots.draftTemplate({ purpose: "from-bot", botId: String(kitchen.id) }, as(pat));
  const asked = writes.at(-1).messages[0].content;
  assert.match(asked, /^Write a template from this bot, Kitchen, for every bot that does the same job\.\nIts template now: \{"tag":"meals",/u);
  assert.match(asked, /\nHow it has been used: Pat plans vegetarian dinners for four\.\n/u, "the newest summary of Pat's own chat");
  assert.match(asked, /\nIts routines: Weekly plan \(Sundays at 5pm\)$/u);
  for (const absent of ["KIM'S OWN CHAT", "AN OLDER SUMMARY", "We're vegetarian.", "Its additions"]) assert.ok(!asked.includes(absent), absent);
  assert.deepEqual(tracked.at(-1), { botId: String(kitchen.id), work: "chat" }, "metered to the bot too");

  await bots.draftTemplate({ purpose: "from-bot", botId: String(kitchen.id), foldAdditions: true }, as(pat));
  assert.match(writes.at(-1).messages[0].content, /\nIts additions, to fold into the template: We're vegetarian\.$/u);
  assert.equal((await knex("bots").where({ id: kitchen.id }).first()).additions, "We're vegetarian.", "drafting keeps nothing");
});

test("a change sends the whole draft and the request; a template being edited keeps its own tag", async (context) => {
  const { bots, as, pat, homeTemplate, writes } = await setup(context);
  const tag = freshTag();
  const own = await homeTemplate();
  await bots.draftTemplate({ purpose: "change", draft: { ...draftOf(tag), slug: "ignored" }, request: "Also water on Fridays." }, as(pat));
  const { system, messages } = writes.at(-1);
  assert.equal(messages[0].content, `Here is a template: ${JSON.stringify(draftOf(tag))}\nChange it as asked, keeping everything else exactly as it is, and answer with the whole template:\nAlso water on Fridays.`);
  const taken = (text) => /Not one of: ([^\n]*)\.\n/u.exec(text)[1].split(", ");
  assert.ok(taken(system).includes(own.tag), "a new template can't take a home template's tag");
  await bots.draftTemplate({ purpose: "change", templateId: String(own.id), draft: draftOf(own.tag), request: "Shorter." }, as(pat, { manages: true }));
  assert.ok(!taken(writes.at(-1).system).includes(own.tag), "the template being edited keeps its own");
  await assert.rejects(bots.draftTemplate({ purpose: "change", templateId: String(own.id), draft: draftOf(own.tag), request: "Shorter." }, as(pat)), {
    statusCode: 403, code: "bots_template_manage_forbidden"
  });
  await assert.rejects(bots.draftTemplate({ purpose: "change", draft: draftOf(tag), request: "" }, as(pat)), { statusCode: 400, code: "bots_template_draft_request_missing" });
});

test("an answer that isn't a whole template is asked for once more with its problems, then refused", async (context) => {
  const tag = freshTag();
  const missingGreeting = JSON.stringify(draftOf(freshTag(), { greeting: "Hello." }));
  const { bots, as, pat, writes } = await setup(context, { answers: ["Sure! Here's a template for you.", JSON.stringify(draftOf(tag)), JSON.stringify(draftOf("meals")), missingGreeting] });
  const answer = await bots.draftTemplate({ purpose: "new", describe: "keep our garden watered" }, as(pat));
  assert.equal(answer.draft.tag, tag);
  assert.equal(writes.length, 2, "asked once more");
  assert.deepEqual(writes[1].messages.slice(0, 2), [
    { role: "user", content: "Write a template for bots that will: keep our garden watered" },
    { role: "assistant", content: "Sure! Here's a template for you." }
  ]);
  assert.match(writes[1].messages[2].content, /^That template can't be used: answer: It isn't one JSON object\. Answer again with the whole template/u);

  await assert.rejects(bots.draftTemplate({ purpose: "new", describe: "plan meals" }, as(pat)), (error) => {
    assert.deepEqual([error.statusCode, error.code, error.message], [422, "bots_template_draft_failed", "Couldn't write a template from that. Try different words."]);
    return true;
  });
  assert.equal(writes.length, 4, "two calls, then refused");
  assert.match(writes[3].messages[2].content, /tag: Another template already has this tag\./u);
});

test("drafting from a bot needs mayChangeBot; another home's bot and template are none; members don't edit or delete", async (context) => {
  const { knex, bots, as, pat, bot, someone, homeTemplate, writes } = await setup(context);
  const guarded = await bot({ name: "Guarded", library_template: "general" });
  const kim = await someone("Kim");
  await assert.rejects(bots.draftTemplate({ purpose: "from-bot", botId: String(guarded.id) }, as(kim.id)), (error) => {
    assert.deepEqual([error.statusCode, error.code], [403, "bots_template_forbidden"]);
    assert.equal(error.message, "Only the person who made Guarded and the home's owners and admins can change its template or additions.");
    return true;
  });
  // An owner or admin may, as for Change template.
  await bots.draftTemplate({ purpose: "from-bot", botId: String(guarded.id) }, as(kim.id, { manages: true }));

  const sam = await someone("Sam", { own: true });
  const theirs = await homeTemplate(freshTag("t"), sam.homeId);
  await assert.rejects(bots.draftTemplate({ purpose: "from-bot", botId: String(guarded.id) }, sam.options), { statusCode: 404, code: "bots_bot_not_found" });
  await assert.rejects(bots.draftTemplate({ purpose: "from-bot", botId: "x1" }, as(pat)), { statusCode: 404, code: "bots_bot_not_found" });
  const owner = as(pat, { manages: true });
  await assert.rejects(bots.draftTemplate({ purpose: "change", templateId: String(theirs.id), draft: draftOf(theirs.tag), request: "x" }, owner), { statusCode: 404 });
  await assert.rejects(bots.homeTemplate(String(theirs.id), owner), { statusCode: 404, code: "bots_template_not_found" });
  await assert.rejects(bots.editHomeTemplate(String(theirs.id), { draft: draftOf(theirs.tag), updatedAt: theirs.updated_at.toISOString() }, owner), { statusCode: 404 });
  await assert.rejects(bots.deleteHomeTemplate(String(theirs.id), owner), { statusCode: 404 });
  await assert.rejects(bots.changeTemplate(guarded.id, { home: String(theirs.id) }, "Pat", owner), { statusCode: 404 });

  const ours = await homeTemplate();
  const opened = await bots.homeTemplate(String(ours.id), as(kim.id));
  await assert.rejects(bots.editHomeTemplate(String(ours.id), { draft: draftOf(ours.tag, { instructions: "Mine." }), updatedAt: opened.updatedAt }, as(kim.id)), {
    statusCode: 403, code: "bots_template_manage_forbidden"
  });
  await assert.rejects(bots.deleteHomeTemplate(String(ours.id), as(kim.id)), { statusCode: 403, code: "bots_template_manage_forbidden" });
  assert.equal((await knex("home_templates").where({ id: ours.id }).first()).instructions, draftOf(ours.tag).instructions, "nothing changed");
  assert.equal((await knex("home_templates").where({ id: theirs.id }).first()).tag, theirs.tag, "nothing changed in Sam's home");
  assert.equal(writes.length, 1, "only the allowed draft asked the model");
});

test("Save and use: New bot makes the template and the bot on it, from the draft's five parts only", async (context) => {
  const { knex, bots, as, pat, made, count, homeId, patsChatWith } = await setup(context);
  const tag = freshTag();
  // A body a client claims is one of Mercbot's library: it's only ever a new home template.
  const claimed = { ...draftOf(tag), slug: "weekly-meal-planner", source: "library", creator: "the Mercbot team", tested: "2026-11-20", routines: [] };
  const made1 = await bots.createBot({ name: "Gardener", color: "#1E86FC", template: { draft: claimed } }, as(pat));
  made.push(made1.id);
  assert.deepEqual(made1.template, { tag, source: "home", description: "Keeps the garden watered." });
  assert.equal(made1.onboardingStep, null, "it greets with its template's greeting instead of the general introduction");
  const row = await knex("bots").where({ id: made1.id }).first();
  const kept = await knex("home_templates").where({ id: row.home_template_id }).first();
  assert.equal(row.library_template, null);
  assert.deepEqual(
    [kept.workspace_id, kept.tag, kept.description, kept.greeting, kept.instructions, kept.skills, String(kept.created_by)],
    [row.workspace_id, tag, claimed.description, claimed.greeting, claimed.instructions, claimed.skills, String(pat)]
  );
  assert.equal(bots.templateGallery().templates.some((entry) => entry.tag === tag), false, "never in Mercbot's library");
  assert.match((await bots.templateDetails("weekly-meal-planner", as(pat))).instructions, /allerg/u, "the library's template is its file's");
  assert.match((await patsChatWith(made1.id)).at(-1).body.text, /^Hi(?: [^,]+)?, I'll keep your garden watered\.$/u);

  // A library choice and a draft at once is refused; the library's own and Mercbot's general one still work.
  await assert.rejects(bots.createBot({ name: "Both", color: "#1E86FC", template: { library: "weekly-meal-planner", draft: draftOf(freshTag()) } }, as(pat)), {
    statusCode: 400, code: "bots_template_two_choices"
  });
  const pantry = await bots.createBot({ name: "Larder", color: "#1E86FC", template: { library: "weekly-meal-planner", instructions: "Mine." } }, as(pat));
  made.push(pantry.id);
  assert.deepEqual([pantry.template.tag, pantry.template.source], ["meals", "library"]);
  assert.match((await patsChatWith(pantry.id)).at(-1).body.text, /I'm Larder\./u, "the template's greeting, as the bot");
  const plain = await bots.createBot({ name: "Plain", color: "#1E86FC", template: { library: "general" } }, as(pat));
  made.push(plain.id);
  assert.deepEqual([plain.template.tag, plain.onboardingStep], ["general", "intro-greet"]);

  // A draft with problems makes nothing, and says what's wrong at each part.
  const templates = await count("home_templates", { workspace_id: homeId });
  const bad = draftOf(freshTag(), { greeting: "Hello.", skills: [] });
  await assert.rejects(bots.createBot({ name: "Broken", color: "#1E86FC", template: { draft: bad } }, as(pat)), (error) => {
    assert.deepEqual([error.statusCode, error.code], [422, "bots_template_draft_invalid"]);
    assert.deepEqual(error.params.problems.map((problem) => problem.field), ["greeting", "skills", "setup"]);
    return true;
  });
  assert.equal(await count("home_templates", { workspace_id: homeId }), templates);
  assert.equal(await count("bots", { name: "Broken", workspace_id: homeId }), 0);
});

test("Save and use in Change template points the bot at the new template; folding in empties its additions only when ticked", async (context) => {
  const { knex, bots, as, pat, bot, patsChatWith } = await setup(context);
  const kept = await bot({ name: "Keeps", library_template: "general", additions: "Keep me." });
  const folded = await bot({ name: "Folds", library_template: "general", additions: "Fold me." });
  const other = await bot({ name: "Library", library_template: "general", additions: "Stay." });
  const row = async (id) => knex("bots").where({ id }).first("library_template", "home_template_id", "additions");

  const first = freshTag();
  const changed = await bots.changeTemplate(kept.id, { draft: draftOf(first), foldAdditions: false }, "Pat", as(pat));
  assert.deepEqual([changed.template.tag, changed.template.source, changed.hasAdditions], [first, "home", true]);
  const after = await row(kept.id);
  assert.deepEqual([after.library_template, after.additions], [null, "Keep me."]);
  assert.equal((await knex("home_templates").where({ id: after.home_template_id }).first()).tag, first, "the bot points at the new template");

  await bots.changeTemplate(folded.id, { draft: draftOf(freshTag(), { instructions: "Water the garden.\n\nFold me." }), foldAdditions: true }, "Pat", as(pat));
  assert.equal((await row(folded.id)).additions, "", "folded in, so emptied");
  // Folding goes with a draft: a template of the library's leaves the additions.
  await bots.changeTemplate(other.id, { library: "weekly-meal-planner", foldAdditions: true }, "Pat", as(pat));
  assert.deepEqual(await row(other.id), { library_template: "weekly-meal-planner", home_template_id: null, additions: "Stay." });
  assert.equal((await patsChatWith(kept.id)).at(-2).body.text, `Now a ${first} bot`);
});

test("an edit records its change line and how many bots it reaches; a stale updatedAt gets 409", async (context) => {
  const { knex, bots, as, bot, someone, homeTemplate, count } = await setup(context);
  const template = await homeTemplate();
  const since = new Date(Date.now() - 60000);
  const users = [await bot({ name: "Uses one", home_template_id: template.id, template_since: since }), await bot({ name: "Uses two", home_template_id: template.id, template_since: since })];
  const ada = await someone("Ada");
  const admin = as(ada.id, { manages: true });
  const opened = await bots.homeTemplate(String(template.id), admin);
  assert.deepEqual([opened.greeting, opened.skills[0].instructions, opened.usedBy], [draftOf(template.tag).greeting, "1. Ask which plants they have.", 2]);
  const { id: _id, usedBy: _usedBy, updatedAt: _updatedAt, ...current } = opened;

  const draft = { ...current, instructions: "You keep the garden and the pond watered.", skills: [{ ...current.skills[0], instructions: "1. Ask which plants and fish they have." }] };
  const saved = await bots.editHomeTemplate(String(template.id), { draft, updatedAt: opened.updatedAt }, admin);
  assert.deepEqual([saved.template.usedBy, saved.changed], [2, ["instructions", "setup questions"]], "the warning's count");
  const [change] = await knex("home_template_changes").where({ home_template_id: template.id });
  assert.deepEqual([change.summary, String(change.changed_by)], ["Instructions and setup questions changed by Ada", String(ada.id)]);
  const read = await bots.instructionsOf(String(users[0].id), as(ada.id));
  assert.deepEqual([read.template.instructions, read.template.changed.text], ["You keep the garden and the pond watered.", "Instructions and setup questions changed by Ada"]);

  // Someone saved since: the old updatedAt is refused, and nothing changes.
  await assert.rejects(bots.editHomeTemplate(String(template.id), { draft: { ...draft, instructions: "Lost." }, updatedAt: opened.updatedAt }, admin), {
    statusCode: 409, code: "bots_template_stale"
  });
  assert.equal((await knex("home_templates").where({ id: template.id }).first()).instructions, "You keep the garden and the pond watered.");
  // Saved with nothing changed: no line. A tag another template has: its problem, at the tag.
  const again = await bots.homeTemplate(String(template.id), admin);
  assert.deepEqual((await bots.editHomeTemplate(String(template.id), { draft, updatedAt: again.updatedAt }, admin)).changed, []);
  assert.equal(await count("home_template_changes", { home_template_id: template.id }), 1);
  await assert.rejects(bots.editHomeTemplate(String(template.id), { draft: { ...draft, tag: "meals" }, updatedAt: again.updatedAt }, admin), (error) => {
    assert.deepEqual([error.statusCode, error.params.problems], [422, [{ field: "tag", text: "Another template already has this tag." }]]);
    return true;
  });
});

test("Delete while a bot uses the template gets 409; once unused it goes, with its changes", async (context) => {
  const { knex, bots, as, pat, bot, homeTemplate, count } = await setup(context);
  const template = await homeTemplate();
  const user = await bot({ name: "Uses it", home_template_id: template.id });
  await knex("home_template_changes").insert({ workspace_id: user.workspace_id, home_template_id: template.id, summary: "Instructions changed by Pat" });
  const owner = as(pat, { manages: true });
  await assert.rejects(bots.deleteHomeTemplate(String(template.id), owner), (error) => {
    assert.deepEqual([error.statusCode, error.code, error.params.usedBy, error.message], [409, "bots_template_in_use", 1, `A bot uses ${template.tag}. Change their template first.`]);
    return true;
  });
  assert.equal(await count("home_templates", { id: template.id }), 1);
  await bots.changeTemplate(user.id, { library: "general" }, "Pat", owner);
  assert.deepEqual(await bots.deleteHomeTemplate(String(template.id), owner), { deleted: String(template.id) });
  assert.deepEqual([await count("home_templates", { id: template.id }), await count("home_template_changes", { home_template_id: template.id })], [0, 0]);
});

// Settings → Templates (D-98): "Used by N bots" is one aggregate, so the list costs the same however many templates.
test("Settings → Templates costs the same with 3 templates as with 40, and says who may edit", async (context) => {
  const { knex, bots, as, pat, bot, homeTemplate } = await setup(context);
  const ours = [];
  const grow = async (size) => {
    while (ours.length < size) {
      const template = await homeTemplate(`n${String(ours.length).padStart(2, "0")}${freshTag("x").slice(1, 6)}`);
      ours.push(template);
      // Every third used by two bots, the next by one, the rest by none.
      for (let n = 0; n < [2, 1, 0][ours.length % 3]; n += 1) await bot({ name: `Uses ${template.tag} ${n}`, home_template_id: template.id });
    }
  };
  const measured = async (size) => {
    await grow(size);
    let list = null;
    const queries = await queriesDuring(knex, async () => {
      list = await bots.homeTemplates(as(pat));
    });
    const shown = new Map(list.templates.map((entry) => [entry.id, entry.usedBy]));
    assert.deepEqual(ours.map((template) => shown.get(String(template.id))), ours.map((_, index) => [2, 1, 0][(index + 1) % 3]));
    return queries;
  };
  await measured(2);
  const few = await measured(3);
  const many = await measured(40);
  assert.equal(many, few, `with 40 templates: ${many} queries, with 3: ${few}`);
  assert.equal((await bots.homeTemplates(as(pat))).canManage, false, "a member sees the list, without Edit and Delete");
  assert.equal((await bots.homeTemplates(as(pat, { manages: true }))).canManage, true);
});

test("a paused home's drafting is refused with its message, before the model is asked", async (context) => {
  const { parts, bots, pat, homeId, writes } = await setup(context);
  const paused = "This home's work is paused, so I can't start anything new.";
  const asked = [];
  const routes = new Map();
  registerRoutes(
    { router: { register: (method, path, _options, handler) => routes.set(`${method} ${path}`, handler) } },
    {
      bots,
      approvals: {},
      notices: {},
      meter: { pausedMessage: async (home) => (asked.push(String(home)), paused), track: (_who, work) => work() },
      records: parts.records,
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
    body: { purpose: "new", describe: "keep our garden watered" },
    user: { id: pat },
    workspace: { id: homeId },
    membership: { roleSid: "owner" },
    permissions: ["workspace.settings.update"]
  };
  request.callOptions = async () => requestContextOptions(request);
  await routes.get("POST /api/w/:workspaceSlug/bots/templates/draft")(request, reply);
  assert.equal(answer.status, 402);
  assert.deepEqual([answer.body.code, answer.body.error], ["work_paused", paused]);
  assert.deepEqual(asked, [String(homeId)], "the home's pause is read");
  assert.equal(writes.length, 0, "the model isn't asked");
});
