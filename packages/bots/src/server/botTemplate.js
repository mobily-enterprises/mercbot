// The template a bot points at (D-98): one of Mercbot's library (bot-templates/ and GENERAL) or one of its home's own
// (home_templates), plus the bot's own additions. A bot changes only its additions, never its template's words, and
// the template wins where they differ; people choose its template (Change template, botTemplates.js).
import { BotsError } from "./botsError.js";
import { LIBRARY } from "./templates.js";

/**
 * The chip a bot shows beside its name (D-98): its template's tag, where the template is from ("library" or "home")
 * and its one-line description; null for a bot with no template yet. A bot read through the bots' repository carries
 * its home template's summary (`home_template`), so this reads nothing.
 * @param {{ library_template?: string | null, home_template_id?: unknown, home_template?: { tag: string, description: string } | null }} row
 */
export function templateChipOf(row) {
  if (row.library_template) {
    const template = LIBRARY.get(row.library_template);
    return template ? { tag: template.tag, source: "library", description: template.description } : null;
  }
  if (row.home_template) return { tag: row.home_template.tag, source: "home", description: row.home_template.description };
  return null;
}

/**
 * The template a bot follows, in full, or null while it has none: from Mercbot's library, or its home's, read through
 * the call's options (so another home's is never one). Its skills are the template's, read with read_skill.
 * @param {{ name: string, library_template?: string | null, home_template_id?: unknown }} row
 * @param {{ find: (id: string, options: object) => Promise<Record<string, any> | null> }} homeTemplates records.homeTemplates
 * @param {object} options the call's options
 */
export async function templateOf(row, homeTemplates, options) {
  if (row.library_template) {
    const template = LIBRARY.get(row.library_template);
    if (!template) throw missing(row, `Mercbot's template ${row.library_template}`);
    return {
      source: "library",
      slug: template.slug,
      tag: template.tag,
      name: template.name,
      description: template.description,
      instructions: template.instructions,
      skills: template.skills,
      greeting: template.greeting || "",
      changes: template.changes || []
    };
  }
  if (row.home_template_id) {
    const template = await homeTemplates.find(String(row.home_template_id), options);
    if (!template) throw missing(row, "its home's template");
    return {
      source: "home",
      id: String(template.id),
      tag: template.tag,
      name: template.tag,
      description: template.description,
      instructions: template.instructions,
      skills: template.skills || [],
      greeting: template.greeting || "",
      createdBy: template.created_by ? String(template.created_by) : null,
      updatedAt: template.updated_at ? new Date(template.updated_at).toISOString() : null
    };
  }
  return null;
}

/**
 * A template's greeting for a person greeted as `first` ("" for no name), from the bot it now runs as: the bot's own
 * name where the template says its own. A template without one has none.
 * @param {{ greeting?: string, name: string }} template
 * @param {string} botName
 * @param {string} first
 */
export function greetingWith(template, botName, first) {
  if (!template.greeting) return "";
  const named = template.greeting.replaceAll(`I'm ${template.name}`, `I'm ${botName}`);
  return first ? named.replaceAll("{firstName}", first) : named.replace(/\s*\{firstName\}/gu, "");
}

const missing = (row, what) =>
  new BotsError(500, `${row.name} points at ${what}, which isn't there.`, { code: "bots_template_missing" });

/**
 * Everything a bot does beyond what every bot knows, as one text (a shared copy's instructions): its template's
 * instructions, then its additions, saying which wins.
 * @param {{ instructions: string } | null} template
 * @param {string} additions
 */
export function wholeInstructions(template, additions) {
  const own = String(additions || "").trim();
  const base = String(template?.instructions || "").trim();
  if (!own) return base;
  if (!base) return own;
  return `${base}\n\nAlso, for this bot (where these differ from the above, the above wins):\n${own}`;
}
