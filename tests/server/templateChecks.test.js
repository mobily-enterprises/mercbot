import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AI_KINDS, WORK } from "../../packages/account/src/server/providers/index.js";
import { templateSummaries } from "../../packages/apps/src/server/templates.js";
import { createBotTemplates } from "../../packages/bots/src/server/botTemplates.js";
import { buildTools } from "../../packages/bots/src/server/botTools.js";
import {
  BEHAVIOUR_SOURCES,
  RESULTS_FILE,
  TEMPLATES_DIR,
  behaviourFingerprint,
  lastCheck,
  missingBehaviourSources,
  readResults,
  resultProblems,
  templateFingerprint,
  testedOn,
  untestedCount
} from "../../packages/bots/src/server/templateResults.js";
import { GALLERY, checkTemplate, setupNeeds, setupSkillOf } from "../../packages/bots/src/server/templates.js";
import { loadCatalogue } from "../../packages/integrations/src/server/catalogue.js";
import { turnDoubles } from "../support/botDoubles.mjs";

// The static checks of every bot template (D-43, D-79): what can be read from a template's file without a model. Its
// schema, the skills and tools it relies on, no personal details, routines created paused, nothing sent without a yes,
// and a setup interview. The end-to-end check (npm run check:templates) plays each one with a real model.

const files = readdirSync(TEMPLATES_DIR).filter((file) => file.endsWith(".json")).sort();
const written = files.map((file) => ({ file, template: JSON.parse(readFileSync(path.join(TEMPLATES_DIR, file), "utf8")) }));

/** Everything a template says: its greeting, job, every skill and every routine. */
const wordsOf = (template) => [
  template.name,
  template.description,
  template.greeting,
  template.instructions,
  ...template.skills.flatMap((skill) => [skill.name, skill.description, skill.instructions]),
  ...template.routines.flatMap((routine) => [routine.name, routine.when, routine.what])
].join("\n");
/** A skill's numbered steps, without their numbers. */
const stepsOf = (skill) => skill.instructions.split("\n").filter((line) => /^\d+\.\s/u.test(line)).map((line) => line.replace(/^\d+\.\s*/u, ""));
const sentencesOf = (text) => text.split(/(?<=[.!?])\s+|\n+/u).filter(Boolean);

test("every template file is a valid template, listed once, with no tested date of its own", () => {
  assert.ok(files.length >= 40, "about 40–60 templates (D-43)");
  assert.equal(GALLERY.length, files.length, "every file reaches the gallery");
  for (const { file, template } of written) {
    assert.doesNotThrow(() => checkTemplate({ ...template, creator: "the Mercbot team" }, file), file);
    assert.equal(`${template.slug}.json`, file, `${file}: named after its slug`);
    assert.equal("tested" in template, false, `${file}: whether it's tested is its check's, in ${path.basename(RESULTS_FILE)}`);
  }
});

test("every template's apps exist and can be connected, and its paired app is a ready-made one", async () => {
  const catalogue = await loadCatalogue();
  const apps = new Map(catalogue.map((entry) => [entry.id, entry]));
  const readyMade = new Set(templateSummaries().map((app) => app.key));
  for (const { file, template } of written) {
    for (const id of template.apps) {
      assert.ok(apps.has(id), `${file}: ${id} is in Connect apps`);
      assert.ok(!apps.get(id).soon, `${file}: ${id} can be connected today`);
    }
    if (template.appTemplate) assert.ok(readyMade.has(template.appTemplate), `${file}: its app ${template.appTemplate} is one of Apps → Templates`);
  }
});

