import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createServer } from "../../server.js";
import { seedChat } from "../support/chatFixtures.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// The home's recurring tasks through the app's real route (GET /api/w/<home>/recurring-tasks, D-132) on the disposable
// test database: nobody signed out or outside the home reads them; a member reads only the tasks of the chats they can
// open and the costs of their own, whatever the request says; and the routes the list's switches and menus call keep
// their own rules.
for (const name of ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "TEST_DB_NAME"]) {
  assert.ok(process.env[name]?.trim(), `${name} must explicitly identify a disposable test database.`);
}
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const runtimeEnv = {
  ...process.env,
  AUTH_LOCAL_SESSION_SECRET: "recurring-tasks-route-test-only-secret",
  AUTH_LOCAL_EMAIL_CONFIRMATION: "false",
  DB_CLIENT: "pg",
  HOST: "127.0.0.1",
  NODE_ENV: "test",
  APP_ENV: "test",
  PORT: "3001",
  SERVER_SURFACE: "all"
};
const JSON_API = "application/vnd.api+json";
const PASSWORD = "Recurring-tasks-route-test-password-2026!";

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

/** Someone registered and signed in: their session and id. */
async function person(app, knex, label) {
  const request = createSession(app);
  const email = `${label}-${randomUUID()}@example.test`;
  assert.equal((await request("GET", "/api/session")).status, 200);
  const registered = await request("POST", "/api/register", { email, password: PASSWORD });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  return { request, id: String((await knex("users").where({ email }).first()).id) };
}

test("the recurring tasks route refuses outsiders and keeps a member to their chats and their own costs", async (context) => {
  const app = await createServer({ runtimeEnv });
  const knex = await connectTestDatabase();
  const made = [];
  context.after(async () => {
    await knex("usage_tasks_daily").whereIn("workspace_id", made).del();
    await knex("workspaces").whereIn("id", made).del();
    await knex.destroy();
    await app.close();
  });
  const ann = await person(app, knex, "ann");
  const ben = await person(app, knex, "ben");
  const cy = await person(app, knex, "cy");
  const created = await ann.request("POST", "/api/workspaces", { data: { type: "workspaces", attributes: { name: "Routines home" } } }, JSON_API);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const slug = encodeURIComponent(created.body.data.attributes.slug);
  const homeId = String(created.body.data.id);
  made.push(homeId);
  await knex("workspace_memberships").insert({ workspace_id: homeId, user_id: ben.id, role_sid: "member", status: "active" });
  const [bot] = await knex("bots").insert({ made_by: ann.id, workspace_id: homeId, name: "Scout", color: "#1E86FC" }).returning("id");
  const botId = String(bot.id);
  const shared = await seedChat(knex, { homeId, kind: "private", title: "Team", people: [ann.id, ben.id], bots: [botId] });
  const annsOwn = await seedChat(knex, { homeId, kind: "private", title: "Ann's diary", people: [ann.id], bots: [botId] });
  const routine = async (chat, name, fields = {}) => String((await knex("bot_routines").insert({
    workspace_id: homeId, chat_bot_id: chat.chatBotIds.get(botId), made_by: ann.id, name, schedule: "Every day at 7:00 (UTC)",
    instructions: name, cron: "0 7 * * *", timezone: "UTC", ...fields
  }).returning("id"))[0].id);
  const weather = await routine(shared, "Weather", { enabled: false });
  const diary = await routine(annsOwn, "Diary");
  const today = new Date().toISOString().slice(0, 10);
  await knex("usage_tasks_daily").insert([weather, diary].map((id) => ({
    workspace_id: homeId, day: today, task_kind: "routine", task_id: id, user_id: ann.id, runs: 1, calls: 1, cost_nano: 4e6
  })));
  const list = (who, query = "") => who.request("GET", `/api/w/${slug}/recurring-tasks${query}`);

  // Signed out, or outside the home: nothing.
  const anonymous = createSession(app);
  await anonymous("GET", "/api/session");
  assert.equal((await list({ request: anonymous })).status, 401);
  const outsider = await list(cy);
  assert.ok([403, 404].includes(outsider.status), `someone outside the home is refused (${outsider.status})`);
  assert.equal(outsider.body?.tasks, undefined);

  // A member: only the chats they can open, and no cost of a task that runs as someone else, whatever they ask for.
  for (const query of ["", "?manages=true", "?scope=home&userId=" + ann.id]) {
    const answer = await list(ben, query);
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    assert.deepEqual(answer.body.tasks.map((task) => [task.name, task.cost]), [["Weather", null]], query || "plain");
    assert.deepEqual([answer.body.costScope, answer.body.others], ["own", null]);
    assert.equal(answer.body.notListedNano, 0, "Ann's diary's cost doesn't reach Ben");
  }
  assert.deepEqual((await list(ben)).body.tasks[0].can, { pause: false, resume: false, edit: false, delete: true });

  // The routes behind the list's controls keep their own rules: Ben can't resume Ann's routine, nor reach her diary's.
  assert.equal((await ben.request("PATCH", `/api/w/${slug}/routines/${weather}`, { enabled: true })).status, 403);
  assert.equal((await ben.request("PATCH", `/api/w/${slug}/routines/${diary}`, { enabled: false })).status, 404);
  assert.equal((await ben.request("DELETE", `/api/w/${slug}/routines/${diary}`)).status, 404);
  assert.equal(await knex("bot_routines").where({ id: diary }).first().then(Boolean), true, "her diary stays");

  // The owner sees both, with their costs.
  const owner = await list(ann);
  assert.equal(owner.status, 200);
  assert.deepEqual(owner.body.tasks.map((task) => [task.name, task.cost?.nano]).sort(), [["Diary", 4e6], ["Weather", 4e6]]);
  assert.equal(owner.body.costScope, "home");
});
