import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { CATALOG, catalogMatch, knownType } from "@local/apps/server/tableCatalog";
import { BOT_PALETTE } from "./botPalette.js";
import { TEAMS_FILE, TEMPLATES_DIR, templateFingerprint } from "./templateResults.js";
import { TAG, TEMPLATE_LIMITS, setupSkillOf, templateProblems } from "../shared/templateBody.js";

// Bot templates (D-43, D-98). Mercbot's library is curated: its templates are files in bot-templates/, one JSON file
// each, written by the Mercbot team and checked end to end with npm run check:templates, whose results
// (bot-templates/checks/results.json) say which are tested (templateResults.js, D-79). Every bot points at one
// template, from the library or its home's own (home_templates), plus its own additions. A template a link opens comes
// from whatever keeps such templates (mercbot.template-links), never listed in the gallery.

// The gallery's job areas, in the order they're shown.
export const CATEGORIES = [
  { id: "family", name: "Home and family" },
  { id: "personal", name: "Personal" },
  { id: "small-business", name: "Small business" },
  { id: "sales", name: "Sales" },
  { id: "marketing", name: "Marketing" },
  { id: "people", name: "Hiring and people" },
  { id: "operations", name: "Operations and finance" },
  { id: "engineering", name: "Engineering and product" },
  { id: "design", name: "Design and writing" }
];
export const TEAM = "the Mercbot team";

// The cloud shapes (D-44), as in botsService.
const SHAPES = [
  "cloud",
  "clover",
  "stratus",
  "tower",
  "wisp",
  "storm",
  "heart",
  "rain",
  "tuft",
  "cluster",
  "lopsided",
  "trefoil",
  "thought",
  "billow",
  "thunderstorm",
  "doublebolt",
  "downpour",
  "drizzle",
  "windy",
  "blower",
  "snow",
  "hail",
  "sleet",
  "fog",
  "rainbow",
  "sunny",
  "night",
  "tornado",
  "mercbot"
];

// A template's setup interview skill, the one its bot runs first and its end-to-end check plays (D-79), and its tag.
export { TAG, setupSkillOf };

/**
 * The connected apps a template's setup needs before it can go on ("Check that GitHub is connected"), by name: its
 * end-to-end check skips it while the check's home can't connect them (D-79).
 */
export function setupNeeds(template) {
  return [...setupSkillOf(template).instructions.matchAll(/^\d+\.\s+Check that ([A-Z][\w ]+?) is connected\b/gmu)].map((match) => match[1]);
}

/**
 * A template file is checked when Mercbot starts, so a broken one never reaches the gallery; the static checks
 * (tests/server/templateChecks.test.js) run it on every file too.
 */
/**
 * What's wrong with a template's `tables` (D-130), each a problem: a shared table's key, or a table of its own whose
 * name no shared table has, whose fields have known types, and whose links point at shared tables, its own tables
 * declared before it, or itself.
 */
function tablesProblems(tables) {
  if (tables === undefined) return [];
  if (!Array.isArray(tables)) return ["tables: shared tables' keys and tables of its own"];
  const problems = [];
  const own = new Set();
  for (const table of tables) {
    if (typeof table === "string") {
      if (!CATALOG.has(table)) problems.push(`tables: "${table}" isn't a shared table`);
      continue;
    }
    const key = String(table?.key || "");
    if (!/^[a-z][a-z0-9_]{0,63}$/u.test(key) || !Array.isArray(table.fields) || !table.fields.length) {
      problems.push(`tables: "${key}" needs a key (a–z, 0–9 and _) and fields`);
      continue;
    }
    const shared = catalogMatch(key) || catalogMatch(table.label);
    if (shared) problems.push(`tables: "${key}" is what the shared table "${shared}" is for: list "${shared}" instead`);
    for (const field of table.fields) {
      if (!knownType(field?.type)) problems.push(`tables: "${key}" field "${field?.key}" has an unknown type`);
      const target = field?.type === "link" ? field.target : null;
      if (target && !CATALOG.has(target) && !own.has(target) && target !== key) {
        problems.push(`tables: "${key}" field "${field.key}" links to "${target}", neither a shared table nor one declared before it`);
      }
    }
    own.add(key);
  }
  return problems;
}

