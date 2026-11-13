// npm run check:templates [-- <slug> ...]: every bot template, or the ones named, checked end to end on the real AI
// (D-43, D-79). For each, a new person adds the bot through Mercbot's routes, plays its setup interview with an
// AI-played person, and the check records whether the bot asked its setup questions, created its routines paused and
// sent nothing without a yes, with the date, the app's commit, the fingerprint of how bots behave (D-79) and the
// reasons, in bot-templates/checks/results.json, which the gallery reads at start. Commit that file afterwards. Run it
// after changing how bots behave and before publishing: a result counts only for the fingerprint it ran on.
//
// It needs the two text kinds of AI (D-72): AI_PREMIUM_PROVIDER and AI_PREMIUM_API_KEY, AI_ECONOMY_PROVIDER and
// AI_ECONOMY_API_KEY (development keys, in .env). Without them, or with a live copy's settings, it refuses and writes
// nothing. It runs Mercbot in this process on a fresh copy of the test database (TEST_DB_NAME's template, as the test
// suites do) and a temporary folder for its files, both gone at the end, as a test copy: every send is simulated
// (D-69), and the check hears each one.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sideEffectsAreLive } from "@jskit-ai/kernel/shared/support/sideEffects";
import { loadEnvFile } from "../server/lib/envFile.js";

loadEnvFile();
const { RESULTS_FILE, behaviourFingerprint } = await import("../packages/bots/src/server/templateResults.js");
const check = await import("../tests/support/templateCheck.mjs");

const missing = check.missingAiSettings(process.env);
if (missing.length) {
  console.error(
    `The template check needs the real AI, and ${missing.join(" and ")} aren't set (D-72). Nothing was checked and no ` +
      "result was written. Put the development keys in .env and run npm run check:templates again."
  );
  process.exit(2);
}
if (process.env.NODE_ENV === "production" || sideEffectsAreLive(process.env)) {
  console.error("The template check never runs with a live copy's settings (NODE_ENV=production or SIDE_EFFECTS=live). Nothing was checked.");
  process.exit(2);
}
if (!String(process.env.TEST_DB_NAME || "").trim()) {
  console.error("The template check runs on a copy of the test database: set TEST_DB_NAME. Nothing was checked.");
  process.exit(2);
}

const { GALLERY, setupNeeds } = await import("../packages/bots/src/server/templates.js");
const asked = process.argv.slice(2);
const unknown = asked.filter((slug) => !GALLERY.some((template) => template.slug === slug));
if (unknown.length) {
  console.error(`No template is called ${unknown.join(", ")}. Nothing was checked.`);
  process.exit(2);
}
const chosen = asked.length ? GALLERY.filter((template) => asked.includes(template.slug)) : GALLERY;

// Each text kind answers once before anything else, so a refused key stops the run instead of failing every template.
const { chatModel, generateOnce } = await import("@jskit-ai/agent/server");
const { modelSettings } = await import("../packages/account/src/server/providers/index.js");
for (const [work, kind] of [["chat", "premium"], ["build", "economy"]]) {
  try {
    await generateOnce({ model: chatModel(modelSettings(process.env, work)), system: "Reply with the word OK.", messages: [{ role: "user", content: "Ready?" }], maxOutputTokens: 20 });
  } catch (error) {
    const status = error?.statusCode ?? error?.lastError?.statusCode;
    console.error(`The ${kind} AI didn't answer${status ? ` (status ${status})` : ""}: check its provider and key. Nothing was checked.`);
    process.exit(3);
  }
}

const { copyTestTemplate, dropTestCopies, prepareTestTemplate, testCopyName } = await import("../tests/support/testDatabase.mjs");
const base = { ...process.env };
await prepareTestTemplate(base);
const database = await copyTestTemplate(testCopyName(process.pid, "templates", base), base);
const dataDir = await mkdtemp(path.join(os.tmpdir(), "mercbot-template-check-"));
let app;
const counts = { passed: 0, failed: 0, skipped: 0 };
try {
  Object.assign(process.env, { DB_NAME: database, TEST_DB_NAME: database });
  const { createServer } = await import("../server.js");
  app = await createServer({ runtimeEnv: await check.checkCopyEnv(process.env, { database, dataDir }) });
  const person = await check.signUpPerson(app);
  const players = check.aiPlayers(process.env);
  // How bots behave, worked out once for the whole run, as Mercbot does at start (D-79).
  const run = { commit: check.appCommit(), behaviour: behaviourFingerprint(), models: check.modelsOf(process.env) };
  const file = JSON.parse(await readFile(RESULTS_FILE, "utf8"));
  console.log(`Checking ${chosen.length} template${chosen.length === 1 ? "" : "s"} at ${run.commit}, how bots behave ${run.behaviour}, on ${run.models.premium} (person and judge: ${run.models.economy}).`);
  for (const template of chosen) {
    const needs = setupNeeds(template);
    if (needs.length) {
      console.log(`- ${template.slug} (${template.name}): skipped, its setup needs ${needs.join(" and ")} connected, which the check's home can't have yet. Its result is unchanged.`);
      counts.skipped += 1;
      continue;
    }
    const started = Date.now();
    const result = await check.checkTemplateEndToEnd({ person, template, players, run });
    file.results[template.slug] = result;
    // Written after each template, so a run cut short keeps what it found.
    await writeFile(RESULTS_FILE, `${JSON.stringify(file, null, 2)}\n`);
    const took = `${Math.round((Date.now() - started) / 1000)} s`;
    if (result.passed) {
      counts.passed += 1;
      console.log(`- ${template.slug} (${template.name}): passed, ${result.asked} questions asked, ${result.turns} turns, ${took}.`);
    } else {
      counts.failed += 1;
      console.log(`- ${template.slug} (${template.name}): FAILED, ${result.turns} turns, ${took}:`);
      for (const reason of result.reasons) console.log(`    ${reason}`);
    }
  }
  console.log(`Done: ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped. The results are in ${path.relative(process.cwd(), RESULTS_FILE)}; commit them.`);
} finally {
  await app?.close();
  await rm(dataDir, { recursive: true, force: true });
  await dropTestCopies(process.pid, base);
}
process.exit(counts.failed ? 1 : 0);
