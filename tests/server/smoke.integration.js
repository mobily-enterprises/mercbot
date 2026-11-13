import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createServer } from "../../server.js";

// The server reads its database as it starts (JSKIT's local auth checks whether the app has an
// account yet), so this file runs in the database suite, on its own copy of the test template.
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must be this file's own test database copy: run it with npm run test:database.");
const runtimeEnv = Object.freeze({
  ...process.env,
  AUTH_LOCAL_SESSION_SECRET: "server-test-only-session-secret",
  DB_CLIENT: "pg",
  HOST: "127.0.0.1",
  NODE_ENV: "test",
  PORT: "3001",
  SERVER_SURFACE: "all"
});

// The tests only read, so they share one server (a boot is about a second even when warm).
let app;
before(async () => {
  app = await createServer({ runtimeEnv });
});
after(() => app?.close());

test("health, the anonymous account session and app logos are available", async () => {
  const healthResponse = await app.inject({
    method: "GET",
    url: "/api/health"
  });
  assert.equal(healthResponse.statusCode, 200);
  assert.deepEqual(healthResponse.json(), {
    ok: true,
    app: "account-app"
  });

  const sessionResponse = await app.inject({
    method: "GET",
    url: "/api/session"
  });
  assert.equal(sessionResponse.statusCode, 200);
  const session = sessionResponse.json();
  assert.equal(session.authenticated, false);
  assert.equal(session.authCapabilities.features.password.login, true);
  assert.equal(session.authCapabilities.features.password.register, true);
  assert.equal(typeof session.csrfToken, "string");
  assert.ok(session.csrfToken.length > 0);

  // App logos come from Simple Icons, which loads with the first one asked for.
  const logo = await app.inject({ method: "GET", url: "/api/plugins/github/logo.svg" });
  assert.equal(logo.statusCode, 200);
  assert.match(logo.headers["content-type"], /^image\/svg\+xml/u);
  assert.match(logo.body, /^<svg [^>]*><title>GitHub<\/title><path fill="#FFFFFF" d="M/u);
  const tile = await app.inject({ method: "GET", url: "/api/plugins/github/logo.svg?tile=1" });
  assert.match(tile.body, /<rect width="24" height="24" rx="6" fill="#181717"\/>/u);
  assert.equal((await app.inject({ method: "GET", url: "/api/plugins/no-such-app/logo.svg" })).statusCode, 404);
});

test("bot routes require a signed-in user", async () => {
  const response = await app.inject({ method: "GET", url: "/api/w/any-home/bots" });
  assert.equal(response.statusCode, 401);
});

test("a copy invites nobody: JSKIT serves none of the invitation routes, and a home's people stay there", async () => {
  // A home's people and their roles are still asked for, by someone signed in.
  for (const url of ["/api/w/any-home/members", "/api/w/any-home/roles"]) {
    assert.equal((await app.inject({ method: "GET", url })).statusCode, 401, url);
  }
  const invitationRoutes = [
    ["GET", "/api/w/any-home/invites"],
    ["POST", "/api/w/any-home/invites"],
    ["DELETE", "/api/w/any-home/invites/1"],
    ["GET", "/api/workspace/invitations/resolve?filter%5Btoken%5D=any"],
    ["GET", "/api/workspace/invitations/pending"],
    ["POST", "/api/workspace/invitations/redeem"]
  ];
  // Each call carries the session's CSRF token, so a change is answered by its route, or the lack of one, and not
  // refused by JSKIT's CSRF check first.
  const session = await app.inject({ method: "GET", url: "/api/session" });
  const headers = {
    cookie: session.cookies.map(({ name, value }) => `${name}=${value}`).join("; "),
    "csrf-token": session.json().csrfToken
  };
  for (const [method, url] of invitationRoutes) {
    assert.equal((await app.inject({ method, url, headers })).statusCode, 404, `${method} ${url}`);
  }
});
