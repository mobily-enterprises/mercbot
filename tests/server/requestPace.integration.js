import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { z } from "zod";
import { ownedHandles } from "../support/ownedHandles.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { startFakeSedna } from "../support/fakeSedna.mjs";
import { buildSednaTools } from "../../packages/bots/src/server/sednaTools.js";
import { createAccounts } from "../../packages/integrations/src/server/accounts.js";
import { loadCatalogue } from "../../packages/integrations/src/server/catalogue.js";
import { createConnections } from "../../packages/integrations/src/server/connections.js";
import { INTEGRATIONS_OWNS, homeDirectory } from "../../packages/integrations/src/server/IntegrationsFeature.js";
import { createSednaCredentials } from "../../packages/integrations/src/server/sednaCredentials.js";

// Each connected account's requests in its Request pace (D-96), through the whole chain against the disposable test
// database and the stand-in Sedna (fakeSedna.mjs), which keeps Sedna's rate limit when `state.window` names one: a busy
// Sedna answers once, and nothing more reaches it while it asked to wait; matching a home's people costs Sedna the pages
// of its users, not a request per person; and the pace an account never chose is Gentle, its turns spaced by Gentle's
// share of Sedna's published limit (plugins/sedna/plugin.json).
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");
const VAULT = randomBytes(32).toString("base64");
const REACH = Object.freeze({ personal: true });
const MANAGE = ["workspace.settings.update"];

/**
 * A home whose owner, Pat, is Sedna's user 201 by email, with `members` more people Sedna doesn't know, and its Sedna
 * account, not connected yet, which never chose a pace.
 */
async function setup(context, { members = 0 } = {}) {
  const knex = await connectTestDatabase();
  const sedna = await startFakeSedna();
  const made = { homeId: "", ids: [] };
  /** The home and its people gone, so another home's Pat can sign in with the same address. */
  const clear = async () => {
    if (made.homeId) await knex("workspaces").where({ id: made.homeId }).del();
    if (made.ids.length) await knex("users").whereIn("id", made.ids).del();
  };
  context.after(async () => {
    await clear();
    await knex.destroy();
    await sedna.close();
  });
  const stamp = `${process.pid}${randomBytes(3).toString("hex")}`;
  const people = [{ name: "pat", email: "pat@acme.example" }, ...Array.from({ length: members }, (_, at) => ({ name: `m${at}`, email: `m${at}-${stamp}@home.example` }))];
  const rows = await knex("users").insert(people.map(({ name, email }) => ({
    auth_provider: "test", auth_provider_user_sid: `${name}-${stamp}`, email, username: `${name}${stamp}`, display_name: name
  }))).returning("id");
  const ids = rows.map((row) => String(row.id ?? row));
  made.ids = ids;
  const [pat] = ids;
  const [home] = await knex("workspaces").insert({ slug: `pace-${stamp}`, name: "Shipping", owner_user_id: pat, is_personal: false }).returning("id");
  const homeId = String(home.id ?? home);
  made.homeId = homeId;
  await knex("workspace_memberships").insert(ids.map((id, at) => ({ workspace_id: homeId, user_id: id, role_sid: at ? "member" : "owner", status: "active" })));
  const [account] = await knex("plugin_accounts").insert({ user_id: pat, workspace_id: homeId, plugin_id: "sedna", name: "" }).returning("*");

  const { profiles, memberships, features } = await ownedHandles(knex, context, { "mercbot.integrations": INTEGRATIONS_OWNS });
  const { resources, systemContext } = features["mercbot.integrations"];
  const accounts = createAccounts({ pluginAccounts: resources.pluginAccounts, systemContext });
  const catalogue = (await loadCatalogue()).filter((entry) => entry.id === "sedna");
  const connections = createConnections({
    resources,
    accounts,
    catalogue,
    systemContext,
    env: { APP_ENV: "test", APP_PUBLIC_URL: "http://localhost:4000", MERCBOT_VAULT_KEY: VAULT },
    providers: {},
    isMember: async () => true,
    recordActivity: async () => {},
    credentialKinds: { sedna: createSednaCredentials({ standIn: sedna.url }) },
    ...homeDirectory({ memberships, profiles })
  });
  const as = (id, manage = false) => requestContextOptions({ user: { id }, workspace: { id: homeId }, permissions: manage ? MANAGE : [] });
  const good = { tenant: "acme", clientId: sedna.clientId, clientSecret: sedna.clientSecret };
  return { knex, sedna, connections, accounts, account, pat, as, good, clear };
}

