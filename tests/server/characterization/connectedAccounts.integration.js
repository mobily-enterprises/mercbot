import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { connectTestDatabase } from "../../support/testDatabase.mjs";
import { reachableAccountIds } from "./harness.mjs";
import { bootServer, signUp } from "./http.mjs";
import { forget, seedHome } from "./seed.mjs";

// Connected accounts (D-37), over HTTP: in a home a person reaches their own accounts and the home's, never another
// person's or another home's; in a shared bot's room only the home's (that reach is a bot's, so harness.mjs asks it);
// and changing a home's account takes one of its owners or admins.

let app;
let knex;
let pat;
let kim;
let sam;
let homeA;
let homeB;
const accounts = {};

before(async () => {
  knex = await connectTestDatabase();
  app = await bootServer();
  pat = await signUp(app, knex, "pat");
  kim = await signUp(app, knex, "kim");
  sam = await signUp(app, knex, "sam");
  homeA = await seedHome(knex, pat.id, [kim.id]);
  homeB = await seedHome(knex, sam.id, [kim.id]);
  const add = async (name, userId, workspaceId = null) =>
    String((await knex("plugin_accounts").insert({ user_id: userId, plugin_id: "github", name, workspace_id: workspaceId }).returning("id"))[0].id);
  accounts.patOwn = await add("Pat's own", pat.id);
  accounts.kimOwn = await add("Kim's own", kim.id);
  accounts.homeA = await add("Home A's", pat.id, homeA.id);
  accounts.homeB = await add("Home B's", sam.id, homeB.id);
});

after(async () => {
  await app?.close();
  await forget(knex, [homeA, homeB], [pat, kim, sam]);
  await knex?.destroy();
});

const seededIds = () => new Set(Object.values(accounts));
const named = (...names) => names.map((name) => accounts[name]).sort();
const nameOf = async (id) => (await knex("plugin_accounts").where({ id }).first("name"))?.name;

/** The accounts Connect apps lists for `person` in `home`, every app's. */
async function listedAccounts(person, home) {
  const answer = await person.get(`${home.url}/plugins`);
  assert.equal(answer.status, 200, `${person.name}'s Connect apps: ${JSON.stringify(answer.body)}`);
  return answer.body.plugins.flatMap((plugin) => plugin.accounts || []);
}

test("each person reaches their own accounts and the home's, never another person's or another home's", async () => {
  for (const [person, home, expectedNames] of [
    [pat, homeA, ["patOwn", "homeA"]],
    [kim, homeA, ["kimOwn", "homeA"]],
    [sam, homeB, ["homeB"]],
    [kim, homeB, ["kimOwn", "homeB"]]
  ]) {
    const listed = await listedAccounts(person, home);
    const ids = listed.map((account) => account.id);
    assert.deepEqual(ids.filter((id) => seededIds().has(id)).sort(), named(...expectedNames), `${person.name} in ${home.slug}`);
    // Whatever else is listed (an account signing up made) is also the person's own or the home's.
    for (const row of await knex("plugin_accounts").whereIn("id", ids)) {
      const reachable = row.workspace_id ? String(row.workspace_id) === home.id : String(row.user_id) === person.id;
      assert.ok(reachable, `${person.name} in ${home.slug} reaches account ${row.id} only if it is theirs or the home's`);
    }
    const homeAccount = listed.find((account) => account.id === accounts[expectedNames.at(-1)]);
    assert.equal(homeAccount.home, true, "the home's account says so");
  }
});

test("a shared bot's room reaches only the home's accounts", async () => {
  const mine = async (reach) => (await reachableAccountIds(knex, reach)).filter((id) => seededIds().has(id)).sort();
  assert.deepEqual(await mine({ userId: pat.id, homeId: homeA.id, personal: false }), named("homeA"), "a room: the home's only");
  assert.deepEqual(await mine({ userId: pat.id, homeId: homeA.id, personal: true }), named("patOwn", "homeA"), "a person's own chat");
  assert.deepEqual(await mine({ userId: pat.id, homeId: homeA.id }), named("patOwn", "homeA"), "personal unless said otherwise");
  assert.deepEqual(await mine({ userId: pat.id }), named("patOwn"), "no home: the person's own");
});

test("changing a home's account takes an owner or admin; a member changes only their own", async () => {
  const kimRenames = await kim.patch(`${homeA.url}/plugin-accounts/${accounts.homeA}`, { name: "Kim was here" });
  assert.equal(kimRenames.status, 403, JSON.stringify(kimRenames.body));
  assert.equal(kimRenames.body.code, "integrations_account_manage_forbidden");
  const kimRemoves = await kim.delete(`${homeA.url}/plugin-accounts/${accounts.homeA}`);
  assert.equal(kimRemoves.status, 403, JSON.stringify(kimRemoves.body));
  assert.equal(kimRemoves.body.code, "integrations_account_manage_forbidden");
  assert.equal(await nameOf(accounts.homeA), "Home A's", "a member changes nothing of the home's");

  const homeAccounts = Number((await knex("plugin_accounts").where({ workspace_id: homeA.id }).count("* as n").first()).n);
  const kimAdds = await kim.post(`${homeA.url}/plugins/github/accounts`, { name: "For everyone", home: true });
  assert.equal(kimAdds.status, 403, JSON.stringify(kimAdds.body));
  assert.equal(kimAdds.body.code, "integrations_home_account_forbidden");
  assert.equal(Number((await knex("plugin_accounts").where({ workspace_id: homeA.id }).count("* as n").first()).n), homeAccounts);

  const patRenames = await pat.patch(`${homeA.url}/plugin-accounts/${accounts.homeA}`, { name: "Renamed by the owner" });
  assert.equal(patRenames.status, 200, JSON.stringify(patRenames.body));
  assert.equal(await nameOf(accounts.homeA), "Renamed by the owner");

  await knex("workspace_memberships").where({ workspace_id: homeA.id, user_id: kim.id }).update({ role_sid: "admin" });
  try {
    const adminRenames = await kim.patch(`${homeA.url}/plugin-accounts/${accounts.homeA}`, { name: "Renamed by an admin" });
    assert.equal(adminRenames.status, 200, JSON.stringify(adminRenames.body));
    assert.equal(await nameOf(accounts.homeA), "Renamed by an admin");
  } finally {
    await knex("workspace_memberships").where({ workspace_id: homeA.id, user_id: kim.id }).update({ role_sid: "member" });
  }

  const kimOwn = await kim.patch(`${homeA.url}/plugin-accounts/${accounts.kimOwn}`, { name: "Kim's, renamed" });
  assert.equal(kimOwn.status, 200, JSON.stringify(kimOwn.body));
  assert.equal(await nameOf(accounts.kimOwn), "Kim's, renamed");
});

