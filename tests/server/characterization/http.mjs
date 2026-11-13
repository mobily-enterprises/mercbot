import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { countRuntimeQueries } from "@jskit-ai/database-runtime/server/testDatabases";
import { createServer } from "../../../server.js";
import { queriesDuring } from "../../support/queryCount.mjs";

// The characterization tests (this folder) pin what people see today, so that they pass unchanged across the
// data-access port: the HTTP routes and the schema stay, the construction behind them changes. They boot the real
// server in this process and call its routes with app.inject(), as people who signed up with a password, each with
// their own cookies. Rows are seeded with Knex (seed.mjs); what no route reaches goes through harness.mjs, the one
// file the port rewires. The server reads its database as it starts, so these run in the database suite, each file
// on its own copy of the test template (tests/support/testFile.mjs).
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must be this file's own test database copy: run it in the database suite.");

const runtimeEnv = Object.freeze({
  ...process.env,
  AUTH_LOCAL_SESSION_SECRET: "characterization-test-only-session-secret",
  // Signing up signs in at once here; the app itself confirms new accounts' email (JSKIT local auth).
  AUTH_LOCAL_EMAIL_CONFIRMATION: "false",
  DB_CLIENT: "pg",
  HOST: "127.0.0.1",
  NODE_ENV: "test",
  PORT: "3001",
  SERVER_SURFACE: "all"
});
const PASSWORD = "Characterization-test-password-2026!";

/**
 * The server as production builds it, never listening: its background loops start only once it listens (onListen)
 * (packages/bots/src/server/botLoops.js), so nothing claims work behind the tests' backs. Close it in an after hook.
 */
export function bootServer() {
  return createServer({ runtimeEnv });
}

/** Calls `app`'s routes as one browser does: one cookie jar, and the session's CSRF token on every call. */
export function browser(app) {
  const cookies = new Map();
  let csrfToken = null;
  return async function request(method, url, payload) {
    const response = await app.inject({
      method,
      url,
      payload,
      headers: {
        ...(payload === undefined ? {} : { "content-type": "application/json" }),
        cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
        ...(csrfToken ? { "x-csrf-token": csrfToken } : {})
      }
    });
    for (const cookie of response.cookies) cookies.set(cookie.name, cookie.value);
    let body = null;
    try {
      body = response.body ? JSON.parse(response.body) : null;
    } catch {
      body = response.body;
    }
    if (body?.csrfToken) csrfToken = body.csrfToken;
    return { status: response.statusCode, body };
  };
}

/**
 * A person who signs up on `app` with a password (which signs them in), and their user id, found by email.
 * JSKIT limits sign-ups to 10 a minute from one address, per server: a file signs up a few people at most.
 * @param {import("fastify").FastifyInstance} app
 * @param {import("knex").Knex} knex
 * @param {string} name
 */
export async function signUp(app, knex, name) {
  const request = browser(app);
  assert.equal((await request("GET", "/api/session")).status, 200, "the session gives a CSRF token");
  const email = `${name}-${randomUUID()}@example.test`;
  const signedUp = await request("POST", "/api/register", { email, password: PASSWORD });
  assert.equal(signedUp.status, 201, `${name} signs up: ${JSON.stringify(signedUp.body)}`);
  const user = await knex("users").whereRaw("lower(email) = ?", [email]).first("id");
  assert.ok(user, `${name} has a user row`);
  return Object.freeze({
    id: String(user.id),
    name,
    email,
    get: (url) => request("GET", url),
    post: (url, body = {}) => request("POST", url, body),
    patch: (url, body = {}) => request("PATCH", url, body),
    delete: (url) => request("DELETE", url)
  });
}

/**
 * How many SQL statements the booted server's own database sends while `work` runs, counted the way queriesDuring
 * (tests/support/queryCount.mjs) counts them: AnyAPI's schema checks apart, and with `matching` only the statements it
 * matches. The server keeps its Knex to itself; JSKIT's countRuntimeQueries() (@jskit-ai/database-runtime 0.1.261 and
 * later) records what the runtime's Knex sends, transactions included, and those statements are replayed through
 * queriesDuring. The test's own Knex is never counted.
 * @param {() => Promise<unknown>} work
 * @param {{ matching?: RegExp }} [options]
 */
export async function serverQueriesDuring(work, options) {
  const { queries } = await countRuntimeQueries(work);
  const replay = new EventEmitter();
  return queriesDuring(replay, () => {
    for (const sql of queries) replay.emit("query", { sql });
  }, options);
}
