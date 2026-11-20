import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { queriesDuring } from "../support/queryCount.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { createMeter, currentWork } from "../../packages/account/src/server/meter.js";
import { createBotsService } from "../../packages/bots/src/server/botsService.js";
import { registerRoutes } from "../../packages/bots/src/server/registerRoutes.js";
import { FREE_RECORDER, serviceDoubles } from "../support/botDoubles.mjs";
import { memberOptions, startBotParts } from "../support/botRecords.mjs";

// Bots decide when to join in (D-102), against the disposable test database, each test in a home of its own: in a
// Shared bot's shared tab with two people, a message that doesn't call the bot goes through one judging call (here a
// stand-in model that answers what the test says and records what it was asked, and for whom), a yes runs the turn
// and a no leaves nothing, marked so nothing takes it up again; a call is always answered; the home's setting turns
// judging off, for its owners and admins only; You only, a home of one, groups, Private and Mixed bots never judge; a
// burst gets one judgement; a failing judge stays quiet; and the statements don't grow with the tab.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const MANAGE = ["workspace.settings.update"];
const texts = (page) => page.messages.filter((message) => message.kind === "text").map((message) => message.body.text);

/** What one judging call was given: its instructions, the conversation, its options and whose work it ran in. */
function judgeOf(options, meter) {
  const system = options.prompt.filter((message) => message.role === "system").map((message) => message.content).join("\n");
  const user = options.prompt.filter((message) => message.role === "user").flatMap((message) => message.content)
    .map((part) => part.text || "").join("");
  return { system, user, providerOptions: options.providerOptions, maxOutputTokens: options.maxOutputTokens, who: meter.currentMeter(), work: currentWork() };
}

/**
 * A home of its own (Hilltop) with Pat, its owner, and `others` more people (Kim first), the Shared bot Ledger with
 * its General tab, and a bots service whose replies say "Noted." and whose model is the judge the test steers
 * (`judging.answer`: its text, or an Error to fail). `news` is every event sent to open pages.
 */
async function setup(context, { others = ["Kim"] } = {}) {
  const knex = await connectTestDatabase();
  const pat = String((await knex("users").orderBy("id").first()).id);
  const stamp = randomBytes(4).toString("hex");
  const people = [];
  for (const name of others) {
    const sid = `${name.toLowerCase()}-${stamp}`;
    const [row] = await knex("users")
      .insert({ auth_provider: "test", auth_provider_user_sid: sid, email: `${sid}@example.com`, username: sid.replace(/-/gu, ""), display_name: name })
      .returning("id");
    people.push(String(row.id));
  }
  const [home] = await knex("workspaces").insert({ slug: `join-in-${stamp}`, name: "Hilltop", owner_user_id: pat, is_personal: false }).returning("id");
  const homeId = String(home.id);
  await knex("workspace_memberships").insert([
    { workspace_id: homeId, user_id: pat, role_sid: "owner", status: "active" },
    ...people.map((userId) => ({ workspace_id: homeId, user_id: userId, role_sid: "member", status: "active" }))
  ]);
  await knex("workspace_settings").insert({ workspace_id: homeId });
  context.after(async () => {
    await knex("bots").where({ workspace_id: homeId }).del();
    await knex("workspace_settings").where({ workspace_id: homeId }).del();
    await knex("workspace_memberships").where({ workspace_id: homeId }).del();
    await knex("workspaces").where({ id: homeId }).del();
    await knex("users").whereIn("id", people).del();
    await knex.destroy();
  });
  const parts = await startBotParts(knex, context);
  const meter = { ...createMeter({ recorder: FREE_RECORDER }), pausedMessage: async () => null };
  const judging = { answer: "{\"reply\": false}", calls: [] };
  // Only the judging call is the judge's; any other one-shot writing (none is expected here) gets a plain answer.
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const call = judgeOf(options, meter);
      const judgement = call.system.startsWith("You decide whether ");
      if (judgement) judging.calls.push(call);
      if (judgement && judging.answer instanceof Error) throw judging.answer;
      return {
        content: [{ type: "text", text: judgement ? judging.answer : "Noted." }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
        warnings: []
      };
    }
  });
  const turns = [];
  const spoke = [];
  const news = [];
  const bots = createBotsService(serviceDoubles({
    knex,
    ...parts,
    meter,
    model,
    approvals: { decide: async () => "allow" },
    notices: {
      publish: async (_topic, _userId, event) => { news.push(event); },
      publishEach: async (_topic, _userIds, event) => { news.push(event); },
      subscribe: () => () => {}
    },
    reply: async (current, history) => {
      turns.push({ bot: String(current.id), history: history.filter((message) => message.kind === "text").map((message) => message.body.text) });
      return { text: "Noted.", transcript: [] };
    },
    groupReply: async (bot) => {
      spoke.push(bot.name);
      return `${bot.name} here.`;
    }
  }));
  context.after(() => bots.drain(10000));
  const as = (userId, role = "member") => memberOptions({ userId, homeId, role, permissions: role === "member" ? [] : MANAGE });
  const owner = as(pat, "owner");
  const makeBot = async (name, fields = {}) =>
    (await knex("bots").insert({ user_id: pat, workspace_id: homeId, name, color: "#1E86FC", ...fields }).returning("*"))[0];
  const bot = await makeBot("Ledger");
  await bots.updateBot(bot.id, { sharing: "shared" }, owner);
  const general = (await bots.listBots(owner)).bots.find((entry) => entry.id === String(bot.id)).rooms[0].id;
  /** Someone says something in a tab (General unless named); answers the message as stored. */
  const say = async (person, text, { room = general, botId = bot.id, ...more } = {}) =>
    (await bots.sendMessage(botId, { text, room, ...more }, as(person))).messages.at(-1);
  /** The page asks for the reply, as the person's page does, and everything it left behind finishes. */
  const ask = async (person, input = {}, { room = general, botId = bot.id } = {}) => {
    const result = await bots.replyTo(botId, { room, ...input }, undefined, as(person));
    await bots.drain(10000);
    return result;
  };
  const tabTexts = async (room = general) => texts(await bots.messages(bot.id, room, {}, owner));
  const bodyOf = async (messageId) => (await knex("bot_messages").where({ id: messageId }).first()).body;
  return { knex, parts, bots, meter, homeId, pat, kim: people[0], people, bot, general, judging, turns, spoke, news, as, owner, makeBot, say, ask, tabTexts, bodyOf };
}