test("one account reads as Connect apps lists it, for the screen waiting for its sign-in", async () => {
  for (const [person, home, name] of [[pat, homeA, "patOwn"], [kim, homeA, "homeA"], [kim, homeB, "kimOwn"]]) {
    const answer = await person.get(`${home.url}/plugin-accounts/${accounts[name]}`);
    assert.equal(answer.status, 200, `${person.name} reads ${name}: ${JSON.stringify(answer.body)}`);
    assert.deepEqual(answer.body.account, (await listedAccounts(person, home)).find((account) => account.id === accounts[name]));
  }
});

test("another person's account and another home's are not found", async () => {
  for (const [person, method, path] of [
    [kim, "get", `${homeA.url}/plugin-accounts/${accounts.patOwn}`],
    [kim, "get", `${homeB.url}/plugin-accounts/${accounts.homeA}`],
    [kim, "patch", `${homeA.url}/plugin-accounts/${accounts.patOwn}`],
    [kim, "delete", `${homeA.url}/plugin-accounts/${accounts.patOwn}`],
    [kim, "patch", `${homeA.url}/plugin-accounts/${accounts.homeB}`],
    [kim, "patch", `${homeB.url}/plugin-accounts/${accounts.homeA}`],
    [sam, "patch", `${homeB.url}/plugin-accounts/${accounts.kimOwn}`]
  ]) {
    const answer = method === "get" ? await person.get(path) : method === "delete" ? await person.delete(path) : await person.patch(path, { name: "Not yours" });
    assert.equal(answer.status, 404, `${person.name} ${method} ${path}: ${JSON.stringify(answer.body)}`);
    assert.equal(answer.body.code, "integrations_account_not_found");
  }
  assert.equal(await nameOf(accounts.patOwn), "Pat's own");
  assert.equal(await nameOf(accounts.homeB), "Home B's");
  assert.notEqual(await nameOf(accounts.kimOwn), "Not yours");
});

// Each account's Request pace (D-96): how fast Mercbot sends its app requests. A stored account that never chose one,
// as every account did before the setting, is Gentle; whoever may change the account chooses it.
test("an account's Request pace is Gentle until chosen, and chosen only by whoever may change the account", async () => {
  const paceOf = async (id) => (await knex("plugin_accounts").where({ id }).first("pace"))?.pace;
  const listedPace = async (person, home, name) => (await listedAccounts(person, home)).find((account) => account.id === accounts[name]).pace;
  assert.equal(await paceOf(accounts.homeA), null);
  assert.equal(await listedPace(kim, homeA, "homeA"), "gentle");
  assert.equal(await listedPace(pat, homeA, "patOwn"), "gentle");

  const kimSets = await kim.put(`${homeA.url}/plugin-accounts/${accounts.homeA}/pace`, { pace: "fast" });
  assert.equal(kimSets.status, 403, JSON.stringify(kimSets.body));
  assert.equal(kimSets.body.code, "integrations_account_manage_forbidden");
  const notYours = await kim.put(`${homeA.url}/plugin-accounts/${accounts.patOwn}/pace`, { pace: "fast" });
  assert.equal(notYours.status, 404, JSON.stringify(notYours.body));
  for (const pace of ["turbo", "", undefined]) {
    const refused = await pat.put(`${homeA.url}/plugin-accounts/${accounts.homeA}/pace`, { pace });
    assert.equal(refused.status, 400, `${pace}: ${JSON.stringify(refused.body)}`);
    assert.equal(refused.body.code, "integrations_account_pace_unknown");
  }
  assert.deepEqual([await paceOf(accounts.homeA), await paceOf(accounts.patOwn)], [null, null], "nothing refused changed a pace");

  const patSets = await pat.put(`${homeA.url}/plugin-accounts/${accounts.homeA}/pace`, { pace: "fast" });
  assert.equal(patSets.status, 200, JSON.stringify(patSets.body));
  assert.equal(await paceOf(accounts.homeA), "fast");
  assert.equal(await listedPace(kim, homeA, "homeA"), "fast", "everyone in the home sees the home's account's pace");
  const kimOwn = await kim.put(`${homeA.url}/plugin-accounts/${accounts.kimOwn}/pace`, { pace: "normal" });
  assert.equal(kimOwn.status, 200, JSON.stringify(kimOwn.body));
  assert.equal(await paceOf(accounts.kimOwn), "normal", "a member chooses their own account's");
});