/** Pat's bot's Sedna tools for one reply, as a bot gets them. */
function patBot({ connections, accounts, pat, as }) {
  const integrations = {
    reachableAccounts: async (reach, call) => (await accounts.reachable(reach, call)).filter((entry) => entry.pluginId === "sedna" && entry.status === "connected"),
    connections
  };
  return buildSednaTools({
    appFor: () => ({ integrations, reach: { userId: pat, personal: true }, call: as(pat) }),
    attempt: async () => ({ error: "No changes in this test." }),
    attempted: [],
    files: { store: {} },
    place: {},
    keep: async () => {
      throw new Error("No files are kept in this test.");
    },
    after: [],
    removed: [],
    failed: (error) => {
      if (error?.constructor?.name === "ConnectedAppError" || error?.statusCode) return { error: error.message };
      throw error;
    },
    statusLine: z.string().optional(),
    inTime: (work) => work,
    untrustedMail: (text) => `<<${text}>>`
  });
}

const apiCalls = (sedna) => sedna.requests.filter((entry) => entry.route.startsWith("/2019-01-01/")).length;

test("a busy Sedna answers once: the read stops and says when to try again, and nothing more reaches Sedna meanwhile", async (context) => {
  const setUp = await setup(context);
  const { sedna, connections, account, pat, as, good } = setUp;
  await connections.saveCredentials(REACH, account.id, good, as(pat, true));
  // A morning's mail in Pat's team, and Sedna taking 8 requests a minute from these credentials (the organisation's
  // other programs use the rest).
  for (let at = 0; at < 30; at += 1) sedna.receive({ subject: `Fixture ${at}` });
  sedna.state.window = { requests: 8, ms: 60000 };
  const bot = patBot(setUp);

  const recent = await bot.sednaMessages.execute({ action: "recent", limit: 25 });
  context.diagnostic(`recent with Sedna busy: ${apiCalls(sedna)} API requests in all, ${sedna.state.refused} answered 429`);
  assert.equal(sedna.state.refused, 1, "Sedna said it was busy once, and was asked nothing more");
  assert.match(String(recent.error), /^Sedna is busy: try again in \d+ s\. Nothing was done\./u, "the reply says so, with no messages silently left out");

  const sent = apiCalls(sedna);
  const read = await bot.sednaMessages.execute({ action: "read", id: "1003" });
  assert.match(String(read.error), /^Sedna is busy: try again in \d+ s\./u);
  assert.equal(apiCalls(sedna), sent, "while Sedna asked to wait, no request reached it");
  assert.equal(sedna.state.refused, 1);
});

test("matching a home's people costs Sedna the pages of its users, not a request per person", async (context) => {
  const counts = {};
  for (const members of [5, 40]) {
    const { sedna, connections, account, pat, as, good, clear } = await setup(context, { members });
    sedna.addUsers(145);
    const before = apiCalls(sedna);
    const saved = await connections.saveCredentials(REACH, account.id, good, as(pat, true));
    assert.equal(saved.unmatched.length, members, "the people Sedna doesn't know are listed");
    const connect = apiCalls(sedna) - before;
    const shown = (await connections.appPeople(REACH, account.id, as(pat, true))).people;
    assert.equal(shown.find((entry) => entry.id === pat).via, "email");
    counts[members] = { connect, people: apiCalls(sedna) - before - connect };
    await clear();
  }
  context.diagnostic(`Sedna requests for a home of 6 and of 41 people, 150 Sedna users: ${JSON.stringify(counts)}`);
  assert.deepEqual(counts[40], counts[5], "the same requests whatever the home's size");
  assert.ok(counts[40].people <= 2, `People reads Sedna's 150 users in two pages (${counts[40].people} requests)`);
});

test("an account that never chose a pace is Gentle: its turns are spaced by a tenth of Sedna's own limit", async (context) => {
  const { knex, connections, account, pat, as, good } = await setup(context);
  await connections.saveCredentials(REACH, account.id, good, as(pat, true));
  const turns = () => knex("plugin_account_turns").where({ account_id: account.id });
  /** How far one request moves the account's next turn on, from a turn `ahead` ms off: no wait, so no clock in it. */
  async function spacing(ahead) {
    const at = Date.now() + ahead;
    await turns().update({ next_at: new Date(at).toISOString() });
    const access = await connections.accessToken(REACH, account.id, as(pat));
    const answer = await access.fetch(`${access.api}/company/me`, { headers: { authorization: `Bearer ${access.accessToken}` } });
    assert.equal(answer.status, 200);
    return new Date((await turns().first()).next_at).getTime() - at;
  }
  assert.equal((await knex("plugin_accounts").where({ id: account.id }).first()).pace, null);
  // Sedna allows 100 requests a second; Gentle uses 10, half of them spread evenly: a turn every 200 ms.
  assert.equal(await spacing(500), 200);
  // Fast uses 90, 45 of them spread: a turn every 22.2 ms, kept as 23 (rounded up to a whole millisecond).
  await knex("plugin_accounts").where({ id: account.id }).update({ pace: "fast" });
  assert.equal(await spacing(500), 23);
});
