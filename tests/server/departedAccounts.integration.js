import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createServer } from "../../server.js";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { testServerEnv } from "../support/testEnv.mjs";

// Someone removed from a home takes the accounts they connected there with them (D-111), through the app's real route
// for removing a member (DELETE /api/w/<home>/members/<person>, JSKIT's workspace.member.remove) on the disposable test
// database: their accounts of that home are withdrawn and removed, and the home's Activity says so, by Mercbot; everyone
// else's accounts there stay, and so do their own accounts in their other homes.
for (const name of ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "TEST_DB_NAME"]) {
  assert.ok(process.env[name]?.trim(), `${name} must explicitly identify a disposable test database.`);
}
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const runtimeEnv = {
  ...testServerEnv(),
  AUTH_LOCAL_SESSION_SECRET: "departed-accounts-test-only-secret",
  // Registering signs in at once here; the app itself confirms new accounts' email (JSKIT local auth).
  AUTH_LOCAL_EMAIL_CONFIRMATION: "false",
  DB_CLIENT: "pg",
  HOST: "127.0.0.1",
  NODE_ENV: "test",
  APP_ENV: "test",
  PORT: "3001",
  SERVER_SURFACE: "all"
};
const JSON_API = "application/vnd.api+json";
const PASSWORD = "Departed-accounts-test-password-2026!";

/** A browser's session with the app: its cookies and CSRF token, kept between requests. */
function createSession(app) {
  const cookies = new Map();
  let csrfToken;
  return async function request(method, url, payload, contentType = "application/json") {
    const response = await app.inject({
      method,
      url,
      payload,
      headers: {
        ...(payload ? { "content-type": contentType } : {}),
        cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
        ...(csrfToken ? { "x-csrf-token": csrfToken } : {})
      }
    });
    for (const cookie of response.cookies) cookies.set(cookie.name, cookie.value);
    const body = response.body ? response.json() : null;
    if (body?.csrfToken) csrfToken = body.csrfToken;
    return { status: response.statusCode, body };
  };
}

/** Someone registered and signed in: their session, email and id. */
async function person(app, knex, label) {
  const request = createSession(app);
  const email = `${label}-${randomUUID()}@example.test`;
  assert.equal((await request("GET", "/api/session")).status, 200);
  const registered = await request("POST", "/api/register", { email, password: PASSWORD });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  return { request, email, id: String((await knex("users").where({ email }).first()).id) };
}

test("someone removed from a home takes the accounts they connected there, and the home's Activity says so", async (context) => {
  const app = await createServer({ runtimeEnv });
  const knex = await connectTestDatabase();
  const made = [];
  context.after(async () => {
    await knex("audit_events").whereIn("workspace_id", made).del();
    await knex("workspaces").whereIn("id", made).del();
    await knex.destroy();
    await app.close();
  });
  const ann = await person(app, knex, "ann");
  const ben = await person(app, knex, "ben");
  const cy = await person(app, knex, "cy");

  // Ann makes a home, as New home does; Ben and Cy are its members.
  const created = await ann.request("POST", "/api/workspaces", { data: { type: "workspaces", attributes: { name: "Shop team" } } }, JSON_API);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const slug = created.body.data.attributes.slug;
  const homeId = String(created.body.data.id);
  made.push(homeId);
  await knex("workspace_memberships").insert([ben, cy].map((who) => ({ workspace_id: homeId, user_id: who.id, role_sid: "member", status: "active" })));
  const bensFirstHome = String((await knex("workspaces").where({ owner_user_id: ben.id, is_personal: true }).first()).id);

  // Each connected an account there, and Ben one in his own first home too.
  const account = (who, homeOf, pluginId, label) => ({ user_id: who.id, workspace_id: homeOf, plugin_id: pluginId, name: "", label, status: "connected" });
  await knex("plugin_accounts").insert([
    account(ann, homeId, "gmail", "ann@example.com"),
    account(ben, homeId, "gmail", "ben@example.com"),
    account(ben, homeId, "github", "ben-codes"),
    account(cy, homeId, "outlook", "cy@example.com"),
    account(ben, bensFirstHome, "gmail", "ben@example.com")
  ]);

  // Ann removes Ben.
  const removed = await ann.request("DELETE", `/api/w/${encodeURIComponent(slug)}/members/${ben.id}`);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));

  const left = await knex("plugin_accounts").whereIn("workspace_id", [homeId, bensFirstHome]).orderBy("label").select("workspace_id", "user_id", "label");
  assert.deepEqual(left.map((row) => [String(row.workspace_id), String(row.user_id), row.label]), [
    [homeId, ann.id, "ann@example.com"],
    [bensFirstHome, ben.id, "ben@example.com"],
    [homeId, cy.id, "cy@example.com"]
  ], "Ben's accounts of the home are gone; Ann's, Cy's and Ben's own elsewhere stay");
  const notices = await knex("audit_events").where({ workspace_id: homeId, action: "settings" }).orderBy("id").select("actor", "changes");
  const bensRow = await knex("users").where({ id: ben.id }).first();
  const benName = bensRow.display_name || bensRow.email.split("@")[0];
  assert.deepEqual(notices.map((row) => [row.actor?.name, row.changes?.departedAccount?.app, row.changes?.departedAccount?.account, row.changes?.departedAccount?.person]).sort(), [
    ["Mercbot", "GitHub", "ben-codes", benName],
    ["Mercbot", "Gmail", "ben@example.com", benName]
  ]);

  // Removing someone else later leaves the home's remaining accounts as they are: nothing is removed twice.
  const again = await ann.request("DELETE", `/api/w/${encodeURIComponent(slug)}/members/${cy.id}`);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.deepEqual((await knex("plugin_accounts").where({ workspace_id: homeId }).select("label")).map((row) => row.label), ["ann@example.com"]);
  assert.equal((await knex("audit_events").where({ workspace_id: homeId, action: "settings" })).length, 3);
});