test("on, a message that doesn't call the bot is judged once; yes runs the turn, metered on the turn's own ticket", async (context) => {
  const { parts, bots, meter, homeId, pat, kim, bot, general, judging, turns, say, ask, tabTexts } = await setup(context);
  // The tab's first person message calls the bot: no judgement.
  await say(kim, "Morning, everyone");
  await ask(kim);
  assert.deepEqual([judging.calls.length, turns.length], [0, 1], "the first message in a new tab is answered");

  const asked = await say(pat, "Does anyone know when the hardware shop opens on Sundays?");
  judging.answer = "```json\n{\"reply\": true}\n```";
  // Through the route, as the page asks: the reply runs for its person, bot and home (D-73).
  const routes = new Map();
  registerRoutes(
    { router: { register: (method, path, _options, handler) => routes.set(`${method} ${path}`, handler) } },
    { bots, approvals: {}, notices: {}, meter, records: parts.records, streams: new Set() }
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
    params: { workspaceSlug: `home-${homeId}`, botId: String(bot.id) },
    body: { room: general, afterMessageId: asked.id },
    user: { id: pat, displayName: "Pat" },
    workspace: { id: homeId },
    membership: { roleSid: "owner" },
    permissions: MANAGE
  };
  request.callOptions = async () => requestContextOptions(request);
  await routes.get("POST /api/w/:workspaceSlug/bots/:botId/reply")(request, reply);
  await bots.drain(10000);
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.deepEqual(texts(answer.body), ["Noted."], "yes: the normal turn ran and answered");
  assert.equal(turns.length, 2);
  assert.equal(judging.calls.length, 1, "one judging call");
  const [judged] = judging.calls;
  assert.deepEqual(judged.who, { userId: pat, botId: String(bot.id), workspaceId: homeId, work: "chat" }, "on the turn's ticket, as chat work");
  assert.equal(judged.work, "chat");
  assert.equal(judged.providerOptions?.deepseek?.thinking?.type, "disabled", "without reasoning");
  assert.ok(judged.maxOutputTokens <= 32, "a few tokens out");
  assert.match(judged.system, /^You decide whether Ledger, a bot in a shared conversation, should answer the latest message\./u);
  assert.match(judged.system, /Ledger's job: An all-round helper/u, "its job is its template's description, else the general one");
  assert.match(judged.system, /When unsure, answer false\.$/u);
  const lines = judged.user.split("\n");
  assert.deepEqual(lines.slice(0, 3), [
    "The conversation, oldest first; decide on the last message:",
    "[Kim]: Morning, everyone",
    "[Ledger]: Noted."
  ], "the tab's text messages, oldest first, each named by its speaker");
  assert.match(lines[3], /^\[[^\]]+\]: Does anyone know when the hardware shop opens on Sundays\?$/u, "the one decided on last");
  assert.equal(lines.length, 4);
  assert.deepEqual((await tabTexts()).slice(-2), ["Does anyone know when the hardware shop opens on Sundays?", "Noted."]);
});

