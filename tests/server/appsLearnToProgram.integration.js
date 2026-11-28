import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { appsHome, botsOf } from "../support/appsHome.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { NO_CONNECTED_APPS } from "../support/appsFeatures.mjs";
import { startShell } from "../support/ownedHandles.mjs";
import { connectTestDatabase, earlierTransactionsEnded } from "../support/testDatabase.mjs";
import { createAppAiWork } from "../../packages/bots/src/server/appAiWork.js";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { shellAvailable } from "../../packages/files/src/server/gvisor.js";
import { testServerEnv } from "../support/testEnv.mjs";

// "Learn to program" (D-146), end to end as a person uses it once it's published with AI allowed: a course asked for in
// the person's words is planned by its bot (Coach), each lesson written with a quiz and an exercise, and no lesson opens
// until its solution passes its tests on the computer (one that fails goes back to the bot with what the computer said,
// and is fixed); then the person's answer is checked on the computer, a failure explained by the bot, a pass celebrated.
// Stand-ins: the model and the meter; the computer is the real sandbox.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");
const SKIP = shellAvailable(process.env) ? false : "the toolbox isn't installed (npm run tools:install)";

const PLAN = [
  "COURSE: 🐍 Python from zero",
  "UNIT: 🧱 First steps | Values and functions",
  "LESSON: ✖️ Doubles | write double(n)",
  "LESSON: 👋 Greetings | write greet(name)"
].join("\n");
const lesson = ({ exercise, starter, solution, tests }) => [
  "LESSON", "A function is a named recipe that gives a value back with return.", "", "    def plus_one(n):", "        return n + 1",
  "QUIZ",
  "Q: What does return do?", "A: Gives a value back", "B: Prints it", "C: Stops Python", "D: Nothing", "ANSWER: A", "WHY: return hands the value back.",
  "Q: What is 2 * 3?", "A: 5", "B: 6", "C: 8", "D: 23", "ANSWER: B", "WHY: Two threes are six.",
  "EXERCISE", exercise, "STARTER", "```python", starter, "```", "SOLUTION", solution, "TESTS", tests, "END"
].join("\n");
const DOUBLES = lesson({
  exercise: "Write double(n), which gives back n times 2: double(3) is 6.",
  starter: "def double(n):\n    # give back n times 2\n    return 0",
  solution: "def double(n):\n    return n * 2",
  tests: [
    "from solution import *", "",
    "def test_doubles_three():", "    assert double(3) == 6, \"double(3) should be 6\"", "",
    "def test_doubles_zero():", "    assert double(0) == 0, \"double(0) should be 0\"", "",
    "def test_doubles_a_negative_number():", "    assert double(-4) == -8, \"double(-4) should be -8\""
  ].join("\n")
});
const greetings = (solution) => lesson({
  exercise: "Write greet(name), which gives back \"Hello, \" then the name and \"!\": greet(\"Ada\") is \"Hello, Ada!\".",
  starter: "def greet(name):\n    return \"\"",
  solution,
  tests: ["from solution import *", "", "def test_greets_ada():", "    assert greet(\"Ada\") == \"Hello, Ada!\", 'greet(\"Ada\") should be \"Hello, Ada!\"'"].join("\n")
});
const BROKEN = greetings("def greet(name):\n    return \"Hi \" + name");
const FIXED = greetings("def greet(name):\n    return \"Hello, \" + name + \"!\"");
const EXPLAINED = "Your function gives back n itself, not n times 2. Try multiplying n by 2 before you return it.";

/** The model: a course its plan, a lesson its material (Greetings first broken, then fixed), a failure its explanation. */
function coachModel(prompts) {
  return new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const system = String(prompt[0].content);
      const item = JSON.stringify(prompt.at(-1));
      prompts.push({ system, item });
      let text;
      if (system.includes("Plan a complete, fun programming course")) text = PLAN;
      else if (system.includes("didn't work on the computer")) text = FIXED;
      else if (system.includes("A learner's code didn't pass")) text = EXPLAINED;
      else text = item.includes("This lesson: ✖️ Doubles") ? DOUBLES : BROKEN;
      return { content: [{ type: "text", text }], finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } }, warnings: [] };
    }
  });
}

