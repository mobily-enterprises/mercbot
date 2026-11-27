import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { claimedWork } from "../support/botRecords.mjs";
import { seedChat } from "../support/chatFixtures.mjs";
import { startFakeSedna } from "../support/fakeSedna.mjs";
import { accessOf } from "../support/appKey.mjs";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";
import { testServerEnv } from "../support/testEnv.mjs";

// Sedna's writes through the chats' turns (D-94, D14), on the disposable test database and the stand-in Sedna
// (fakeSedna.mjs): a Sedna draft card's Send goes out once as the person's own Sedna user, a test copy only logs it, in
// any chat; only the person the card is for can send it; a routine's run reads the events feed from where its last good
// run got to.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");
const PAT = { id: "201", name: "Pat Doe", email: "pat@acme.example", teams: [{ id: "11", name: "Chartering" }] };
const LIVE = { ...testServerEnv(), APP_ENV: "production" };
const TEST_COPY = { ...testServerEnv(), APP_ENV: "test" };

/**
 * Pat and Kim's home with Pat's bot, Pat's direct chat with it and a public chat of the three; the home's Sedna,
 * connected, with Pat matched to the person by email (D-93). `service(env, reply)` is the turns in a copy of `env`.
 */
async function setup(context) {
  const fake = await startFakeSedna();
  const api = `${fake.url}/acme/platform/2019-01-01`;
  const mint = async () => {
    const form = new URLSearchParams({ grant_type: "client_credentials", client_id: fake.clientId, client_secret: fake.clientSecret });
    return (await (await fetch(`${fake.url}/acme/platform/oauth/token`, { method: "POST", body: form })).json()).access_token;
  };
  const key = await mint();
  const integrations = {
    reachableAccounts: async () => [{ id: "9", pluginId: "sedna", name: "", label: "Acme Shipping", status: "connected", home: true }],
    toolSwitches: async () => ({ skip: {}, removed: [], turnedOff: [], connected: ["sedna"] }),
    app: (id) => (id === "sedna" ? { id: "sedna", name: "Sedna", credentials: { home: true } } : null),
    connections: { accessToken: async () => ({ ...accessOf(key), api }), appPerson: async () => ({ person: PAT, via: "email" }), whenConnected: () => () => {} }
  };
  const kit = await startChatTurns(context, { integrations, env: LIVE });
  kit.cleanup.after(() => fake.close());
  const { knex } = kit;
  const { homeId, people: [pat, kim] } = await homeOfPeople(kit, ["Pat", "Kim"]);
  const [botId] = await botsOf(kit, homeId, pat, ["Sedna writer"]);
  const direct = await seedChat(knex, { homeId, direct: { userId: pat, botId } });
  const shared = await seedChat(knex, { homeId, people: [pat, kim], bots: [botId] });
  const bot = { id: botId, workspace_id: homeId, made_by: pat, conversation_id: direct.id, chat_bot_id: direct.chatBotIds.get(botId) };
  const service = async (env, reply = async () => ({ text: "ok", transcript: [] })) =>
    (await startChatTurns(context, { integrations, env, reply })).turns;
  /** The bot's draft card in a chat, for Pat (R4). */
  const card = async (chatId, body) => (await knex("messages").insert({
    workspace_id: homeId, author_bot_id: botId, conversation_id: chatId, kind: "draft", role: "bot", body: { ...body, for: { id: pat, name: "Pat" } }
  }).returning("*"))[0];
  return { knex, bot, fake, service, card, as: kit.as(pat, homeId), asKim: kit.as(kim, homeId), shared: shared.id };
}

const REPLY = {
  from: "Pat Doe · Chartering (Sedna)", to: "Kim Broker <kim@brokers.example>", subject: "Re: Fixture recap VOY-101", text: "Kim, laycan works.",
  status: "pending", inReplyTo: { from: "Kim Broker", subject: "Fixture recap VOY-101" }, sedna: { team: { id: "11", name: "Chartering" }, replyTo: "1001" }
};