// Records go in the home's tables, never a spreadsheet (D-130): a template may name one only where the person asks for it.
const NAMES_SPREADSHEET = /spreadsheet|\.xlsx|\.xls\b|\.csv|\bexcel\b|\bcsv\b/iu;
const ASKED_FOR = /\basks?\b[^.]{0,40}\b(?:spreadsheet|export|excel|csv)/iu;

/** Each sentence of what a template tells its bot that names a spreadsheet the person didn't ask for, as a problem. */
function spreadsheetProblems(template) {
  const texts = [
    template.description,
    template.greeting,
    template.instructions,
    ...(template.skills || []).flatMap((skill) => [skill.description, skill.instructions]),
    ...(template.routines || []).map((routine) => routine.what)
  ];
  return texts
    .flatMap((text) => String(text || "").split(/[.!?\n]/u))
    .filter((sentence) => NAMES_SPREADSHEET.test(sentence) && !ASKED_FOR.test(sentence))
    .map((sentence) => `keeps records in a spreadsheet ("${sentence.trim().slice(0, 80)}"): keep them in the home's tables`);
}

export function checkTemplate(template, file = template.slug) {
  const problems = [];
  const text = (value, max) => typeof value === "string" && value.trim() && value.length <= max;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(template.slug || "") || template.slug.length > 40) {
    problems.push("slug: lowercase words joined by -");
  }
  // The body's own rules are a home template's too (templateBody.js), with a library description of up to 240
  // characters and any number of skills.
  const body = new Set(templateProblems(template, { description: 240, skills: Infinity }).map(({ field }) => field.split(".")[0]));
  if (body.has("tag")) problems.push("tag: 2 to 10 lowercase letters or digits, starting with a letter");
  if (!text(template.name, 40)) problems.push("name: up to 40 characters");
  if (!BOT_PALETTE.includes(template.color)) problems.push("color: one of the bot palette");
  if (!SHAPES.includes(template.shape)) problems.push("shape: one of the bot shapes");
  if (!CATEGORIES.some((category) => category.id === template.category)) problems.push("category: one of the gallery's");
  if (body.has("description")) problems.push("description: one line of up to 240 characters");
  if (body.has("greeting")) problems.push(`greeting: up to ${TEMPLATE_LIMITS.greeting} characters, greeting {firstName}`);
  if (body.has("instructions")) problems.push(`instructions: up to ${TEMPLATE_LIMITS.instructions.toLocaleString("en")} characters`);
  if (body.has("skills")) problems.push("skills: at least one, each with a name, description and instructions");
  if (body.has("setup")) problems.push("skills: a setup interview");
  if (
    !Array.isArray(template.routines) ||
    template.routines.some((routine) => !text(routine.name, 80) || !text(routine.when, 80) || !text(routine.what, 400))
  ) {
    problems.push("routines: each with a name, when and what");
  }
  if (!Array.isArray(template.apps) || template.apps.some((app) => typeof app !== "string")) problems.push("apps: plugin ids");
  problems.push(...tablesProblems(template.tables));
  problems.push(...spreadsheetProblems(template));
  // What the team changed, newest first (D-98): each bot using it shows the newest change since it started to.
  if (
    "changes" in template &&
    (!Array.isArray(template.changes) ||
      template.changes.some((change) => !/^\d{4}-\d{2}-\d{2}$/u.test(String(change?.date)) || !text(change?.text, 200)) ||
      template.changes.some((change, index) => index && change.date > template.changes[index - 1].date))
  ) {
    problems.push("changes: each with a date (YYYY-MM-DD) and a line of text, newest first");
  }
  // Whether it's tested is its end-to-end check's to say, in the results file (D-79), never the template's own.
  if ("tested" in template) problems.push("tested: kept in bot-templates/checks/results.json, not in the template");
  if (problems.length) throw new Error(`Bot template ${file}: ${problems.join("; ")}`);
  return template;
}

/** The library's template files, by name: every JSON file in bot-templates/ but its teams (D-105). */
export function templateFiles() {
  return readdirSync(TEMPLATES_DIR).filter((file) => file.endsWith(".json") && file !== path.basename(TEAMS_FILE)).sort();
}

