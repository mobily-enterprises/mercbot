import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createServer } from "../../server.js";
import { createNotices } from "../../packages/notices/src/server/notices.js";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// Renaming a home (D-103), through the app's real routes on the disposable test database: JSKIT's own route for a
// workspace's profile (PATCH /api/w/<home>, workspace.workspaces.update) renames it for its owners and admins, and every
// person's list of homes, which the sidebar and the home switcher show, has the new name at once; a member is refused
// 403 and someone outside the home 404, an empty name (spaces only included) and one longer than 160 characters are
// refused, each leaving the name as it was; everyone in the home hears of it (home-changed), so open pages read their
// homes again; and a first home renamed keeps its name when its owner signs in again.
for (const name of ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "TEST_DB_NAME"]) {
  assert.ok(process.env[name]?.trim(), `${name} must explicitly identify a disposable test database.`);
}
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const runtimeEnv = {
  ...process.env,
  AUTH_LOCAL_SESSION_SECRET: "home-rename-test-only-secret",
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
const PASSWORD = "Home-rename-test-password-2026!";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** Someone registered and signed in: their session and email. */
async function person(app, label) {
  const request = createSession(app);
  const email = `${label}-${randomUUID()}@example.test`;
  assert.equal((await request("GET", "/api/session")).status, 200);
  const registered = await request("POST", "/api/register", { email, password: PASSWORD });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  const session = await request("GET", "/api/session");
  assert.equal(session.body.authenticated, true);
  return { request, email };
}

/** Each home in someone's list, by slug: its name, as the sidebar and the home switcher show it. */
async function namesSeenBy(who) {
  const listed = await who.request("GET", "/api/workspaces");
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  return new Map((listed.body.data || []).map((entry) => [entry.attributes.slug, entry.attributes.name]));
}

const rename = (who, slug, name) => who.request(
  "PATCH",
  `/api/w/${encodeURIComponent(slug)}`,
  { data: { type: "workspaces", attributes: { name } } },
  JSON_API
);

test("a home's owners and admins rename it for everyone in it; a member, an outsider and a bad name are refused", async (context) => {
  const app = await createServer({ runtimeEnv });
  context.after(() => app.close());
  const knex = await connectTestDatabase();
  const made = [];
  context.after(async () => {
    await knex("workspace_memberships").whereIn("workspace_id", made).del();
    await knex("workspace_settings").whereIn("workspace_id", made).del();
    await knex("workspaces").whereIn("id", made).del();
    await knex.destroy();
  });
  const idOf = async (who) => String((await knex("users").where({ email: who.email }).first()).id);

  const ann = await person(app, "ann");
  const ada = await person(app, "ada");
  const ben = await person(app, "ben");
  const sam = await person(app, "sam");

  // Ann makes a home, as New home does, and Ada joins it as an admin and Ben as a member.
  const newHome = { data: { type: "workspaces", attributes: { name: "Shop team" } } };
  const created = await ann.request("POST", "/api/workspaces", newHome, JSON_API);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const slug = created.body.data.attributes.slug;
  const homeId = String(created.body.data.id);
  made.push(homeId);
  await knex("workspace_memberships").insert([
    { workspace_id: homeId, user_id: await idOf(ada), role_sid: "admin", status: "active" },
    { workspace_id: homeId, user_id: await idOf(ben), role_sid: "member", status: "active" }
  ]);
  assert.equal((await namesSeenBy(ben)).get(slug), "Shop team");

  // Everyone in the home hears of a rename on their bot events (from any server), so their open pages read their homes
  // again. The listener connects in the background: a probe notice, sent until it's heard, says it is listening.
  const notices = createNotices({ knex });
  context.after(() => notices.close());
  let listening = false;
  notices.subscribe("bots", `probe-${homeId}`, () => { listening = true; });
  for (let tries = 0; tries < 100 && !listening; tries += 1) {
    await notices.publish("bots", `probe-${homeId}`, { type: "probe" });
    await pause(100);
  }
  assert.ok(listening, "the test's listener hears notices");
  const heard = [];
  notices.subscribe("bots", await idOf(ben), (event) => heard.push(event));

  // The owner renames it: everyone's list has the new name at once, the server keeping it trimmed.
  const renamed = await rename(ann, slug, "  The Smiths  ");
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  assert.equal(renamed.body.data.attributes.name, "The Smiths");
  for (const who of [ann, ada, ben]) assert.equal((await namesSeenBy(who)).get(slug), "The Smiths");
  for (let tries = 0; tries < 50 && !heard.some((event) => event.type === "home-changed"); tries += 1) await pause(100);
  assert.deepEqual(heard.filter((event) => event.type === "home-changed"), [{ type: "home-changed", homeId }], "Ben's page hears of it");

  // An admin may rename it too, to a name of 160 characters, the most a name may have.
  const longest = "L".repeat(160);
  assert.equal((await rename(ada, slug, longest)).status, 200);
  assert.equal((await namesSeenBy(ben)).get(slug), longest);
  assert.equal((await rename(ada, slug, "The Smiths")).status, 200);

  // A member is refused, and someone outside the home is told it isn't there; the name stays.
  const byMember = await rename(ben, slug, "Ben's now");
  assert.equal(byMember.status, 403, JSON.stringify(byMember.body));
  const byOutsider = await rename(sam, slug, "Sam's now");
  assert.equal(byOutsider.status, 404, JSON.stringify(byOutsider.body));
  assert.equal((await namesSeenBy(sam)).has(slug), false);

  // An empty name, spaces only, and one longer than 160 characters are refused; the name stays.
  for (const name of ["", "   ", "L".repeat(161)]) {
    const refused = await rename(ann, slug, name);
    assert.equal(refused.status, 400, `${JSON.stringify(name.slice(0, 10))}: ${JSON.stringify(refused.body)}`);
  }
  assert.equal((await knex("workspaces").where({ id: homeId }).first()).name, "The Smiths", "the name is as the owner last kept it");
});

test("a first home renamed keeps its new name when its owner signs in again", async (context) => {
  const app = await createServer({ runtimeEnv });
  context.after(() => app.close());
  const kim = await person(app, "kim");
  const [[slug, firstName]] = [...(await namesSeenBy(kim))];
  assert.match(firstName, /'s home$/u, "Mercbot named the first home after its person");
  assert.equal((await rename(kim, slug, "Kim and family")).status, 200);

  assert.equal((await kim.request("POST", "/api/logout", {})).status, 200);
  const signedIn = await kim.request("POST", "/api/login", { email: kim.email, password: PASSWORD });
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
  assert.equal((await namesSeenBy(kim)).get(slug), "Kim and family", "signing in doesn't name the first home again");
});
