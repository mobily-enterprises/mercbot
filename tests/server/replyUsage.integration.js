import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { createServer } from "../../server.js";
import { providerCostNano } from "../../packages/account/src/server/cost.js";
import { startStandInModel } from "../../tools/standInModel.mjs";
import { checkCopyEnv, signUpPerson } from "../support/templateCheck.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";

// A bot's reply, through the routes, on the stand-in model (MERCBOT_TEST_AI_URL, D-83): each of its AI calls is
// recorded for the home, person and bot with what it cost at its provider (D-56, D-73), and however much the home has
// used, the next reply is never refused or paused.
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must be this file's own test database copy: run it in the database suite.");

const settings = Object.freeze({
  ...process.env,
  AUTH_LOCAL_SESSION_SECRET: "reply-usage-test-only-session-secret",
  AI_PREMIUM_PROVIDER: "together",
  AI_PREMIUM_API_KEY: "",
  AI_ECONOMY_PROVIDER: "deepinfra",
  AI_ECONOMY_API_KEY: "",
  AI_IMAGES_PROVIDER: "",
  AI_IMAGES_API_KEY: "",
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: "3001"
});
const REPLY_BOUND_MS = 60_000;

let app;
let standIn;
let dataDir;
let knex;
let person;

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "mercbot-reply-usage-"));
  standIn = await startStandInModel();
  const runtimeEnv = await checkCopyEnv({ ...settings, MERCBOT_TEST_AI_URL: standIn.url }, { database: process.env.DB_NAME, dataDir });
  app = await createServer({ runtimeEnv });
  knex = await connectTestDatabase();
  person = await signUpPerson(app);
});

after(async () => {
  await app?.close();
  await knex?.destroy();
  await standIn?.stop();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

/** Says something to the bot and waits for its reply; the reply's messages. */
async function talk(chat, text) {
  const sent = await person.request("POST", `${chat}/messages`, { json: { text, clientId: randomUUID() } });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const json = { afterMessageId: sent.body.messages.at(-1).id, timeZone: "Europe/London", language: "en" };
  for (const until = Date.now() + REPLY_BOUND_MS; ;) {
    const answer = await person.request("POST", `${chat}/reply`, { json });
    assert.equal(answer.status, 200, JSON.stringify(answer.body));
    if (!answer.body.pending) return answer.body.messages;
    assert.ok(Date.now() < until, "the reply came within a minute");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

test("a bot's reply records what each AI call cost at its provider, and however much the home has used, nothing is refused", async () => {
  const base = `/api/w/${person.home}`;
  const added = await person.request("POST", `${base}/bots/from-template`, { json: { slug: "brand-voice-editor" } });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  const { bot } = added.body;
  const chat = `${base}/bots/${bot.id}`;
  const calls = () => knex("usage_events").where({ bot_id: bot.id }).orderBy("id");

  const first = await talk(chat, "Hello! Our brand is calm, plain and friendly.");
  assert.ok(first.some((message) => message.role === "bot" && message.kind === "text"), "the bot replied");
  const recorded = await calls();
  assert.ok(recorded.length > 0, "its AI calls were recorded");
  for (const call of recorded) {
    const used = { cacheHit: Number(call.cache_hit_tokens), cacheMiss: Number(call.cache_miss_tokens), output: Number(call.output_tokens) };
    assert.equal(call.state, "done");
    const provider = String(call.served_by).split("/")[0];
    assert.ok(["together", "deepinfra"].includes(provider), `served by ${call.served_by}`);
    assert.ok(used.cacheMiss > 0 && used.output > 0, "with the provider's own figures");
    assert.equal(Number(call.cost_nano), providerCostNano(used, provider), "at its provider's cost");
  }
  const homeId = recorded[0].workspace_id;
  const daily = await knex("usage_daily").where({ workspace_id: homeId, bot_id: bot.id }).sum({ cost: "cost_nano" }).first();
  assert.equal(Number(daily.cost), recorded.reduce((total, call) => total + Number(call.cost_nano), 0), "and added to the day's totals");

  // A home that has used a fortune this month: the next reply comes all the same, and Spending has nothing to act on.
  await knex("usage_monthly").insert({ workspace_id: homeId, month: `${new Date().toISOString().slice(0, 7)}-01`, bot_id: 0, user_id: 0, kind: "premium", calls: 1, cost_nano: 1e15 });
  const next = await talk(chat, "Please make this friendlier: Your order has shipped.");
  assert.ok(next.some((message) => message.role === "bot" && message.kind === "text"), "the bot replied again");
  assert.ok((await calls()).length > recorded.length, "and its calls were recorded");
  const usage = await person.request("GET", `${base}/usage`);
  assert.equal(usage.status, 200);
  assert.deepEqual([usage.body.note, usage.body.attention, usage.body.action], [null, false, null]);
  assert.ok(usage.body.monthNano >= 1e15);
});
