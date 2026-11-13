import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import http from "node:http";
import test from "node:test";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { ownedHandles } from "../support/ownedHandles.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { seal, unseal } from "../../packages/account/src/server/vaultCrypto.js";
import { auditEventResource } from "../../packages/apps/src/server/tableResources.js";
import { createAccounts } from "../../packages/integrations/src/server/accounts.js";
import { createConnections } from "../../packages/integrations/src/server/connections.js";
import { INTEGRATIONS_OWNS } from "../../packages/integrations/src/server/IntegrationsFeature.js";
import { createOAuth } from "../../packages/integrations/src/server/oauth.js";

// Connected accounts and the bridge (D-31), against the disposable test database, with a stand-in provider in place
// of Google and a stand-in hub: a copy without its own apps links to a hub, borrows its sign-in and gets hourly keys,
// while the long-lived permission stays on the hub, which lends its sign-ins through `bridgedSignIns`.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");
const VAULT = randomBytes(32).toString("base64");

// The stand-in provider: a token endpoint that hands out codes' and refreshes' tokens, and "who am I".
async function standInProvider(context) {
  let refreshes = 0;
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const form = new URLSearchParams(body);
      const send = (status, value) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
      if (request.url === "/me") return send(200, { email: "pat@example.com" });
      if (form.get("client_secret") !== "secret") return send(401, { error: "invalid_client" });
      if (form.get("grant_type") === "authorization_code" && form.get("code") === "partial" && form.get("code_verifier")) {
        return send(200, { access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, token_type: "Bearer", scope: "profile" });
      }
      if (form.get("grant_type") === "authorization_code" && form.get("code") === "full" && form.get("code_verifier")) {
        return send(200, { access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, token_type: "Bearer", scope: "https://scopes.example/profile https://scopes.example/mail" });
      }
      if (form.get("grant_type") === "authorization_code" && form.get("code") === "good" && form.get("code_verifier")) {
        return send(200, { access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, token_type: "Bearer" });
      }
      if (form.get("grant_type") === "refresh_token" && form.get("refresh_token") === "refresh-1") {
        refreshes += 1;
        return send(200, { access_token: `access-${refreshes + 1}`, expires_in: 3600, token_type: "Bearer" });
      }
      return send(400, { error: "invalid_grant" });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
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

const catalogue = [{ id: "testmail", name: "Testmail", oauth: { provider: "test", scopes: ["mail"] } }];
// The person's own accounts, as the Connect apps routes reach them.
const REACH = Object.freeze({ personal: true });
// Calls no one is signed in to: the provider sending the browser back, a linked copy calling the hub.
const NO_ONE = requestContextOptions({});

// A stand-in for the hub a copy links to (D-31): its link approved by setting `approved`, and the sign-ins it lends kept
// in memory as the feature lending them would keep them (`lent`, mercbot.integrations.bridged-sign-ins). `forCopy` is
// what a linked copy reaches it through, the hub's own connections (`hub`) doing the signing in.
function standInHub() {
  const request = { id: "request-1", code: "KQ7M-3PXD", pollSecret: "poll-secret" };
  const state = { name: null, approved: false, unlinked: false, rows: new Map() };
  const byRef = (ref) => [...state.rows.values()].find((row) => row.remoteRef === ref) || null;
  const lent = {
    pluginOf: async (id) => state.rows.get(id)?.pluginId ?? null,
    signedIn: async (id, { tokens, label }) => {
      Object.assign(state.rows.get(id), { tokens, label });
    }
  };
  const forCopy = (hub, installToken) => {
    const linked = () => assert.equal(installToken, "install-token", "the copy proves itself with its install token");
    return {
      createLinkRequest: async (name) => {
        state.name = name;
        return { ...request, approveUrl: `https://hub.example/account/link?link=${request.code}` };
      },
      claim: async (id, pollSecret) => {
        assert.deepEqual([id, pollSecret], [request.id, request.pollSecret]);
        return state.approved ? { token: "install-token" } : { pending: true };
      },
      start: async ({ pluginId, remoteRef }) => {
        linked();
        return hub.startBridgedSignIn(pluginId, async (plugin) => {
          const id = String(state.rows.size + 1);
          state.rows.set(id, { remoteRef, pluginId: plugin, tokens: null, label: null });
          return id;
        }, NO_ONE);
      },
      status: async (ref) => {
        linked();
        return { connected: Boolean(byRef(ref)?.tokens), label: byRef(ref)?.label ?? null };
      },
      token: async (ref) => {
        linked();
        const row = byRef(ref);
        return hub.bridgedToken(row.pluginId, row.tokens, async (tokens) => {
          row.tokens = tokens;
        }, NO_ONE);
      },
      disconnect: async (ref) => {
        linked();
        for (const [id, row] of state.rows) if (row.remoteRef === ref) state.rows.delete(id);
        return { disconnected: true };
      },
      unlink: async () => {
        linked();
        state.unlinked = true;
        return { unlinked: true };
      }
    };
  };
  return { state, lent, forCopy };
}

async function setup(context) {
  const knex = await connectTestDatabase();
  const userId = (await knex("users").first())?.id;
  assert.ok(userId, "the test database needs a user row");
  const providers = await standInProvider(context);
  const [account] = await knex("plugin_accounts").insert({ user_id: userId, plugin_id: "testmail", name: "default" }).returning("*");
  context.after(async () => {
    await knex("plugin_accounts").where({ id: account.id }).del();
    await knex("bridge_link").del();
    await knex.destroy();
  });
  // The apps feature's Activity trail, which records an unlink (D-31), as mercbot.apps' activity.record writes it.
  const { memberships, features } = await ownedHandles(knex, context, { "mercbot.integrations": INTEGRATIONS_OWNS, "mercbot.apps": [auditEventResource] });
  const { resources, systemContext } = features["mercbot.integrations"];
  const { auditEvents } = features["mercbot.apps"].resources;
  // As IntegrationsFeature passes them: a home's members from workspaces.memberships, and the apps' Activity trail.
  const homeDependencies = {
    isMember: async (homeId, memberId, options) => Boolean(await memberships.findActiveByWorkspaceIdAndUserId(homeId, memberId, passedOn(options))),
    recordActivity: (entry, options) => auditEvents.create(entry, { ...passedOn(options), returning: "none" })
  };
  const accounts = createAccounts({ pluginAccounts: resources.pluginAccounts, systemContext });
  const connections = (fields) => createConnections({ resources, accounts, ...homeDependencies, ...fields });
  const service = (env, hubFor = null, bridgedSignIns = null) =>
    connections({ catalogue, env, providers, oauthClient: createOAuth({ env, insecure: true }), bridgedSignIns, ...(hubFor ? { hubFor } : {}) });
  // The person signed in outside any home, as the Connect apps routes' options describe them.
  const as = requestContextOptions({ user: { id: String(userId) } });
  return { knex, userId, account, service, connections, as };
}

const HUB_ENV = Object.freeze({ APP_PUBLIC_URL: "https://hub.example", TESTMAIL_CLIENT_ID: "client", TESTMAIL_CLIENT_SECRET: "secret", MERCBOT_VAULT_KEY: VAULT });

test("a copy without its own apps links to a hub and borrows its sign-in, which the hub lends", async (context) => {
  const { knex, userId, account, service, as } = await setup(context);
  const standIn = standInHub();
  const hub = service(HUB_ENV, null, standIn.lent);
  const local = service({ APP_PUBLIC_URL: "http://localhost:4000", MERCBOT_HUB_URL: "https://hub.example", MERCBOT_VAULT_KEY: VAULT }, (_url, installToken) => standIn.forCopy(hub, installToken));

  // Unlinked, it says how to fix it.
  await assert.rejects(local.connect(REACH, account.id, as), /Link it to a Mercbot account/u);
  // Without MERCBOT_HUB_URL, linking is off and says so (keys.js).
  await assert.rejects(service({ APP_PUBLIC_URL: "http://localhost:4000", MERCBOT_VAULT_KEY: VAULT }).startLink("Pat's laptop", as), {
    statusCode: 409,
    code: "integrations_link_hub_unset"
  });

  // Linking: the person approves the code on the hub, then the copy picks up its install token.
  const { approveUrl, code } = await local.startLink("Pat's laptop", as);
  assert.equal(approveUrl, `https://hub.example/account/link?link=${code}`);
  assert.equal(standIn.state.name, "Pat's laptop");
  assert.equal((await local.checkLink(as)).linked, false);
  standIn.state.approved = true;
  assert.equal((await local.checkLink(as)).linked, true);

  // Connecting goes through the hub's app, and the provider sends the person back to the hub, which hands the sign-in to
  // the bridge connection it lent it for: its app, its label, and its tokens sealed.
  const { url } = await local.connect(REACH, account.id, as);
  const consent = new URL(url);
  assert.equal(consent.searchParams.get("client_id"), "client");
  assert.equal(consent.searchParams.get("redirect_uri"), "https://hub.example/api/connections/callback");
  assert.equal(consent.searchParams.get("code_challenge_method"), "S256");
  assert.equal(consent.searchParams.get("scope"), "profile mail");
  const result = await hub.callback({ code: "good", state: consent.searchParams.get("state") }, NO_ONE);
  assert.equal(result.label, "pat@example.com");
  const [bridged] = standIn.state.rows.values();
  assert.deepEqual([bridged.pluginId, bridged.label], ["testmail", "pat@example.com"]);
  assert.ok(bridged.tokens && !JSON.stringify(bridged.tokens).includes("refresh-1"), "tokens are sealed on the hub");

  // What waits for a connection (the bots' connect follow-ups) hears of it once, the person's own, while it's saved (not
  // yet seen connected outside its transaction), and what it answers runs once that has committed.
  const told = [];
  const statusNow = async () => (await knex("plugin_accounts").where({ id: account.id }).first()).status;
  context.after(local.whenConnected(async (connection) => {
    told.push({ ...connection, seenOutside: await statusNow() });
    return async () => told.push({ committed: await statusNow() });
  }));

  // The screen waiting for one account's sign-in finishes that one only.
  await local.syncPending(as, { accountId: String(Number(account.id) + 1) });
  assert.equal((await knex("plugin_accounts").where({ id: account.id }).first()).status, "needs-auth", "another account's check leaves it");
  await local.syncPending(as, { accountId: "not-an-id" });
  assert.equal((await knex("plugin_accounts").where({ id: account.id }).first()).status, "needs-auth");
  await local.syncPending(as, { accountId: String(account.id) });

  // The copy sees it connected, and gets hourly keys; the long-lived permission stays on the hub.
  await local.syncPending(as);
  assert.deepEqual(told, [{ pluginId: "testmail", userId: String(userId), homeId: null, seenOutside: "needs-auth" }, { committed: "connected" }]);
  const row = await knex("plugin_accounts").where({ id: account.id }).first();
  assert.equal(row.status, "connected");
  assert.equal(row.label, "pat@example.com");
  assert.equal(row.tokens, null);
  assert.equal((await local.accessToken(REACH, account.id, as)).accessToken, "access-1");

  // An expired key is renewed on the hub, which keeps the renewed tokens, sealed.
  const key = Buffer.from(VAULT, "base64");
  bridged.tokens = seal({ ...unseal(bridged.tokens, key), expiresAt: Date.now() - 1000 }, key);
  assert.equal((await local.accessToken(REACH, account.id, as)).accessToken, "access-2");
  assert.equal(unseal(bridged.tokens, key).access, "access-2");

  // A sign-in link only works once.
  await assert.rejects(hub.callback({ code: "good", state: consent.searchParams.get("state") }, NO_ONE), /expired/u);

  // Disconnecting removes the hub's permission; unlinking tells the hub, so the copy's token stops working there.
  await local.disconnect(REACH, account.id, as);
  assert.equal(standIn.state.rows.size, 0);
  const installToken = (await knex("bridge_link").first()).token;
  assert.ok(installToken && !JSON.stringify(installToken).includes("install-token"), "the copy keeps its install token sealed");
  await local.unlink(as);
  assert.equal(standIn.state.unlinked, true);
  assert.equal((await local.linkStatus(as)).linked, false);
});

// The provider's callback for a sign-in lent to a bridge connection (oauth_states.bridge_connection_id) is finished only
// through the feature that keeps those connections, and only while it still has the connection.
test("a sign-in lent for a bridge connection is finished only through the feature that keeps it", async (context) => {
  const { service } = await setup(context);
  const lentOnce = async (lender) => {
    const { url } = await lender.startBridgedSignIn("testmail", async (pluginId) => {
      assert.equal(pluginId, "testmail");
      return "41";
    }, NO_ONE);
    return new URL(url).searchParams.get("state");
  };
  // No feature keeps bridge connections on this server.
  const alone = service(HUB_ENV);
  await assert.rejects(alone.callback({ code: "good", state: await lentOnce(alone) }, NO_ONE), { code: "integrations_sign_in_unavailable" });
  // The feature no longer has the connection.
  const kept = [];
  const gone = service(HUB_ENV, null, { pluginOf: async () => null, signedIn: async (...args) => kept.push(args) });
  await assert.rejects(gone.callback({ code: "good", state: await lentOnce(gone) }, NO_ONE), { code: "integrations_sign_in_unavailable" });
  assert.deepEqual(kept, []);
  // A key from a lent sign-in that ran out with nothing to renew it with is refused, and nothing is saved.
  const key = Buffer.from(VAULT, "base64");
  await assert.rejects(
    alone.bridgedToken("testmail", seal({ access: "old", expiresAt: Date.now() - 1000 }, key), async () => assert.fail("nothing to save"), NO_ONE),
    { code: "integrations_sign_in_ran_out" }
  );
});

test("a copy with its own app signs in directly", async (context) => {
  const { knex, account, service, as } = await setup(context);
  const local = service({ APP_PUBLIC_URL: "http://localhost:4000", TESTMAIL_TEST_CLIENT_ID: "client", TESTMAIL_TEST_CLIENT_SECRET: "secret", MERCBOT_VAULT_KEY: VAULT });
  const consent = new URL((await local.connect(REACH, account.id, as)).url);
  assert.equal(consent.searchParams.get("redirect_uri"), "http://localhost:4000/api/connections/callback");
  // Started and not finished, then cancelled: Reconnect, then Retry.
  assert.equal((await knex("plugin_accounts").where({ id: account.id }).first()).sign_in_state, "started");
  await assert.rejects(local.callback({ error: "access_denied", state: consent.searchParams.get("state") }, NO_ONE), /cancelled, so nothing was connected/u);
  assert.equal((await knex("plugin_accounts").where({ id: account.id }).first()).sign_in_state, "failed");

  const again = new URL((await local.connect(REACH, account.id, as)).url);
  await local.callback({ code: "good", state: again.searchParams.get("state") }, NO_ONE);
  const row = await knex("plugin_accounts").where({ id: account.id }).first();
  assert.equal(row.status, "connected");
  assert.equal(row.sign_in_state, null);
  assert.ok(row.tokens && !JSON.stringify(row.tokens).includes("access-1"), "tokens are sealed");
  assert.equal((await local.accessToken(REACH, account.id, as)).accessToken, "access-1");
});

test("a sign-in that couldn't come back is finished from the pasted address, only by its owner", async (context) => {
  const { knex, account, service, as } = await setup(context);
  const local = service({ APP_PUBLIC_URL: "http://127.0.0.1:4000", TESTMAIL_CLIENT_ID: "client", TESTMAIL_CLIENT_SECRET: "secret", MERCBOT_VAULT_KEY: VAULT });
  const consent = new URL((await local.connect(REACH, account.id, as)).url);
  const state = consent.searchParams.get("state");
  await assert.rejects(local.finishPasted(`https://elsewhere.example/api/connections/callback?state=${state}&code=good`, as), /isn't the address/u);
  await assert.rejects(local.finishPasted("not an address", as), /isn't the address/u);
  await assert.rejects(local.finishPasted(`http://127.0.0.1:4000/api/connections/callback?state=${state}&code=good`, requestContextOptions({ user: { id: "999999999" } })), /expired or was already finished/u);
  const result = await local.finishPasted(`  http://127.0.0.1:4000/api/connections/callback?state=${state}&code=good&scope=mail  `, as);
  assert.equal(result.label, "pat@example.com");
  assert.equal((await knex("plugin_accounts").where({ id: account.id }).first()).status, "connected");
  await assert.rejects(local.finishPasted(`http://127.0.0.1:4000/api/connections/callback?state=${state}&code=good`, as), /expired or was already finished/u);

  // A code the provider no longer accepts gets a plain answer.
  const late = new URL((await local.connect(REACH, account.id, as)).url).searchParams.get("state");
  await assert.rejects(local.finishPasted(`http://127.0.0.1:4000/api/connections/callback?state=${late}&code=stale`, as), /didn't accept the sign-in/u);
});

test("a sign-in where the person unticked part of the access isn't connected", async (context) => {
  const { knex, account, service, connections, as } = await setup(context);
  const local = service({ APP_PUBLIC_URL: "http://localhost:4000", TESTMAIL_CLIENT_ID: "client", TESTMAIL_CLIENT_SECRET: "secret", MERCBOT_VAULT_KEY: VAULT });
  const first = new URL((await local.connect(REACH, account.id, as)).url).searchParams.get("state");
  await assert.rejects(local.callback({ code: "partial", state: first }, NO_ONE), /didn't give Testmail access/u);
  assert.equal((await knex("plugin_accounts").where({ id: account.id }).first()).status, "needs-auth");
  const again = new URL((await local.connect(REACH, account.id, as)).url).searchParams.get("state");
  await local.callback({ code: "full", state: again }, NO_ONE);
  const row = await knex("plugin_accounts").where({ id: account.id }).first();
  assert.equal(row.status, "connected");

  // When the app later asks for more than the sign-in gave (D-42), the account needs more access.
  // The account as the integrations module reads it.
  const record = { ...row, pluginId: row.plugin_id };
  assert.equal(local.lacksAccess(record), false);
  const wider = connections({
    catalogue: [{ id: "testmail", name: "Testmail", oauth: { provider: "test", scopes: ["mail", "calendar"] } }],
    env: { MERCBOT_VAULT_KEY: VAULT }, providers: await standInProvider(context)
  });
  assert.equal(wider.lacksAccess(record), true);
  assert.equal(wider.lacksAccess({ ...record, status: "needs-auth" }), false, "only a connected account");
});

// Unlinking (D-31): every account that borrowed the hub's sign-in is signed out, a person's own (of no home) as well
// as a home's, since a copy no longer linked must not keep using the hub's permission; an account signed in on its
// own stays connected.
test("unlinking signs out every account that borrowed the hub's sign-in, a person's own and a home's", async (context) => {
  const { knex, userId, account, service, as } = await setup(context);
  const stamp = `${Date.now()}-${process.pid}`;
  const [home] = await knex("workspaces").insert({ slug: `unlink-${stamp}`, name: "Unlink test", owner_user_id: userId, is_personal: false }).returning("id");
  const homeId = home.id ?? home;
  const bridged = { user_id: userId, plugin_id: "testmail", status: "connected", label: "pat@example.com" };
  const seeded = await knex("plugin_accounts").insert([
    { ...bridged, workspace_id: null, name: "own, bridged", bridge_ref: `personal-${stamp}` },
    { ...bridged, workspace_id: homeId, name: "home, bridged", bridge_ref: `home-${stamp}` }
  ]).returning("id");
  const [personal, ofHome] = seeded.map((row) => row.id ?? row);
  await knex("plugin_accounts").where({ id: account.id }).update({ status: "connected", label: "own@example.com" });
  await knex("bridge_link").del();
  await knex("bridge_link").insert({ hub_url: "https://hub.example", name: "Pat's laptop", linked_by: userId });
  try {
    const local = service({ APP_PUBLIC_URL: "http://localhost:4000", MERCBOT_HUB_URL: "https://hub.example", MERCBOT_VAULT_KEY: VAULT });
    assert.equal((await local.unlink(as)).linked, false);
    const rows = new Map((await knex("plugin_accounts").whereIn("id", [personal, ofHome, account.id])).map((row) => [String(row.id), row]));
    for (const id of [personal, ofHome]) {
      const row = rows.get(String(id));
      assert.deepEqual([row.bridge_ref, row.status, row.label], [null, "needs-auth", null], `${row.name}: signed out`);
    }
    assert.deepEqual([rows.get(String(account.id)).status, rows.get(String(account.id)).label], ["connected", "own@example.com"], "an account signed in on its own stays connected");
    assert.equal((await knex("bridge_link")).length, 0, "the link is gone");
  } finally {
    await knex("plugin_accounts").whereIn("id", [personal, ofHome]).del();
    await knex("workspaces").where({ id: homeId }).del();
  }
});

// Who may unlink (D-31): the person who linked the copy, anywhere; the owners and admins of a home that person is in,
// from that home, which records it in the home's Activity trail; once the linker's account is gone, the owners and
// admins of any home. A member who doesn't manage the home, and the owner of a home the linker isn't in, may not:
// making a home of one's own mustn't be a way to cut everyone else off.
test("the linker, and the owners and admins of a home the linker is in, may unlink; the home's Activity trail records it", async (context) => {
  const { knex, userId, connections, as } = await setup(context);
  const stamp = `${Date.now()}-${process.pid}`;
  const people = await knex("users").insert(["lee", "kim", "sam"].map((name) => ({
    auth_provider: "test", auth_provider_user_sid: `${name}-${stamp}`, email: `${name}-${stamp}@example.com`, username: `${name}${stamp.replace("-", "")}`, display_name: name
  }))).returning("id");
  const [lee, kim, sam] = people.map((row) => String(row.id ?? row));
  const homes = await knex("workspaces").insert([
    { slug: `linker-${stamp}`, name: "Pat's home", owner_user_id: userId, is_personal: false },
    { slug: `elsewhere-${stamp}`, name: "Sam's home", owner_user_id: sam, is_personal: false }
  ]).returning("id");
  const [patHome, samHome] = homes.map((row) => String(row.id ?? row));
  await knex("workspace_memberships").insert([
    { workspace_id: patHome, user_id: userId, role_sid: "owner", status: "active" },
    { workspace_id: patHome, user_id: lee, role_sid: "admin", status: "active" },
    { workspace_id: patHome, user_id: kim, role_sid: "member", status: "active" },
    { workspace_id: samHome, user_id: sam, role_sid: "owner", status: "active" }
  ]);
  try {
    const told = [];
    const env = { APP_PUBLIC_URL: "http://localhost:4000", MERCBOT_HUB_URL: "https://hub.example", MERCBOT_VAULT_KEY: VAULT };
    const local = connections({ catalogue, env, providers: {}, hubFor: (url, token) => ({ unlink: async () => { told.push([url, token]); } }) });
    const link = async (linkedBy) => {
      await knex("bridge_link").del();
      await knex("bridge_link").insert({ hub_url: "https://hub.example", name: "Pat's laptop", linked_by: linkedBy, token: seal("install-token", Buffer.from(VAULT, "base64")) });
    };
    const MANAGE = ["workspace.settings.update"];
    const inHome = (id, home, permissions = []) => requestContextOptions({ user: { id, displayName: { [lee]: "Lee", [kim]: "Kim", [sam]: "Sam" }[id] }, workspace: { id: home }, permissions });
    const refused = { code: "integrations_unlink_forbidden", message: "Only the person who linked this copy, or an owner or admin of a home they're in, can unlink it." };

    await link(userId);
    for (const [who, options] of [["a member", inHome(kim, patHome)], ["another home's owner", inHome(sam, samHome, MANAGE)], ["another home's owner outside it", requestContextOptions({ user: { id: sam } })]]) {
      assert.equal((await local.linkStatus(options)).canUnlink, false, who);
      await assert.rejects(local.unlink(options), refused, who);
    }
    assert.equal((await local.linkStatus(as)).canUnlink, true, "the linker");
    const admin = inHome(lee, patHome, MANAGE);
    assert.equal((await local.linkStatus(admin)).canUnlink, true, "an admin of a home the linker is in");
    assert.equal((await local.unlink(admin)).linked, false);
    assert.deepEqual(told, [["https://hub.example", "install-token"]], "the hub is told");
    const [entry, ...more] = await knex("audit_events").where({ workspace_id: patHome });
    assert.equal(more.length, 0);
    assert.deepEqual(
      [entry.action, entry.actor, entry.via, entry.changes],
      ["settings", { type: "person", id: lee, name: "Lee" }, { kind: "settings" }, { unlinkedCopy: { name: "Pat's laptop", hub: "hub.example" } }]
    );

    // The linker's account is gone: the owners and admins of any home may unlink, still not a member who doesn't manage it.
    await link(null);
    await assert.rejects(local.unlink(inHome(kim, patHome)), refused);
    assert.equal((await local.linkStatus(inHome(sam, samHome, MANAGE))).canUnlink, true);
    assert.equal((await local.unlink(inHome(sam, samHome, MANAGE))).linked, false);
    assert.equal((await knex("audit_events").where({ workspace_id: samHome })).length, 1);

    // The linker unlinks from outside any home: there is no home's trail to record it in.
    await link(userId);
    assert.equal((await local.unlink(as)).linked, false);
    assert.equal((await knex("audit_events").whereIn("workspace_id", [patHome, samHome])).length, 2);
  } finally {
    await knex("audit_events").whereIn("workspace_id", [patHome, samHome]).del();
    await knex("workspace_memberships").whereIn("workspace_id", [patHome, samHome]).del();
    await knex("workspaces").whereIn("id", [patHome, samHome]).del();
    await knex("users").whereIn("id", [lee, kim, sam]).del();
  }
});
