import assert from "node:assert/strict";
import test from "node:test";
import { appsHome, appsParts, botsOf } from "../support/appsHome.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { connectTestDatabase } from "../support/testDatabase.mjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { createScripts } from "../../packages/apps/src/server/scripts.js";
import { createWatches } from "../../packages/apps/src/server/watches.js";

// Bots and pictures for apps' scripts (D-136), on the test database: only buttons and jobs, only when the app's owners
// allowed them, as the run's person, queued as app jobs for the bots' runner (its own test is appAiWork.test.js), with
// the main bot by default, every limit, a draft's preview queuing nothing, and the Logic tab's list read in one query.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("ai for scripts: allowed apps, buttons and jobs, the main bot, limits, previews, the queue and its list", async (context) => {
  const testKnex = await connectTestDatabase();
  const cleanup = cleanupStack(context);
  cleanup.after(() => testKnex.destroy());
  // The app jobs' row rule is the bots' records' (botsOf's stand-in).
  const home = await appsHome(cleanup, { slug: "apps-ai", knex: testKnex, records: botsOf(testKnex) });
  const { knex, userId, workspaceId, options } = home;
  const bot = async (name, extra = {}) =>
    String((await knex("bots").insert({ workspace_id: workspaceId, made_by: userId, name, color: "#1E86FC", ...extra }).returning("id"))[0].id);
  const otto = await bot("Otto");
  const ida = await bot("Ida");
  const bots = [
    { id: otto, name: "Otto", main: true, archived: false },
    { id: ida, name: "Ida", main: false, archived: false },
    { id: ida, name: "Old", main: false, archived: true }
  ];
  let scripts = null;
  const { resources, repository, registry, gate, apps, systemContext } = appsParts(home, {
    trustMs: Infinity,
    beforeSave: (...args) => scripts.beforeSave(...args),
    beforeSaveEach: (...args) => scripts.beforeSaveEach(...args)
  });
  scripts = createScripts({ resources, repository, systemContext, registry, gate, apps, env: process.env, homeBots: async () => bots });
  const watches = createWatches({ resources, repository, systemContext, registry, gate, apps });
  cleanup.after(() => scripts.close());
  const actor = { type: "person", id: userId, name: "Pat" };
  await registry.createTable(actor, {
    key: "emails",
    fields: [{ key: "subject", type: "text" }, { key: "verdict", type: "longtext" }, { key: "drawing", type: "image" }, { key: "count", type: "number" }]
  }, options);
  await apps.createApp(actor, { name: "Canary" }, options);
  const appId = (await apps.find("canary", options)).id;
  const mail = await gate.create(home.ctx(actor), "emails", { subject: "Server down" });
  const save = async (key, kind, code, extra = {}, expect = null) => {
    const tests = [{ name: "t", input: {}, ai: { bots: [], work: {}, picture: {} }, expect }];
    const saved = await scripts.save(actor, "canary", { key, kind, summary: key, code, tests, ...extra }, options);
    assert.deepEqual(saved.errors, [], key);
  };
  const press = (key, input = {}, reach = null) => scripts.runNamed("action", appId, key, input, { kind: "button" }, reach, options);
  const jobs = () => knex("app_jobs").where({ workspace_id: workspaceId }).orderBy("id");
  const work = (args) => `async function main(input) { await ai.work(${args}); return null }`;
  const one = `{ task: "Is it urgent?", items: [{ record: { table: "emails", id: input.id }, text: "Server down" }], into: "verdict" }`;

  // ---- Only when the app's owners and admins allowed bots and pictures ----
  await save("judge", "action", work(one));
  await assert.rejects(press("judge", { id: mail.id }), /this app may not use bots and pictures/u);
  await knex("apps").where({ id: appId }).update({ connected_access: JSON.stringify(["ai"]) });

  // ---- A button queues a batch for the main bot, as the person who pressed ----
  await press("judge", { id: mail.id });
  const [batch] = await jobs();
  assert.deepEqual(
    [batch.kind, batch.app_id, String(batch.bot_id), String(batch.user_id), batch.status, batch.prompt],
    ["ai_batch", appId, otto, userId, "queued", "Is it urgent?"]
  );
  assert.deepEqual(batch.steps, [{ table: "emails", id: mail.id, text: "Server down", into: "verdict", done: false }]);

  // ---- A named bot, bots(), and every refusal ----
  await save("named", "action", `async function main(input) { const bots = await ai.bots(); return await ai.work({ bot: "ida", task: "t", items: [{ record: { table: "emails", id: input.id }, text: "x" }], into: "verdict" }).then((queued) => ({ bots, bot: queued.bot })) }`, {}, { bots: [] });
  assert.deepEqual(await press("named", { id: mail.id }), { bots: [{ name: "Otto", isMain: true }, { name: "Ida", isMain: false }], bot: "Ida" });
  const refusals = {
    archived: [work(`{ bot: "Old", task: "t", items: [{ record: { table: "emails", id: "1" }, text: "x" }], into: "verdict" }`), /Old is archived/u],
    unknownBot: [work(`{ bot: "Nobody", task: "t", items: [{ record: { table: "emails", id: "1" }, text: "x" }], into: "verdict" }`), /no bot called Nobody/u],
    notText: [work(`{ task: "t", items: [{ record: { table: "emails", id: "1" }, text: "x" }], into: "count" }`), /no text field "count"/u],
    noTable: [work(`{ task: "t", items: [{ record: { table: "nope", id: "1" }, text: "x" }], into: "verdict" }`), /no table "nope"/u],
    tooMany: [work(`{ task: "t", items: Array.from({ length: 101 }, () => ({ record: { table: "emails", id: "1" }, text: "x" })), into: "verdict" }`), /1 to 100/u],
    longText: [work(`{ task: "t", items: [{ record: { table: "emails", id: "1" }, text: "x".repeat(8001) }], into: "verdict" }`), /over 8000 characters/u],
    longTask: [work(`{ task: "t".repeat(2001), items: [{ record: { table: "emails", id: "1" }, text: "x" }], into: "verdict" }`), /1 to 2000 characters/u],
    twice: [`async function main(input) { await ai.work(${one}); await ai.work(${one}); return null }`, /at most 1 ai\.work a run/u],
    pictureField: [`async function main() { await ai.picture({ prompt: "a bird", into: { table: "emails", id: "1", field: "subject" } }); return null }`, /no file or picture field "subject"/u],
    sixPictures: [`async function main() { for (let i = 0; i < 6; i += 1) await ai.picture({ prompt: "a bird", into: { table: "emails", id: "1", field: "drawing" } }); return null }`, /at most 5 ai\.picture a run/u]
  };
  for (const [key, [code, refusal]] of Object.entries(refusals)) {
    await save(key.toLowerCase(), "action", code);
    await assert.rejects(press(key.toLowerCase(), { id: mail.id }), refusal, key);
  }

  // ---- At most three batches of an app at once, counted in the database ----
  // Three are waiting: the first two buttons' and the first of "twice", queued before its second call was refused (as a
  // script's record writes before an error are kept).
  assert.equal((await jobs()).filter((job) => job.kind === "ai_batch").length, 3);
  await assert.rejects(press("judge", { id: mail.id }), /already has 3 batches/u);
  await knex("app_jobs").where({ app_id: appId }).update({ status: "done" });
  await press("judge", { id: mail.id });

  // ---- A picture is queued into a files field ----
  await save("draw", "action", `async function main(input) { return await ai.picture({ prompt: "A yellow canary", into: { table: "emails", id: input.id, field: "drawing" } }) }`, {}, {});
  const drawn = await press("draw", { id: mail.id });
  const picture = (await jobs()).at(-1);
  assert.deepEqual([picture.kind, String(drawn.picture), String(picture.bot_id), picture.steps], ["ai_picture", String(picture.id), otto, [{ table: "emails", id: mail.id, into: "drawing", done: false }]]);

  // ---- A draft's preview queues nothing; a visitor gets nothing; a screen's script has no ai ----
  const before = (await jobs()).length;
  const practice = { simulated: [] };
  assert.equal(await press("judge", { id: mail.id }, { practice }), null);
  assert.deepEqual(practice.simulated, [{ ai: { bot: "Otto", items: 1 }, script: "judge" }]);
  await assert.rejects(press("judge", { id: mail.id }, { visitor: { signedIn: false, email: "" }, access: {} }), /a public app's visitors can't use them/u);
  assert.equal((await jobs()).length, before);
  const screen = await scripts.save(actor, "canary", { key: "peek", kind: "source", summary: "peek", code: "async function main() { return await ai.bots() }", tests: [{ name: "t", input: {}, expect: [] }] }, options);
  assert.match(JSON.stringify(screen.results), /'ai' is not defined/u, "a screen's data never spends on AI");

  // ---- A job queues as its person; once they leave, it can't ----
  await save("nightly", "job", `async function main() { await ai.work({ task: "t", items: [{ record: { table: "emails", id: "${mail.id}" }, text: "x" }], into: "verdict" }); return 1 }`, { settings: { every: "day", at: "07:00", timeZone: "Europe/Rome" }, tests: [{ name: "t", input: {}, ai: { work: {} }, expect: 1 }] });
  await knex("app_jobs").where({ app_id: appId }).update({ status: "done" });
  const job = await knex("app_scripts").where({ workspace_id: workspaceId, key: "nightly" }).first();
  const runJob = async () => {
    await knex("app_scripts").where({ id: job.id }).update({ next_run_at: new Date(Date.now() - 1000) });
    await scripts.runDue({ matchChanges: watches.matchChanges });
    return knex("app_script_runs").where({ script_id: job.id }).orderBy("id", "desc").first();
  };
  assert.equal((await runJob()).ok, true);
  assert.equal(String((await jobs()).at(-1).user_id), userId);
  await scripts.forgetPerson(userId, home.job);
  assert.match((await runJob()).error, /no person to use bots and pictures as/u);

  // ---- The Logic tab's list: the app's newest work, done of total and why it failed, in one read ----
  await knex("app_jobs").where({ id: batch.id }).update({ status: "failed", error: "This home's credit has run out." });
  const listed = await scripts.list("canary", {}, options);
  assert.deepEqual(listed.aiWork.find((entry) => entry.id === String(batch.id)), {
    id: String(batch.id), kind: "ai_batch", title: "Canary: Is it urgent?", status: "failed", done: 0, total: 1,
    error: "This home's credit has run out.", createdAt: listed.aiWork.find((entry) => entry.id === String(batch.id)).createdAt, finishedAt: null
  });
  const reads = async () => (await queriesDuring(knex, () => scripts.list("canary", {}, options), { matching: /from "app_jobs"/u }));
  const few = await reads();
  await knex("app_jobs").insert(Array.from({ length: 40 }, () => ({ workspace_id: workspaceId, app_id: appId, kind: "ai_batch", bot_id: otto, user_id: userId, title: "x", prompt: "x", status: "done", steps: JSON.stringify([]) })));
  assert.equal(await reads(), few, "the same reads however much work the app has had");
  assert.ok((await scripts.list("canary", {}, options)).aiWork.length <= 20);
});
