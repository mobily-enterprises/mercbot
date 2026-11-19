import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { z } from "zod";
import { ownedHandles } from "../support/ownedHandles.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { startFakeSedna } from "../support/fakeSedna.mjs";
import { unseal } from "../../packages/account/src/server/vaultCrypto.js";
import { buildSednaTools } from "../../packages/bots/src/server/sednaTools.js";
import { createAccounts } from "../../packages/integrations/src/server/accounts.js";
import { loadCatalogue } from "../../packages/integrations/src/server/catalogue.js";
import { createConnections } from "../../packages/integrations/src/server/connections.js";
import { INTEGRATIONS_OWNS, homeDirectory } from "../../packages/integrations/src/server/IntegrationsFeature.js";
import { createIntegrationsService } from "../../packages/integrations/src/server/integrationsService.js";
import { createSednaCredentials } from "../../packages/integrations/src/server/sednaCredentials.js";

// Sedna connected with a home's API credentials (D-93), against the disposable test database and the stand-in Sedna
// (fakeSedna.mjs): credentials checked before they're saved and sealed, the hourly key made again under the account's
// row lock, who each person is in Sedna (by email, or picked and confirmed by an owner or admin, never someone else),
// and a bot reading only its person's teams.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");
const VAULT = randomBytes(32).toString("base64");
const REACH = Object.freeze({ personal: true });
const MANAGE = ["workspace.settings.update"];

async function setup(context) {
  const knex = await connectTestDatabase();
  const sedna = await startFakeSedna();
  const stamp = `${process.pid}${randomBytes(3).toString("hex")}`;
  // Pat owns the home and Lee is an admin, both Sedna users by email; Sam, Kim and Ari sign in with addresses Sedna
  // doesn't know, Ari as an admin.
  const emails = { pat: "pat@acme.example", lee: "lee@acme.example", sam: `sam-${stamp}@home.example`, kim: `kim-${stamp}@home.example`, ari: `ari-${stamp}@home.example` };
  const rows = await knex("users").insert(Object.entries(emails).map(([name, email]) => ({
    auth_provider: "test", auth_provider_user_sid: `${name}-${stamp}`, email, username: `${name}${stamp}`, display_name: name[0].toUpperCase() + name.slice(1)
  }))).returning("id");
  const [pat, lee, sam, kim, ari] = rows.map((row) => String(row.id ?? row));
  const [home] = await knex("workspaces").insert({ slug: `sedna-${stamp}`, name: "Shipping", owner_user_id: pat, is_personal: false }).returning("id");
  const homeId = String(home.id ?? home);
  await knex("workspace_memberships").insert([
    { workspace_id: homeId, user_id: pat, role_sid: "owner", status: "active" },
    { workspace_id: homeId, user_id: lee, role_sid: "admin", status: "active" },
    { workspace_id: homeId, user_id: sam, role_sid: "member", status: "active" },
    { workspace_id: homeId, user_id: kim, role_sid: "member", status: "active" },
    { workspace_id: homeId, user_id: ari, role_sid: "admin", status: "active" }
  ]);
  // Fast, so these tests don't wait their turns (requestPace.integration.js tests the paces themselves, D-96).
  const [account] = await knex("plugin_accounts").insert({ user_id: pat, workspace_id: homeId, plugin_id: "sedna", name: "", pace: "fast" }).returning("*");
  context.after(async () => {
    await knex("workspaces").where({ id: homeId }).del();
    await knex("users").whereIn("id", [pat, lee, sam, kim, ari]).del();
    await knex.destroy();
    await sedna.close();
  });

  const { profiles, memberships, features } = await ownedHandles(knex, context, { "mercbot.integrations": INTEGRATIONS_OWNS });
  const { resources, systemContext } = features["mercbot.integrations"];
  const accounts = createAccounts({ pluginAccounts: resources.pluginAccounts, systemContext });
  const catalogue = (await loadCatalogue()).filter((entry) => entry.id === "sedna");
  const connections = createConnections({
    resources,
    accounts,
    systemContext,
    catalogue,
    env: { APP_ENV: "test", APP_PUBLIC_URL: "http://localhost:4000", MERCBOT_VAULT_KEY: VAULT },
    providers: {},
    isMember: async () => true,
    recordActivity: async () => {},
    credentialKinds: { sedna: createSednaCredentials({ standIn: sedna.url }) },
    ...homeDirectory({ memberships, profiles })
  });
  const integrations = createIntegrationsService({ resources, accounts, catalogue, connections, profiles, systemContext });
  const as = (id, manage = false) => requestContextOptions({ user: { id }, workspace: { id: homeId }, permissions: manage ? MANAGE : [] });
  const good = { tenant: "https://acme.sednanetwork.com/", clientId: sedna.clientId, clientSecret: sedna.clientSecret };
  // The service on other accounts (a test that holds their reads).
  const serviceWith = (changed) => createIntegrationsService({ resources, accounts: changed, catalogue, connections, profiles, systemContext });
  return { knex, sedna, connections, accounts, integrations, serviceWith, account, homeId, people: { pat, lee, sam, kim, ari }, as, good };
}