test("on and no: nothing is posted, no working line is sent, the message is marked, and nothing takes it up again", async (context) => {
  const { kim, pat, judging, turns, news, say, ask, tabTexts, bodyOf } = await setup(context);
  await say(kim, "Are we still on for dinner?");
  await ask(kim);
  news.length = 0;
  const chat = await say(pat, "Yes, see you at seven.");
  const before = news.length;
  const result = await ask(pat, { afterMessageId: chat.id });
  assert.deepEqual(result.messages, [], "no reply");
  assert.equal(result.bot.preview, undefined, "and the bot's line in the list keeps what it showed");
  assert.equal(judging.calls.length, 1);
  assert.equal(turns.length, 1, "no turn ran");
  const told = news.slice(before).map((event) => event.type);
  assert.ok(!told.includes("working"), `no working line, on any page: ${told}`);
  assert.ok(!told.includes("messages"), `and no new messages: ${told}`);
  assert.equal((await tabTexts()).at(-1), "Yes, see you at seven.");
  assert.equal((await bodyOf(chat.id)).judged, "quiet", "the message is marked");

  // Asked again, after it or without saying where from: no second judgement, nothing posted.
  assert.deepEqual((await ask(pat, { afterMessageId: chat.id })).messages, []);
  assert.deepEqual((await ask(kim, {})).messages, []);
  assert.deepEqual([judging.calls.length, turns.length], [1, 1], "not taken up again");
});

test("a call is always answered, never judged: the name, an @-mention, a reply to the bot, a card's answer", async (context) => {
  const { knex, bots, homeId, pat, kim, bot, general, judging, turns, as, say, ask } = await setup(context);
  await say(kim, "Hello all");
  await ask(kim);
  const called = async (person, text, more = {}) => {
    const before = turns.length;
    await say(person, text, more);
    await ask(person);
    assert.equal(turns.length, before + 1, `"${text}" is answered`);
  };
  await called(pat, "ledger, what's on the calendar today?");
  await called(kim, "What do you think, LEDGER");
  await called(pat, `<@bot:${bot.id}> any news?`);
  const botLine = (await bots.messages(bot.id, general, {}, as(pat))).messages.filter((message) => message.role === "bot").at(-1);
  await called(kim, "Can you say more?", { replyTo: { id: botLine.id } });
  assert.equal(judging.calls.length, 0, "none of them judged");

  // A reply to a person's message, and a name inside another word, don't call it: those are judged.
  const kims = await say(kim, "I'll bring the salad");
  await say(pat, "Great, thanks", { replyTo: { id: kims.id } });
  await ask(pat);
  await say(kim, "Ledgerman was a great film");
  await ask(kim);
  assert.equal(judging.calls.length, 2);

  // A message it left quiet, then a card it shows (as a reply carried on can), answered: the page asks for the card's
  // reply, which runs, though the newest text message is one it left to the people. (Typing closes an open card.)
  const quiet = await say(kim, "Nice weather today");
  await ask(kim, { afterMessageId: quiet.id });
  assert.equal(judging.calls.length, 3);
  const [card] = await knex("bot_messages").insert({
    workspace_id: homeId, bot_id: bot.id, conversation_id: general, kind: "choice", role: "bot",
    body: { question: "Book the usual table?", options: ["Yes", "No"], multi: false }
  }).returning("id");
  const before = turns.length;
  await bots.answerChoice(bot.id, String(card.id), ["Yes"], as(pat));
  // Asked from the newest message the page has, the card: without afterCard the quiet message would settle it.
  await ask(pat, { afterMessageId: String(card.id), afterCard: true });
  assert.equal(turns.length, before + 1, "the card's answer is answered");
  assert.equal(judging.calls.length, 3, "and not judged");
});

