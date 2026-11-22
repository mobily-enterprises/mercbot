import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import http from "node:http";
import test from "node:test";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { seedChat } from "../support/chatFixtures.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { ownedHandles } from "../support/ownedHandles.mjs";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { planOf, queriesDuring, statementsDuring } from "../support/queryCount.mjs";
import { createAccounts } from "../../packages/integrations/src/server/accounts.js";
import { createConnections } from "../../packages/integrations/src/server/connections.js";
import { INTEGRATIONS_OWNS } from "../../packages/integrations/src/server/IntegrationsFeature.js";
import { createOAuth } from "../../packages/integrations/src/server/oauth.js";
import { botsOf, homeOfPeople, startChatTurns } from "../support/botDoubles.mjs";

// Connect follow-ups (D-77) against the disposable test database, on two servers that share it: each is
// its own Knex pool with its own chats' turns and sign-ins, and a stand-in provider stands in for the app's sign-in.
// The sign-in's callback marks the follow-ups its connection reaches as it saves the account, its server starts them,
// and every server's sweep finds only the ones whose start or server was lost.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const VAULT = randomBytes(32).toString("base64");
const CATALOGUE = [{ id: "testmail", name: "Testmail", oauth: { provider: "test", scopes: ["mail"] } }];
const ENV = { APP_PUBLIC_URL: "http://localhost:4000", TESTMAIL_TEST_CLIENT_ID: "client", TESTMAIL_TEST_CLIENT_SECRET: "secret", MERCBOT_VAULT_KEY: VAULT };
const NO_ONE = requestContextOptions({});

