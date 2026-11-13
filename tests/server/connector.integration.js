import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { startFakeMcp } from "../support/fakeMcpServer.mjs";
import { ownedHandles } from "../support/ownedHandles.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { ACCOUNT_OWNS } from "../../packages/account/src/server/AccountFeature.js";
import { createAccountService } from "../../packages/account/src/server/accountService.js";
import { publicFetch } from "../../packages/account/src/server/publicAddress.js";
import { seal, unseal } from "../../packages/account/src/server/vaultCrypto.js";
import { createAccounts } from "../../packages/integrations/src/server/accounts.js";
import { createConnections } from "../../packages/integrations/src/server/connections.js";
import { INTEGRATIONS_OWNS } from "../../packages/integrations/src/server/IntegrationsFeature.js";
import { createIntegrationsService } from "../../packages/integrations/src/server/integrationsService.js";
import { createOAuth } from "../../packages/integrations/src/server/oauth.js";

// The general connector (D-34), against the disposable test database and a stand-in app that hosts its own connection
// point (tests/support/fakeMcpServer.mjs): the app is found from what it says about itself, this copy registers there
// once and every server reuses that, people sign in with PKCE for the app's own address, its actions are listed and
// run over Streamable HTTP, keys are renewed, a withdrawn sign-in signs the account out, and disconnecting withdraws
// it at the app too.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");
const VAULT = randomBytes(32).toString("base64");
const VAULT_KEY = Buffer.from(VAULT, "base64");
// The person's own accounts, as the Connect apps routes and a bot's own chat reach them.
const REACH = Object.freeze({ personal: true });
// The app sending the browser back: no one is signed in to that call.
const NO_ONE = requestContextOptions({});
const ENV = Object.freeze({ APP_PUBLIC_URL: "http://localhost:4000", MERCBOT_VAULT_KEY: VAULT });
const CALLBACK = "http://localhost:4000/api/connections/callback";

/**
 * The test database's first person with one account of a stand-in app of the test's own (its plugin id is unique to
 * the test), and `serve(env)`: the integrations service and its sign-ins as a fresh server builds them.
 */
