import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appsHome, botsOf } from "../support/appsHome.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { startShell } from "../support/ownedHandles.mjs";
import { connectTestDatabase, earlierTransactionsEnded } from "../support/testDatabase.mjs";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { shellAvailable } from "../../packages/files/src/server/gvisor.js";

// "Make your own LLM" (D-146): a course written in the template, whose every lesson's checks run on the computer. Its own
// solutions pass every lesson's checks in Python and in JavaScript and its starting code doesn't; and, as a person uses
// the app, a lesson's answer is checked (wrong, then right), a model is trained on a short book with their passed code,
// kept on their record, and answers in their chat. Everything is the real thing but the bots and the meter.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");
const SKIP = shellAvailable(process.env) ? false : "the toolbox isn't installed (npm run tools:install)";

const template = JSON.parse(await readFile(new URL("../../packages/apps/templates/llm_course.json", import.meta.url), "utf8"));
const FILES = template.definition.computer.files;
const STARTERS = JSON.parse(/const STARTERS = (.*);\nconst ORDER/u.exec(template.scripts.find((script) => script.key === "open").code)[1]);
const KEYS = Object.keys(STARTERS);
/** A language's own solution of each lesson: the part of its reference file under the lesson's marker. */
const solutions = (file, marker) => Object.fromEntries(
  FILES[file].split(new RegExp(`^${marker} --- (l\\d\\d) ---\\n`, "mu")).slice(1).reduce((pairs, part, index, parts) => (index % 2 ? pairs : [...pairs, [part, parts[index + 1]]]), [])
);
const LANGUAGES = {
  Python: { ext: "py", check: "python3 course/check.py", solutions: solutions("course/reference.py", "#") },
  JavaScript: { ext: "js", check: "node course/check.js", solutions: solutions("course/reference.js", "//") }
};
const meter = { startComputation: async () => ({ blockSeconds: 600, renew: async () => true, settle: async () => true }) };

for (const [language, { ext, check, solutions: answers }] of Object.entries(LANGUAGES)) {
  test(`every lesson's own solution passes its checks in ${language}, and its starting code doesn't`, { skip: SKIP }, async (context) => {
    const knex = await connectTestDatabase();
    context.after(() => knex.destroy());
    const { shell } = await startShell(knex, context, { store: null, meter });
    assert.deepEqual(Object.keys(answers), KEYS, "a solution for every lesson");
    const files = Object.fromEntries(KEYS.flatMap((key) => [
      [`solution/${key}.${ext}`, (language === "Python" ? "import math\n" : "") + answers[key]],
      [`start/${key}.${ext}`, STARTERS[key][language]]
    ]));
    const command = KEYS.map((key) => [
      `cp solution/${key}.${ext} answer.${ext}; ${check} ${key} > out.txt && echo "${key} solution passes" || { echo "${key} solution fails"; cat out.txt; }`,
      `cp start/${key}.${ext} answer.${ext}; ${check} ${key} > out.txt && echo "${key} start passes" || echo "${key} start fails"`
    ].join("; ")).join("; ");
    const result = await shell.runProgram({ workspaceId: "1", botId: "1", command, files, readOnlyFiles: FILES, seconds: 120 });
    assert.equal(result.output, KEYS.map((key) => `${key} solution passes\n${key} start fails\n`).join(""));
  });
}

const BOOK = [
  "The keeper climbed the steps of the white tower every evening and lit the lamp, and the cat climbed beside her.",
  "The ships saw the light and knew where the rocks were, and the cat sat by the window to watch them come home.",
  "One night the wind blew the match out, so the cat sat in front of the broken glass and the flame stood up bright.",
  "In the morning a fisherman brought a basket of fish, and the keeper said it was the cat who had saved him.",
  "So the light still turns over the sea at night, and a small grey cat still watches the ships by the window."
].join("\n\n");

