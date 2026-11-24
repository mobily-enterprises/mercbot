import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createServer } from "../../server.js";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// People's notifications through the app's real routes (D-133) on the disposable test database: nobody signed out or
// outside the home reaches them, a malformed request from someone signed out gets the refusal and no field errors,
// another person's device can't be removed, and a push address inside the server's network or not a push service's
// is refused before anything is kept.
for (const name of ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "TEST_DB_NAME"]) {
  assert.ok(process.env[name]?.trim(), `${name} must explicitly identify a disposable test database.`);
}
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const runtimeEnv = {
  ...process.env,
  AUTH_LOCAL_SESSION_SECRET: "push-routes-test-only-secret",
  AUTH_LOCAL_EMAIL_CONFIRMATION: "false",
  MERCBOT_PUSH_SECRET: "push-routes-test-only-push-secret",
  DB_CLIENT: "pg",
  HOST: "127.0.0.1",
  NODE_ENV: "test",
  APP_ENV: "test",
  PORT: "3001",
  SERVER_SURFACE: "all"
};
const JSON_API = "application/vnd.api+json";
const PASSWORD = "Push-routes-test-password-2026!";
const KEYS = { p256dh: `B${"x".repeat(86)}`, auth: "abcdefghijklmnop" };

/** A browser's session with the app: its cookies and CSRF token, kept between requests. */
function createSession(app) {
  const cookies = new Map();
  let csrfToken;
  const request = async function request(method, url, payload, contentType = "application/json", { csrf = true } = {}) {
    const response = await app.inject({
      method,
      url,
      payload,
      headers: {
        ...(payload !== undefined ? { "content-type": contentType } : {}),
        cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
        ...(csrfToken && csrf ? { "x-csrf-token": csrfToken } : {})
      }
    });
    for (const cookie of response.cookies) cookies.set(cookie.name, cookie.value);
    const body = response.body ? JSON.parse(response.body) : null;
    if (body?.csrfToken) csrfToken = body.csrfToken;
    return { status: response.statusCode, body };
  };
  return request;
}

/** Someone registered and signed in: their session. */
async function person(app, label) {
  const request = createSession(app);
  assert.equal((await request("GET", "/api/session")).status, 200);
  const registered = await request("POST", "/api/register", { email: `${label}-${randomUUID()}@example.test`, password: PASSWORD });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  return request;
}

test("the notification routes keep to the signed-in person's own, and refuse what's wrong", async (context) => {
  const app = await createServer({ runtimeEnv });
  const knex = await connectTestDatabase();
  const made = [];
  context.after(async () => {
    await knex("workspaces").whereIn("id", made).del();
    await knex.destroy();
    await app.close();
  });
  const ann = await person(app, "ann");
  const ben = await person(app, "ben");
  const created = await ann("POST", "/api/workspaces", { data: { type: "workspaces", attributes: { name: "Push home" } } }, JSON_API);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  made.push(String(created.body.data.id));
  const base = `/api/w/${encodeURIComponent(created.body.data.attributes.slug)}/push`;

  // Signed out: refused, a malformed body included, with no field errors.
  const anonymous = createSession(app);
  await anonymous("GET", "/api/session");
  for (const [method, path, payload] of [["GET", "", undefined], ["PUT", "/settings", "\"hello\""], ["POST", "/devices", { endpoint: 42 }], ["DELETE", "/devices/1", undefined]]) {
    const answer = await anonymous(method, `${base}${path}`, payload);
    assert.equal(answer.status, 401, `${method} ${path}`);
    assert.equal(JSON.stringify(answer.body).includes("fieldErrors"), false, `${method} ${path} names no fields`);
  }
  // Outside the home: nothing.
  const outside = await ben("GET", base);
  assert.ok([403, 404].includes(outside.status), `someone outside the home is refused (${outside.status})`);

  // Ann's own: a push address inside the network, or not a push service's, is refused; a real one is kept.
  for (const endpoint of ["https://127.0.0.1:3001/api/health", "https://169.254.169.254/latest", "https://example.test/x"]) {
    const refused = await ann("POST", `${base}/devices`, { endpoint, keys: KEYS });
    assert.deepEqual([refused.status, refused.body?.code ?? refused.body?.error?.code], [400, "account_push_endpoint"], endpoint);
  }
  const kept = await ann("POST", `${base}/devices`, { endpoint: "https://fcm.googleapis.com/fcm/send/ann", keys: KEYS, label: "Ann's phone" });
  assert.equal(kept.status, 200, JSON.stringify(kept.body));
  const [device] = kept.body.devices;
  // Another site's page making Ann's browser send a change, without the page's CSRF token: refused, nothing changed.
  const forged = await ann("DELETE", `${base}/devices/${device.id}`, undefined, "application/json", { csrf: false });
  assert.equal(forged.status, 403, JSON.stringify(forged.body));
  assert.equal((await ann("GET", base)).body.devices.length, 1);
  const malformed = await ann("PUT", `${base}/settings`, "\"hello\"");
  assert.equal(malformed.status, 400, JSON.stringify(malformed.body));
  assert.equal((await ann("PUT", `${base}/settings`, { messages: false })).body.settings.messages, false);

  // Ben, in the home now, can't see or remove Ann's device.
  await knex("workspace_memberships").insert({ workspace_id: made[0], user_id: (await knex("users").where("email", "like", "ben-%").orderBy("id", "desc").first()).id, role_sid: "member", status: "active" });
  const bens = await ben("GET", base);
  assert.equal(bens.status, 200, JSON.stringify(bens.body));
  assert.deepEqual(bens.body.devices, []);
  assert.equal(bens.body.settings.messages, true, "Ann's settings are hers");
  assert.equal((await ben("DELETE", `${base}/devices/${device.id}`)).status, 404);
  assert.equal((await ann("GET", base)).body.devices.length, 1, "Ann's phone stays");

  // Signing out, a browser has the server forget its device by its push address, outside any home: only the person's
  // own, never without a session or the page's CSRF token, and a malformed one refused.
  const forget = "/api/push/devices/forget";
  assert.equal((await anonymous("POST", forget, { endpoint: device.endpoint })).status, 401);
  const anonymousMalformed = await anonymous("POST", forget, { endpoint: 42 });
  assert.deepEqual([anonymousMalformed.status, JSON.stringify(anonymousMalformed.body).includes("fieldErrors")], [401, false]);
  assert.deepEqual((await ben("POST", forget, { endpoint: device.endpoint })).body, { forgotten: false });
  assert.equal((await ann("POST", forget, { endpoint: device.endpoint }, "application/json", { csrf: false })).status, 403);
  assert.equal((await ann("POST", forget, { endpoint: 42 })).status, 400);
  assert.equal((await ann("GET", base)).body.devices.length, 1, "nothing forgotten yet");
  const forgotten = await ann("POST", forget, { endpoint: device.endpoint });
  assert.deepEqual([forgotten.status, forgotten.body], [200, { forgotten: true }]);
  assert.deepEqual((await ann("GET", base)).body.devices, []);
});