test("credentials are checked with Sedna before they're saved, sealed, and match the home's people by email", async (context) => {
  const { knex, sedna, connections, account, people: { pat, lee, sam, kim, ari }, as, good } = await setup(context);
  const row = () => knex("plugin_accounts").where({ id: account.id }).first();

  await assert.rejects(connections.saveCredentials(REACH, account.id, good, as(sam)), { statusCode: 403, code: "integrations_account_manage_forbidden" });
  await assert.rejects(connections.saveCredentials(REACH, account.id, { ...good, clientSecret: "wrong" }, as(pat, true)), {
    statusCode: 400,
    code: "integrations_credentials_refused",
    message: "Sedna didn't accept that client ID and secret for acme.sednanetwork.com. Check them in Sedna's API credential management."
  });
  await assert.rejects(connections.saveCredentials(REACH, account.id, { ...good, tenant: "acme.example.com" }, as(pat, true)), { code: "integrations_sedna_tenant_invalid" });
  await assert.rejects(connections.saveCredentials(REACH, account.id, { ...good, tenant: "other" }, as(pat, true)), { code: "integrations_sedna_tenant_unknown" });
  await assert.rejects(connections.saveCredentials(REACH, account.id, { ...good, clientId: " " }, as(pat, true)), { code: "integrations_credentials_field_missing", message: "Fill in Client ID." });
  assert.deepEqual([(await row()).status, (await row()).tokens], ["needs-auth", null], "nothing is saved until Sedna takes them");
  assert.equal(sedna.requests.filter((entry) => entry.tenant !== "acme").length, 1, "a tenant typed as another host never leaves acme's label");

  const saved = await connections.saveCredentials(REACH, account.id, good, as(pat, true));
  assert.equal(saved.label, "Acme Shipping");
  assert.deepEqual(saved.matched.map((entry) => [entry.id, entry.sednaName]).sort(), [[lee, "Lee Roe"], [pat, "Pat Doe"]].sort());
  assert.deepEqual(saved.unmatched.map((entry) => entry.id).sort(), [sam, kim, ari].sort());
  const stored = await row();
  assert.deepEqual([stored.status, stored.label], ["connected", "Acme Shipping"]);
  assert.doesNotMatch(JSON.stringify(stored.tokens), /acme-secret|acme-client/u, "the credentials are sealed");
  const opened = unseal(stored.tokens, Buffer.from(VAULT, "base64"));
  assert.deepEqual(opened.values, { tenant: "acme", clientId: sedna.clientId, clientSecret: sedna.clientSecret });
  assert.ok(sedna.requests.some((entry) => entry.route === "/2019-01-01/company/me"));
  // The home's account is the home's: another home's admin can't reach it, and the hub never lends it.
  await assert.rejects(connections.connect(REACH, account.id, as(pat, true)), { statusCode: 409, code: "integrations_credentials_only" });
  await assert.rejects(connections.startBridgedSignIn("sedna", { connectionFor: async () => "1", lentTo: "1" }, as(pat)), { statusCode: 409, code: "integrations_credentials_only" });
  await assert.rejects(connections.bridgedToken("sedna", stored.tokens, async () => {}, as(pat)), { code: "integrations_credentials_only" });
});

