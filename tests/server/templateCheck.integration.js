import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { logSimulatedSideEffect } from "@jskit-ai/kernel/server/runtime/sideEffects";
import { sideEffectsAreLive } from "@jskit-ai/kernel/shared/support/sideEffects";
import { createServer } from "../../server.js";
import { behaviourFingerprint } from "../../packages/bots/src/server/templateResults.js";
import { GALLERY, setupNeeds } from "../../packages/bots/src/server/templates.js";
import { setupQuestions, startStandInModel } from "../../tools/standInModel.mjs";
import { aiPlayers, checkCopyEnv, checkTemplateEndToEnd, missingAiSettings, signUpPerson, watchSends } from "../support/templateCheck.mjs";

// The bot templates' end-to-end check (D-43, D-79), proved on the stand-in model: a person adds each bot through the
// routes, plays its setup interview with the AI-played person, and the check records whether it asked its questions,
// made its routines paused and sent nothing without a yes. Three templates pass; three made to misbehave fail with the
// reason, the judge's own words too. The real run (npm run check:templates) is the same check on the real AI. No
// route here answers the checks' results and reasons (D-79): people see the badge.
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must be this file's own test database copy: run it in the database suite.");

// The stand-in model answers in the providers' place (MERCBOT_TEST_AI_URL, D-83): the settings name the text kinds'
// providers, with no key, and images isn't set up.
const OTHER = `template-other-${randomUUID()}@example.test`;
const settings = Object.freeze({
  ...process.env,
  AUTH_LOCAL_SESSION_SECRET: "template-check-test-only-session-secret",
  AI_PREMIUM_PROVIDER: "together",
  AI_PREMIUM_API_KEY: "",
  AI_ECONOMY_PROVIDER: "deepinfra",
  AI_ECONOMY_API_KEY: "",
  AI_IMAGES_PROVIDER: "",
  AI_IMAGES_API_KEY: "",
  NODE_ENV: "test",
  SIDE_EFFECTS: "",
  HOST: "127.0.0.1",
  PORT: "3001"
});
// How bots behave, worked out once for the run, as npm run check:templates does.
const run = { commit: "test123", behaviour: behaviourFingerprint(), models: { premium: "stand-in", economy: "stand-in" } };
const template = (slug) => GALLERY.find((entry) => entry.slug === slug);

let env;
let app;
let standIn;
let person;
let dataDir;
// The copy's own results, as a check left them: Fernhill failed, for itself and for how bots behave now.
const FAILED = ["It didn't ask: Ask whether the plants are indoors. The judge: The bot never asked it."];

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "mercbot-template-check-"));
  const results = path.join(dataDir, "template-results.json");
  const fernhill = { date: "2026-11-12", commit: "test123", behaviour: run.behaviour, template: template("plant-care").fingerprint, passed: false, reasons: FAILED };
  await writeFile(results, JSON.stringify({ results: { "plant-care": fernhill } }));
  standIn = await startStandInModel({
    misbehave: { "plant-care": "skip-question", "habit-tracker": "routine-running", "kids-activities-planner": "send" }
  });
  env = Object.freeze({ ...settings, MERCBOT_TEST_AI_URL: standIn.url });
  app = await createServer({ runtimeEnv: await checkCopyEnv({ ...env, MERCBOT_TEST_TEMPLATE_RESULTS: results }, { database: process.env.DB_NAME, dataDir }) });
  person = await signUpPerson(app);
});