async function setup(context, { mcp = {} } = {}) {
  const knex = await connectTestDatabase();
  const fake = await startFakeMcp(context);
  const userId = String((await knex("users").first()).id);
  const pluginId = `tasks-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
  const catalogue = [{ id: pluginId, name: "Tasks", mcp: { url: fake.url, whoami: "whoami", sends: ["add-comment"], ...mcp } }];
  const [account] = await knex("plugin_accounts").insert({ user_id: userId, plugin_id: pluginId, name: "default" }).returning("*");
  context.after(async () => {
    await knex("plugin_actions_off").where({ plugin_id: pluginId }).del();
    await knex("plugin_accounts").where({ plugin_id: pluginId }).del();
    await knex("connector_apps").where({ plugin_id: pluginId }).del();
    await knex.destroy();
  });
  const { profiles, features } = await ownedHandles(knex, context, { "mercbot.integrations": INTEGRATIONS_OWNS, "mercbot.account": ACCOUNT_OWNS });
  const accountService = createAccountService({ ...features["mercbot.account"], directory: { botOwner: async () => null }, profiles, env: ENV, copyRunners: null });
  const { resources, systemContext } = features["mercbot.integrations"];
  const serve = (env = ENV) => {
    const accounts = createAccounts({ pluginAccounts: resources.pluginAccounts, systemContext });
    const connections = createConnections({
      resources,
      accounts,
      systemContext,
      catalogue,
      env,
      oauthClient: createOAuth({ env, insecure: true }),
      // The stand-in is on this machine, which only tests may reach.
      fetch: publicFetch(true),
      // No home is unlinked from in these tests.
      isMember: async () => false,
      recordActivity: async () => {},
      // This copy lends no sign-ins.
      bridgedSignIns: null
    });
    return createIntegrationsService({ resources, accounts, catalogue, connections, account: accountService, profiles, systemContext });
  };
  const as = requestContextOptions({ user: { id: userId } });
  const row = () => knex("plugin_accounts").where({ id: account.id }).first();
  const app = () => knex("connector_apps").where({ plugin_id: pluginId }).first();
  return { knex, fake, catalogue, pluginId, accountId: String(account.id), serve, as, row, app };
}

/** Connect, the person agreeing at the app, and the app sending the browser back: the callback's answer. */
async function signIn(integrations, fake, accountId, as) {
  const url = new URL((await integrations.connections.connect(REACH, accountId, as)).url);
  const back = await fake.consent(url);
  assert.equal(`${back.origin}${back.pathname}`, CALLBACK);
  return { url, result: await integrations.connections.callback(Object.fromEntries(back.searchParams), NO_ONE) };
}

/** The key the account now holds, opened. */
async function keysOf(row) {
  return unseal((await row()).tokens, VAULT_KEY);
}

test("an app is found from what it says about itself, registered once, signed in to, and its actions listed and run", async (context) => {
  const { fake, pluginId, accountId, serve, as, row, app } = await setup(context);
  const integrations = serve();

  // Discovery and registration: the app's 401 named its description, which named its sign-in server.
  const { url, result } = await signIn(integrations, fake, accountId, as);
  assert.equal(`${url.origin}${url.pathname}`, `${fake.base}/auth/authorize`);
  assert.deepEqual(
    ["client_id", "redirect_uri", "response_type", "scope", "code_challenge_method", "resource"].map((name) => url.searchParams.get(name)),
    ["client-1", CALLBACK, "code", "tasks", "S256", fake.url]
  );
  assert.equal(fake.state.registrations, 1);
  const stored = await app();
  assert.equal(stored.redirect_uri, CALLBACK);
  assert.deepEqual([stored.server.issuer, stored.server.resource, stored.server.scopes], [`${fake.base}/auth`, fake.url, ["tasks"]]);
  assert.ok(!JSON.stringify(stored.client).includes("client-1"), "the registered client is sealed");

  // Signed in: labelled with who the app says signed in, its actions kept for the switches on its page.
  assert.deepEqual(result, { provider: "Tasks", label: "pat@example.com" });
  const signedIn = await row();
  assert.deepEqual([signedIn.status, signedIn.label, signedIn.sign_in_state], ["connected", "pat@example.com", null]);
  assert.ok(!JSON.stringify(signedIn.tokens).includes("access-"), "the keys are sealed");
  assert.deepEqual((await app()).tools.map((tool) => [tool.id, tool.reads]), [
    ["whoami", true], ["list-tasks", true], ["add-task", false], ["delete-task", false], ["add-comment", false], ["broken", true], ["refused", true]
  ]);
  const listed = (await integrations.list(REACH, as)).plugins.find((entry) => entry.id === pluginId);
  assert.deepEqual(listed.actions.slice(0, 3), [
    { id: "whoami", name: "Who am I", reads: true, enabled: true },
    { id: "list-tasks", name: "List tasks", reads: true, enabled: true },
    { id: "add-task", name: "Add a task", reads: false, enabled: true }
  ]);

  // Another server signing someone in uses the same registration (D-15); a copy whose address changed registers again.
  await signIn(serve(), fake, accountId, as);
  assert.equal(fake.state.registrations, 1);
  const moved = serve({ ...ENV, APP_PUBLIC_URL: "http://localhost:4100" });
  const movedUrl = new URL((await moved.connections.connect(REACH, accountId, as)).url);
  assert.deepEqual([movedUrl.searchParams.get("client_id"), fake.state.registrations], ["client-2", 2]);
  assert.equal((await app()).redirect_uri, "http://localhost:4100/api/connections/callback");
  await signIn(integrations, fake, accountId, as);

  // The actions, read over two pages, and run: an answer as JSON or as server-sent events, the app's own error.
  const { tools, off } = await integrations.connectors.actions(REACH, accountId, as);
  assert.deepEqual([tools.length, off], [7, []]);
  assert.deepEqual(tools.find((tool) => tool.name === "add-task").inputSchema.required, ["content"]);
  assert.deepEqual(await integrations.connectors.use(REACH, accountId, "list-tasks", {}, as), { text: "Buy milk\nCall the vet", isError: false });
  assert.deepEqual(await integrations.connectors.use(REACH, accountId, "add-task", { content: "Buy a card" }, as), { text: 'Added "Buy a card".', isError: false });
  assert.deepEqual(await integrations.connectors.use(REACH, accountId, "broken", {}, as), { text: "No such project.", isError: true });
  await assert.rejects(integrations.connectors.use(REACH, accountId, "refused", {}, as), (error) => {
    assert.equal(error.code, "integrations_connector_refused");
    assert.equal(error.message, "Tasks refused that: Unknown project id");
    return true;
  });
  assert.deepEqual(fake.state.calls.slice(-4).map((call) => call.name), ["list-tasks", "add-task", "broken", "refused"]);

  // An action the person switched off in Connect apps isn't offered, and isn't run.
  await integrations.switchAction(REACH, pluginId, "delete-task", false, as);
  const switched = await integrations.connectors.actions(REACH, accountId, as);
  assert.deepEqual([switched.tools.some((tool) => tool.name === "delete-task"), switched.off], [false, ["Delete a task"]]);
  await assert.rejects(integrations.connectors.use(REACH, accountId, "delete-task", { content: "Buy milk" }, as), { code: "integrations_connector_action_off" });
  await assert.rejects(integrations.switchAction(REACH, pluginId, "no-such-action", false, as), { code: "integrations_action_not_found" });

  // Each conversation ends its session at the app.
  for (let waited = 0; fake.state.ended < 5 && waited < 2000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(fake.state.ended >= 5, `sessions ended: ${fake.state.ended}`);
});


test("an app whose connection point moves is found and registered again at its new address", async (context) => {
  const { fake, catalogue, accountId, serve, as, app } = await setup(context);
  await signIn(serve(), fake, accountId, as);
  const moved = await startFakeMcp(context);
  catalogue[0].mcp.url = moved.url;
  const url = new URL((await serve().connections.connect(REACH, accountId, as)).url);
  assert.equal(`${url.origin}${url.pathname}`, `${moved.base}/auth/authorize`);
  assert.deepEqual([url.searchParams.get("client_id"), url.searchParams.get("resource"), moved.state.registrations], ["client-1", moved.url, 1]);
  const stored = (await app()).server;
  assert.deepEqual([stored.url, stored.issuer, stored.resource], [moved.url, `${moved.base}/auth`, moved.url]);
});
test("a key is renewed before it runs out and when the app refuses it; a withdrawn sign-in signs the account out", async (context) => {
  const { knex, fake, accountId, serve, as, row } = await setup(context);
  const integrations = serve();
  await signIn(integrations, fake, accountId, as);
  const first = await keysOf(row);

  // About to run out: renewed first, for the app's own address, and the app's new refresh key kept (it rotates them).
  await knex("plugin_accounts").where({ id: accountId }).update({ tokens: seal({ ...first, expiresAt: Date.now() - 1000 }, VAULT_KEY) });
  assert.equal((await integrations.connectors.use(REACH, accountId, "list-tasks", {}, as)).isError, false);
  const renewed = await keysOf(row);
  assert.equal(fake.state.refreshes, 1);
  assert.notEqual(renewed.access, first.access);
  assert.notEqual(renewed.refresh, first.refresh);

  // Refused by the app before its time (401): renewed once and tried again.
  fake.expireAccessKeys();
  assert.equal((await integrations.connectors.use(REACH, accountId, "list-tasks", {}, as)).isError, false);
  assert.equal(fake.state.refreshes, 2);

  // Withdrawn on the app's own site: signed out, still named, and the bot told plainly.
  fake.withdrawAll();
  await assert.rejects(integrations.connectors.use(REACH, accountId, "list-tasks", {}, as), (error) => {
    assert.equal(error.code, "integrations_connector_signed_out");
    assert.equal(error.message, "Tasks isn't connected any more: its sign-in was withdrawn or has run out. Sign in again from Connect apps.");
    return true;
  });
  const signedOut = await row();
  assert.deepEqual([signedOut.status, signedOut.tokens, signedOut.label], ["needs-auth", null, "pat@example.com"]);
  await assert.rejects(integrations.connectors.actions(REACH, accountId, as), { code: "integrations_account_signed_out" });

  // Signing in again connects it again.
  await signIn(integrations, fake, accountId, as);
  assert.equal((await row()).status, "connected");
});

// Notion and Todoist take each refresh key once. Two servers renewing one account's key at the same moment: the second
// waits for the first and goes on with its new key, where it used to send the used refresh key, be refused and sign
// the account out (D-15). The stand-in answers renewals late, so both ask while the other's renewal is on its way.
test("two servers renewing one account's key at once renew it once, and both go on with the new key", async (context) => {
  const { knex, fake, accountId, serve, as, row } = await setup(context);
  await signIn(serve(), fake, accountId, as);
  const first = await keysOf(row);
  fake.settings.tokenDelay = 300;
  const both = () => Promise.all([serve(), serve()].map((server) => server.connectors.use(REACH, accountId, "list-tasks", {}, as)));

  // About to run out on both.
  await knex("plugin_accounts").where({ id: accountId }).update({ tokens: seal({ ...first, expiresAt: Date.now() - 1000 }, VAULT_KEY) });
  assert.deepEqual((await both()).map((answer) => answer.isError), [false, false]);
  assert.equal(fake.state.refreshes, 1);
  assert.deepEqual([(await row()).status, (await keysOf(row)).refresh === first.refresh], ["connected", false]);

  // Refused by the app on both before its time (401).
  fake.expireAccessKeys();
  assert.deepEqual((await both()).map((answer) => answer.isError), [false, false]);
  assert.equal(fake.state.refreshes, 2);
  assert.equal((await row()).status, "connected");
});

test("disconnecting withdraws the sign-in at the app too", async (context) => {
  const { fake, accountId, serve, as, row } = await setup(context);
  const integrations = serve();
  await signIn(integrations, fake, accountId, as);
  const { refresh } = await keysOf(row);
  await integrations.connections.disconnect(REACH, accountId, as);
  assert.deepEqual(fake.state.revoked, [refresh]);
  const gone = await row();
  assert.deepEqual([gone.status, gone.tokens, gone.label], ["needs-auth", null, null]);
  await assert.rejects(integrations.connectors.use(REACH, accountId, "list-tasks", {}, as), { code: "integrations_account_signed_out" });
});

test("an app whose sign-in can't be trusted or used gets a plain answer", async (context) => {
  const { fake, accountId, pluginId, serve, as, app } = await setup(context);
  const connect = () => serve().connections.connect(REACH, accountId, as);

  // A sign-in this copy would lend to another copy (startBridgedSignIn) is refused before the app is even looked at.
  const lent = [];
  await assert.rejects(serve().connections.startBridgedSignIn(pluginId, async (id) => lent.push(id), NO_ONE), { code: "integrations_hub_sign_in_unset" });
  assert.deepEqual(lent, [], "no bridge connection is made for it");
  assert.equal(fake.state.registrations, 0);
  const refusal = (code, message) => (error) => {
    assert.equal(error.code, code);
    assert.match(error.message, message);
    return true;
  };

  // Describing another address: another app could be passing itself off as this one.
  fake.settings.resource = "https://elsewhere.example/mcp";
  await assert.rejects(connect(), refusal("integrations_connector_discovery_failed", /Couldn't reach Tasks's sign-in \(it described another address\)/u));
  fake.settings.resource = null;

  // A sign-in without PKCE isn't used.
  fake.settings.pkce = false;
  await assert.rejects(connect(), refusal("integrations_connector_discovery_failed", /doesn't offer PKCE/u));
  fake.settings.pkce = true;

  // Registration refused, and an app that doesn't let Mercbot register with no app of this copy's own set up.
  fake.settings.refuseRegistration = true;
  await assert.rejects(connect(), refusal("integrations_connector_registration_refused", /didn't let Mercbot register for sign-in \(invalid_client_metadata: redirect_uri must start with https in Production\)/u));
  fake.settings.refuseRegistration = false;
  fake.settings.registration = false;
  await assert.rejects(connect(), refusal("integrations_connector_unregistered", /doesn't let Mercbot register itself/u));
  assert.equal(await app(), undefined, "nothing is stored for a sign-in that can't work");
  fake.settings.registration = true;

  // An app that has forgotten this copy's registration: the sign-in fails plainly, and the next one registers again.
  const integrations = serve();
  const url = new URL((await integrations.connections.connect(REACH, accountId, as)).url);
  const back = await fake.consent(url);
  fake.forgetClients();
  await assert.rejects(integrations.connections.callback(Object.fromEntries(back.searchParams), NO_ONE), /Tasks/u);
  for (let waited = 0; (await app()) && waited < 2000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await app(), undefined, "the forgotten registration is dropped");
  await signIn(serve(), fake, accountId, as);
  assert.equal(fake.state.registrations, 2);
});

test("an app that can't be reached says so", async (context) => {
  const { accountId, serve, as } = await setup(context, { mcp: { url: "http://127.0.0.1:9/mcp" } });
  await assert.rejects(serve().connections.connect(REACH, accountId, as), (error) => {
    assert.equal(error.code, "integrations_connector_discovery_failed");
    assert.equal(error.message, "Couldn't reach Tasks's sign-in (no answer). Try again in a few minutes.");
    return true;
  });
});
