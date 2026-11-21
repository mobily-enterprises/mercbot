// Teams (D-105) on the page: what the team screen lists, adds and says.

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

/** The list of teams' first words, in Add bots' ready-made teams. */
export const TEAM_INTRO = "Pick what you need help with. Mercbot adds a few bots that work well together, in their own section of your sidebar.";

/** The headings Add bots lists the teams under (D-109), by what each team is for. */
const TEAM_GROUPS = Object.freeze([
  { for: "home", name: "For home and life" },
  { for: "work", name: "For work" }
]);

/**
 * The teams under their headings, each in the gallery's order; a heading with no team is left out.
 * @param {Array<{ id: string, for: string }>} teams as the gallery lists them
 */
export const teamGroups = (teams) =>
  TEAM_GROUPS.map((group) => ({ ...group, teams: teams.filter((team) => team.for === group.for) })).filter((group) => group.teams.length);