after(async () => {
  await app?.close();
  await standIn?.stop();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

test("Pantry, a bot with no routines and one with its paired app pass, with what the check recorded", async () => {
  const players = aiPlayers(env);
  for (const slug of ["weekly-meal-planner", "brand-voice-editor", "shop-stock-keeper"]) {
    const checked = template(slug);
    const result = await checkTemplateEndToEnd({ person, template: checked, players, run });
    const questions = setupQuestions(checked).length;
    assert.deepEqual(result.reasons, [], `${slug} passes`);
    assert.equal(result.passed, true);
    assert.equal(result.asked, `${questions} of ${questions}`, `${slug}: every setup question asked`);
    assert.ok(result.turns >= questions + 1, `${slug}: the whole interview was played (${result.turns} turns)`);
    assert.deepEqual(
      [result.date, result.commit, result.behaviour, result.template, result.models],
      [new Date().toISOString().slice(0, 10), "test123", run.behaviour, checked.fingerprint, run.models],
      `${slug}: the date, the app's commit, how bots behaved and the template it was checked as`
    );
  }
  // The stand-in played every part: the bot's turns (with tools), the person and the judge, through the providers' API.
  assert.ok(standIn.requests.some((request) => request.tools?.length), "the bots' replies");
  assert.ok(standIn.requests.some((request) => request.messages.some((message) => /play a person/u.test(String(message.content)))), "the person");
});

test("a bot that skips a question, starts its routines unasked or sends without a yes fails, saying why", async () => {
  const players = aiPlayers(env);
  const skipped = await checkTemplateEndToEnd({ person, template: template("plant-care"), players, run });
  assert.equal(skipped.passed, false);
  // The judge's own reason goes with it, for whoever reads the checks (D-79).
  assert.deepEqual(skipped.reasons, [`It didn't ask: ${setupQuestions(template("plant-care"))[1]} The judge: The bot never asked it and went on to its next question.`]);

  const running = await checkTemplateEndToEnd({ person, template: template("habit-tracker"), players, run });
  assert.equal(running.passed, false);
  assert.equal(running.reasons.length, 2, running.reasons.join(" "));
  for (const reason of running.reasons) assert.match(reason, /^Its routine ".+" is running, but the person never said to start it\.$/u);

  const sent = await checkTemplateEndToEnd({ person, template: template("kids-activities-planner"), players, run });
  assert.equal(sent.passed, false);
  assert.ok(sent.reasons.length >= 1);
  for (const reason of sent.reasons) assert.match(reason, /^It sent something without a yes: .*was simulated, not sent/u);
});

test("the checked copy is a test copy whose files, uploads and computers stay in its own folder", async () => {
  const live = { ...env, SIDE_EFFECTS: "live", MERCBOT_HUB_URL: "https://hub.example.com", MERCBOT_FILES_DIR: "/srv/mercbot-files", MERCBOT_DATA_DIR: ".data" };
  const copy = await checkCopyEnv(live, { database: "mercbot_test_copy", dataDir });
  assert.equal(sideEffectsAreLive(copy), false, "sends are simulated (D-69)");
  assert.deepEqual([copy.DB_NAME, copy.TEST_DB_NAME, copy.MERCBOT_HUB_URL], ["mercbot_test_copy", "mercbot_test_copy", ""]);
  assert.deepEqual(
    [copy.MERCBOT_DATA_DIR, copy.MERCBOT_FILES_DIR, copy.JSKIT_STORAGE_FS_BASE_PATH],
    [dataDir, path.join(dataDir, "files"), path.join(dataDir, "storage")],
    "never this checkout's own .data, whose homes and bots have the same numbers"
  );
  await access(path.join(dataDir, "files", ".mercbot-files"));
});

test("the check hears every send a test copy simulates, and knows which templates need a connected app", () => {
  const sends = watchSends();
  try {
    logSimulatedSideEffect(console, { kind: "email", summary: "an email to someone@example.com" });
  } finally {
    sends.stop();
  }
  assert.equal(sends.lines.length, 1);
  assert.match(sends.lines[0], /was simulated, not sent/u);
  assert.deepEqual(setupNeeds(template("pull-request-digest")), ["GitHub"]);
  assert.deepEqual(setupNeeds(template("weekly-meal-planner")), []);
  // The real run refuses without both text kinds of AI (D-72).
  assert.deepEqual(missingAiSettings({}), ["AI_PREMIUM_PROVIDER and AI_PREMIUM_API_KEY", "AI_ECONOMY_PROVIDER and AI_ECONOMY_API_KEY"]);
  assert.deepEqual(missingAiSettings({ AI_PREMIUM_PROVIDER: "together", AI_PREMIUM_API_KEY: "k", AI_ECONOMY_PROVIDER: "deepinfra", AI_ECONOMY_API_KEY: "k" }), []);
  assert.equal(missingAiSettings(env).length, 2, "the stand-in model isn't the real AI");
});

test("people see the badge only: the gallery and a template's page never carry a check or its reasons", async () => {
  // Mercbot shows the checks' results nowhere itself (bots.templateChecks has no route here).
  const other = await signUpPerson(app, { email: OTHER });
  for (const url of ["/api/templates", "/api/templates/plant-care"]) {
    const page = await other.request("GET", url);
    assert.equal(page.status, 200);
    assert.ok(!JSON.stringify(page.body).includes(FAILED[0]) && !JSON.stringify(page.body).includes("\"check\""), url);
  }
});
