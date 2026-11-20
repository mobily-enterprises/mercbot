import { botsApi } from "./botsApi.js";

// Teams (D-105) on the page: what the team screen adds and says, the New home form's name for a home made for a team,
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
 * The New home form's name once its purpose changes from team `before` to team `chosen` (null for Something else):
 * the team's name while the name is empty or still the last team's; a name the person typed stays.
 * @param {string} name
 * @param {{ name: string } | null} before
 * @param {{ name: string } | null} chosen
 */
export const nameFor = (name, before, chosen) => (!name.trim() || name === before?.name ? chosen?.name || "" : name);

/**
 * A new home made for a team: every bot of it the home hasn't got, added (the New home form, through
 * pages/w/[workspaceSlug]/index.vue). Answers whether that went through; when it didn't, the team screen lets the
 * person try again.
 * @param {string} teamId
 */
export async function addWholeTeam(teamId) {
  try {
    const team = await botsApi.team(teamId);
    const templates = botsToAdd(team, new Set()).map((bot) => bot.slug);
    if (templates.length) await botsApi.addTeam(teamId, templates);
    return true;
  } catch {
    return false;
  }
}
