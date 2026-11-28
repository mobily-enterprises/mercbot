import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { appsHome, botsOf } from "../support/appsHome.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { NO_CONNECTED_APPS } from "../support/appsFeatures.mjs";
import { connectTestDatabase, earlierTransactionsEnded } from "../support/testDatabase.mjs";
import { PICTURE } from "../support/browser.mjs";
import { createAppAiWork } from "../../packages/bots/src/server/appAiWork.js";
import { createFileStore } from "../../packages/files/src/server/fileStore.js";
import { testServerEnv } from "../support/testEnv.mjs";

// The Study template (D-143), end to end on the test database, as a person uses it once it's published with AI allowed:
// a book's text file is read in parts the home's main bot summarises, each heading kept by the template's rule; a course
// asked for on the Learn screen is planned from the book, made into units and lessons, each written with its quiz; a
// quiz is taken (a right answer and the finished lesson celebrate); planned again, a lesson that keeps its title keeps
// its progress, a new one is written as New and one left out is put away; and a rewritten lesson starts fresh. Stand-ins:
// the model, the meter, the picture service (globalThis.fetch) and its checks; everything else is the real thing.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

const filler = (topic) => Array.from({ length: 75 }, (_, index) => `${topic} fact ${index + 1} is worth knowing.`).join(" ");
const BOOK = [
  `Chapter 1. Seeds wake up. ${filler("Seed")}`,
  `Chapter 2. Good soil. ${filler("Soil")}`,
  `Chapter 3. Leaves make food. ${filler("Leaf")}`
].join("\n\n");
const HEADINGS = { 1: "Seeds wake up", 2: "Good soil", 3: "Leaves make food" };
const PLAN = [
  "COURSE: 🌱 Plants 101",
  "UNIT: 🌰 Seeds | How seeds start",
  "LESSON: 💧 Water | Why seeds need water | 1",
  "LESSON: ☀️ Light | Why light matters | 3",
  "UNIT: 🍃 Leaves | What leaves do",
  "LESSON: 🍃 Making food | How leaves make food | 3"
].join("\n");
// Planned again: Water stays (its emoji changed), Soil is new, Light is left out.
const REPLAN = [
  "COURSE: 🌱 Plants 101",
  "UNIT: 🌰 Seeds | How seeds start",
  "LESSON: 💦 Water | Why seeds need water | 1",
  "LESSON: 🪱 Soil | What soil gives roots | 2",
  "UNIT: 🍃 Leaves | What leaves do",
  "LESSON: 🍃 Making food | How leaves make food | 3"
].join("\n");
const lessonFor = (title) => [
  `All about ${title}.`,
  "",
  "Plants are amazing.",
  "QUIZ",
  `Q: First question on ${title}?`, "A: Right one", "B: Wrong", "C: Wrong", "D: Wrong", "ANSWER: A", "WHY: Because it is.",
  `Q: Second question on ${title}?`, "A: Wrong", "B: Right one", "C: Wrong", "D: Wrong", "ANSWER: B", "WHY: That's how it works."
].join("\n");

/** The model: a book's part gets its heading and summary, a course its plan, a lesson its text and quiz. */
function studyModel(prompts) {
  return new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const system = String(prompt[0].content);
      const item = JSON.stringify(prompt.at(-1));
      prompts.push({ system, item });
      let text;
      if (system.includes("This is one part of a book")) {
        const part = /Part (\d) of 3/u.exec(item)[1];
        text = `# ${HEADINGS[part]}\nPart ${part} explains it simply.`;
      } else if (system.includes("Plan a complete, fun course")) {
        text = item.includes("What to change this time") ? REPLAN : PLAN;
      } else {
        text = lessonFor(/This lesson: ([^\\]+)/u.exec(item)[1]);
      }
      return { content: [{ type: "text", text }], finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } }, warnings: [] };
    }
  });
}

