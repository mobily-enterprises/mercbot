import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import knex from "knex";
import { prepareDatabaseFromApp } from "@jskit-ai/database-runtime/server/databaseSetup";
import { createKnexMigrationConfigFromApp } from "@jskit-ai/database-runtime/server/knexMigrationConfig";
import { createServer } from "../../server.js";

for (const name of ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "TEST_DB_NAME"]) {
  assert.ok(process.env[name]?.trim(), `${name} must explicitly identify a disposable test database.`);
}
assert.ok(
  Object.hasOwn(process.env, "DB_PASSWORD"),
  "DB_PASSWORD must be explicit; an empty password is allowed."
);
assert.equal(
  process.env.DB_NAME,
  process.env.TEST_DB_NAME,
  "DB_NAME must match the dedicated TEST_DB_NAME."
);
const runtimeEnv = {
  ...process.env,
  AUTH_LOCAL_SESSION_SECRET: "account-persistence-test-only-secret",
  // Registering signs in at once here; the app itself confirms new accounts' email (JSKIT local auth).
  AUTH_LOCAL_EMAIL_CONFIRMATION: "false",
  DB_CLIENT: "pg",
  HOST: "127.0.0.1",
  NODE_ENV: "test",
  PORT: "3001",
  SERVER_SURFACE: "all"
};

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
    for (const cookie of response.cookies) {
      cookies.set(cookie.name, cookie.value);
    }
    const body = response.body ? response.json() : null;
    if (body?.csrfToken) {
      csrfToken = body.csrfToken;
    }
    return { status: response.statusCode, body };
  };
}

test("account data survives server restart and stays scoped to its owner", async (context) => {
  const preparation = { client: "pg", environment: runtimeEnv };
  const database = knex(await createKnexMigrationConfigFromApp(preparation));
  try {
    const { rows: [identity] } = await database.raw('SELECT current_database() AS "databaseName"');
    assert.equal(
      identity.databaseName,
      runtimeEnv.TEST_DB_NAME,
      "The connection must select the dedicated test database."
    );
  } finally {
    await database.destroy();
  }
  // The file's database is a copy of the test template, which is already migrated: preparing it
  // again is the repeat that must not rerun migrations (each preparation reads every installed package).
  const repeated = await prepareDatabaseFromApp(preparation);
  assert.deepEqual(repeated.migrations, [], "Repeated preparation must not rerun migrations.");

  let app = await createServer({ runtimeEnv });
  context.after(() => app?.close());
  let request = createSession(app);
  const email = `migration-${randomUUID()}@example.test`;
  const password = "Migration-test-password-2026!";
  const anonymousSession = await request("GET", "/api/session");
  assert.equal(anonymousSession.status, 200);
  const registered = await request("POST", "/api/register", { email, password });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  const registeredSession = await request("GET", "/api/session");
  assert.equal(registeredSession.body.authenticated, true);

  const patched = await request("PATCH", "/api/settings/profile", {
    data: {
      type: "user-profiles",
      attributes: { displayName: "Migration tester" }
    }
  }, "application/vnd.api+json");
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  const settings = await request("GET", "/api/settings");
  assert.equal(settings.status, 200, JSON.stringify(settings.body));
  assert.equal(settings.body.data.attributes.profile.displayName, "Migration tester");

  const loggedOut = await request("POST", "/api/logout", {});
  assert.equal(loggedOut.status, 200);
  await app.close();
  app = null;
  app = await createServer({ runtimeEnv });
  request = createSession(app);

  const restartedSession = await request("GET", "/api/session");
  assert.equal(restartedSession.body.authenticated, false);
  const anonymousSettings = await request("GET", "/api/settings");
  assert.equal(anonymousSettings.status, 401);
  const wrongPassword = await request("POST", "/api/login", {
    email,
    password: "incorrect-password"
  });
  assert.equal(wrongPassword.status, 401, JSON.stringify(wrongPassword.body));
  const loggedIn = await request("POST", "/api/login", { email, password });
  assert.equal(loggedIn.status, 200, JSON.stringify(loggedIn.body));
  const persistedSettings = await request("GET", "/api/settings");
  assert.equal(persistedSettings.body.data.attributes.profile.displayName, "Migration tester");

  const other = createSession(app);
  await other("GET", "/api/session");
  const otherRegistration = await other("POST", "/api/register", {
    email: `other-${randomUUID()}@example.test`,
    password
  });
  assert.equal(otherRegistration.status, 201, JSON.stringify(otherRegistration.body));
  const otherSettings = await other("GET", "/api/settings");
  assert.notEqual(otherSettings.body.data.attributes.profile.displayName, "Migration tester");
  const otherPatched = await other("PATCH", "/api/settings/profile", {
    data: {
      type: "user-profiles",
      attributes: { displayName: "Second owner" }
    }
  }, "application/vnd.api+json");
  assert.equal(otherPatched.status, 200);
  const originalSettings = await request("GET", "/api/settings");
  assert.equal(originalSettings.body.data.attributes.profile.displayName, "Migration tester");
});
