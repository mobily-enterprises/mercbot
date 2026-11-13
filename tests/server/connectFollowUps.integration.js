import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import http from "node:http";
import test from "node:test";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { testBot } from "./testHome.js";
import { startBotsService } from "../support/botDoubles.mjs";
import { memberOptions, startBotParts } from "../support/botRecords.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { ownedHandles } from "../support/ownedHandles.mjs";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { planOf, queriesDuring, statementsDuring } from "../support/queryCount.mjs";
import { createAccounts } from "../../packages/integrations/src/server/accounts.js";
import { createConnections } from "../../packages/integrations/src/server/connections.js";
import { INTEGRATIONS_OWNS } from "../../packages/integrations/src/server/IntegrationsFeature.js";
import { createOAuth } from "../../packages/integrations/src/server/oauth.js";

// Connect follow-ups (D-77) against the disposable test database, on two servers that share it: each is
// its own Knex pool with its own bots service and sign-ins, and a stand-in provider stands in for the app's sign-in.
// The sign-in's callback marks the follow-ups its connection reaches as it saves the account, its server starts them,
// and every server's sweep finds only the ones whose start or server was lost.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const VAULT = randomBytes(32).toString("base64");
const CATALOGUE = [{ id: "testmail", name: "Testmail", oauth: { provider: "test", scopes: ["mail"] } }];
const ENV = { APP_PUBLIC_URL: "http://localhost:4000", TESTMAIL_TEST_CLIENT_ID: "client", TESTMAIL_TEST_CLIENT_SECRET: "secret", MERCBOT_VAULT_KEY: VAULT };
// The person's own accounts, as Connect apps reaches them, and a callback no one is signed in to.
const REACH = Object.freeze({ personal: true });
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
 * One server: its own pool on the shared test database, its sign-ins (integrations' connections, as
 * IntegrationsFeature builds them) and its bots service, whose integrations see what the database says is connected.
 * `reply` stands in for the model; each server's prompts are kept.
 */
async function startServer(cleanup, { userId, providers, reply = async () => ({ text: "Done.", transcript: [] }) }) {
  const knex = await connectTestDatabase();
  cleanup.after(() => knex.destroy());
  const { features } = await ownedHandles(knex, cleanup, { "mercbot.integrations": INTEGRATIONS_OWNS });
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
  const parts = await startBotParts(knex, cleanup);
  const prompts = [];
  const bots = startBotsService(cleanup, {
    ...parts,
    approvals: { decide: async () => "allow" },
    integrations: {
      hasConnected: async (_reach, pluginId) =>
        Boolean(await knex("plugin_accounts").where({ user_id: userId, plugin_id: pluginId, status: "connected" }).first()),
      connections
    },
    reply: (bot, history, tools, state, prompt, options) => {
      prompts.push(prompt);
      return reply(bot, history, tools, state, prompt, options);
    }
  });
  const system = { context: parts.systemContext("connect follow-up") };
  return { knex, connections, parts, bots, prompts, system };
}