test("Study: a book read in parts, a course planned from it, a quiz taken, the course changed with progress kept", async (context) => {
  const knex = await connectTestDatabase();
  const cleanup = cleanupStack(context);
  cleanup.after(() => knex.destroy());
  const bots = botsOf(knex);
  let mainBot = null;
  // The bot Study comes with (D-144), as the bots make it the first time: Learner, on its library template.
  let learner = null;
  const appBot = async (slug) => {
    learner ??= String((await knex("bots").insert({ workspace_id: home.workspaceId, made_by: home.userId, name: "Learner", color: "#8F59F9", library_template: slug }).returning("id"))[0].id);
    return { id: learner, name: "Learner" };
  };
  const faces = async () => [{ id: mainBot, name: "Otto", main: true, archived: false }, ...(learner ? [{ id: learner, name: "Learner", main: false, archived: false }] : [])];
  const records = { ...bots, directory: { ...bots.directory, homeBotFaces: faces } };
  // What the app's scripts tell a person in their chat with its bot (D-147): the bots' side, kept to be read.
  const told = [];
  const telling = { members: async () => [home.userId], tellPerson: async (_call, message) => told.push(message) };
  const home = await appsHome(cleanup, { slug: "apps-study", knex, records, extras: { inputs: { "mercbot.app-connected": { ...NO_CONNECTED_APPS, appBot, ...telling } } } });
  const { userId, workspaceId, options } = home;
  const { gate, apps, runtime, scripts, watches, jobs, registry } = home.apps;
  await knex("workspace_memberships").insert({ workspace_id: workspaceId, user_id: userId, role_sid: "member", status: "active" });
  mainBot = String((await knex("bots").insert({ workspace_id: workspaceId, made_by: userId, name: "Otto", color: "#1E86FC" }).returning("id"))[0].id);
  const dir = await mkdtemp(path.join(os.tmpdir(), "mb-study-"));
  cleanup.after(() => rm(dir, { recursive: true, force: true }));
  const store = createFileStore({ root: "", fallback: dir, ownStorage: async () => null, settle: async () => {}, explain: async () => {} });
  home.apps.useRecordFiles({
    write: store.writeRecordFile,
    remove: store.removeRecordFile,
    real: async (homeId, virtualPath) => (await store.existingFile(store.homePlace(homeId), virtualPath)).real
  });
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PICTURE.toString("base64") } }] } }] });
  cleanup.after(() => {
    globalThis.fetch = original;
  });

  // ---- Installed, published, and AI allowed for it by an owner ----
  const actor = { type: "person", id: userId, name: "Pat" };
  const ctx = home.ctx(actor);
  const { app, errors } = await home.apps.installTemplate(ctx, "study", {});
  assert.deepEqual(errors, []);
  assert.equal(String((await knex("apps").where({ id: app.id }).first()).bot_id), learner, "the app comes with its Learner bot");
  // An app made before templates brought bots gets its bot when it's brought up to its template, the home's own Learner.
  await knex("apps").where({ id: app.id }).update({ bot_id: null });
  assert.deepEqual((await home.apps.updateFromTemplate(ctx, app.slug)).errors, []);
  assert.equal(String((await knex("apps").where({ id: app.id }).first()).bot_id), learner, "brought up to its template, it has its bot again");
  assert.equal((await knex("bots").where({ workspace_id: home.workspaceId, name: "Learner" })).length, 1, "the same Learner, never a second");
  // A watching job's cursor starts at the horizon when it's published: after every change made before it.
  await earlierTransactionsEnded(knex);
  await apps.publish(actor, app.slug, {}, options);
  await knex("apps").where({ id: app.id }).update({ connected_access: JSON.stringify(["ai"]) });

  // The bots' runner for the work the scripts queue, and the watches loop that runs the jobs.
  const prompts = [];
  const systemContext = () => home.systemContext;
  const runner = createAppAiWork({
    model: studyModel(prompts),
    meter: { track: async (_who, run) => run() },
    records: { bots: { get: async (id) => ({ id, name: "Otto" }) } },
    apps: { gate, jobs },
    files: { media: { checkText: async () => ({ verdict: "allow" }), check: async () => ({ verdict: "allow" }) } },
    env: { ...testServerEnv(), AI_IMAGES_PROVIDER: "gemini", AI_IMAGES_API_KEY: "test-key" },
    systemContext
  });
  // The watching jobs read changes up to the database server's transaction horizon, which a transaction still open in
  // another test file's database holds back: each round first waits for those to end, so it sees every change made
  // before it, and the work is done when a round finds no job (testDatabase.mjs earlierTransactionsEnded).
  const work = async () => {
    for (let round = 0; round < 6; round += 1) {
      await earlierTransactionsEnded(knex);
      await scripts.runDue({ matchChanges: watches.matchChanges });
      const job = await jobs.withTransaction({ context: home.systemContext }, (txOptions) => jobs.claimNext(txOptions, 60));
      if (!job) return;
      await runner.run(job);
      await jobs.finish(job, "done", { context: home.systemContext.forWorkspace(workspaceId) });
    }
  };
  const press = async (screen, at, { params = {}, values = {} } = {}) =>
    (await runtime.action(ctx, { slug: app.slug, screen, path: at, params, values })).effects;
  const query = (screen, name, params = {}) => runtime.query(ctx, { slug: app.slug, screen, query: name, params });
  const rows = async (screen, name, params) => (await query(screen, name, params)).records;
  const record = async (screen, name, params) => (await query(screen, name, params)).record;

  // ---- A book: added on the shelf, its text file attached, read in parts with a heading and summary each ----
  await press("books", "content/2/buttons/0/do", { values: { title: "Plants for Beginners", author: "Mira Green" } });
  const [book] = await rows("books", "books");
  const source = path.join(dir, "plants.txt");
  await writeFile(source, BOOK);
  await gate.attachFile(ctx, "books", book.id, "file", { source, name: "plants.txt", type: "text/plain" });
  const bookChoices = async () =>
    (await runtime.linkChoices(ctx, { slug: app.slug, version: "live", screen: "learn", path: "content/2", field: "book" })).items.map((item) => item.title);
  assert.deepEqual(await bookChoices(), [], "a book not read yet isn't offered for a course");
  await work();
  assert.deepEqual(await bookChoices(), ["Plants for Beginners"], "once its contents are written, it is");
  const parts = await rows("book", "parts", { id: book.id });
  assert.deepEqual(parts.map((part) => [part.position, part.heading, part.summary]), [
    [1, "Seeds wake up", "Part 1 explains it simply."],
    [2, "Good soil", "Part 2 explains it simply."],
    [3, "Leaves make food", "Part 3 explains it simply."]
  ]);
  assert.ok(parts[0].text.startsWith("Chapter 1. Seeds wake up.") && parts[0].text.endsWith("fact 75 is worth knowing."), "a part is a chapter, cut where a paragraph ends");
  const shelf = await record("book", "book", { id: book.id });
  assert.deepEqual([shelf.contents_status, shelf.parts, shelf.parts_read], ["Reading", 3, 3]);

  // ---- A course: asked for on Learn, planned from the book, made into units and lessons, each written ----
  const asked = await press("learn", "content/2/buttons/0/do", { values: { goal: "How plants grow", book: book.id, level: "Just starting" } });
  assert.deepEqual(asked, [{ celebrate: "Planning your course: it's ready in a minute or two! 🧠" }]);
  const [course] = await rows("learn", "courses");
  await work();
  const planPrompt = prompts.find((entry) => entry.system.includes("Plan a complete, fun course"));
  assert.match(planPrompt.item, /What I want to learn: How plants grow\\nHow much I know already: Just starting\\nThe book \\"Plants for Beginners\\" by Mira Green, part by part:\\n1\. Seeds wake up - Part 1 explains it simply\./u);
  const planned = await record("course", "course", { id: course.id });
  assert.deepEqual([planned.title, planned.status, planned.units, planned.lessons, planned.written], ["🌱 Plants 101", "Ready", 2, 3, 3]);
  const ready = "Your course \"🌱 Plants 101\" is ready: every lesson is written. Open it whenever you like! 🎉";
  assert.deepEqual(told, [{ appId: app.id, title: "Study", botId: learner, userId: home.userId, text: ready }], "its learner hears it once, in their chat with Learner");
  assert.deepEqual([planned.to_write, typeof planned.writing_started], [3, "string"], "the round's lessons to write, and when it started");
  assert.equal(planned.cover?.type, "image/png", "its cover is drawn");
  const units = await rows("course", "units", { id: course.id });
  assert.deepEqual(units.map((unit) => [unit.position, unit.title, unit.about]), [[1, "🌰 Seeds", "How seeds start"], [2, "🍃 Leaves", "What leaves do"]]);
  const seedLessons = await rows("unit", "lessons", { id: units[0].id });
  assert.deepEqual(seedLessons.map((lesson) => [lesson.position, lesson.title, lesson.status, lesson.questions]), [[101, "💧 Water", "New", 2], [102, "☀️ Light", "New", 2]]);
  const water = seedLessons[0];
  assert.equal(water.text, "All about 💧 Water.\n\nPlants are amazing.");
  const waterPrompt = prompts.find((entry) => entry.item.includes("This lesson: 💧 Water"));
  assert.match(waterPrompt.item, /From the book, part 1:\\nChapter 1\. Seeds wake up\./u, "a lesson is written from the book's parts it uses");

  // ---- The quiz: a right answer celebrates, a wrong one doesn't, finishing the lesson celebrates its score ----
  assert.deepEqual(await press("course", "content/6/do", { params: { id: course.id } }), [{ go: { screen: "lesson", params: { id: water.id } } }], "Continue opens the first lesson");
  const [start] = await press("lesson", "content/5/content/0/do", { params: { id: water.id } });
  const quiz = start.go.params;
  assert.deepEqual([start.go.screen, quiz.lesson, (await record("quiz", "q", quiz)).question], ["quiz", water.id, "First question on 💧 Water?"]);
  assert.deepEqual(await press("quiz", "content/3/content/0/do", { params: quiz }), [{ celebrate: "Right! 🎉" }]);
  const [onwards] = await press("quiz", "content/4/content/2/do", { params: quiz });
  const second = onwards.go.params;
  assert.equal((await record("quiz", "q", second)).question, "Second question on 💧 Water?");
  assert.deepEqual(await press("quiz", "content/3/content/0/do", { params: second }), [], "a wrong answer");
  assert.equal((await rows("quiz", "mine", second))[0].answered, 2, "every question answered");
  const finished = await press("quiz", "content/4/content/3/do", { params: second });
  assert.deepEqual(finished, [{ celebrate: "Lesson done! 1 of 2 right ⭐" }, { go: { screen: "lesson", params: { id: water.id } } }]);
  // The person's own progress: the course's totals of it, as the course screen reads them.
  const mineOf = async (id) => {
    const [done] = (await query("course", "done", { id })).totals;
    const [stars] = (await query("course", "stars", { id })).totals;
    return [done?.count ?? 0, stars?.total ?? 0];
  };
  assert.deepEqual(await mineOf(course.id), [1, 1]);
  // The Builder trying the course screen (app_try) reads its progress bars as a percentage, a hidden one marked so.
  assert.deepEqual((await apps.saveDraft(actor, app.slug, (await apps.get(app.slug, {}, options)).definition, "Try it", options)).errors, []);
  const tried = await home.apps.trial.tryScreen(ctx, { slug: app.slug, screen: "course", params: { id: course.id } });
  assert.deepEqual(tried.shown.parts.filter((part) => "progress" in part), [
    { progress: "Step 2 of 2 · ✍️ 3 of 3 lessons written", percent: 100, hidden: true },
    { progress: "Your progress", percent: 33 }
  ]);

  // ---- Planned again: Water keeps its progress, Soil is new, Light is put away ----
  await press("course", "content/8/tabs/1/content/1/buttons/0/do", {
    params: { id: course.id },
    values: { goal: "How plants grow", level: "Just starting", changes: "Teach soil instead of light" }
  });
  await work();
  const replanPrompt = prompts.findLast((entry) => entry.system.includes("Plan a complete, fun course"));
  assert.match(replanPrompt.item, /What to change this time: Teach soil instead of light\\nThe course so far \(keep the exact titles of the lessons that stay\):\\nUNIT: 🌰 Seeds \| How seeds start\\nLESSON: 💧 Water \| Why seeds need water \| 1/u);
  const changed = await rows("unit", "lessons", { id: units[0].id });
  assert.deepEqual(changed.map((lesson) => [lesson.id === water.id, lesson.title, lesson.status]), [[true, "💧 Water", "New"], [false, "🪱 Soil", "New"]]);
  const [kept] = await rows("lesson", "mine", { id: water.id });
  assert.deepEqual([kept.done, kept.stars], [true, 1], "the kept lesson keeps the person's progress");
  const after = await record("course", "course", { id: course.id });
  assert.deepEqual([after.status, after.lessons, after.changes, ...(await mineOf(course.id))], ["Ready", 3, null, 1, 1]);

  // ---- A lesson rewritten starts fresh as New, with a new quiz; the others keep theirs ----
  await press("lesson", "content/6/content/1/buttons/0/do", { params: { id: water.id }, values: { title: "💧 Water", goal: "Why seeds drink", request: "Shorter, please" } });
  await work();
  const rewritten = await record("lesson", "lesson", { id: water.id });
  assert.deepEqual([rewritten.status, rewritten.goal, rewritten.questions, rewritten.request], ["New", "Why seeds drink", 2, null]);
  assert.deepEqual(await rows("lesson", "mine", { id: water.id }), [], "the person's progress in it is put away");
  assert.match(prompts.at(-1).item, /Change this time: Shorter, please/u);
  assert.deepEqual(await mineOf(course.id), [0, 0]);
  // ---- The book is put away from its page: it leaves the shelf at once, and its contents go with it ----
  await press("book", "content/5/content/3/do", { params: { id: book.id } });
  assert.deepEqual(await rows("books", "books"), [], "off the shelf at once");
  await work();
  assert.deepEqual(await rows("book", "parts", { id: book.id }), [], "its contents go with it");
  assert.equal((await gate.read(ctx, "books")).records.length, 0, "the book is put away, not deleted");
  const failed = await knex("app_jobs").where({ app_id: app.id, status: "failed" });
  assert.deepEqual(failed.map((job) => job.error), []);
  const workers = await knex("app_jobs").where({ app_id: app.id }).distinct("bot_id");
  assert.deepEqual(workers.map((job) => String(job.bot_id)), [learner], "every bit of its AI work is its own bot's, never the main bot's");
  const tables = (await registry.loadTables(options)).map((table) => table.key).sort();
  assert.deepEqual(tables, ["book_parts", "books", "study_answers", "study_courses", "study_lessons", "study_progress", "study_questions", "study_units"]);
});