function load() {
  const files = templateFiles();
  const templates = files.map((file) => {
    const written = JSON.parse(readFileSync(path.join(TEMPLATES_DIR, file), "utf8"));
    // Its fingerprint ties a check's result to the template as it was then (D-79).
    return checkTemplate({ ...written, creator: TEAM, fingerprint: templateFingerprint(written) }, file);
  });
  const slugs = new Set();
  const tags = new Set([GENERAL.tag]);
  for (const template of templates) {
    if (slugs.has(template.slug)) throw new Error(`Bot template ${template.slug} is listed twice.`);
    if (tags.has(template.tag)) throw new Error(`Bot template ${template.slug}: its tag ${template.tag} is another template's.`);
    slugs.add(template.slug);
    tags.add(template.tag);
  }
  return templates;
}

/**
 * The library's one template that isn't in the gallery (D-98): an all-round helper with no job beyond Mercbot's rules,
 * for a bot made with nothing more in mind (the home's main bot among them). It has no setup interview and no greeting
 * of its own: such a bot starts with its short introduction (onboarding.js).
 */
export const GENERAL = Object.freeze({
  slug: "general",
  tag: "general",
  name: "General helper",
  description: "An all-round helper with no particular job, for whatever you ask.",
  instructions: "You have no particular job: help with whatever the people you work for ask, in everyday life and at work alike.",
  skills: Object.freeze([]),
  creator: TEAM
});

/** The gallery: Mercbot's own templates, the files in bot-templates/. */
export const GALLERY = load();

/** Mercbot's whole library by slug, the gallery and GENERAL: what a bot's `library_template` names. */
export const LIBRARY = new Map([...GALLERY, GENERAL].map((template) => [template.slug, template]));

/**
 * A tag for a home's new template (D-98), from a word or a name: its letters and digits, lowercase, starting with a
 * letter, at most 10; "bot" when that leaves fewer than 2. When `taken` has it (Mercbot's library's tags and the
 * home's), the first free number goes on the end: pantry2, pantry3…
 * @param {string} words
 * @param {Set<string>} taken
 */
export function freeTag(words, taken) {
  const base = String(words || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/gu, "").replace(/^[0-9]+/u, "").slice(0, 10);
  const tag = base.length >= 2 ? base : "bot";
  if (!taken.has(tag)) return tag;
  for (let number = 2; ; number += 1) {
    const candidate = `${tag.slice(0, 10 - String(number).length)}${number}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Mercbot's library's tags, which no home's template takes. */
export const LIBRARY_TAGS = new Set([...LIBRARY.values()].map((template) => template.tag));

/** Text as one line of at most `max` characters, cut at a word with "…" when longer: a home template's description. */
export function oneLine(text, max) {
  const line = String(text || "").replace(/\s+/gu, " ").trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > max / 2 ? cut.slice(0, space) : cut}…`;
}

/**
 * What the gallery lists for each template. `team` marks the Mercbot team's own, which the app says it made and which
 * carry a badge (D-43): a template a link opens (`linked`) never has it, whatever name its creator goes by. `tested` is
 * the day its end-to-end check last passed, or null (D-79).
 */
export const summary = (template) => ({
  slug: template.slug,
  ...(template.tag ? { tag: template.tag } : {}),
  name: template.name,
  color: template.color,
  shape: template.shape,
  category: template.category || null,
  description: template.description,
  creator: template.creator,
  ...(template.linked ? {} : { team: true }),
  ...(template.featured ? { featured: true } : {}),
  tested: template.tested ?? null
});

/**
 * A template's page and the app's preview: everything it gives a bot, in full, so nobody adds a
 * bot without seeing what it will do (D-43). Only its greeting is left for the chat.
 */
export const details = (template, appOf = () => null) => ({
  ...summary(template),
  instructions: template.instructions,
  skills: template.skills.map(({ name, description, instructions }) => ({ name, description, steps: instructions })),
  routines: template.routines,
  // An app with no open-set logo shows its maker's own icon (D-34), as Connect apps does.
  apps: template.apps.map((id) => {
    const app = appOf(id);
    return { id, name: app?.name || id, ...(!app?.logo && app?.logoImage ? { logoImage: app.logoImage } : {}) };
  }),
  ...(template.appTemplate ? { appTemplate: template.appTemplate } : {}),
  ...(template.updatedAt ? { updatedAt: template.updatedAt } : {})
});