test("Send on a Sedna draft card sends it once as the person from their team; a failure Sedna may have done says so; a test copy logs it", async (context) => {
  const { knex, bot, fake, service, card, as } = await setup(context);
  const bots = await service(LIVE);
  const pending = await card(bot.conversation_id, REPLY);
  const sent = await bots.chat.settleDraft(bot.conversation_id, pending.id, { action: "send", text: "Kim, laycan 3-5 Dec works for owners." }, as);
  assert.deepEqual([sent.messages[0].body.status, sent.messages[0].body.simulated], ["sent", undefined]);
  assert.match(sent.messages[1].body.text, /^Sent from Sedna: Re: Fixture recap VOY-101$/u);
  assert.equal(fake.sent.length, 1);
  assert.deepEqual([fake.sent[0].from, fake.sent[0].team, fake.sent[0].to.map((entry) => entry.email)], ["201", "11", ["kim@brokers.example"]]);
  assert.match(fake.sent[0].html, /^<p>Kim, laycan 3-5 Dec works for owners\.<\/p><p>On \w{3}, \d{2} \w{3} \d{4} [\d:]{8} GMT, Kim Broker &lt;kim@brokers\.example&gt; wrote:<\/p><blockquote/u);
  await assert.rejects(bots.chat.settleDraft(bot.conversation_id, pending.id, { action: "send" }, as), { statusCode: 409 });
  assert.equal(fake.sent.length, 1, "a second press sends nothing");

  // Sedna failed without saying whether it sent it: the card waits, saying to look in Sedna first; nothing is resent.
  const other = await card(bot.conversation_id, { ...REPLY, subject: "Laycan" });
  fake.state.failNext = 500;
  await assert.rejects(bots.chat.settleDraft(bot.conversation_id, other.id, { action: "send" }, as), { statusCode: 502, message: /It wasn't sent: Sedna answered 500/u });
  const waiting = (await knex("messages").where({ id: other.id }).first()).body;
  assert.deepEqual([waiting.status, waiting.unsure], ["pending", true]);
  assert.equal(fake.requests.filter((entry) => entry.route.endsWith("/message/send")).length, 2, "tried once, never again by itself");

  // A test copy checks everything a live one does, then logs it and marks the card logged.
  const copy = await service(TEST_COPY);
  const logged = [];
  context.mock.method(console, "info", (fields) => logged.push(fields));
  const third = await card(bot.conversation_id, REPLY);
  const simulated = await copy.chat.settleDraft(bot.conversation_id, third.id, { action: "send" }, as);
  assert.deepEqual([simulated.messages[0].body.status, simulated.messages[0].body.simulated], ["sent", true]);
  assert.match(simulated.messages[1].body.detail, /This is a test copy, so it was logged, not done in Sedna/u);
  assert.deepEqual(logged.filter((fields) => fields?.appEnv).map((fields) => [fields.kind, fields.team]), [["Sedna message", "Chartering"]]);
  assert.equal(fake.sent.length, 1);
});

test("in a chat with others, only the person a Sedna card is for sends it, as their own Sedna user", async (context) => {
  const { knex, fake, service, card, as, asKim, shared } = await setup(context);
  const bots = await service(LIVE);
  const pending = await card(shared, REPLY);
  await assert.rejects(bots.chat.settleDraft(shared, pending.id, { action: "send" }, asKim), { statusCode: 403, code: "bots_waiting_for_other" });
  assert.equal((await knex("messages").where({ id: pending.id }).first()).body.status, "pending");
  assert.deepEqual(fake.requests.filter((entry) => entry.method !== "GET" && !entry.route.endsWith("/oauth/token")), [], "nothing reached Sedna");
  const sent = await bots.chat.settleDraft(shared, pending.id, { action: "send" }, as);
  assert.equal(sent.messages[0].body.status, "sent", "Pat sends it in the shared chat (D14)");
  assert.deepEqual([fake.sent.length, fake.sent[0].from, fake.sent[0].team], [1, "201", "11"], "as Pat's own Sedna user, from Pat's team");
});

test("a routine's run reads Sedna's new mail from where its last good run got to, and moves on only when the run ends well", async (context) => {
  const { knex, bot, fake, service } = await setup(context);
  const handed = [];
  let ending = "report";
  // The run's model, scripted: it reads the new mail, tags each message, and reports, finds nothing, or fails.
  const bots = await service(LIVE, async (_bot, _history, tools) => {
    const { result } = await tools.sednaInbox.execute({ action: "new" });
    handed.push(result.messages.map((message) => message.id));
    for (const message of result.messages) await tools.sednaSort.execute({ action: "tag", id: message.id, tag: "Fixtures" });
    if (ending === "fail") throw new Error("The model's provider failed");
    if (ending === "quiet") {
      await tools.nothingNew.execute({});
      return { text: "", transcript: [] };
    }
    return { text: `Tagged ${result.messages.length}`, transcript: [{ role: "assistant", content: "Tagged" }] };
  });
  const [routine] = await knex("bot_routines").insert({
    workspace_id: bot.workspace_id, chat_bot_id: bot.chat_bot_id, made_by: bot.made_by, name: "Tag fixtures", schedule: "Every 10 minutes",
    instructions: "Tag new fixtures mail", cron: "*/10 * * * *", timezone: "UTC", next_run_at: knex.fn.now(), created_at: new Date(Date.now() - 60000)
  }).returning("*");
  // Claimed as its runner claims it: a run id this server holds.
  const runOnce = async () => {
    await knex("bot_routines").where({ id: routine.id }).update({ run_id: randomUUID(), run_attempts: 1, run_lease_until: knex.raw("now() + interval '10 minutes'") });
    await bots.runRoutine(claimedWork(await knex("bot_routines").where({ id: routine.id }).first()));
    return (await knex("bot_routines").where({ id: routine.id }).first()).feeds;
  };

  const started = await runOnce();
  assert.deepEqual([handed[0], Object.keys(started)], [[], ["sedna:9"]], "its first run starts now: older mail isn't new");
  const first = fake.receive({ subject: "Fixture A" });
  fake.receive({ team: "12", subject: "Operations' own" });
  await runOnce();
  assert.deepEqual(handed[1], [first]);
  assert.deepEqual(fake.messages.find((message) => message.id === first).tags, ["301"]);

  // A failed run reads the same mail again next time; a quiet one moves on.
  const second = fake.receive({ subject: "Fixture B" });
  context.mock.method(console, "error", () => {});
  ending = "fail";
  await runOnce();
  ending = "quiet";
  await runOnce();
  ending = "report";
  await runOnce();
  assert.deepEqual(handed.slice(2), [[second], [second], []]);
});