/** The stand-in provider: a token endpoint that answers the code "good", and "who am I". */
async function standInProvider(cleanup) {
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const form = new URLSearchParams(body);
      const send = (status, value) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
      if (request.url === "/me") return send(200, { email: "pat@example.com" });
      if (form.get("client_secret") === "secret" && form.get("grant_type") === "authorization_code" && form.get("code") === "good") {
        return send(200, { access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, token_type: "Bearer" });
      }
      return send(400, { error: "invalid_grant" });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    test: {
      name: "Testmail",
      env: "TESTMAIL",
      server: { issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token` },
      scopes: ["profile"],
      params: {},
      whoami: { url: `${base}/me`, label: (body) => body.email }
    }
  };
}

/** A promise and the function that settles it. */
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * One server: its own pool on the shared test database, its chats' turns and its sign-ins (integrations' connections,
 * as IntegrationsFeature builds them, with the follow-ups listening as botsService wires them). Its integrations see
 * what the database says is connected in `home` (filled in once it exists). `reply` stands in for the model; each
 * server's prompts are kept.
 */
async function startServer(context, { home, providers, reply = async () => ({ text: "Done.", transcript: [] }) }) {
  const prompts = [];
  const connected = { knex: null };
  const kit = await startChatTurns(context, {
    integrations: {
      hasConnected: async (pluginId) =>
        Boolean(await connected.knex("plugin_accounts").where({ workspace_id: home.id, plugin_id: pluginId, status: "connected" }).first())
    },
    reply: (bot, history, tools, state, prompt, options) => {
      prompts.push(prompt);
      return reply(bot, history, tools, state, prompt, options);
    }
  });
  connected.knex = kit.knex;
  const { features } = await ownedHandles(kit.knex, kit.cleanup, { "mercbot.integrations": INTEGRATIONS_OWNS });
  const { resources, systemContext } = features["mercbot.integrations"];
  const accounts = createAccounts({ pluginAccounts: resources.pluginAccounts, systemContext });
  const connections = createConnections({
    resources,
    accounts,
    systemContext,
    catalogue: CATALOGUE,
    env: ENV,
    providers,
    oauthClient: createOAuth({ env: ENV, insecure: true }),
    isMember: async () => true,
    recordActivity: async () => {},
    // This copy lends no sign-ins.
    bridgedSignIns: null
  });
  connections.whenConnected(kit.turns.connectFollowUps.connected);
  const system = { context: kit.systemContext("connect follow-up") };
  return { ...kit, connections, prompts, system, followUps: kit.turns.connectFollowUps };
}

/**
 * Pat and Kim's home, Pat's bot and Pat's chat with it, holding a connect card for Pat, and Pat's Testmail account,
 * not connected yet; the two servers.
 */
async function setup(context, replies = {}) {
  const cleanup = cleanupStack(context);
  const providers = await standInProvider(cleanup);
  const home = {};
  // The sign-in's callback lands on A; the person's page, and their chat, are on B.
  const a = await startServer(context, { home, providers, reply: replies.a });
  const b = await startServer(context, { home, providers, reply: replies.b });
  const { knex } = a;
  const { homeId, people: [userId, kim] } = await homeOfPeople(a, ["Pat", "Kim"]);
  home.id = homeId;
  const [botId] = await botsOf(a, homeId, userId, ["Follow-ups"]);
  const { id: chatId, chatBotIds } = await seedChat(knex, { homeId, direct: { userId, botId } });
  const bot = { id: botId, workspace_id: homeId, chat_id: chatId, chat_bot_id: chatBotIds.get(botId), person: { id: userId, name: "Pat" } };
  const [account] = await knex("plugin_accounts").insert({ user_id: userId, workspace_id: homeId, plugin_id: "testmail", name: "default" }).returning("*");
  const as = a.as(userId, homeId);
  const [card] = await knex("messages").insert(connectCard(bot)).returning("*");
  /** Signs in on server A from start to the callback; `query` is what the provider sends back. */
  const signIn = async (query = { code: "good" }) => {
    const { url, cookie } = await a.connections.connect(account.id, as);
    const state = new URL(url).searchParams.get("state");
    // The browser the sign-in started in comes back with its cookie (D-97).
    return a.connections.callback({ ...query, state }, { [cookie.name]: cookie.value }, NO_ONE);
  };
  const followUp = () => knex("connect_follow_ups").where({ message_id: card.id }).first();
  const cardStatus = async () => (await knex("messages").where({ id: card.id }).first()).body.status;
  const botTexts = async () =>
    (await knex("messages").where({ conversation_id: chatId, kind: "text", role: "bot" }).orderBy("id")).map((row) => row.body.text);
  return { knex, userId, kim, homeId, bot, account, card, a, b, as, signIn, followUp, cardStatus, botTexts };
}

/** A connect card waiting in the bot's chat, for its person, as cardTools.js posts one. */
function connectCard(bot, fields = {}) {
  return {
    workspace_id: bot.workspace_id,
    author_bot_id: bot.id,
    conversation_id: bot.chat_id,
    kind: "connect",
    role: "bot",
    body: {
      app: "Testmail",
      button: "Authorize",
      task: "file the receipts",
      status: "waiting",
      plugin: { id: "testmail", name: "Testmail" },
      for: bot.person
    },
    ...fields
  };
}

const CARRIED_ON = /^\(Testmail is connected now: the person signed in from your card\. Finish what you said you'd do once it was: file the receipts\./u;

test("a sign-in finishing on another server marks the card's follow-up as it is saved, starts it there at once, and the bot carries on once", async (context) => {
  const chat = {};
  const { knex, userId, a, b, card, as, bot, account, signIn, followUp, cardStatus, botTexts } = await setup(context, {
    // While the bot carries on, the person writes again: that message gets its own reply afterwards.
    a: async (_bot, _history, _tools, _state, prompt) => {
      if (!CARRIED_ON.test(prompt)) return { text: "Added the March ones too.", transcript: [] };
      await chat.write("Also add the March ones.");
      return { text: "Filed the receipts.", transcript: [] };
    }
  });
  chat.write = (text) => knex("messages").insert({
    workspace_id: bot.workspace_id, conversation_id: bot.chat_id, author_user_id: userId, kind: "text", role: "user", body: { text }
  });

  // The person presses Authorize on B: the card shows it's connecting, and its follow-up waits for the sign-in.
  const pressed = await b.turns.chat.connectFromCard(bot.chat_id, card.id, { timeZone: "Europe/Rome", language: "it" }, as);
  assert.equal(pressed.messages[0].body.status, "connecting");
  assert.equal((await followUp()).status, "waiting");
  await b.followUps.sweep();
  assert.equal((await followUp()).status, "waiting", "a sweep leaves a follow-up still waiting for its sign-in");

  // A listener that fails rolls the sign-in back with it: the account and the follow-up are saved together or not at all.
  const failing = a.connections.whenConnected(async () => {
    throw new Error("a listener that fails");
  });
  await assert.rejects(signIn(), /a listener that fails/u);
  failing();
  assert.notEqual((await a.knex("plugin_accounts").where({ id: account.id }).first()).status, "connected");
  assert.equal((await followUp()).status, "waiting", "the follow-up's mark rolled back with the account");

  // The provider sends the person back to A: A marks the follow-up in the transaction that saves the account (ready
  // inside it, still waiting to every other server until it commits), and carries on at once.
  const { id } = await followUp();
  const seen = [];
  const watching = a.connections.whenConnected(async (_connection, txOptions) => {
    seen.push(Boolean(await a.records.followUps.startable(id, { ...passedOn(txOptions), ...a.system })));
    seen.push(Boolean(await b.records.followUps.startable(id, b.system)));
  });
  await signIn();
  watching();
  assert.deepEqual(seen, [true, false], "ready in the account's own transaction, and only there until it commits");
  await a.drain(10000);
  assert.equal(a.prompts.length, 2, "server A carried on, without waiting for any sweep, then answered the new message");
  assert.match(a.prompts[0], CARRIED_ON);
  assert.match(a.prompts[1], /^\(The message "Also add the March ones\." arrived while you were busy/u, "not the app's task again");
  assert.equal(b.prompts.length, 0, "server B didn't");
  assert.equal(await cardStatus(), "connected");
  assert.equal(await followUp(), undefined, "its follow-up ended with its reply");
  assert.deepEqual(await botTexts(), ["Filed the receipts.", "Added the March ones too."]);

  // Nothing is left for any server to sweep, and the card can't be started again.
  await b.followUps.sweep();
  await b.drain(10000);
  assert.equal(b.prompts.length, 0);
  assert.equal(a.prompts.length, 2);
  await assert.rejects(b.turns.chat.connectFromCard(bot.chat_id, card.id, {}, as), { code: "bots_connect_card_closed" });
});

test("a server stopped mid-follow-up: another server's sweep takes it over and finishes it once, and the stopped one posts nothing", async (context) => {
  const asked = deferred();
  const late = deferred();
  const { knex, a, b, card, as, bot, signIn, followUp, cardStatus, botTexts } = await setup(context, {
    // A's model call never answers until the test lets it: its server stops meanwhile.
    a: () => {
      asked.resolve();
      return late.promise;
    },
    b: async () => ({ text: "Filed the receipts on B.", transcript: [] })
  });
  context.mock.method(console, "warn", () => {});
  await b.turns.chat.connectFromCard(bot.chat_id, card.id, {}, as);
  await signIn();
  await asked.promise;
  const held = await followUp();
  assert.equal(held.attempts, 1);
  assert.equal(await cardStatus(), "connected", "its first run claimed the card");

  // A stops: its follow-up's lease and its hold on the chat are no longer renewed, and lapse.
  await knex("connect_follow_ups").where({ id: held.id }).update({ lease_until: knex.raw("now() - interval '1 second'") });
  await knex("agent_runs").where({ conversation_id: bot.chat_bot_id }).update({ heartbeat_at: knex.raw("now() - interval '5 minutes'") });

  // B's sweep takes it over, under a run of its own, and finishes it.
  await b.followUps.sweep();
  await b.drain(10000);
  assert.equal(b.prompts.length, 1);
  assert.match(b.prompts[0], CARRIED_ON);
  assert.equal(await followUp(), undefined);
  assert.deepEqual(await botTexts(), ["Filed the receipts on B."]);

  // A comes back to life with its answer: the run isn't its own any more, so nothing more is posted, and B's
  // sweep finds nothing left.
  late.resolve({ text: "Filed the receipts on A.", transcript: [] });
  await a.drain(10000);
  await b.followUps.sweep();
  await b.drain(10000);
  assert.deepEqual(await botTexts(), ["Filed the receipts on B."], "followed up once");
  assert.equal(b.prompts.length, 1);
});

test("a server that stops hands its follow-up over at once: its chat is freed, and another server's sweep finishes it", async (context) => {
  const asked = deferred();
  const { a, b, card, as, bot, signIn, followUp, botTexts, knex } = await setup(context, {
    // As the agent loop does: a model call ends at once when the run's signal aborts, with its reason.
    a: (_bot, _history, _tools, _state, _prompt, options) => {
      asked.resolve();
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
    },
    b: async () => ({ text: "Filed the receipts on B.", transcript: [] })
  });
  await b.turns.chat.connectFromCard(bot.chat_id, card.id, {}, as);
  await signIn();
  await asked.promise;

  // A shuts down (D-19): its sweeps stop, and its run stops at its next step and is handed over.
  await a.followUps.startSweeping({ everyMs: 3600000 }).drain(0);
  await a.drain(10000);
  assert.equal(await knex("agent_runs").where({ conversation_id: bot.chat_bot_id }).first(), undefined, "the chat is free");
  assert.deepEqual(await botTexts(), [], "A posted nothing");

  // The next sweep anywhere takes it over at once, without waiting for its lease to lapse.
  await b.followUps.sweep();
  await b.drain(10000);
  assert.deepEqual(await botTexts(), ["Filed the receipts on B."]);
  assert.equal(await followUp(), undefined);
  assert.deepEqual([a.prompts.length, b.prompts.length], [1, 1]);
});

test("a follow-up its server marked but never started waits out its start there, and one whose chat is busy starts as that chat's reply ends", async (context) => {
  const replying = deferred();
  const answer = deferred();
  const { knex, b, card, as, bot, account, userId, homeId, followUp, botTexts } = await setup(context, {
    // B is answering the person when the follow-up's start comes due; then it carries on.
    b: async (_bot, _history, _tools, _state, prompt) => {
      if (CARRIED_ON.test(prompt)) return { text: "Filed the receipts.", transcript: [] };
      replying.resolve();
      return answer.promise;
    }
  });
  await b.turns.chat.connectFromCard(bot.chat_id, card.id, {}, as);
  // The account is saved connected and its follow-up marked, and that server stops before it starts it.
  await knex("plugin_accounts").where({ id: account.id }).update({ status: "connected" });
  await b.followUps.connected({ pluginId: "testmail", userId: String(userId), homeId }, b.system);
  await b.followUps.sweep();
  const left = await followUp();
  assert.deepEqual([left.status, left.run_id], ["ready", null], "another server's sweep leaves its start to the server that marked it, for 10 seconds");

  // Its start is overdue, but the chat is busy with a reply: the sweep puts it off.
  const [asked] = (await b.turns.chat.sendMessage(bot.chat_id, { text: "What's in my inbox?" }, as)).messages;
  const replied = b.turns.chat.reply(bot.chat_id, { afterMessageId: asked.id }, undefined, as);
  await Promise.race([replying.promise, replied.then(() => assert.fail("the person's reply didn't run"))]);
  await knex("connect_follow_ups").where({ message_id: card.id }).update({ lease_until: knex.raw("now() - interval '1 second'") });
  await b.followUps.sweep();
  const putOff = await knex("connect_follow_ups").where({ message_id: card.id }).first(knex.raw("run_id, lease_until > now() + interval '50 seconds' as later"));
  assert.deepEqual(putOff, { run_id: null, later: true }, "put off for a minute, not started");

  // The reply ends, and the follow-up starts at once, without waiting for any sweep.
  answer.resolve({ text: "Here you are.", transcript: [] });
  await replied;
  await b.drain(10000);
  assert.equal(b.prompts.length, 2);
  assert.match(b.prompts[1], CARRIED_ON);
  assert.deepEqual(await botTexts(), ["Here you are.", "Filed the receipts."]);
  assert.equal(await followUp(), undefined);
});

test("a cancelled sign-in leaves the card as it is, one never finished goes after 30 minutes, and an archived bot's follow-up is closed", async (context) => {
  const { knex, a, b, card, as, bot, signIn, followUp, cardStatus } = await setup(context);
  await b.turns.chat.connectFromCard(bot.chat_id, card.id, {}, as);
  await assert.rejects(signIn({ error: "access_denied" }), /cancelled, so nothing was connected/u);
  assert.equal((await followUp()).status, "waiting");
  assert.equal(await cardStatus(), "connecting");

  // Only a connection in the card's home marks it (D-111): an account of the app connected there, whoever connected
  // it, reaches every chat in the home; another home's or another app's doesn't.
  const timing = { minutes: 30, graceSeconds: 10 };
  const marks = (connection) => b.records.followUps.markReady({ pluginId: "testmail", homeId: String(bot.workspace_id), ...connection }, timing, b.system);
  assert.deepEqual(await marks({ pluginId: "othermail" }), []);
  assert.deepEqual(await marks({ homeId: "999999999" }), []);
  const ids = await marks({});
  assert.deepEqual(ids.map(String), [String((await followUp()).id)]);
  await b.records.followUps.waitAgain(ids[0], b.system);
  assert.equal((await followUp()).status, "waiting", "a ready follow-up whose app isn't connected for its chat waits again");

  // One begun 31 minutes ago and never finished goes with the next sweep; the card stays as it is.
  await knex("connect_follow_ups").where({ message_id: card.id }).update({ waiting_since: knex.raw("now() - interval '31 minutes'") });
  await a.followUps.sweep();
  assert.equal(await followUp(), undefined);
  assert.equal(await cardStatus(), "connecting");

  // An archived bot never carries on (D-101): its follow-up is closed, and it doesn't answer.
  await b.turns.chat.connectFromCard(bot.chat_id, card.id, {}, as);
  await knex("bots").where({ id: bot.id }).update({ archived_at: knex.fn.now() });
  await knex("connect_follow_ups").where({ message_id: card.id }).update({ status: "ready", lease_until: knex.raw("now() - interval '1 second'") });
  await a.followUps.sweep();
  await a.drain(10000);
  assert.equal(await followUp(), undefined);
  assert.equal(a.prompts.length, 0);

  // A chat deleted takes its follow-ups with it.
  await knex("bots").where({ id: bot.id }).update({ archived_at: null });
  await knex("messages").where({ id: card.id }).update({ body: connectCard(bot).body });
  await b.turns.chat.connectFromCard(bot.chat_id, card.id, {}, as);
  assert.ok(await followUp());
  await knex("conversations").where({ id: bot.chat_id }).del();
  assert.equal(await followUp(), undefined);
});

test("only the card's person can start its follow-up, from a connect card still waiting", async (context) => {
  const { knex, b, card, bot, as, kim, homeId, followUp } = await setup(context);
  // Pat's chat with the bot is Private, his alone: Kim, in the home, can't read its card (the route answers 404 for the
  // chat before this).
  await assert.rejects(b.turns.chat.connectFromCard(bot.chat_id, card.id, {}, b.as(kim, homeId)), { statusCode: 409, code: "bots_connect_card_closed" });
  // In a room of both of them, Kim may open the chat, but a card for Pat is Pat's (R4).
  const { id: room } = await seedChat(knex, { homeId, title: "Receipts", people: [bot.person.id, kim], bots: [bot.id] });
  const [shared] = await knex("messages").insert({ ...connectCard(bot), conversation_id: room }).returning("*");
  await assert.rejects(b.turns.chat.connectFromCard(room, shared.id, {}, b.as(kim, homeId)), { statusCode: 403, code: "bots_waiting_for_other" });
  const [text] = await knex("messages").insert({ ...connectCard(bot), kind: "text", body: { text: "Hello." } }).returning("*");
  await assert.rejects(b.turns.chat.connectFromCard(bot.chat_id, text.id, {}, as), { code: "bots_connect_card_closed" });
  await knex("messages").where({ id: card.id }).update({ body: { ...connectCard(bot).body, status: "connected" } });
  await assert.rejects(b.turns.chat.connectFromCard(bot.chat_id, card.id, {}, as), { code: "bots_connect_card_closed" });
  assert.equal(await followUp(), undefined, "no refused press keeps a follow-up");
});

test("a sweep's statements and a sign-in's marking don't grow with the cards waiting, and read through their indexes", async (context) => {
  const { knex, a, userId, homeId } = await setup(context);
  // `count` more cards waiting for a sign-in, each another person's, in a chat of another home, which a sign-in in the
  // bot's home doesn't reach.
  const { homeId: elsewhereHome, people: [sam] } = await homeOfPeople(a, ["Sam"]);
  const [elsewhereBot] = await botsOf(a, elsewhereHome, sam, ["Elsewhere"]);
  const { id: elsewhereChat, chatBotIds } = await seedChat(knex, { homeId: elsewhereHome, direct: { userId: sam, botId: elsewhereBot } });
  const elsewhereSeat = chatBotIds.get(elsewhereBot);
  const seed = (count) => knex.raw(
    `with cards as (
       insert into messages (workspace_id, author_bot_id, conversation_id, kind, role, body)
       select ?, ?, ?, 'connect', 'bot', '{"app": "Testmail", "task": "file it", "status": "connecting", "plugin": {"id": "testmail"}}'::jsonb
         from generate_series(1, ?)
       returning id
     )
     insert into connect_follow_ups (workspace_id, message_id, chat_bot_id, user_id, plugin_id)
     select ?, id, ?, 900000000 + id, 'testmail' from cards`,
    [elsewhereHome, elsewhereBot, elsewhereChat, count, elsewhereHome, elsewhereSeat]
  );
  // An account connected in the bot's home, with none of its cards waiting.
  const mark = async () => {
    const after = await a.followUps.connected({ pluginId: "testmail", userId: String(userId), homeId }, a.system);
    await after();
  };
  const sweeps = {};
  const marking = {};
  for (const [size, add] of [[10, 10], [10000, 9990]]) {
    await seed(add);
    sweeps[size] = await queriesDuring(a.knex, () => a.followUps.sweep());
    marking[size] = await queriesDuring(a.knex, mark);
  }
  console.log(`connect follow-ups, statements at 10 and 10,000 cards waiting: a sweep ${JSON.stringify(sweeps)}, a sign-in's marking ${JSON.stringify(marking)}`);
  assert.equal(sweeps[10000], sweeps[10], "a sweep sends the same statements however many cards wait");
  assert.equal(marking[10000], marking[10], "so does marking a sign-in's follow-ups");
  assert.equal(Number((await knex("connect_follow_ups").where({ chat_bot_id: elsewhereSeat, status: "waiting" }).count("* as n").first()).n), 10000);

  // Each statement reads through its index, a handful of rows, not the 10,000 waiting.
  const statements = await statementsDuring(a.knex, async () => {
    await a.followUps.sweep();
    await mark();
  }, /connect_follow_ups/u);
  for (const statement of statements) {
    const { rowsRead, indexes } = await planOf(knex, statement);
    assert.ok([...indexes].some((name) => name.includes("connect_follow_ups")), `${statement.sql} reads through its index (${[...indexes]})`);
    assert.ok(rowsRead < 50, `${statement.sql} reads ${rowsRead} rows`);
  }
});
