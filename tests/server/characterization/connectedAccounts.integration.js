import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { connectTestDatabase } from "../../support/testDatabase.mjs";
import { reachableAccountIds } from "./harness.mjs";
import { bootServer, signUp } from "./http.mjs";
import { forget, seedHome } from "./seed.mjs";

// Connected accounts (D-111), over HTTP: every account of a home is everyone's in it, and their bots' in any chat,
// never another home's; changing one takes the person who added it or one of the home's owners or admins.

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
  const add = async (name, userId, workspaceId) =>
    String((await knex("plugin_accounts").insert({ user_id: userId, plugin_id: "github", name, workspace_id: workspaceId }).returning("id"))[0].id);
  accounts.patInA = await add("Pat's in A", pat.id, homeA.id);
  accounts.kimInA = await add("Kim's in A", kim.id, homeA.id);
  accounts.kimInB = await add("Kim's in B", kim.id, homeB.id);
  accounts.samInB = await add("Sam's in B", sam.id, homeB.id);
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

test("everyone in a home reaches every account of it, whoever added it, never another home's", async () => {
  for (const [person, home, expectedNames] of [
    [pat, homeA, ["patInA", "kimInA"]],
    [kim, homeA, ["patInA", "kimInA"]],
    [sam, homeB, ["kimInB", "samInB"]],
    [kim, homeB, ["kimInB", "samInB"]]
  ]) {
    const listed = await listedAccounts(person, home);
    const ids = listed.map((account) => account.id);
    assert.deepEqual(ids.filter((id) => seededIds().has(id)).sort(), named(...expectedNames), `${person.name} in ${home.slug}`);
    // Whatever else is listed (an account signing up made) is the home's too.
    for (const row of await knex("plugin_accounts").whereIn("id", ids)) {
      assert.equal(String(row.workspace_id), home.id, `${person.name} in ${home.slug} reaches account ${row.id} only if it is the home's`);
    }
    for (const account of listed.filter((entry) => seededIds().has(entry.id))) {
      const row = await knex("plugin_accounts").where({ id: account.id }).first("user_id");
      assert.equal(account.addedByYou, String(row.user_id) === person.id, `${person.name} sees who added ${account.name}`);
      assert.equal("home" in account, false, "no account is anyone's own");
    }
  }
});

test("a bot's turn reaches every account of its home, in a room as in a person's own chat", async () => {
  const reached = async (turn) => (await reachableAccountIds(knex, turn)).filter((id) => seededIds().has(id)).sort();
  assert.deepEqual(await reached({ userId: kim.id, homeId: homeA.id }), named("patInA", "kimInA"), "Kim's turn in A: Pat's too");
  assert.deepEqual(await reached({ userId: pat.id, homeId: homeA.id }), named("patInA", "kimInA"), "Pat's turn in A: Kim's too");
  assert.deepEqual(await reached({ userId: kim.id, homeId: homeB.id }), named("kimInB", "samInB"), "Kim's turn in B: B's only");
});