async function setup(context, replies = {}) {
  const cleanup = cleanupStack(context);
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  assert.ok(userId, "the test database needs a user row");
  const bot = await testBot(knex, userId, { name: "Follow-ups" });
  const [account] = await knex("plugin_accounts").insert({ user_id: userId, plugin_id: "testmail", name: "default" }).returning("*");
  cleanup.after(async () => {
    await knex("plugin_accounts").where({ id: account.id }).del();
    await knex("bots").where({ id: bot.id }).del();
    await knex.destroy();
  });
  const providers = await standInProvider(cleanup);
  // The sign-in's callback lands on A; the person's page, and their chat, are on B.
  const a = await startServer(cleanup, { userId, providers, reply: replies.a });
  const b = await startServer(cleanup, { userId, providers, reply: replies.b });
  const as = memberOptions({ userId, homeId: bot.workspace_id });
  const person = requestContextOptions({ user: { id: String(userId) } });
  const [card] = await knex("bot_messages").insert(connectCard(bot)).returning("*");
  /** Signs in on server A from start to the callback; `query` is what the provider sends back. */
  const signIn = async (query = { code: "good" }) => {
    const state = new URL((await a.connections.connect(REACH, account.id, person)).url).searchParams.get("state");
    return a.connections.callback({ ...query, state }, NO_ONE);
  };
  const followUp = () => knex("connect_follow_ups").where({ message_id: card.id }).first();
  const cardStatus = async () => (await knex("bot_messages").where({ id: card.id }).first()).body.status;
  const botTexts = async () =>
    (await knex("bot_messages").where({ conversation_id: bot.conversation_id, kind: "text", role: "bot" }).orderBy("id")).map((row) => row.body.text);
  return { knex, cleanup, userId, bot, account, card, a, b, as, signIn, followUp, cardStatus, botTexts };
}

/** A connect card waiting in the bot's chat, as cardTools.js posts one. */
function connectCard(bot, fields = {}) {
  return {
    workspace_id: bot.workspace_id,
    bot_id: bot.id,
    conversation_id: bot.conversation_id,
    kind: "connect",
    role: "bot",
    body: {
      app: "Testmail",
      button: "Authorize",
      task: "file the receipts",
      status: "waiting",
      plugin: { id: "testmail", name: "Testmail" }
    },
    ...fields
  };
}