test("Learn to program: a course written to the person's wishes, every lesson's tests passing on the computer before it opens, an answer checked and explained", { skip: SKIP }, async (context) => {
  const knex = await connectTestDatabase();
  const cleanup = cleanupStack(context);
  cleanup.after(() => knex.destroy());
  const bots = botsOf(knex);
  let mainBot = null;
  let coach = null;
  const appBot = async (slug) => {
    coach ??= String((await knex("bots").insert({ workspace_id: home.workspaceId, made_by: home.userId, name: "Coach", color: "#1E86FC", library_template: slug }).returning("id"))[0].id);
    return { id: coach, name: "Coach" };
  };
  const faces = async () => [{ id: mainBot, name: "Otto", main: true, archived: false }, ...(coach ? [{ id: coach, name: "Coach", main: false, archived: false }] : [])];
  const records = { ...bots, directory: { ...bots.directory, homeBotFaces: faces } };
  const home = await appsHome(cleanup, { slug: "apps-program", knex, records, extras: { inputs: { "mercbot.app-connected": { ...NO_CONNECTED_APPS, appBot } } } });
  const { userId, workspaceId, options } = home;
  const { gate, apps, runtime, scripts, watches, jobs } = home.apps;
  await knex("workspace_memberships").insert({ workspace_id: workspaceId, user_id: userId, role_sid: "member", status: "active" });
  mainBot = String((await knex("bots").insert({ workspace_id: workspaceId, made_by: userId, name: "Otto", color: "#1E86FC" }).returning("id"))[0].id);
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-program-"));
  cleanup.after(() => rm(dir, { recursive: true, force: true }));
  const store = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  const meter = { startComputation: async () => ({ blockSeconds: 600, renew: async () => true, settle: async () => true }) };
  const { programs: computer } = await startShell(knex, cleanup, { store, meter });
  home.apps.useComputer(computer);

  const actor = { type: "person", id: userId, name: "Pat" };
  const ctx = home.ctx(actor);
  const { app, errors } = await home.apps.installTemplate(ctx, "learn_to_program", {});
  assert.deepEqual(errors, []);
  assert.equal(String((await knex("apps").where({ id: app.id }).first()).bot_id), coach, "the app comes with its Coach bot");
  await earlierTransactionsEnded(knex);
  await apps.publish(actor, app.slug, {}, options);
  await knex("apps").where({ id: app.id }).update({ connected_access: JSON.stringify(["ai"]) });

  const prompts = [];
  const runner = createAppAiWork({
    model: coachModel(prompts),
    meter: { track: async (_who, run) => run() },
    records: { bots: { get: async (id) => ({ id, name: "Coach" }) } },
    apps: { gate, jobs },
    files: { media: { checkText: async () => ({ verdict: "allow" }), check: async () => ({ verdict: "allow" }) } },
    env: testServerEnv(),
    systemContext: () => home.systemContext
  });
  const work = async () => {
    for (let round = 0; round < 10; round += 1) {
      await earlierTransactionsEnded(knex);
      await scripts.runDue({ matchChanges: watches.matchChanges });
      const job = await jobs.withTransaction({ context: home.systemContext }, (txOptions) => jobs.claimNext(txOptions, 60));
      if (!job) return;
      assert.equal(String(job.botId), coach, "its AI work is its own bot's");
      await runner.run(job);
      await jobs.finish(job, "done", { context: home.systemContext.forWorkspace(workspaceId) });
    }
  };
  const press = async (screen, at, { params = {}, values = {} } = {}) => (await runtime.action(ctx, { slug: app.slug, screen, path: at, params, values })).effects;
  const query = (screen, name, params = {}) => runtime.query(ctx, { slug: app.slug, screen, query: name, params });
  const rows = async (screen, name, params) => (await query(screen, name, params)).records;
  const record = async (screen, name, params) => (await query(screen, name, params)).record;
  const run = (key, input) => scripts.runNamed("action", (app.id), key, input, { kind: "button" }, null, options);

  // ---- A course in the person's words: planned, written, and every lesson's solution passing its tests ----
  const asked = await press("learn", "content/2/buttons/0/do", { values: { goal: "Make small games", language: "Python", level: "I've never programmed" } });
  assert.deepEqual(asked, [{ celebrate: "Coach is planning your course: it's ready in a few minutes! 🧠" }]);
  const [course] = await rows("learn", "courses");
  await work();
  assert.match(prompts[0].item, /Language: Python\\nWhat I want to learn and do: Make small games\\nHow much I know already: I've never programmed/u);
  const planned = await record("course", "course", { id: course.id });
  assert.deepEqual([planned.title, planned.status, planned.lessons, planned.ready], ["🐍 Python from zero", "Ready", 2, 2]);
  const [doubles, greet] = await rows("course", "lessons", { id: course.id });
  assert.deepEqual([doubles.title, doubles.status, doubles.fixes, greet.title, greet.status, greet.fixes], ["✖️ Doubles", "New", 0, "👋 Greetings", "New", 1]);
  assert.equal(doubles.check, "✅ doubles three\n✅ doubles zero\n✅ doubles a negative number\n\n🎉 3 of 3 tests passed.");
  assert.equal(doubles.starter, "def double(n):\n    # give back n times 2\n    return 0", "its code without the fences");
  const writePrompt = prompts.find((entry) => entry.item.includes("This lesson: ✖️ Doubles"));
  assert.match(writePrompt.item, /TESTS starts with the line: from solution import \*/u, "the bot is told how to write its tests");
  const fixPrompt = prompts.find((entry) => entry.system.includes("didn't work on the computer"));
  assert.match(fixPrompt.item, /The solution didn't pass the tests:\\n❌ greets ada: greet\(\\"Ada\\"\) should be \\"Hello, Ada!\\"\\n\\n0 of 1 tests passed\./u, "a failing lesson goes back with what the computer said");
  assert.equal(greet.solution, "def greet(name):\n    return \"Hello, \" + name + \"!\"", "and comes back fixed");
  assert.deepEqual((await rows("quiz", "answers", { lesson: doubles.id, id: "0" })).length, 0);

  // ---- The person's answer: their own progress from the starting code, checked on the computer ----
  const opened = await run("open", { course: course.id });
  assert.deepEqual(opened.go.screen, "lesson");
  const mine = opened.go.params.mine;
  assert.equal((await record("lesson", "mine", { id: doubles.id, mine })).code, "def double(n):\n    # give back n times 2\n    return 0");
  assert.deepEqual(await run("check", { mine, code: "def double(n):\n    return n" }), { notify: "1 of 3 tests passed. Coach is looking at what went wrong…" });
  await work();
  const [failed] = await rows("lesson", "attempts", { id: doubles.id, mine });
  assert.deepEqual([failed.passed, failed.output, failed.explanation], [
    false,
    "❌ doubles three: double(3) should be 6\n✅ doubles zero\n❌ doubles a negative number: double(-4) should be -8\n\n1 of 3 tests passed.",
    EXPLAINED
  ]);
  assert.match(prompts.at(-1).item, /The exercise: Write double\(n\).*Their code:\\ndef double\(n\):\\n {4}return n/u, "the bot sees the exercise, the code and what the tests said");
  assert.deepEqual(await run("check", { mine, code: "def double(n):\n    return n + n" }), { celebrate: "🎉 Every test passed!" });
  const progress = await record("lesson", "mine", { id: doubles.id, mine });
  assert.deepEqual([progress.done, progress.tries, progress.code], [true, 2, "def double(n):\n    return n + n"]);

  // ---- Its quiz, the person's own answers ----
  const quiz = await run("quiz", { lesson: doubles.id, mine });
  assert.equal(quiz.go.screen, "quiz");
  await run("answer", { question: quiz.go.params.id, pick: "A" });
  const answers = await rows("quiz", "answers", { lesson: doubles.id, id: quiz.go.params.id, mine });
  assert.deepEqual(answers.map((answer) => [answer.picked, answer.correct]), [["A", true]]);
  assert.deepEqual((await run("open", { course: course.id })).go.params.id, greet.id, "Continue opens the next lesson");
});