test("changing an account takes the person who added it or an owner or admin; any member adds one", async () => {
  const kimRenames = await kim.patch(`${homeA.url}/plugin-accounts/${accounts.patInA}`, { name: "Kim was here" });
  assert.equal(kimRenames.status, 403, JSON.stringify(kimRenames.body));
  assert.equal(kimRenames.body.code, "integrations_account_manage_forbidden");
  const kimRemoves = await kim.delete(`${homeA.url}/plugin-accounts/${accounts.patInA}`);
  assert.equal(kimRemoves.status, 403, JSON.stringify(kimRemoves.body));
  assert.equal(kimRemoves.body.code, "integrations_account_manage_forbidden");
  assert.equal(await nameOf(accounts.patInA), "Pat's in A", "a member changes nothing someone else added");

  const kimOwn = await kim.patch(`${homeA.url}/plugin-accounts/${accounts.kimInA}`, { name: "Kim's, renamed" });
  assert.equal(kimOwn.status, 200, JSON.stringify(kimOwn.body));
  assert.equal(await nameOf(accounts.kimInA), "Kim's, renamed");

  const patRenames = await pat.patch(`${homeA.url}/plugin-accounts/${accounts.kimInA}`, { name: "Renamed by the owner" });
  assert.equal(patRenames.status, 200, JSON.stringify(patRenames.body));
  assert.equal(await nameOf(accounts.kimInA), "Renamed by the owner");

  await knex("workspace_memberships").where({ workspace_id: homeA.id, user_id: kim.id }).update({ role_sid: "admin" });
  try {
    const adminRenames = await kim.patch(`${homeA.url}/plugin-accounts/${accounts.patInA}`, { name: "Renamed by an admin" });
    assert.equal(adminRenames.status, 200, JSON.stringify(adminRenames.body));
    assert.equal(await nameOf(accounts.patInA), "Renamed by an admin");
  } finally {
    await knex("workspace_memberships").where({ workspace_id: homeA.id, user_id: kim.id }).update({ role_sid: "member" });
  }

  const kimAdds = await kim.post(`${homeA.url}/plugins/github/accounts`, { name: "Kim's second" });
  assert.equal(kimAdds.status, 200, JSON.stringify(kimAdds.body));
  const added = await knex("plugin_accounts").where({ id: kimAdds.body.accountId }).first("user_id", "workspace_id");
  assert.deepEqual([String(added.user_id), String(added.workspace_id)], [kim.id, homeA.id], "a member's account is the home's, added by them");
  await knex("plugin_accounts").where({ id: kimAdds.body.accountId }).del();
});

test("one account reads as Connect apps lists it, for the screen waiting for its sign-in", async () => {
  for (const [person, home, name] of [[pat, homeA, "kimInA"], [kim, homeA, "patInA"], [kim, homeB, "samInB"]]) {
    const answer = await person.get(`${home.url}/plugin-accounts/${accounts[name]}`);
    assert.equal(answer.status, 200, `${person.name} reads ${name}: ${JSON.stringify(answer.body)}`);
    assert.deepEqual(answer.body.account, (await listedAccounts(person, home)).find((account) => account.id === accounts[name]));
  }
});

test("another home's account is not found", async () => {
  for (const [person, method, path] of [
    [kim, "get", `${homeB.url}/plugin-accounts/${accounts.patInA}`],
    [kim, "get", `${homeA.url}/plugin-accounts/${accounts.samInB}`],
    [kim, "patch", `${homeB.url}/plugin-accounts/${accounts.patInA}`],
    [kim, "delete", `${homeA.url}/plugin-accounts/${accounts.samInB}`],
    [sam, "patch", `${homeB.url}/plugin-accounts/${accounts.kimInA}`],
    [pat, "get", `${homeA.url}/plugin-accounts/${accounts.kimInB}`]
  ]) {
    const answer = method === "get" ? await person.get(path) : method === "delete" ? await person.delete(path) : await person.patch(path, { name: "Not yours" });
    assert.equal(answer.status, 404, `${person.name} ${method} ${path}: ${JSON.stringify(answer.body)}`);
    assert.equal(answer.body.code, "integrations_account_not_found");
  }
  assert.equal(await nameOf(accounts.samInB), "Sam's in B");
  assert.notEqual(await nameOf(accounts.kimInB), "Not yours");
});

test("who can use an account is no longer switched: the old switch's route is gone, and the account stays the home's", async () => {
  for (const [person, home] of [[pat, homeA], [kim, homeA]]) {
    const answer = await person.put(`${home.url}/plugin-accounts/${accounts.patInA}/home`, { home: false });
    assert.equal(answer.status, 404, `${person.name}: ${JSON.stringify(answer.body)}`);
  }
  const row = await knex("plugin_accounts").where({ id: accounts.patInA }).first("workspace_id", "user_id");
  assert.deepEqual([String(row.workspace_id), String(row.user_id)], [homeA.id, pat.id]);
});
