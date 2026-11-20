import { BotsError } from "./botsError.js";
import { lookOf } from "./botList.js";
import { LIBRARY } from "./templates.js";
import { teamById } from "./teams.js";

/**
 * Teams (D-105): the first step towards a home that comes with help. A team is a few of Mercbot's templates for one
 * purpose (teams.js), which the team screen shows with their looks and lines, and Add N bots makes into bots at once,
 * as New bot makes one: the same makeBots, shared as the home's new bots are (D-100), in a section of the person's
 * sidebar named after the team. A template the home's bots already follow isn't added again. Whoever may add a bot may
 * add a team: anyone in the home (JSKIT refuses everyone else). Every method takes the call's options last.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records: the home's lock, the person's
 *   sections and the templates its bots follow
 * @param {import("./types.js").BotList} dependencies.botList makeBots, New bot's own way of making bots, and the list
 * @param {import("./types.js").BotTemplates} dependencies.templates what a bot made on a template starts with
 */
export function createBotTeams({ records, botList, templates }) {
  const { conversations: store, newBots } = records;

  /** A team by the id a request names, or 400. */
  function knownTeam(teamId) {
    const team = teamById(String(teamId ?? ""));
    if (!team) throw new BotsError(400, "There's no team by that name.", { code: "bots_team_unknown" });
    return team;
  }

  /**
   * The team screen: the team, and each of its bots in order with its name, look, tag, line and paired app, and whether
   * the home already has a bot on its template (`inHome`), which Add leaves out. One read, whatever the home's bots.
   * @param {string} teamId
   * @param {import("./types.js").CallOptions} options
   */
  async function teamFor(teamId, options) {
    const team = knownTeam(teamId);
    const followed = await newBots.followedOf([...team.templates], options);
    return {
      id: team.id,
      name: team.name,
      description: team.description,
      bots: team.templates.map((slug) => {
        const { name, color, shape, tag, description, appTemplate } = LIBRARY.get(slug);
        return { slug, name, color, shape, tag, description, ...(appTemplate ? { appTemplate } : {}), inHome: followed.has(slug) };
      })
    };
  }

  /**
   * The person's section named after the team, at the end of their sidebar: theirs already, or new.
   * @param {string} name
   * @param {import("./types.js").CallOptions} txOptions
   */
  async function sectionNamed(name, txOptions) {
    const sections = await store.lockSections(txOptions);
    return sections.find((section) => section.name === name) || store.insertSection(name, sections.length, sections, txOptions);
  }

  /**
   * Add N bots: the team's bots on the templates chosen (slugs of the team's; 400 for none, or for one the team hasn't
   * got), in the team's order, made in one transaction through makeBots, so either all of them are made or none is,
   * in the same statements however many there are. The home is locked meanwhile, so a template its bots follow, read
   * then, is never added twice (`skipped`); 409 when every one chosen is there already. Each bot takes its template's
   * name and look and opens with its greeting; none starts any AI work. Answers the list as the person sees it after,
   * with the new bots' ids (`added`) and their section (`sectionId`).
   * @param {string} teamId
   * @param {unknown} chosen
   * @param {string} displayName the person's, for the greetings
   * @param {import("./types.js").CallOptions} options
   */
  async function addTeam(teamId, chosen, displayName, options) {
    const team = knownTeam(teamId);
    const slugs = Array.isArray(chosen) ? [...new Set(chosen.map(String))] : [];
    if (!slugs.length) throw new BotsError(400, "Choose at least one bot to add.", { code: "bots_team_empty" });
    const strange = slugs.find((slug) => !team.templates.includes(slug));
    if (strange) {
      throw new BotsError(400, `${team.name} has no ${strange} bot.`, { code: "bots_team_template_unknown", params: { template: strange } });
    }
    const firstName = await templates.firstNameFor(displayName, options);
    return store.withTransaction(options, async (txOptions) => {
      await store.lockHome(txOptions);
      const followed = await newBots.followedOf(slugs, txOptions);
      const adding = team.templates.filter((slug) => slugs.includes(slug) && !followed.has(slug));
      if (!adding.length) {
        throw new BotsError(409, "Every bot you chose is already in this home.", { code: "bots_team_all_in_home" });
      }
      const section = await sectionNamed(team.name, txOptions);
      // Mercbot's own templates: what each starts with is read from the library, with no statement.
      const entries = [];
      for (const slug of adding) {
        const look = lookOf(LIBRARY.get(slug));
        entries.push({ ...look, start: await templates.startOn({ choice: { library: slug }, botName: look.name, firstName }, txOptions) });
      }
      const made = await botList.makeBots(entries, section.id, txOptions);
      return {
        ...(await botList.listBots(txOptions)),
        added: made.map((bot) => bot.id),
        skipped: slugs.filter((slug) => followed.has(slug)),
        sectionId: String(section.id)
      };
    });
  }

  return Object.freeze({
    teamFor,
    addTeam
  });
}