// A course is ready only once every lesson of it is written (D-144): the bot writes them one at a time, and each one in
// sets off make_quiz, which must leave the course writing while others are still to come.
test("Study: a course stays writing until its last lesson is in", async (context) => {
  const knex = await connectTestDatabase();
  const cleanup = cleanupStack(context);
  cleanup.after(() => knex.destroy());
  const home = await appsHome(cleanup, { slug: "apps-study-writing", knex });
  const { userId, options } = home;
  const { gate, apps, scripts, watches } = home.apps;
  const actor = { type: "person", id: userId, name: "Pat" };
  const ctx = home.ctx(actor);
  const { app, errors } = await home.apps.installTemplate(ctx, "study", {});
  assert.deepEqual(errors, []);
  await earlierTransactionsEnded(knex);
  await apps.publish(actor, app.slug, {}, options);
  const course = await gate.create(ctx, "study_courses", { goal: "Plants", status: "Writing", to_write: 2 });
  const unit = await gate.create(ctx, "study_units", { course: course.id, title: "Seeds", position: 1 });
  const lessons = [];
  for (const title of ["Water", "Light"]) lessons.push(await gate.create(ctx, "study_lessons", { course: course.id, unit: unit.id, title, status: "Writing" }));
  const statusOf = async () => {
    const table = (await home.apps.registry.loadTables(options)).find((entry) => entry.key === "study_courses");
    return (await gate.get(ctx, "study_courses", course.id))[table.fields.find((field) => field.key === "status").id];
  };
  const answer = async (lesson) => {
    await gate.update({ ...ctx, actor: { type: "bot", id: "1", name: "Learner" } }, "study_lessons", lesson.id, { material: `About ${lesson.id}.\nQUIZ\nQ: Why?\nA: a\nB: b\nC: c\nD: d\nANSWER: A\nWHY: So.` });
    await earlierTransactionsEnded(knex);
    await scripts.runDue({ matchChanges: watches.matchChanges });
  };
  await answer(lessons[0]);
  assert.equal(await statusOf(), "Writing", "one of two lessons written");
  await answer(lessons[1]);
  assert.equal(await statusOf(), "Ready");
});