test("the hourly key is made again under the account's row lock, once for two calls; credentials Sedna drops sign it out; disconnect clears them", async (context) => {
  const { knex, sedna, connections, account, people: { pat, sam }, as, good } = await setup(context);
  sedna.state.expiresIn = 30; // under a minute: not fresh, so the next call makes a new key
  await connections.saveCredentials(REACH, account.id, good, as(pat, true));
  sedna.state.expiresIn = 3600;
  sedna.state.tokenDelay = 300;
  const before = sedna.state.tokens;
  const [one, two] = await Promise.all([connections.accessToken(REACH, account.id, as(sam)), connections.accessToken(REACH, account.id, as(pat))]);
  assert.equal(sedna.state.tokens - before, 1, "one key for both calls");
  assert.equal(one.accessToken, two.accessToken);
  assert.deepEqual([one.renewed || two.renewed, one.api], [true, `${sedna.url}/acme/platform/2019-01-01`]);
  const again = await connections.accessToken(REACH, account.id, as(sam));
  assert.deepEqual([again.accessToken, again.renewed, sedna.state.tokens - before], [one.accessToken, false, 1], "a fresh key is used as it is");

  // Sedna refusing the key, and then the credentials themselves: the account is signed out, for an admin to fix.
  sedna.state.tokenDelay = 0;
  sedna.state.revoked = true;
  await assert.rejects(connections.accessToken(REACH, account.id, as(sam), { refused: one.accessToken }), {
    statusCode: 409,
    code: "integrations_credentials_missing",
    message: "Sedna isn't connected: an owner or admin of the home enters its API credentials in Connect apps."
  });
  const signedOut = await knex("plugin_accounts").where({ id: account.id }).first();
  assert.deepEqual([signedOut.status, signedOut.tokens], ["needs-auth", null]);

  sedna.state.revoked = false;
  await connections.saveCredentials(REACH, account.id, good, as(pat, true));
  await assert.rejects(connections.disconnect(REACH, account.id, as(sam)), { statusCode: 403 });
  await connections.disconnect(REACH, account.id, as(pat, true));
  const cleared = await knex("plugin_accounts").where({ id: account.id }).first();
  assert.deepEqual([cleared.status, cleared.tokens, cleared.label], ["needs-auth", null, null]);
  await assert.rejects(connections.accessToken(REACH, account.id, as(sam)), { code: "integrations_credentials_missing" });
});

test("who each person is in Sedna: their address, or the user they pick once an owner or admin confirms it; never someone else", async (context) => {
  const { knex, connections, account, people: { pat, lee, sam, kim, ari }, as, good } = await setup(context);
  await connections.saveCredentials(REACH, account.id, good, as(pat, true));

  const patInSedna = await connections.appPerson(REACH, account.id, as(pat));
  assert.deepEqual([patInSedna.person.id, patInSedna.via, patInSedna.person.teams], ["201", "email", [{ id: "11", name: "Chartering" }]]);
  assert.deepEqual(await connections.appPerson(REACH, account.id, as(sam)), { app: "Sedna", person: null, asked: null });
  assert.ok((await connections.appUsers(REACH, account.id, "sam", as(sam))).some((user) => user.id === "203"));

  // Nobody picks someone else: a user another person of the home has by address, an archived one, or a made-up id.
  await assert.rejects(connections.pickAppUser(REACH, account.id, "201", as(sam)), { statusCode: 409, code: "integrations_app_user_taken" });
  await assert.rejects(connections.pickAppUser(REACH, account.id, "204", as(sam)), { statusCode: 404, code: "integrations_app_user_unknown" });
  await assert.rejects(connections.pickAppUser(REACH, account.id, "../company/me", as(sam)), { code: "integrations_app_user_unknown" });
  // Someone Sedna knows by address picks no one else.
  await assert.rejects(connections.pickAppUser(REACH, account.id, "203", as(pat, true)), { code: "integrations_app_person_matched" });

  // A member's pick waits for an owner or admin; until then they're no one in Sedna.
  const asked = await connections.pickAppUser(REACH, account.id, "203", as(sam));
  assert.deepEqual([asked.person, asked.asked], [null, { id: "203", name: "Sam Poe" }]);
  await assert.rejects(connections.confirmAppPerson(REACH, account.id, sam, as(kim)), { statusCode: 403, code: "integrations_account_manage_forbidden" });
  await assert.rejects(connections.appPeople(REACH, account.id, as(kim)), { statusCode: 403 });
  const listed = await connections.appPeople(REACH, account.id, as(lee, true));
  const shown = Object.fromEntries(listed.people.map((entry) => [entry.id, entry]));
  assert.deepEqual([shown[pat].via, shown[pat].appUser.name, shown[sam].asked.name, shown[kim].asked, shown[lee].via], ["email", "Pat Doe", "Sam Poe", null, "email"]);

  const confirmed = await connections.confirmAppPerson(REACH, account.id, sam, as(lee, true));
  assert.equal(confirmed.people.find((entry) => entry.id === sam).via, "picked");
  const samInSedna = await connections.appPerson(REACH, account.id, as(sam));
  assert.deepEqual([samInSedna.person.id, samInSedna.via, samInSedna.person.teams.map((team) => team.name)], ["203", "picked", ["Chartering", "Operations"]]);
  await assert.rejects(connections.confirmAppPerson(REACH, account.id, sam, as(lee, true)), { statusCode: 404, code: "integrations_app_person_not_asked" });
  // One Sedna user is one person: Kim can't be Sam too.
  await assert.rejects(connections.pickAppUser(REACH, account.id, "203", as(kim)), { code: "integrations_app_user_taken" });

  // An admin's own pick is confirmed at once; a member can't undo someone else's.
  const ariInSedna = await connections.pickAppUser(REACH, account.id, "205", as(ari, true));
  assert.deepEqual([ariInSedna.person.id, ariInSedna.via], ["205", "picked"]);
  await assert.rejects(connections.forgetAppPerson(REACH, account.id, ari, as(kim)), { statusCode: 403 });
  await connections.forgetAppPerson(REACH, account.id, "me", as(sam));
  assert.equal((await connections.appPerson(REACH, account.id, as(sam))).person, null);
  assert.deepEqual(
    (await knex("plugin_account_people").where({ account_id: account.id }).select("user_id", "app_user_id", "status", "org")).map((entry) => [String(entry.user_id), entry.app_user_id, entry.status, entry.org]),
    [[ari, "205", "confirmed", "acme"]]
  );
});

