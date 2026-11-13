import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { BOT_PALETTE } from "./botPalette.js";
import { TEMPLATES_DIR, templateFingerprint } from "./templateResults.js";

// Bot templates (D-43). The gallery is curated: Mercbot's own templates are files in
// bot-templates/, one JSON file each, written by the Mercbot team and checked end to end with
// npm run check:templates, whose results (bot-templates/checks/results.json) say which are tested
// (templateResults.js, D-79). A template a link opens comes from whatever keeps such templates
// (mercbot.template-links), never listed in the gallery.

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

/** A template's setup interview skill: the one its bot runs first, and its end-to-end check plays (D-79). */
export const setupSkillOf = (template) => template.skills?.find((skill) => /set ?up|first[- ]run|interview/iu.test(skill.name));

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
export function checkTemplate(template, file = template.slug) {
  const problems = [];
  const text = (value, max) => typeof value === "string" && value.trim() && value.length <= max;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(template.slug || "") || template.slug.length > 40) {
    problems.push("slug: lowercase words joined by -");
  }
  if (!text(template.name, 40)) problems.push("name: up to 40 characters");
  if (!BOT_PALETTE.includes(template.color)) problems.push("color: one of the bot palette");
  if (!SHAPES.includes(template.shape)) problems.push("shape: one of the bot shapes");
  if (!CATEGORIES.some((category) => category.id === template.category)) problems.push("category: one of the gallery's");
  if (!text(template.description, 240)) problems.push("description: up to 240 characters");
  if (!text(template.greeting, 600) || !template.greeting.includes("{firstName}")) {
    problems.push("greeting: up to 600 characters, greeting {firstName}");
  }
  if (!text(template.instructions, 8000)) problems.push("instructions: up to 8,000 characters");
  if (
    !Array.isArray(template.skills) ||
    !template.skills.length ||
    template.skills.some((skill) => !text(skill.name, 60) || !text(skill.description, 160) || !text(skill.instructions, 6000))
  ) {
    problems.push("skills: at least one, each with a name, description and instructions");
  }
  if (!setupSkillOf(template)) problems.push("skills: a setup interview");
  if (
    !Array.isArray(template.routines) ||
    template.routines.some((routine) => !text(routine.name, 80) || !text(routine.when, 80) || !text(routine.what, 400))
  ) {
    problems.push("routines: each with a name, when and what");
  }
  if (!Array.isArray(template.apps) || template.apps.some((app) => typeof app !== "string")) problems.push("apps: plugin ids");
  // Whether it's tested is its end-to-end check's to say, in the results file (D-79), never the template's own.
  if ("tested" in template) problems.push("tested: kept in bot-templates/checks/results.json, not in the template");
  if (problems.length) throw new Error(`Bot template ${file}: ${problems.join("; ")}`);
  return template;
}

function load() {
  const files = readdirSync(TEMPLATES_DIR).filter((file) => file.endsWith(".json")).sort();
  const templates = files.map((file) => {
    const written = JSON.parse(readFileSync(path.join(TEMPLATES_DIR, file), "utf8"));
    // Its fingerprint ties a check's result to the template as it was then (D-79).
    return checkTemplate({ ...written, creator: TEAM, fingerprint: templateFingerprint(written) }, file);
  });
  const slugs = new Set();
  for (const template of templates) {
    if (slugs.has(template.slug)) throw new Error(`Bot template ${template.slug} is listed twice.`);
    slugs.add(template.slug);
  }
  return templates;
}

export const GALLERY = load();

/**
 * What the gallery lists for each template. `team` marks the Mercbot team's own, which the app says it made and which
 * carry a badge (D-43): a template a link opens (`linked`) never has it, whatever name its creator goes by. `tested` is
 * the day its end-to-end check last passed, or null (D-79).
 */
export const summary = (template) => ({
  slug: template.slug,
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