// Each person's own progress (D-145): two people on one course each see only their own answers, stars, lessons done,
// what's next and retakes, though the course, its lessons and questions are everyone's; a lesson written again starts
// fresh for both.
test("Study: two people on one course each see only their own answers and progress", async (context) => {
  const knex = await connectTestDatabase();
  const cleanup = cleanupStack(context);
  cleanup.after(() => knex.destroy());
  const home = await appsHome(cleanup, { slug: "apps-study-two", knex });
  const { userId, workspaceId, options } = home;
  const { gate, apps, runtime, scripts, watches } = home.apps;
  const sam = String((await knex("users").orderBy("id").offset(1).first()).id);
  await knex("workspace_memberships").insert([
    { workspace_id: workspaceId, user_id: userId, role_sid: "member", status: "active" },
    { workspace_id: workspaceId, user_id: sam, role_sid: "member", status: "active" }
  ]);
  const pat = home.ctx({ type: "person", id: userId, name: "Pat" });
  const samCtx = { options: home.memberOptions(sam, home.workspace), actor: { type: "person", id: sam, name: "Sam" }, via: { kind: "data" } };
  const { app, errors } = await home.apps.installTemplate(pat, "study", { sample: true });
  assert.deepEqual(errors, []);
  await earlierTransactionsEnded(knex);
  await apps.publish(pat.actor, app.slug, {}, options);
  const as = (who) => ({
    press: async (screen, at, params) => (await runtime.action(who, { slug: app.slug, screen, path: at, params, values: {} })).effects,
    rows: async (screen, name, params) => (await runtime.query(who, { slug: app.slug, screen, query: name, params })).records,
    groups: async (screen, name, params) => (await runtime.query(who, { slug: app.slug, screen, query: name, params })).totals
  });
  const [P, S] = [as(pat), as(samCtx)];
  const [course] = await P.rows("learn", "courses");
  const lessons = await P.rows("course", "lessons", { id: course.id });
  const water = lessons[0];
  const [first, second] = await P.rows("lesson", "questions", { id: water.id });

  // Pat answers both (one right, one wrong) and finishes the lesson; Sam answers the first wrong.
  const choose = (who, question, letter) => who.press("quiz", `content/3/content/${"ABCD".indexOf(letter)}/do`, { lesson: water.id, id: question.id });
  assert.deepEqual(await choose(P, first, first.answer), [{ celebrate: "Right! 🎉" }]);
  await choose(P, second, second.answer === "A" ? "B" : "A");
  assert.deepEqual(await P.press("quiz", "content/4/content/3/do", { lesson: water.id, id: second.id }),
    [{ celebrate: "Lesson done! 1 of 2 right ⭐" }, { go: { screen: "lesson", params: { id: water.id } } }]);
  await choose(S, first, first.answer === "A" ? "B" : "A");

  const answerTo = async (who, question) => (await who.rows("quiz", "answer", { lesson: water.id, id: question.id })).map((row) => row.correct);
  assert.deepEqual([await answerTo(P, first), await answerTo(S, first), await answerTo(S, second)], [[true], [false], []], "each sees only their own answers");
  const progressOf = async (who) => (await who.rows("lesson", "mine", { id: water.id })).map((row) => [row.done, row.answered, row.stars]);
  assert.deepEqual([await progressOf(P), await progressOf(S)], [[[true, 2, 1]], [[false, 1, 0]]]);
  const doneOf = async (who) => (await who.groups("course", "done", { id: course.id })).map((group) => group.count);
  assert.deepEqual([await doneOf(P), await doneOf(S)], [[1], []], "lessons done are each person's");
  const next = async (who) => (await who.press("course", "content/6/do", { id: course.id }))[0].go.params.id;
  assert.deepEqual([await next(P), await next(S)], [lessons[1].id, water.id], "Continue is each person's next lesson");

  // Pat takes the quiz again: only Pat's answers go.
  await P.press("lesson", "content/5/content/1/do", { id: water.id });
  assert.deepEqual([await answerTo(P, first), await answerTo(S, first)], [[], [false]]);

  // The lesson is written again: it starts fresh for both.
  const tables = await home.apps.registry.loadTables(options);
  const field = (key) => tables.find((table) => table.key === "study_lessons").fields.find((entry) => entry.key === key).id;
  await gate.update(pat, "study_lessons", water.id, { [field("status")]: "Writing", [field("material")]: "" });
  await gate.update({ ...pat, actor: { type: "bot", id: "1", name: "Learner" } }, "study_lessons", water.id, { material: "Again.\nQUIZ\nQ: Why?\nA: a\nB: b\nC: c\nD: d\nANSWER: A\nWHY: So." });
  await earlierTransactionsEnded(knex);
  await scripts.runDue({ matchChanges: watches.matchChanges });
  assert.deepEqual([await progressOf(P), await progressOf(S)], [[], []]);
});