test("a bot reads only its person's Sedna teams, through the whole chain", async (context) => {
  const { sedna, connections, accounts, account, people: { pat, lee, kim }, as, good } = await setup(context);
  await connections.saveCredentials(REACH, account.id, good, as(pat, true));
  const integrations = {
    reachableAccounts: async (reach, call) => (await accounts.reachable(reach, call)).filter((entry) => entry.pluginId === "sedna" && entry.status === "connected"),
    connections
  };
  const botOf = (userId) => buildSednaTools({
    appFor: () => ({ integrations, reach: { userId, personal: true }, call: as(userId) }),
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

  const patBot = botOf(pat);
  const recent = await patBot.sednaMessages.execute({ action: "recent" });
  assert.deepEqual(recent.result.messages.map((entry) => entry.id), ["1003", "1001"], "Operations' message isn't Pat's");
  assert.match(recent.result.messages[0].subject, /^<<Urgent/u);
  const other = await patBot.sednaMessages.execute({ action: "read", id: "1002" });
  assert.match(other.error, /isn't in any of the person's Sedna teams/u);
  assert.doesNotMatch(JSON.stringify(other), /Bunkers/u);
  const tagged = await patBot.sednaMessages.execute({ action: "by_tag", tag: "Fixtures" });
  assert.deepEqual(tagged.result.messages.map((entry) => entry.id), ["1001"]);
  assert.equal(sedna.requests.find((entry) => entry.route.endsWith("/messageV2")).query["filter[team]"], "11");
  assert.match((await patBot.sednaMessages.execute({ action: "read", id: "1001" })).result.text, /Laycan/u);

  // Lee is in Operations only; Kim is no one in Sedna.
  assert.match((await botOf(lee).sednaMessages.execute({ action: "read", id: "1001" })).error, /isn't in any of the person's Sedna teams/u);
  assert.match((await botOf(kim).sednaMessages.execute({ action: "recent" })).error, /isn't matched to a Sedna user/u);
});

test("credentials Sedna takes only as a username and password (Basic auth) connect the same way, and bots read with them; one without COMPANY_READ is named as missing it", async (context) => {
  const { sedna, connections, accounts, account, people: { pat }, as, good } = await setup(context);
  // Without COMPANY_READ, Sedna takes the credential but won't name the company: Connect names the permission, by a key
  // and as Basic auth alike, rather than calling the credential wrong.
  sedna.state.forbidden = ["/company/me"];
  const noCompany = { code: "integrations_sedna_permission_missing", message: /give them COMPANY_READ/u };
  await assert.rejects(connections.saveCredentials(REACH, account.id, good, as(pat, true)), noCompany);
  // Sedna's token endpoint turns this credential down, as for one an organisation uses only as Basic auth elsewhere.
  sedna.state.basicOnly = true;
  const basicFrom = sedna.requests.length;
  await assert.rejects(connections.saveCredentials(REACH, account.id, good, as(pat, true)), noCompany);
  sedna.state.forbidden = [];
  await assert.rejects(connections.saveCredentials(REACH, account.id, { ...good, clientSecret: "wrong" }, as(pat, true)), { code: "integrations_credentials_refused" });
  const saved = await connections.saveCredentials(REACH, account.id, good, as(pat, true));
  assert.equal(saved.label, "Acme Shipping");
  const integrations = {
    reachableAccounts: async (reach, call) => (await accounts.reachable(reach, call)).filter((entry) => entry.pluginId === "sedna" && entry.status === "connected"),
    connections
  };
  const bot = buildSednaTools({
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
    untrustedMail: (text) => text
  });
  const recent = await bot.sednaMessages.execute({ action: "recent" });
  assert.deepEqual(recent.result.messages.map((entry) => entry.id), ["1003", "1001"]);
  const reads = sedna.requests.slice(basicFrom).filter((entry) => entry.route.startsWith("/2019-01-01/"));
  assert.ok(reads.length > 2);
  assert.deepEqual([...new Set(reads.map((entry) => entry.scheme))], ["Basic"], "every call as Basic auth, none with a key");
});

test("only the home's owners and admins add Sedna, and only for everyone in the home", async (context) => {
  const { knex, connections, integrations, account, homeId, people: { pat, lee, sam }, as, good } = await setup(context);
  await knex("plugin_accounts").where({ id: account.id }).del();
  await assert.rejects(integrations.install(REACH, "sedna", as(sam)), { statusCode: 403, code: "integrations_home_app_forbidden" });
  const listed = await integrations.install(REACH, "sedna", as(lee, true));
  const [home] = listed.plugins.find((entry) => entry.id === "sedna").accounts;
  assert.deepEqual([home.home, home.status], [true, "needs-auth"]);
  await integrations.install(REACH, "sedna", as(pat, true));
  assert.equal((await knex("plugin_accounts").where({ workspace_id: homeId, plugin_id: "sedna" })).length, 1, "one home account, however many add it");
  await assert.rejects(integrations.addAccount(REACH, "sedna", "mine", { forHome: false }, as(lee, true)), { statusCode: 409, code: "integrations_home_account_only" });
  await assert.rejects(integrations.addAccount(REACH, "sedna", "second", { forHome: true }, as(sam)), { statusCode: 403 });

  // A member sees the home's account and, once connected, gets the Sedna tools on their own turns.
  assert.deepEqual((await integrations.toolSwitches(REACH, as(sam))).connected, []);
  await connections.saveCredentials(REACH, home.id, good, as(lee, true));
  const seen = (await integrations.list(REACH, as(sam))).plugins.find((entry) => entry.id === "sedna");
  assert.deepEqual([seen.installed, seen.accounts.map((entry) => [entry.status, entry.label])], [false, [["connected", "Acme Shipping"]]]);
  assert.deepEqual((await integrations.toolSwitches(REACH, as(sam))).connected, ["sedna"]);
});

test("two owners adding Sedna at the same moment make one home account between them", async (context) => {
  const { knex, accounts, serviceWith, account, homeId, people: { pat, lee }, as } = await setup(context);
  await knex("plugin_accounts").where({ id: account.id }).del();
  // Each looks for the home's account and finds none before either makes one: the race, every time.
  const looked = [];
  let both;
  const met = new Promise((resolve) => { both = resolve; });
  const racing = serviceWith({
    ...accounts,
    async reachable(reach, call, query) {
      const found = await accounts.reachable(reach, call, query);
      if (query?.filters?.homeOnly && looked.length < 2) {
        looked.push(found.length);
        if (looked.length === 2) both();
        await met;
      }
      return found;
    }
  });
  await Promise.all([racing.install(REACH, "sedna", as(pat, true)), racing.install(REACH, "sedna", as(lee, true))]);
  assert.deepEqual(looked, [0, 0]);
  const made = await knex("plugin_accounts").where({ workspace_id: homeId, plugin_id: "sedna" });
  assert.equal(made.length, 1, "the second found the first's");
  // The index keeps it so for any other writer; an account added for everyone with a label isn't held to it.
  await assert.rejects(knex("plugin_accounts").insert({ user_id: lee, workspace_id: homeId, plugin_id: "sedna", name: "" }), { code: "23505" });
  await knex("plugin_accounts").insert({ user_id: lee, workspace_id: homeId, plugin_id: "sedna", name: "Second desk" });
});