const CARRIED_ON = /^\(Testmail is connected now: the person signed in from your card\. Finish what you said you'd do once it was: file the receipts\./u;

test("a sign-in finishing on another server marks the card's follow-up as it is saved, starts it there at once, and the bot carries on once", async (context) => {
  const chat = {};
  const { knex, a, b, card, as, bot, account, signIn, followUp, cardStatus, botTexts } = await setup(context, {
    // While the bot carries on, the person writes again: that message gets its own reply afterwards.
    a: async (_bot, _history, _tools, _state, prompt) => {
      if (!CARRIED_ON.test(prompt)) return { text: "Added the March ones too.", transcript: [] };
      await chat.write("Also add the March ones.");
      return { text: "Filed the receipts.", transcript: [] };
    }
  });
  chat.write = (text) => knex("bot_messages").insert({ ...connectCard(bot), kind: "text", role: "user", body: { text } });

  // The person presses Authorize on B: the card shows it's connecting, and its follow-up waits for the sign-in.
  const pressed = await b.bots.connectFromCard(bot.id, card.id, { timeZone: "Europe/Rome", language: "it" }, as);
  assert.equal(pressed.messages[0].body.status, "connecting");
  assert.equal((await followUp()).status, "waiting");
  await b.bots.connectFollowUps.sweep();
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
    seen.push(Boolean(await a.parts.records.followUps.startable(id, { ...passedOn(txOptions), ...a.system })));
    seen.push(Boolean(await b.parts.records.followUps.startable(id, b.system)));
  });
  await signIn();
  watching();
  assert.deepEqual(seen, [true, false], "ready in the account's own transaction, and only there until it commits");
  await a.bots.drain(10000);
  assert.equal(a.prompts.length, 2, "server A carried on, without waiting for any sweep, then answered the new message");
  assert.match(a.prompts[0], CARRIED_ON);
  assert.match(a.prompts[1], /^\(The person's message "Also add the March ones\." arrived while you were busy/u, "not the app's task again");
  assert.equal(b.prompts.length, 0, "server B didn't");
  assert.equal(await cardStatus(), "connected");
  assert.equal(await followUp(), undefined, "its follow-up ended with its reply");
  assert.deepEqual(await botTexts(), ["Filed the receipts.", "Added the March ones too."]);

  // Nothing is left for any server to sweep, and the card can't be started again.
  await b.bots.connectFollowUps.sweep();
  await b.bots.drain(10000);
  assert.equal(b.prompts.length, 0);
  assert.equal(a.prompts.length, 2);
  await assert.rejects(b.bots.connectFromCard(bot.id, card.id, {}, as), { code: "bots_connect_card_closed" });
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
  await b.bots.connectFromCard(bot.id, card.id, {}, as);
  await signIn();
  await asked.promise;
  const held = await followUp();
  assert.equal(held.attempts, 1);
  assert.equal(await cardStatus(), "connected", "its first run claimed the card");

  // A stops: its follow-up's lease and its hold on the chat are no longer renewed, and lapse.
  await knex("connect_follow_ups").where({ id: held.id }).update({ lease_until: knex.raw("now() - interval '1 second'") });
  await knex("agent_runs").where({ conversation_id: bot.conversation_id }).update({ heartbeat_at: knex.raw("now() - interval '5 minutes'") });

  // B's sweep takes it over, under a run of its own, and finishes it.
  await b.bots.connectFollowUps.sweep();
  await b.bots.drain(10000);
  assert.equal(b.prompts.length, 1);
  assert.match(b.prompts[0], CARRIED_ON);
  assert.equal(await followUp(), undefined);
  assert.deepEqual(await botTexts(), ["Filed the receipts on B."]);

  // A comes back to life with its answer: the run isn't its own any more, so nothing more is posted, and B's
  // sweep finds nothing left.
  late.resolve({ text: "Filed the receipts on A.", transcript: [] });
  await a.bots.drain(10000);
  await b.bots.connectFollowUps.sweep();
  await b.bots.drain(10000);
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
  await b.bots.connectFromCard(bot.id, card.id, {}, as);
  await signIn();
  await asked.promise;

  // A shuts down (D-19): its sweeps stop, and its run stops at its next step and is handed over.
  await a.bots.connectFollowUps.startSweeping({ everyMs: 3600000 }).drain(0);
  await a.bots.drain(10000);
  assert.equal(await knex("agent_runs").where({ conversation_id: bot.conversation_id }).first(), undefined, "the chat is free");
  assert.deepEqual(await botTexts(), [], "A posted nothing");

  // The next sweep anywhere takes it over at once, without waiting for its lease to lapse.
  await b.bots.connectFollowUps.sweep();
  await b.bots.drain(10000);
  assert.deepEqual(await botTexts(), ["Filed the receipts on B."]);
  assert.equal(await followUp(), undefined);
  assert.deepEqual([a.prompts.length, b.prompts.length], [1, 1]);
});

test("a follow-up its server marked but never started waits out its start there, and one whose chat is busy starts as that chat's reply ends", async (context) => {
  const replying = deferred();
  const answer = deferred();
  const { knex, b, card, as, bot, account, userId, followUp, botTexts } = await setup(context, {
    // B is answering the person when the follow-up's start comes due; then it carries on.
    b: async (_bot, _history, _tools, _state, prompt) => {
      if (CARRIED_ON.test(prompt)) return { text: "Filed the receipts.", transcript: [] };
      replying.resolve();
      return answer.promise;
    }
  });
  await b.bots.connectFromCard(bot.id, card.id, {}, as);
  // The account is saved connected and its follow-up marked, and that server stops before it starts it.
  await knex("plugin_accounts").where({ id: account.id }).update({ status: "connected" });
  await b.bots.connectFollowUps.connected({ pluginId: "testmail", userId: String(userId), homeId: null }, b.system);
  await b.bots.connectFollowUps.sweep();
  const left = await followUp();
  assert.deepEqual([left.status, left.run_id], ["ready", null], "another server's sweep leaves its start to the server that marked it, for 10 seconds");

  // Its start is overdue, but the chat is busy with a reply: the sweep puts it off.
  const replied = b.bots.replyTo(bot.id, {}, undefined, as);
  await Promise.race([replying.promise, replied.then(() => assert.fail("the person's reply didn't run"))]);
  await knex("connect_follow_ups").where({ message_id: card.id }).update({ lease_until: knex.raw("now() - interval '1 second'") });
  await b.bots.connectFollowUps.sweep();
  const putOff = await knex("connect_follow_ups").where({ message_id: card.id }).first(knex.raw("run_id, lease_until > now() + interval '50 seconds' as later"));
  assert.deepEqual(putOff, { run_id: null, later: true }, "put off for a minute, not started");

  // The reply ends, and the follow-up starts at once, without waiting for any sweep.
  answer.resolve({ text: "Here you are.", transcript: [] });
  await replied;
  await b.bots.drain(10000);
  assert.equal(b.prompts.length, 2);
  assert.match(b.prompts[1], CARRIED_ON);
  assert.deepEqual(await botTexts(), ["Here you are.", "Filed the receipts."]);
  assert.equal(await followUp(), undefined);
});

test("a cancelled sign-in leaves the card as it is, one never finished goes after 30 minutes, and a group's follow-up is closed", async (context) => {
  const { knex, cleanup, a, b, card, as, bot, userId, signIn, followUp, cardStatus } = await setup(context);
  await b.bots.connectFromCard(bot.id, card.id, {}, as);
  await assert.rejects(signIn({ error: "access_denied" }), /cancelled, so nothing was connected/u);
  assert.equal((await followUp()).status, "waiting");
  assert.equal(await cardStatus(), "connecting");

  // Only a connection that reaches the card's chat marks it (D-37): not another person's own account, nor another
  // home's or app's; a home's account reaches every chat in its home.
  const timing = { minutes: 30, graceSeconds: 10 };
  const marks = (connection) => b.parts.records.followUps.markReady({ pluginId: "testmail", userId: String(userId), homeId: null, ...connection }, timing, b.system);
  const other = (await knex("users").whereNot({ id: userId }).first())?.id;
  assert.ok(other, "the test database needs a second user row");
  assert.deepEqual(await marks({ userId: String(other) }), []);
  assert.deepEqual(await marks({ pluginId: "othermail" }), []);
  assert.deepEqual(await marks({ userId: String(other), homeId: "999999999" }), []);
  const ids = await marks({ userId: String(other), homeId: String(bot.workspace_id) });
  assert.deepEqual(ids.map(String), [String((await followUp()).id)]);
  await b.parts.records.followUps.waitAgain(ids[0], b.system);
  assert.equal((await followUp()).status, "waiting", "a ready follow-up whose app isn't connected for its chat waits again");

  // One begun 31 minutes ago and never finished goes with the next sweep; the card stays as it is.
  await knex("connect_follow_ups").where({ message_id: card.id }).update({ waiting_since: knex.raw("now() - interval '31 minutes'") });
  await a.bots.connectFollowUps.sweep();
  assert.equal(await followUp(), undefined);
  assert.equal(await cardStatus(), "connecting");

  // A group never carries on (D-46): its follow-up is closed, and its bot doesn't answer.
  const group = await testBot(knex, userId, { name: "Group", kind: "group" });
  cleanup.after(() => knex("bots").where({ id: group.id }).del());
  const [groupCard] = await knex("bot_messages").insert(connectCard(group, { body: { ...connectCard(group).body, status: "connecting" } })).returning("*");
  await knex("connect_follow_ups").insert({
    workspace_id: group.workspace_id,
    message_id: groupCard.id,
    conversation_id: group.conversation_id,
    user_id: userId,
    personal: true,
    plugin_id: "testmail",
    status: "ready",
    lease_until: knex.raw("now() - interval '1 second'")
  });
  await a.bots.connectFollowUps.sweep();
  await a.bots.drain(10000);
  assert.equal(await knex("connect_follow_ups").where({ message_id: groupCard.id }).first(), undefined);
  assert.equal(a.prompts.length, 0);

  // A chat deleted with its bot takes its follow-ups with it.
  await b.bots.connectFromCard(bot.id, card.id, {}, as);
  assert.ok(await followUp());
  await knex("bots").where({ id: bot.id }).del();
  assert.equal(await followUp(), undefined);
});

test("only the person can start a card's follow-up, from a connect card still waiting in their own chat", async (context) => {
  const { knex, b, card, bot, userId, followUp } = await setup(context);
  const other = (await knex("users").whereNot({ id: userId }).first())?.id;
  assert.ok(other, "the test database needs a second user row");
  await assert.rejects(b.bots.connectFromCard(bot.id, card.id, {}, memberOptions({ userId: other, homeId: bot.workspace_id })));
  const [text] = await knex("bot_messages").insert({ ...connectCard(bot), kind: "text", body: { text: "Hello." } }).returning("*");
  const as = memberOptions({ userId, homeId: bot.workspace_id });
  await assert.rejects(b.bots.connectFromCard(bot.id, text.id, {}, as), { code: "bots_connect_card_closed" });
  await knex("bot_messages").where({ id: card.id }).update({ body: { ...connectCard(bot).body, status: "connected" } });
  await assert.rejects(b.bots.connectFromCard(bot.id, card.id, {}, as), { code: "bots_connect_card_closed" });
  assert.equal(await followUp(), undefined, "no refused press keeps a follow-up");
});

test("a sweep's statements and a sign-in's marking don't grow with the cards waiting, and read through their indexes", async (context) => {
  const { knex, a, bot, userId } = await setup(context);
  // `count` more cards waiting for a sign-in, each another person's, in the bot's chat.
  const seed = (count) => knex.raw(
    `with cards as (
       insert into bot_messages (workspace_id, bot_id, conversation_id, kind, role, body)
       select ?, ?, ?, 'connect', 'bot', '{"app": "Testmail", "task": "file it", "status": "connecting", "plugin": {"id": "testmail"}}'::jsonb
         from generate_series(1, ?)
       returning id
     )
     insert into connect_follow_ups (workspace_id, message_id, conversation_id, user_id, personal, plugin_id)
     select ?, id, ?, 900000000 + id, true, 'testmail' from cards`,
    [bot.workspace_id, bot.id, bot.conversation_id, count, bot.workspace_id, bot.conversation_id]
  );
  // The person's own account connected, with none of their own cards waiting.
  const mark = async () => {
    const after = await a.bots.connectFollowUps.connected({ pluginId: "testmail", userId: String(userId), homeId: null }, a.system);
    await after();
  };
  const sweeps = {};
  const marking = {};
  for (const [size, add] of [[10, 10], [10000, 9990]]) {
    await seed(add);
    sweeps[size] = await queriesDuring(a.knex, () => a.bots.connectFollowUps.sweep());
    marking[size] = await queriesDuring(a.knex, mark);
  }
  console.log(`connect follow-ups, statements at 10 and 10,000 cards waiting: a sweep ${JSON.stringify(sweeps)}, a sign-in's marking ${JSON.stringify(marking)}`);
  assert.equal(sweeps[10000], sweeps[10], "a sweep sends the same statements however many cards wait");
  assert.equal(marking[10000], marking[10], "so does marking a sign-in's follow-ups");
  assert.equal(Number((await knex("connect_follow_ups").where({ conversation_id: bot.conversation_id, status: "waiting" }).count("* as n").first()).n), 10000);

  // Each statement reads through its index, a handful of rows, not the 10,000 waiting.
  const statements = await statementsDuring(a.knex, async () => {
    await a.bots.connectFollowUps.sweep();
    await mark();
  }, /connect_follow_ups/u);
  for (const statement of statements) {
    const { rowsRead, indexes } = await planOf(knex, statement);
    assert.ok([...indexes].some((name) => name.includes("connect_follow_ups")), `${statement.sql} reads through its index (${[...indexes]})`);
    assert.ok(rowsRead < 50, `${statement.sql} reads ${rowsRead} rows`);
  }
});