test("off, only a call is answered, with no judging call; only owners and admins turn it off, through the route too", async (context) => {
  const { knex, parts, bots, homeId, pat, kim, judging, turns, as, owner, say, ask, bodyOf } = await setup(context);
  await say(kim, "Hi");
  await ask(kim);
  await assert.rejects(bots.changeHomeSettings({ botsJoinIn: false }, as(kim)), (error) => error.statusCode === 403 && error.code === "bots_home_default_forbidden");
  await assert.rejects(bots.changeHomeSettings({ botsJoinIn: "no" }, owner), (error) => error.statusCode === 400);
  assert.equal(await knex("home_settings").where({ workspace_id: homeId }).first(), undefined, "a refusal keeps nothing");
  assert.deepEqual(await bots.homeDefault(as(kim)), { newBotSharing: "mixed", chosen: false, teamQuestion: null, botsJoinIn: true }, "on with nothing set");

  // The route, as a request reaches it.
  const routes = new Map();
  registerRoutes(
    { router: { register: (method, path, _options, handler) => routes.set(`${method} ${path}`, handler) } },
    { bots, approvals: {}, notices: {}, meter: { track: (_who, work) => work() }, records: parts.records, streams: new Set() }
  );
  const patch = async (userId, role, body) => {
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
      params: { workspaceSlug: `home-${homeId}` }, body, user: { id: userId }, workspace: { id: homeId }, membership: { roleSid: role },
      permissions: role === "member" ? [] : MANAGE
    };
    request.callOptions = async () => requestContextOptions(request);
    await routes.get("PATCH /api/w/:workspaceSlug/home-settings")(request, reply);
    return answer;
  };
  const refused = await patch(kim, "member", { botsJoinIn: false });
  assert.deepEqual([refused.status, refused.body.code], [403, "bots_home_default_forbidden"]);
  // Each setting keeps the other's value: a row made by choosing new bots' mode is on, and turning it off keeps the mode.
  assert.equal((await bots.changeHomeSettings({ newBotSharing: "shared" }, owner)).botsJoinIn, true);
  const off = await patch(pat, "owner", { botsJoinIn: false });
  assert.deepEqual([off.status, off.body.botsJoinIn, off.body.newBotSharing], [200, false, "shared"]);
  assert.equal((await bots.changeHomeSettings({ newBotSharing: "private" }, owner)).botsJoinIn, false);
  const row = await knex("home_settings").where({ workspace_id: homeId }).first();
  assert.deepEqual([row.bots_join_in, row.new_bot_sharing, String(row.updated_by)], [false, "private", pat]);

  const chat = await say(kim, "Is it raining where you are?");
  assert.deepEqual((await ask(kim)).messages, [], "not called: nothing");
  assert.equal((await bodyOf(chat.id)).judged, "quiet");
  assert.equal(judging.calls.length, 0, "and no judging call");
  const before = turns.length;
  await say(kim, "Ledger, is it raining in town?");
  await ask(kim);
  assert.equal(turns.length, before + 1, "called: answered");

  // On again, it judges again.
  assert.equal((await bots.changeHomeSettings({ botsJoinIn: true }, owner)).botsJoinIn, true);
  await say(pat, "Shall we go for a walk?");
  await ask(pat);
  assert.equal(judging.calls.length, 1);
});

test("You only, a home of one, groups, and Private and Mixed bots never judge", async (context) => {
  const { knex, bots, pat, kim, bot, judging, turns, spoke, as, owner, makeBot, say, ask } = await setup(context);
  const seat = String((await knex("bot_conversations").where({ bot_id: bot.id, user_id: pat }).first()).id);
  // You only.
  await say(pat, "Remind me what I said", { room: seat });
  await ask(pat, {}, { room: seat });
  await say(pat, "Lovely weather", { room: seat });
  await ask(pat, {}, { room: seat });
  // Private and Mixed bots, in someone's own chat.
  for (const sharing of ["private", "mixed"]) {
    const other = await makeBot(`Scribe ${sharing}`, { sharing });
    await say(kim, "Lovely weather", { room: null, botId: other.id });
    await ask(kim, {}, { room: null, botId: other.id });
  }
  assert.deepEqual([turns.length, judging.calls.length], [4, 0], "each answered, none judged");

  // A group with both people and the Shared bot: D-46's rule, nobody named, nobody speaks, no judging call.
  const { bot: group } = await bots.createGroup({ botIds: [String(bot.id)], text: "Let's plan the weekend" }, "Pat", owner);
  await bots.addPerson(group.id, kim, owner);
  await bots.sendMessage(group.id, { text: "Lovely weather" }, as(kim));
  await bots.replyTo(group.id, {}, "Kim", as(kim));
  await bots.drain(10000);
  assert.deepEqual([spoke, judging.calls.length], [[], 0]);
});

