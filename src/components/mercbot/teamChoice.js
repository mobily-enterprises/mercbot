import { appsApi } from "../apps/appsApi.js";
import { botsApi } from "./botsApi.js";

// Teams (D-105) on the page: what the team screen adds and says, New home's name and action for a home made for a team,
// and that home's bots, added with it.

/**
 * The team screen's bots Add makes: those the home hasn't got on their template that are still ticked, in the team's
 * order.
 * @param {{ bots: Array<{ slug: string, inHome: boolean }> } | null} team as GET /teams/:teamId answers it
 * @param {Set<string>} unticked the slugs the person unticked
 */
export const botsToAdd = (team, unticked) => (team?.bots || []).filter((bot) => !bot.inHome && !unticked.has(bot.slug));

/** The Add button's words: "Add 1 bot", "Add 6 bots", or "Adding…" while it works. */
export const addLabel = (count, busy) => (busy ? "Adding…" : `Add ${count} ${count === 1 ? "bot" : "bots"}`);

/**
 * The apps set up with the bots added, as New bot sets up a template's (only for someone who may: `apps` is empty
 * otherwise): each added bot's app the person left ticked, each app once, where the first bot wanting it comes.
 * @param {Array<{ slug: string, appTemplate?: string }>} adding
 * @param {Map<string, { key: string, name: string }>} apps the home's app templates, by key
 * @param {Set<string>} withoutApp the bots whose app the person unticked
 */
export function appsFor(adding, apps, withoutApp) {
  const wanted = adding.filter((bot) => !withoutApp.has(bot.slug) && apps.has(bot.appTemplate)).map((bot) => apps.get(bot.appTemplate));
  return [...new Map(wanted.map((app) => [app.key, app])).values()];
}

/**
 * New home's name once its purpose changes from team `before` to team `chosen` (null for Something else):
 * the team's name while the name is empty or still the last team's; a name the person typed stays.
 * @param {string} name
 * @param {{ name: string } | null} before
 * @param {{ name: string } | null} chosen
 */
export const nameFor = (name, before, chosen) => (!name.trim() || name === before?.name ? chosen?.name || "" : name);

/** The list of teams' first words, in New home and Add a team alike. */
export const TEAM_INTRO = "Pick what you need help with. Mercbot adds a few bots that work well together, in their own section of your sidebar.";

/** New home's action for a team: "Create home with 6 bots", following the ticks, or "Creating…" while it works. */
export const newHomeLabel = (count, busy) => (busy ? "Creating…" : `Create home with ${count} ${count === 1 ? "bot" : "bots"}`);

/**
 * The new home's address for the team chosen in New home: the team, its bots ticked and the apps asked for, which the
 * home's first load adds (pages/w/[workspaceSlug]/index.vue, addChosenBots).
 * @param {{ teamId: string, templates: string[], apps: Array<{ key: string }> }} choice
 */
export function homeQuery({ teamId, templates, apps }) {
  return { team: teamId, bots: templates.join(","), ...(apps.length ? { apps: apps.map((app) => app.key).join(",") } : {}) };
}

/**
 * The choice an address carries (homeQuery), or null when it names no bots: a ?team= alone opens the team screen.
 * @param {Record<string, unknown>} query
 */
export function choiceOf(query) {
  const listed = (value) => (typeof value === "string" ? value.split(",").filter(Boolean) : []);
  const templates = listed(query.bots);
  return query.team && templates.length ? { teamId: String(query.team), templates, apps: listed(query.apps) } : null;
}

/**
 * A new home made for a team: the bots chosen in New home, added in the home the page is in, then the apps asked for,
 * as drafts. Answers whether the bots went through (when they didn't, the team screen lets the person try again) and
 * the apps that couldn't be set up.
 * @param {{ teamId: string, templates: string[], apps: string[] }} choice
 */
export async function addChosenBots({ teamId, templates, apps }) {
  try {
    await botsApi.addTeam(teamId, templates);
  } catch {
    return { added: false, appsFailed: [] };
  }
  const appsFailed = [];
  for (const key of apps) await appsApi.installTemplate(key, false).catch(() => appsFailed.push(key));
  return { added: true, appsFailed };
}
