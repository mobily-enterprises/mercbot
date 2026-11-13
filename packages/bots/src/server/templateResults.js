import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The bot templates' end-to-end checks (D-43, D-79): what `npm run check:templates` found for each of Mercbot's own
// templates, kept in one committed file and read when Mercbot starts, so the gallery and the preview before Add bot
// can say "Tested <date>" or "Not tested yet" honestly.
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
export const TEMPLATES_DIR = path.join(APP_ROOT, "bot-templates");
export const RESULTS_FILE = path.join(TEMPLATES_DIR, "checks", "results.json");

/**
 * The source that defines how bots behave (D-79), in the owner's five parts. A check's result counts only for the
 * fingerprint of these files it ran on (behaviourFingerprint), so any change to them shows "Not tested yet" until
 * `npm run check:templates` runs again. Each path is a file or a folder (every file in it), from the app's folder, or
 * from an installed package's own folder when it starts with the package's name. A file that comes to define one of
 * these parts is added here; tests/server/templateChecks.test.js fails while a path named here is missing.
 */
export const BEHAVIOUR_SOURCES = Object.freeze({
  // The rules every bot gets, with the list of Mercbot's own skills they include.
  "Mercbot's own rules (instructionsFor)": [
    "packages/bots/src/server/botAgent.js",
    "packages/bots/src/server/skills.js",
    "packages/bots/skills"
  ],
  "The agent loop": ["@jskit-ai/agent/src", "@jskit-ai/agent-runtime/src"],
  // ask_with_options; remember and read_skill; create_routine (paused) and update_routine (running).
  "The setup tools (question cards, memories, skills, routines)": [
    "packages/bots/src/server/cardTools.js",
    "packages/bots/src/server/memoryTools.js",
    "packages/bots/src/server/routineTools.js",
    "packages/bots/src/server/routineSchedule.js"
  ],
  // What needs the person's yes (every action goes through botTools' attempt), mail drafts and sending them.
  "Approvals, drafts and sending": [
    "packages/bots/src/server/approvals.js",
    "packages/bots/src/server/botActions.js",
    "packages/bots/src/server/botTools.js",
    "packages/bots/src/server/draftTools.js",
    "packages/bots/src/server/mailTools.js"
  ],
  // WORK and the kinds of AI, the premium kind's one provider (D-72), and the chat model made from them.
  "The chat kind's provider and model settings": [
    "packages/account/src/server/providers/index.js",
    "packages/account/src/server/providers/together.js",
    "packages/bots/src/server/model.js"
  ]
});

const require = createRequire(import.meta.url);

/** Where a source path is on this machine: in the app's folder, or in the package it starts with, as bots load it. */
function located(source) {
  if (!source.startsWith("@")) return path.join(APP_ROOT, source);
  const [scope, name, ...rest] = source.split("/");
  const own = `${scope}/${name}`;
  const folder = (require.resolve.paths(own) || [])
    .map((base) => path.join(base, own))
    .find((candidate) => existsSync(path.join(candidate, "package.json")));
  return folder ? path.join(folder, ...rest) : null;
}