test("in a home of one, a Shared bot answers every message in its shared tabs, unjudged", async (context) => {
  const { judging, turns, pat, say, ask } = await setup(context, { others: [] });
  for (const text of ["Hello", "Lovely weather", "Thanks"]) {
    await say(pat, text);
    await ask(pat);
  }
  assert.deepEqual([turns.length, judging.calls.length], [3, 0]);
});

test("three quick messages get one judgement, on the latest, and nothing is left to take up", async (context) => {
  const { pat, kim, judging, turns, say, ask, bodyOf } = await setup(context);
  await say(kim, "Hi all");
  await ask(kim);
  const first = await say(kim, "Movie night on Friday?");
  const second = await say(pat, "I'm in");
  const third = await say(kim, "Great, I'll bring popcorn");
  // Each sender's page asks, at once, from the message it last had.
  await Promise.all([first, second, third].map((message, at) => ask([kim, pat, kim][at], { afterMessageId: message.id })));
  assert.equal(judging.calls.length, 1, "one judgement");
  assert.match(judging.calls[0].user, /\[Kim\]: Great, I'll bring popcorn$/u, "on the latest");
  assert.match(judging.calls[0].user, /Movie night on Friday\?\n.*I'm in\n/u, "with the others as its conversation");
  assert.equal(turns.length, 1, "no turn ran");
  assert.equal((await bodyOf(third.id)).judged, "quiet");
  // Each page asking again finds it settled: the messages after its own, none of them the bot's.
  for (const [message, person] of [[first, kim], [second, pat], [third, kim]]) {
    const again = await ask(person, { afterMessageId: message.id });
    assert.deepEqual(again.messages.filter((line) => line.role === "bot"), []);
  }
  assert.deepEqual([judging.calls.length, turns.length], [1, 1]);
});

test("a judge that fails, or answers in another shape, stays quiet and says so in the log", async (context) => {
  const warn = context.mock.method(console, "warn", () => {});
  const { pat, kim, bot, judging, turns, say, ask, bodyOf } = await setup(context);
  await say(kim, "Hi");
  await ask(kim);
  judging.answer = new Error("The provider is down");
  const failed = await say(pat, "What time is it in Tokyo?");
  assert.deepEqual((await ask(pat)).messages, []);
  judging.answer = "Sure, I'd answer that!";
  const odd = await say(kim, "Anyone fancy a coffee?");
  assert.deepEqual((await ask(kim)).messages, []);
  assert.equal(turns.length, 1, "nothing ran");
  assert.deepEqual([(await bodyOf(failed.id)).judged, (await bodyOf(odd.id)).judged], ["quiet", "quiet"]);
  const lines = warn.mock.calls.map((call) => String(call.arguments[0])).filter((line) => line.includes("stayed quiet"));
  assert.deepEqual(lines, [
    `Bot ${bot.id} stayed quiet: its judgement failed: The provider is down`,
    `Bot ${bot.id} stayed quiet: its judgement came back in another shape.`
  ]);
  assert.ok(!lines.some((line) => /Tokyo|coffee/u.test(line)), "never with the conversation");
});

test("the reply path's statements are the same for a tab of 4 messages as for one of 40", async (context) => {
  const { knex, bots, homeId, pat, kim, bot, general, owner, say, ask, judging } = await setup(context);
  // Each tab made from General, which is empty: the same fork for both.
  const tabOf = async (title, count) => {
    const { room } = await bots.createRoom(bot.id, { title, from: general }, owner);
    const lines = Array.from({ length: count }, (_, at) => ({
      workspace_id: homeId, bot_id: bot.id, conversation_id: room.id, kind: "text",
      role: at % 3 === 2 ? "bot" : "user",
      body: at % 3 === 2 ? { text: `Answer ${at}`, answers: 0 } : { text: `Line ${at} of the chat`, from: { id: kim, name: "Kim" } }
    }));
    await knex("bot_messages").insert(lines);
    return room.id;
  };
  const counted = async (room) => {
    await say(pat, "Sounds good to me", { room });
    return queriesDuring(knex, () => ask(pat, {}, { room }));
  };
  const short = await counted(await tabOf("Short", 3));
  const long = await counted(await tabOf("Long", 39));
  assert.equal(judging.calls.length, 2, "both judged");
  assert.equal(long, short, "the same statements whatever the tab's length");
});