test("every skill a template names is one of its own, and every tool its steps rely on exists", () => {
  const { tools } = buildTools(turnDoubles({ approvals: {}, computer: null, homeId: "1", userId: "7", botId: "3", conversationId: "5" }));
  const offered = new Map(Object.values(tools).map((tool) => [tool.id, tool]));
  // What the templates ask for in plain words, and the tool that does it.
  const needs = [
    [/question card/iu, "ask_with_options"],
    [/\bmemor(?:y|ies)\b/iu, "remember"],
    [/\bas a draft\b/iu, "show_draft"],
    [/\bskill\b/iu, "read_skill"],
    [/\/files\/mine/iu, "list_files"]
  ];
  for (const [, id] of needs) assert.ok(offered.has(id), `the bots have ${id}`);
  // Routines are created paused and started only on a yes.
  assert.ok(offered.get("create_routine").inputSchema.shape.paused, "create_routine can create a routine paused");
  assert.ok(offered.get("update_routine").inputSchema.shape.running, "update_routine can start a paused routine");
  for (const { file, template } of written) {
    const words = wordsOf(template);
    const named = [
      ...[...words.matchAll(/\brun the ([a-z][\w '’-]{2,40}?) skill\b/giu)].map((match) => match[1]),
      ...[...words.matchAll(/\bthe "([^"]{2,60})" skill\b/giu)].map((match) => match[1])
    ];
    for (const name of named) {
      assert.ok(template.skills.some((skill) => skill.name.toLowerCase() === name.toLowerCase()), `${file}: it names the skill "${name}", which it has`);
    }
    for (const [said, id] of needs) if (said.test(words)) assert.ok(offered.has(id), `${file}: ${id}`);
  }
});

const EMAIL = /[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/iu;
const PHONE = /(?:\+\d[\d ().-]{7,}\d|\b\d{3,5}[ .-]\d{3,4}[ .-]\d{3,4}\b)/u;
const HANDLE = /(?:^|[\s(])@[a-z0-9_]{2,}/iu;
const ADDRESS = /\bhttps?:\/\/|\bwww\./iu;

test("no template carries anyone's personal details", () => {
  for (const { file, template } of written) {
    const words = wordsOf(template);
    for (const [pattern, what] of [[EMAIL, "an email address"], [PHONE, "a phone number"], [HANDLE, "an @handle"], [ADDRESS, "a web address"]]) {
      assert.doesNotMatch(words, pattern, `${file}: ${what}`);
    }
    // The person is greeted by their own first name, filled in when the bot is added, or none.
    assert.match(template.greeting, /\{firstName\}/u, `${file}: greets the person by {firstName}`);
    assert.match(template.instructions, /Never greet (?:people|anyone) by (?:any name|a name other than)/iu, `${file}: greets nobody else by name`);
  }
});

test("every routine is created paused and starts only on a yes", () => {
  for (const { file, template } of written) {
    const setup = setupSkillOf(template);
    if (!template.routines.length) {
      assert.doesNotMatch(`${template.instructions}\n${setup.instructions}`, /\bcreate (?:the|a|two|both)\b[^.\n]{0,40}\broutines?\b/iu, `${file}: has no routines, and makes none`);
      continue;
    }
    assert.match(template.instructions, /routines? (?:is|are) created paused during setup, and you start (?:it|them) only when the person says yes/iu, `${file}: its job says routines start paused`);
    assert.match(setup.instructions, /\broutines?\b[^.\n]{0,80}\bpaused\b/iu, `${file}: its setup creates routines paused`);
    assert.match(setup.instructions, /\bask whether to start|start (?:it|them) only if they say yes/iu, `${file}: its setup asks before starting them`);
    for (const routine of template.routines) {
      assert.ok(setup.instructions.includes(`"${routine.name}"`), `${file}: its setup creates "${routine.name}" by that name`);
      assert.match(routine.what, /paused/iu, `${file}: "${routine.name}" says it's created paused`);
      assert.match(routine.what, /when you say yes/iu, `${file}: "${routine.name}" says it starts on a yes`);
    }
  }
});

// Words that send something to someone outside the chat, and words that let it go without the person.
const SENDS = /\b(?:send|sends|sent|email|emails|post|posts|publish|publishes|share|shares|reply|replies|invite|invites|forward|forwards|message|messages|notify|contact|submit|book|pay|order)\b/iu;
const UNASKED = /\b(?:automatically|without (?:asking|checking|a yes|their ok|confirmation|approval)|on your own|by yourself)\b/iu;
const HELD = /\b(?:never|don't|do not|not|nothing|no|only|unless|until|before|wait|ask|asks)\b/iu;

test("nothing in a template tells its bot to send without asking", () => {
  for (const { file, template } of written) {
    // Every template says so in so many words (D-43), one of two ways, whatever else it says about drafts.
    assert.match(template.instructions, /\b(?:ask before anything leaves this chat|nothing leaves this chat without (?:the person's|a) yes)\b/iu, `${file}: asks before anything leaves the chat`);
    for (const sentence of sentencesOf(wordsOf(template))) {
      if (SENDS.test(sentence) && UNASKED.test(sentence)) assert.match(sentence, HELD, `${file}: "${sentence}" lets something go out unasked`);
    }
  }
});

test("every template starts with a setup interview of its own", () => {
  for (const { file, template } of written) {
    const setup = setupSkillOf(template);
    assert.ok(setup, `${file}: has a setup interview skill`);
    assert.match(template.instructions, /\brun the setup interview skill\b/iu, `${file}: its job runs the interview before the first piece of work`);
    const steps = stepsOf(setup);
    assert.ok(steps.length >= 4, `${file}: the interview is written as numbered steps`);
    assert.ok(steps.filter((step) => /^Ask\b/u.test(step)).length >= 2, `${file}: it asks at least two questions`);
    assert.ok(steps.some((step) => /\bmemor(?:y|ies)\b/iu.test(step)), `${file}: it saves the answers as memories`);
    assert.match(template.greeting, /\?/u, `${file}: its greeting offers to start the interview`);
  }
});

test("the results file is well formed and names only Mercbot's templates", () => {
  const results = readResults();
  const slugs = new Set(written.map(({ template }) => template.slug));
  for (const slug of Object.keys(results)) assert.ok(slugs.has(slug), `${slug} is a template`);
});

test("every file the behaviour fingerprint names is there, the chat kind's providers too", () => {
  assert.deepEqual(missingBehaviourSources(), [], "a file that defines how bots behave was moved or renamed: name it again in BEHAVIOUR_SOURCES");
  assert.equal(Object.keys(BEHAVIOUR_SOURCES).length, 5, "the owner's five parts (D-79)");
  // Every provider the chat kind accepts (D-72) has its layer in the list.
  const named = new Set(Object.values(BEHAVIOUR_SOURCES).flat());
  for (const id of Object.keys(AI_KINDS[WORK.chat.kind].types)) {
    assert.ok(named.has(`packages/account/src/server/providers/${id}.js`), `${id}, a provider chats can run on`);
  }
  // A path that isn't there is found: a file, an installed package's folder, or an empty folder.
  const empty = mkdtempSync(path.join(os.tmpdir(), "mercbot-behaviour-"));
  try {
    const fromApp = path.relative(path.dirname(TEMPLATES_DIR), empty);
    const missing = { gone: ["packages/bots/src/server/noSuchRules.js", "@jskit-ai/no-such-agent/src", "@jskit-ai/agent/no-such-folder", fromApp] };
    assert.deepEqual(missingBehaviourSources(missing), missing.gone);
    assert.deepEqual(missingBehaviourSources({ here: ["packages/bots/src/server/botAgent.js", "@jskit-ai/agent/src", "packages/bots/skills"] }), []);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("the behaviour fingerprint follows the content and paths of what it names, and nothing else", () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), "mercbot-behaviour-"));
  try {
    const fromApp = path.relative(path.dirname(TEMPLATES_DIR), folder);
    writeFileSync(path.join(folder, "rules.js"), "export const RULE = 'ask first';\n");
    const file = { rules: [`${fromApp}/rules.js`] };
    const whole = { rules: [fromApp] };
    const first = behaviourFingerprint(file);
    assert.match(first, /^[0-9a-f]{16}$/u);
    assert.equal(behaviourFingerprint(file), first, "the same files, the same fingerprint, whenever and wherever it's worked out");
    assert.equal(behaviourFingerprint({ "another name": file.rules }), first, "the parts' names aren't part of it");
    const folderFirst = behaviourFingerprint(whole);
    writeFileSync(path.join(folder, "rules.js"), "export const RULE = 'ask first, always';\n");
    assert.notEqual(behaviourFingerprint(file), first, "a change to a file changes it");
    assert.notEqual(behaviourFingerprint(whole), folderFirst, "a change to a file in a folder changes it");
    writeFileSync(path.join(folder, "rules.js"), "export const RULE = 'ask first';\n");
    assert.equal(behaviourFingerprint(file), first, "and changing it back gives it back");
    writeFileSync(path.join(folder, "more.js"), "");
    assert.notEqual(behaviourFingerprint(whole), folderFirst, "a file added to a folder changes it");
    rmSync(path.join(folder, "rules.js"));
    assert.notEqual(behaviourFingerprint(file), first, "a missing file counts as missing, without stopping Mercbot");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  assert.match(behaviourFingerprint(), /^[0-9a-f]{16}$/u, "this copy's own");
  assert.equal(behaviourFingerprint(), behaviourFingerprint());
});

test("a template shows as tested only while its newest result passed for it and for how bots behave, as they are now", () => {
  const template = { slug: "plant-care", fingerprint: templateFingerprint({ slug: "plant-care", name: "Fern" }) };
  const behaviour = "0123456789abcdef";
  const passed = { date: "2026-11-12", commit: "abc1234", behaviour, template: template.fingerprint, passed: true, reasons: [] };
  assert.deepEqual(resultProblems(passed), []);
  assert.equal(testedOn(template, { "plant-care": passed }, behaviour), "2026-11-12");
  assert.equal(testedOn(template, {}, behaviour), null, "never checked");
  assert.equal(testedOn(template, { "plant-care": { ...passed, passed: false, reasons: ["It didn't ask about the plants."] } }, behaviour), null, "failed");
  assert.equal(testedOn({ ...template, fingerprint: templateFingerprint({ slug: "plant-care", name: "Fern 2" }) }, { "plant-care": passed }, behaviour), null, "the template changed since");
  assert.equal(testedOn(template, { "plant-care": passed }, "fedcba9876543210"), null, "how bots behave changed since (D-79)");
  // A result from before the fingerprint, under a generation number, is kept and counts for none.
  const older = { date: "2026-11-11", commit: "abc1234", generation: 1, template: template.fingerprint, passed: true, reasons: [] };
  assert.deepEqual(resultProblems(older), []);
  assert.equal(testedOn(template, { "plant-care": older }, behaviour), null);
  // The fingerprint follows what a template says, not how its file is laid out.
  assert.equal(templateFingerprint({ name: "Fern", slug: "plant-care" }), template.fingerprint);
  assert.deepEqual(resultProblems({ ...passed, passed: false, reasons: [] }), ["reasons: why it failed"]);
  assert.ok(resultProblems({ ...passed, template: "abc" }).length);
  assert.deepEqual(resultProblems({ ...passed, behaviour: "a generation" }), ["behaviour: the fingerprint of how bots behaved"]);
});

test("a template's newest check comes with its reasons, and how many aren't tested for how bots behave now", () => {
  const behaviour = "0123456789abcdef";
  const [fern, pantry, never] = [{ slug: "plant-care", fingerprint: "1111111111111111" }, { slug: "weekly-meal-planner", fingerprint: "2222222222222222" }, { slug: "habit-tracker", fingerprint: "3333333333333333" }];
  const reasons = ["It didn't ask: Ask whether the plants are indoors. The judge: The bot never asked it."];
  const results = {
    "plant-care": { date: "2026-11-12", commit: "abc1234", behaviour, template: fern.fingerprint, models: { premium: "together m" }, passed: false, reasons },
    "weekly-meal-planner": { date: "2026-11-10", commit: "abc1234", behaviour: "fedcba9876543210", template: pantry.fingerprint, passed: true, reasons: [] }
  };
  assert.deepEqual(lastCheck(fern, results, behaviour), {
    date: "2026-11-12", commit: "abc1234", models: { premium: "together m" }, passed: false, reasons, sameTemplate: true, sameBehaviour: true
  });
  assert.deepEqual(
    [lastCheck(pantry, results, behaviour).sameBehaviour, lastCheck({ ...fern, fingerprint: "4444444444444444" }, results, behaviour).sameTemplate],
    [false, false],
    "a check from before a change says so"
  );
  assert.equal(lastCheck(never, results, behaviour), null);
  assert.deepEqual(untestedCount([fern, pantry, never], results, behaviour), { total: 3, untested: 3, failed: 1 });
  assert.deepEqual(untestedCount([pantry], results, "fedcba9876543210"), { total: 1, untested: 0, failed: 0 });
  // The check skips templates whose setup needs an app it can't connect yet.
  assert.deepEqual(setupNeeds(GALLERY.find((template) => template.slug === "pull-request-digest")), ["GitHub"]);
  assert.deepEqual(setupNeeds(GALLERY.find((template) => template.slug === "weekly-meal-planner")), []);
});

test("the templates' checks list every team template's newest check; the gallery carries none", () => {
  const templates = createBotTemplates({ records: {}, profiles: {}, integrations: {}, conversations: {}, env: {} });
  const report = templates.templateChecks();
  assert.equal(report.behaviour, behaviourFingerprint(), "this copy's fingerprint, worked out at start");
  assert.equal(report.total, GALLERY.length);
  assert.equal(report.templates.length, GALLERY.length);
  assert.equal(report.untested, report.templates.filter((entry) => !entry.tested).length);
  const digest = report.templates.find((entry) => entry.slug === "pull-request-digest");
  assert.deepEqual([digest.name, digest.needs, "check" in digest], [GALLERY.find((entry) => entry.slug === "pull-request-digest").name, ["GitHub"], true]);
  // People see the badge only: the gallery carries no check.
  assert.ok(templates.templateGallery().templates.every((entry) => !("check" in entry) && !("reasons" in entry)));
});

test("the real check refuses without the AI keys, and writes nothing", () => {
  const before = readFileSync(RESULTS_FILE, "utf8");
  const blank = Object.fromEntries(["AI_PREMIUM_PROVIDER", "AI_PREMIUM_API_KEY", "AI_ECONOMY_PROVIDER", "AI_ECONOMY_API_KEY"].map((name) => [name, ""]));
  const ran = spawnSync(process.execPath, ["scripts/check-templates.mjs"], { env: { ...process.env, ...blank }, encoding: "utf8" });
  assert.equal(ran.status, 2, ran.stderr);
  assert.match(ran.stderr, /needs the real AI, and AI_PREMIUM_PROVIDER and AI_PREMIUM_API_KEY and AI_ECONOMY_PROVIDER and AI_ECONOMY_API_KEY aren't set/u);
  assert.match(ran.stderr, /Nothing was checked and no result was written/u);
  assert.equal(readFileSync(RESULTS_FILE, "utf8"), before);
});

test("the real check refuses a live copy's settings before it asks the AI anything, and writes nothing", () => {
  const before = readFileSync(RESULTS_FILE, "utf8");
  const keys = { AI_PREMIUM_PROVIDER: "together", AI_PREMIUM_API_KEY: "unused", AI_ECONOMY_PROVIDER: "deepinfra", AI_ECONOMY_API_KEY: "unused" };
  for (const live of [{ NODE_ENV: "production" }, { SIDE_EFFECTS: "live" }]) {
    const ran = spawnSync(process.execPath, ["scripts/check-templates.mjs"], { env: { ...process.env, NODE_ENV: "test", SIDE_EFFECTS: "", ...keys, ...live }, encoding: "utf8" });
    assert.equal(ran.status, 2, ran.stderr);
    assert.match(ran.stderr, /never runs with a live copy's settings .* Nothing was checked\./u, JSON.stringify(live));
  }
  assert.equal(readFileSync(RESULTS_FILE, "utf8"), before);
});