/** A source path's files, relative to it and in a fixed order: "" for a file itself, or every file in a folder. */
function filesOf(full) {
  if (!statSync(full).isDirectory()) return [""];
  return readdirSync(full, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(full, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

/**
 * The source paths that aren't there: a missing file or package, or an empty folder.
 * @param {Record<string, string[]>} [sources]
 */
export function missingBehaviourSources(sources = BEHAVIOUR_SOURCES) {
  return Object.values(sources).flat().filter((source) => {
    const full = located(source);
    return !full || !existsSync(full) || !filesOf(full).length;
  });
}

/**
 * The fingerprint of how bots behave (D-79): every file BEHAVIOUR_SOURCES names, by its path there and its content, so
 * it's the same on every server running the same release and changes with any change to those files. Mercbot works it
 * out once, at start; a path that's missing counts as missing instead of stopping it.
 * @param {Record<string, string[]>} [sources]
 */
export function behaviourFingerprint(sources = BEHAVIOUR_SOURCES) {
  const hash = createHash("sha256");
  for (const source of Object.values(sources).flat()) {
    const full = located(source);
    if (!full || !existsSync(full)) {
      hash.update(`${source}\0missing\0`);
      continue;
    }
    for (const file of filesOf(full)) {
      hash.update(`${file ? `${source}/${file}` : source}\0`);
      hash.update(readFileSync(path.join(full, file)));
      hash.update("\0");
    }
  }
  return hash.digest("hex").slice(0, 16);
}

/** A value with its object keys sorted, so a template's fingerprint doesn't depend on key order or spacing. */
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  return value;
}

/**
 * A template's fingerprint: its file's content as parsed, so any change to what it says or gives a bot changes it.
 * @param {object} template a template file's JSON, as parsed
 */
export function templateFingerprint(template) {
  return createHash("sha256").update(JSON.stringify(sorted(template))).digest("hex").slice(0, 16);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/u;
const FINGERPRINT = /^[0-9a-f]{16}$/u;

/**
 * What's wrong with one recorded result; empty when it's well formed. A result recorded before the behaviour
 * fingerprint (with a generation instead) is well formed, and counts for no fingerprint.
 * @param {unknown} result
 */
export function resultProblems(result) {
  if (!result || typeof result !== "object") return ["a result is an object"];
  const problems = [];
  if (!DAY.test(String(result.date || ""))) problems.push("date: YYYY-MM-DD");
  if (typeof result.commit !== "string" || !result.commit) problems.push("commit: the app's commit it was checked at");
  if ("behaviour" in result && !FINGERPRINT.test(String(result.behaviour))) problems.push("behaviour: the fingerprint of how bots behaved");
  if (!FINGERPRINT.test(String(result.template || ""))) problems.push("template: the template's fingerprint");
  if (typeof result.passed !== "boolean") problems.push("passed: true or false");
  if (!Array.isArray(result.reasons) || result.reasons.some((reason) => typeof reason !== "string")) problems.push("reasons: a list of sentences");
  if (result.passed === false && !result.reasons?.length) problems.push("reasons: why it failed");
  return problems;
}

/**
 * The recorded results, by template slug; none when the file isn't there. A file that isn't well formed stops
 * startup, naming what's wrong, as a broken template does.
 * @param {string} [file]
 * @returns {Record<string, object>}
 */
export function readResults(file = RESULTS_FILE) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
  const { results = {} } = JSON.parse(text);
  const problems = Object.entries(results).flatMap(([slug, result]) => resultProblems(result).map((problem) => `${slug}: ${problem}`));
  if (problems.length) throw new Error(`The bot templates' results in ${file}: ${problems.join("; ")}`);
  return results;
}

/**
 * The file a copy reads its results from: the committed one, or, outside production, a test copy's own
 * (MERCBOT_TEST_TEMPLATE_RESULTS, which the Test Preview sets).
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
export function resultsFileFor(env) {
  const own = env.NODE_ENV !== "production" && String(env.MERCBOT_TEST_TEMPLATE_RESULTS || "").trim();
  return own || RESULTS_FILE;
}

/**
 * The day a template was last tested end to end, or null for "Not tested yet": only a passing result for the template
 * as it is now (the same fingerprint) and for how bots behave now counts (D-79).
 * @param {{ slug: string, fingerprint: string }} template
 * @param {Record<string, object>} results
 * @param {string} behaviour this copy's behaviourFingerprint()
 * @returns {string | null}
 */
export function testedOn(template, results, behaviour) {
  const result = results[template.slug];
  if (!result?.passed || result.template !== template.fingerprint || result.behaviour !== behaviour) return null;
  return result.date;
}

/**
 * A template's newest check (D-79), as templateChecks() gives it: when it ran, at which commit and on which models,
 * whether it passed and why not (the judge's and the check's reasons), and whether it ran on the template and on how
 * bots behave as they are now. Null when it never ran. People see only the badge.
 * @param {{ slug: string, fingerprint: string }} template
 * @param {Record<string, object>} results
 * @param {string} behaviour this copy's behaviourFingerprint()
 */
export function lastCheck(template, results, behaviour) {
  const result = results[template.slug];
  if (!result) return null;
  return {
    date: result.date,
    commit: result.commit,
    models: result.models ?? null,
    passed: result.passed,
    reasons: result.reasons,
    sameTemplate: result.template === template.fingerprint,
    sameBehaviour: result.behaviour === behaviour
  };
}

/**
 * How many of the Mercbot team's templates show "Not tested yet" for how bots behave now, and how many of those failed
 * their newest check: what `npm test` warns about.
 * @param {{ slug: string, fingerprint: string }[]} templates
 * @param {Record<string, object>} results
 * @param {string} behaviour
 */
export function untestedCount(templates, results, behaviour) {
  const untested = templates.filter((template) => !testedOn(template, results, behaviour));
  const failed = untested.filter((template) => results[template.slug]?.passed === false).length;
  return { total: templates.length, untested: untested.length, failed };
}
