import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createServer, startServer } from "../../server.js";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { insertRows } from "./characterization/seed.mjs";
import { testBot, testHome } from "./testHome.js";

// A server's role (D-131). A web server serves the pages and the API, and claims the work every web server shares, each
// piece once across them: due routines, Apps' jobs, bots' requests, goals and replies to carry on (those claims are
// characterization/queueClaims.integration.js's). A computers server runs only bots' computers for the other servers and
// claims none of that work. These boot the real server, which reads its database as it starts, so the file runs in the
// database suite, on its own copy of the test template. No AI is set up, as on a computers server given none: bots'
// work a server claims there is answered "its AI isn't set up" in place of being done. No web server here listens: its
// loops' JSKIT drains (agent-runtime's runs, goals and summaries) each leave a 20 s timer as it closes, which would keep
// the file alive past its bound.
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must be this file's own test database copy: run it with npm run test:database.");
const withoutAi = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("AI_") && name !== "MERCBOT_TEST_AI_URL"));
const settings = {
  AUTH_LOCAL_SESSION_SECRET: "server-roles-test-only-session-secret",
  DB_CLIENT: "pg",
  HOST: "127.0.0.1",
  NODE_ENV: "test",
  APP_ENV: "test",
  PORT: "0",
  SERVER_SURFACE: "all"
};
const runtimeEnv = Object.freeze({ ...withoutAi, ...settings });

let knex;
let userId;
let homeId;
let bot;

before(async () => {
  knex = await connectTestDatabase();
  userId = String((await knex("users").orderBy("id").first("id")).id);
  homeId = String(await testHome(knex, userId));
  bot = await testBot(knex, userId, { name: "Roles" });
});

after(async () => {
  // Its chat goes with it, and its routines and jobs with its seat (each on delete cascade).
  if (knex && bot) await knex("bots").where({ id: bot.id }).del();
  await knex?.destroy();
});

/** A routine due ten days ago, so a runner claims it before any other, and a queued Apps job for the same bot. */
async function queuedWork(context) {
  const [routine] = await insertRows(knex, "bot_routines", {
    chat_bot_id: bot.chat_bot_id,
    made_by: userId,
    name: "Morning summary",
    schedule: "Every day at 9:00",
    cron: "0 9 * * *",
    timezone: "UTC",
    enabled: true,
    next_run_at: knex.raw("now() - interval '10 days'")
  }, homeId);
  const [job] = await insertRows(knex, "app_jobs", {
    kind: "handoff",
    bot_id: bot.id,
    chat_bot_id: bot.chat_bot_id,
    user_id: userId,
    title: "Hand-off",
    prompt: "Carry on",
    status: "queued"
  }, homeId);
  context.after(async () => {
    await knex("app_jobs").where({ id: job.id }).del();
    await knex("bot_routines").where({ id: routine.id }).del();
  });
  return { routine: String(routine.id), job: String(job.id) };
}

/** Whether each was claimed: a routine's last run is set as it is claimed, and a job leaves "queued". */
async function claimed({ routine, job }) {
  const [routineRow, jobRow] = await Promise.all([
    knex("bot_routines").where({ id: routine }).first("last_run_at"),
    knex("app_jobs").where({ id: job }).first("status")
  ]);
  return { routine: routineRow.last_run_at !== null, job: jobRow.status !== "queued" };
}

test("a computers server claims no due routine or queued Apps job", async (context) => {
  const work = await queuedWork(context);
  const computers = await createServer({ runtimeEnv, gate: false, role: "computers" });
  await computers.listen({ host: "127.0.0.1", port: 0 });
  try {
    // A web server's loops claim both at their first tick, which runs as it starts listening (routineRunner.js,
    // appJobRunner.js): a claim would be in by now.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.deepEqual(await claimed(work), { routine: false, job: false }, "the computers server claimed bots' work");
  } finally {
    await computers.close();
  }
});

test("a computers server answers its health and the work other servers pass it, and nothing else", async () => {
  const computers = await createServer({ runtimeEnv, gate: false, role: "computers" });
  try {
    assert.equal((await computers.inject({ method: "GET", url: "/api/health" })).statusCode, 200);
    assert.equal((await computers.inject({ method: "HEAD", url: "/api/health" })).statusCode, 200);
    // Passed work reaches the computer feature, which refuses a call without the servers' secret.
    const passed = await computers.inject({ method: "POST", url: "/api/internal/computer", payload: { operation: "wake", computerId: "1" } });
    assert.equal(passed.statusCode, 403, passed.body);
    // Its own rclone's call for a Google Drive home's keys reaches the files feature, which refuses a key it never made.
    const drive = await computers.inject({
      method: "POST",
      url: "/api/files/drive-token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "grant_type=refresh_token&refresh_token=none"
    });
    assert.notEqual(drive.statusCode, 404, drive.body);
    for (const [method, url] of [
      ["GET", "/api/session"],
      ["POST", "/api/login"],
      ["GET", "/api/w/any-home/bots"],
      ["GET", "/"],
      ["GET", "/w/any-home"],
      ["GET", "/assets/app.js"]
    ]) {
      assert.equal((await computers.inject({ method, url })).statusCode, 404, `${method} ${url}`);
    }
  } finally {
    await computers.close();
  }
  const web = await createServer({ runtimeEnv, gate: false, role: "web" });
  try {
    assert.equal((await web.inject({ method: "GET", url: "/api/session" })).statusCode, 200);
  } finally {
    await web.close();
  }
});

test("a server doesn't start without its role, or with one there isn't, and says which to give", async () => {
  const saved = Object.fromEntries(Object.keys(settings).map((name) => [name, process.env[name]]));
  Object.assign(process.env, settings);
  try {
    for (const role of [undefined, "", "worker"]) {
      const outcome = await startServer({ host: "127.0.0.1", port: 0, gate: false, ...(role === undefined ? {} : { role }) }).then(
        async (app) => {
          await app.close();
          return "started";
        },
        (error) => error.message
      );
      assert.match(outcome, /^A Mercbot server needs its role: "web" .+ or "computers" .+ serve\(\{ role: "web" \}\)/u, `role ${JSON.stringify(role)}`);
    }
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