test("the course in use: a lesson checked wrong then right, a model trained on a book, and a chat with it", { skip: SKIP }, async (context) => {
  const knex = await connectTestDatabase();
  const cleanup = cleanupStack(context);
  cleanup.after(() => knex.destroy());
  let mainBot = null;
  const bots = botsOf(knex);
  const records = { ...bots, directory: { ...bots.directory, homeBotFaces: async () => [{ id: mainBot, name: "Otto", main: true, archived: false }] } };
  const home = await appsHome(cleanup, { slug: "apps-llm", knex, records });
  const { userId, workspaceId, options } = home;
  const { gate, apps, runtime, scripts, watches } = home.apps;
  await knex("workspace_memberships").insert({ workspace_id: workspaceId, user_id: userId, role_sid: "member", status: "active" });
  mainBot = String((await knex("bots").insert({ workspace_id: workspaceId, made_by: userId, name: "Otto", color: "#1E86FC" }).returning("id"))[0].id);
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-llm-"));
  cleanup.after(() => rm(dir, { recursive: true, force: true }));
  const store = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  home.apps.useRecordFiles({
    write: store.writeRecordFile,
    remove: store.removeRecordFile,
    real: async (homeId, virtualPath) => (await store.existingFile(store.homePlace(homeId), virtualPath)).real
  });
  const { shell } = await startShell(knex, cleanup, { store, meter });
  home.apps.useComputer({ available: () => shell.available(), run: (request) => shell.runProgram(request) });

  const actor = { type: "person", id: userId, name: "Pat" };
  const ctx = home.ctx(actor);
  const { app, errors } = await home.apps.installTemplate(ctx, "llm_course", {});
  assert.deepEqual(errors, []);
  await earlierTransactionsEnded(knex);
  await apps.publish(actor, app.slug, {}, options);
  const appId = (await apps.find(app.slug, options)).id;
  const press = (key, input) => scripts.runNamed("action", appId, key, input, { kind: "button" }, null, options);
  const lessons = async () => (await runtime.query(ctx, { slug: app.slug, screen: "course", query: "lessons" })).records;
  const work = async () => {
    for (let round = 0; round < 3; round += 1) {
      await earlierTransactionsEnded(knex);
      await scripts.runDue({ matchChanges: watches.matchChanges });
    }
  };

  // ---- Python: a lesson, wrong and then right ----
  assert.deepEqual(await press("start", { language: "Python" }), { notify: "🐍 Python it is! Lesson 1 is waiting." });
  const opened = await press("open", { lesson: "l10" });
  assert.equal(opened.go.screen, "l10");
  const workId = opened.go.params.work;
  const [learner] = (await gate.read(ctx, "llm_learners", {})).records.map((row) => row.id);
  const fieldsOf = async (table, id) => {
    const tables = await home.apps.registry.loadTables(options);
    const shape = tables.find((entry) => entry.key === table);
    const row = await gate.get(ctx, table, id);
    return Object.fromEntries(shape.fields.filter((field) => !field.obsolete).map((field) => [field.key, row[field.id]]));
  };
  assert.equal((await fieldsOf("llm_work", workId)).code, STARTERS.l10.Python, "a lesson starts from its starting code");
  const wrong = "def vocabulary(text):\n    return list(text)\n\ndef encode(text, vocab):\n    return []\n\ndef decode(ids, vocab):\n    return ''";
  assert.deepEqual(await press("check", { work: workId, code: wrong }), { notify: "0 of 3 checks passed. See below what to fix." });
  const failed = await fieldsOf("llm_work", workId);
  assert.deepEqual([failed.passed, failed.tries, failed.code], [false, 1, wrong]);
  assert.equal(failed.result, [
    "❌ vocabulary(\"hello\") should be ['e', 'h', 'l', 'o'], but it gave ['h', 'e', 'l', 'l', 'o']",
    "❌ encode(\"hello\", [\"e\", \"h\", \"l\", \"o\"]) should be [1, 0, 2, 2, 3], but it gave []",
    "❌ decode([1, 0, 2, 2, 3], [\"e\", \"h\", \"l\", \"o\"]) should be 'hello', but it gave ''",
    "",
    "0 of 3 checks passed."
  ].join("\n"));
  const right = LANGUAGES.Python.solutions.l10.trim();
  assert.deepEqual(await press("check", { work: workId, code: right }), { celebrate: "🎉 Every check passed!" });
  const passed = await fieldsOf("llm_work", workId);
  assert.deepEqual([passed.passed, passed.tries, passed.passed_code], [true, 2, right]);
  assert.equal((await lessons()).find((row) => row.key === "l10").state, "✅ Passed");

  // ---- Its model: a book, trained on the computer with the person's own code, kept on their record ----
  const source = path.join(dir, "lighthouse.txt");
  await writeFile(source, BOOK);
  await gate.attachFile(ctx, "llm_learners", learner, "book", { source, name: "lighthouse.txt", type: "text/plain" });
  await gate.update(ctx, "llm_learners", learner, { status: "Training" });
  await work();
  const trained = await fieldsOf("llm_learners", learner);
  assert.deepEqual([trained.status, trained.model_language, trained.model?.name], ["Ready", "Python", "model.json"]);
  assert.match(trained.note, /^Read 554 characters: 30 different ones, 546 examples\.\nTrained for 1,500 steps in \d+ s: the loss went from \d\.\d\d to \d\.\d\d\.\nIt used your own code from 1 lesson and the course's for the rest\.$/u);
  const model = JSON.parse(await readFile((await gate.recordFile(ctx, "llm_learners", learner, "model")).real, "utf8"));
  assert.deepEqual([model.vocab.length, model.K, model.D, model.E.length, model.Wo.length], [30, 8, 24, 30, 24]);

  // ---- A chat: the person's words and the model's reply, made of the book's characters ----
  assert.deepEqual(await press("reply", { learner, text: "The cat sat by the" }), {});
  const chat = async () => (await runtime.query(ctx, { slug: app.slug, screen: "model", query: "messages", params: { id: learner } })).records;
  const [reply, said] = await chat();
  assert.deepEqual([said.who, said.text, reply.who], ["You", "The cat sat by the", "Model"]);
  assert.ok(reply.text.length > 0 && [...reply.text].every((char) => model.vocab.includes(char)), `a reply in the book's characters: ${reply.text}`);

  // ---- JavaScript: the same model trained and talking in the other language, with the course's code ----
  await press("start", { language: "JavaScript" });
  await gate.update(ctx, "llm_learners", learner, { status: "Training" });
  await work();
  const again = await fieldsOf("llm_learners", learner);
  assert.deepEqual([again.status, again.model_language], ["Ready", "JavaScript"]);
  assert.match(again.note, /^Read 554 characters: 30 different ones, 546 examples\.\nTrained for 1,500 steps in \d+ s: the loss went from \d\.\d\d to \d\.\d\d\.\nIt used the course's code: pass lessons and it uses yours\.$/u);
  await press("reply", { learner, text: "The ships saw" });
  const [answer] = await chat();
  assert.equal(answer.who, "Model");
  assert.ok(answer.text.length > 0 && !answer.text.startsWith("(It couldn't answer"), `a reply: ${answer.text}`);
  assert.deepEqual(await press("clear_chat", {}), { notify: "Your chat is cleared." });
  assert.deepEqual(await chat(), []);
});
