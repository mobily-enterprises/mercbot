import assert from "node:assert/strict";
import test from "node:test";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { requestContextOptions } from "../support/requestContextOptions.mjs";
import { startIntegrations } from "../support/ownedHandles.mjs";
import { separateHome } from "./testHome.js";

// One account workflow for every app (D-110), every account its home's (D-111): anyone in the home adds an account with
// a label or none, which adds the app to the home's list too; every account, the first and the only one too, connected
// or not, is removed with its bin, which withdraws its sign-in first, by the person who added it or the home's owners
// and admins; removing the last account keeps the app; Remove from this home takes the app with every account of it,
// for the home's owners and admins, or the person who added the app while every account of it is theirs.
const CATALOGUE = [
  { id: "gmail", name: "Gmail", oauth: { provider: "google", scopes: [] } },
  { id: "sedna", name: "Sedna", credentials: { kind: "sedna", home: true } }
];

/** A person's call in the home, as Connect apps' routes make it; owners and admins manage the home. */
function inHome(userId, homeId, { manages = false } = {}) {
  return requestContextOptions({
    user: { id: userId },
    workspace: { id: homeId },
    membership: { roleSid: manages ? "admin" : "member" },
    permissions: manages ? ["workspace.settings.update"] : []
  });
}

async function setup(context) {
  const knex = await connectTestDatabase();
  const pat = String((await knex("users").first()).id);
  const stamp = Date.now();
  const person = async (name) => String((await knex("users").insert({
    auth_provider: "test", auth_provider_user_sid: `${name}-${stamp}`, email: `${name}-${stamp}@example.com`, username: `${name}${stamp}`, display_name: name
  }).returning("id"))[0].id);
  const kim = await person("Kim");
  const lee = await person("Lee");
  // A home of the test's own: every account in it is everyone's there, so no other test's may be in it.
  const homeId = await separateHome(knex, pat, [kim, lee]);
  await knex("workspace_memberships").where({ workspace_id: homeId, user_id: lee }).update({ role_sid: "admin" });
  const withdrawn = [];
  const connections = { lacksAccess: () => false, github: { shown: () => null }, withdraw: async (account) => withdrawn.push([account.id, Boolean(account.tokens)]) };
  const { integrations } = await startIntegrations(knex, context, { catalogue: CATALOGUE, connections });
  context.after(async () => {
    await knex("workspaces").where({ id: homeId }).del();
    await knex("users").whereIn("id", [kim, lee]).del();
    await knex.destroy();
  });
  const owner = inHome(pat, homeId, { manages: true });
  return { knex, integrations, withdrawn, homeId, pat, kim, lee, owner, admin: inHome(lee, homeId, { manages: true }), member: inHome(kim, homeId) };
}

const gmailOf = async (integrations, options) => (await integrations.list(options)).plugins.find((plugin) => plugin.id === "gmail");
/** Each Gmail account's line as `options`' person sees it: its name, whether they added it, and whether they may change it. */
const linesOf = async (integrations, options) =>
  (await gmailOf(integrations, options)).accounts.map((account) => [account.name, account.addedByYou, account.canChange]).sort();
const marksOf = async (knex, homeId) =>
  (await knex("home_plugins").where({ workspace_id: homeId }).orderBy("plugin_id").select("plugin_id", "user_id"))
    .map((mark) => [mark.plugin_id, String(mark.user_id)]);

test("anyone in the home adds an account, with a label or none, which adds the app to the home; Connect adds no unnamed account (items 4, 6)", async (context) => {
  const { knex, integrations, homeId, owner, member, kim } = await setup(context);

  // Connect on an app people sign in to only adds it to the home: its accounts come from the Add account step.
  await integrations.install("gmail", member);
  assert.deepEqual(await linesOf(integrations, member), [], "no unnamed account");
  assert.equal((await gmailOf(integrations, owner)).installed, true, "it's on the home's list, for everyone");
  assert.deepEqual(await marksOf(knex, homeId), [["gmail", kim]], "added by Kim");

  // No label, twice, by a member: each its own account of the home's, shown by its address once signed in.
  const first = await integrations.addAccount("gmail", "", member);
  await integrations.addAccount("gmail", "  ", member);
  assert.ok(first.accountId);
  assert.deepEqual(await linesOf(integrations, member), [["", true, true], ["", true, true]]);

  // No label, twice, by an owner: every one is the home's; Kim sees Pat's and can't change them, Pat changes all four.
  await integrations.addAccount("gmail", "", owner);
  await integrations.addAccount("gmail", "", owner);
  assert.deepEqual(await linesOf(integrations, member), [["", false, false], ["", false, false], ["", true, true], ["", true, true]]);
  assert.deepEqual(await linesOf(integrations, owner), [["", false, true], ["", false, true], ["", true, true], ["", true, true]]);
  assert.equal((await knex("plugin_accounts").where({ workspace_id: homeId, plugin_id: "gmail" })).length, 4, "all four in the home");
  assert.deepEqual(await marksOf(knex, homeId), [["gmail", kim]], "the app is on the list once");
});

test("every account has its bin, for the person who added it and the home's owners and admins; removing the last keeps the app (items 3, 5)", async (context) => {
  const { knex, integrations, withdrawn, owner, member, admin } = await setup(context);
  const { accountId: only } = await integrations.addAccount("gmail", "", member);
  await knex("plugin_accounts").where({ id: only }).update({ status: "connected", label: "kim@example.com", tokens: JSON.stringify({ sealed: "k" }) });

  // The only one, connected, by the member who added it: removed, its sign-in withdrawn first with its keys; the app stays.
  const listed = await integrations.removeAccount(only, member);
  assert.deepEqual(withdrawn, [[only, true]]);
  assert.equal(await knex("plugin_accounts").where({ id: only }).first(), undefined);
  assert.equal(listed.plugins.find((plugin) => plugin.id === "gmail").installed, true, "removing the last account keeps the app");

  // Pat's: Kim, a member who didn't add it, can't remove it; an admin can.
  const { accountId: pats } = await integrations.addAccount("gmail", "", owner);
  await assert.rejects(integrations.removeAccount(pats, member), { statusCode: 403, code: "integrations_account_manage_forbidden" });
  assert.deepEqual(withdrawn.map(([id]) => id), [only], "nothing withdrawn on a refusal");
  await integrations.removeAccount(pats, admin);

  // Kim's: the owner removes it too.
  const { accountId: kims } = await integrations.addAccount("gmail", "work", member);
  await integrations.removeAccount(kims, owner);
  assert.deepEqual(withdrawn.map(([id]) => id), [only, pats, kims]);
});

test("Remove from this home takes the app with every account of it, withdrawn first; who may", async (context) => {
  const { knex, integrations, withdrawn, homeId, owner, admin, member } = await setup(context);
  const { accountId: kims } = await integrations.addAccount("gmail", "", member);
  const { accountId: pats } = await integrations.addAccount("gmail", "", owner);

  // Kim added the app, but Pat's account is in it too: only an owner or admin takes it off now.
  assert.equal((await gmailOf(integrations, member)).canRemove, false);
  await assert.rejects(integrations.uninstall("gmail", member), { statusCode: 403, code: "integrations_home_app_remove_forbidden" });
  assert.deepEqual(withdrawn, []);
  assert.equal((await gmailOf(integrations, admin)).canRemove, true);
  await integrations.uninstall("gmail", admin);
  assert.deepEqual(withdrawn.map(([id]) => id).sort(), [kims, pats].sort());
  assert.deepEqual(await knex("plugin_accounts").where({ workspace_id: homeId, plugin_id: "gmail" }), []);
  assert.equal((await gmailOf(integrations, member)).installed, false, "off the home's list, for everyone");
  assert.deepEqual(await marksOf(knex, homeId), []);

  // Added again by Kim with only her own account: she takes it off herself.
  const { accountId: again } = await integrations.addAccount("gmail", "", member);
  assert.equal((await gmailOf(integrations, member)).canRemove, true);
  await integrations.uninstall("gmail", member);
  assert.equal(withdrawn.at(-1)[0], again);
  assert.equal((await gmailOf(integrations, owner)).installed, false);
});

test("an app whose API credentials are the home's keeps one unlabelled account a home", async (context) => {
  const { knex, integrations, homeId, owner, admin } = await setup(context);
  const listed = await integrations.install("sedna", owner);
  const [account] = listed.plugins.find((plugin) => plugin.id === "sedna").accounts;
  assert.deepEqual([account.name, account.addedByYou], ["", true]);
  await assert.rejects(integrations.addAccount("sedna", "", admin), { statusCode: 400, code: "integrations_account_label_missing" });
  // The database holds it to one too, as two owners adding it at once would make.
  await assert.rejects(knex("plugin_accounts").insert({ user_id: (await knex("users").first()).id, workspace_id: homeId, plugin_id: "sedna", name: "" }), /ix_plugin_accounts_home_app_unlabelled/u);
  // Its bin forgets it, with its people matches; the next unlabelled one may then be added.
  await integrations.removeAccount(account.id, admin);
  const { accountId } = await integrations.addAccount("sedna", "", admin);
  assert.ok(accountId);
});
