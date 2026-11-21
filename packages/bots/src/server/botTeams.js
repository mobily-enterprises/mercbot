import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { BotsError } from "./botsError.js";
import { lookOf } from "./botList.js";
import { PLAN_LIMITS } from "./botPlans.js";
import { GENERAL, LIBRARY } from "./templates.js";
import { teamById } from "./teams.js";

/**
 * Teams (D-105): the first step towards a home that comes with help. A team is a few of Mercbot's templates for one
 * purpose (teams.js), which the team screen shows with their looks and lines, and Add N bots makes into bots at once,
 * as One bot makes one: the same makeBots, shared as the home's new bots are (D-100), in a section of the person's
 * sidebar named after the team. Add bots' suggestions (D-109) are made the same way, in the section the person names,
 * with the home's templates and new ones beside Mercbot's. A template the home's bots already follow isn't added again.
 * Whoever may add a bot may add a team: anyone in the home (JSKIT refuses everyone else). Every method takes the call's
 * options last.
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
   * the home already has a bot on its template (`inHome`), which Add leaves out, and whether that bot is archived
   * (`archivedInHome`, D-108: unarchiving it brings it back). One read, whatever the home's bots.
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
        const inHome = followed.has(slug);
        const archivedInHome = followed.get(slug) ? { archivedInHome: true } : {};
        return { slug, name, color, shape, tag, description, ...(appTemplate ? { appTemplate } : {}), inHome, ...archivedInHome };
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
   * Makes the bots `entries` name, each `{ choice, look }` (a choice as startOn takes it: `{ library }`, `{ home }` or
   * `{ draft }`), in the person's section `sectionName`: last to first in one transaction through makeBots (the sidebar
   * puts the newest first, so they read there in the order given, the first on top), so either all of them are made or
   * none is, in the same statements however many library bots there are (each new template adds its own). The home is
   * locked meanwhile, so a library template its bots follow, read then, is never added twice (`skipped`); 409 when every
   * one is there already. Each bot opens with its template's greeting; none starts any AI work. Answers the list as the
   * person sees it after, with the new bots' ids (`added`) and their section (`sectionId`).
   */
  async function make(sectionName, entries, displayName, options) {
    const firstName = await templates.firstNameFor(displayName, options);
    // A new template's tag lost to a race runs the whole transaction again.
    return retryLostInsertRace(options, () => store.withTransaction(options, async (txOptions) => {
      await store.lockHome(txOptions);
      const slugs = entries.filter((entry) => entry.choice.library).map((entry) => entry.choice.library);
      const followed = await newBots.followedOf(slugs, txOptions);
      const adding = entries.filter((entry) => !followed.has(entry.choice.library));
      if (!adding.length) {
        throw new BotsError(409, "Every bot you chose is already in this home.", { code: "bots_team_all_in_home" });
      }
      const section = await sectionNamed(sectionName, txOptions);
      const starts = [];
      for (const { choice, look } of adding) {
        starts.push({ ...look, start: await templates.startOn({ choice, botName: look.name, firstName }, txOptions) });
      }
      const made = await botList.makeBots(starts.toReversed(), section.id, txOptions);
      return {
        ...(await botList.listBots(txOptions)),
        added: made.map((bot) => bot.id).toReversed(),
        skipped: slugs.filter((slug) => followed.has(slug)),
        sectionId: String(section.id)
      };
    }));
  }

  /**
   * Add N bots of a team: the team's bots on the templates chosen (slugs of the team's; 400 for none, or for one the
   * team hasn't got), in the team's order, in a section named after it (make). Each takes its template's name and look;
   * Mercbot's own templates are read from the library, with no statement.
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
    const entries = team.templates.filter((slug) => slugs.includes(slug))
      .map((slug) => ({ choice: { library: slug }, look: lookOf(LIBRARY.get(slug)) }));
    return make(team.name, entries, displayName, options);
  }

  /**
   * One bot of a suggestion as Add sends it: `{ library }`, one of Mercbot's (its own name and look), or `{ home }` or
   * `{ draft }`, one of the home's templates or a new one, with the name and look the suggestion gave it (D-109).
   */
  function suggested(bot, index) {
    const given = ["library", "home", "draft"].filter((key) => bot?.[key] !== undefined);
    if (given.length !== 1) {
      throw new BotsError(400, "Each bot needs one template.", { code: "bots_add_template", params: { index } });
    }
    if (bot.library !== undefined) {
      const template = LIBRARY.get(String(bot.library));
      if (!template || template === GENERAL) {
        throw new BotsError(400, "There's no bot template by that name.", { code: "bots_add_template_unknown", params: { index } });
      }
      return { choice: { library: template.slug }, look: lookOf(template) };
    }
    return { choice: bot.home !== undefined ? { home: String(bot.home) } : { draft: bot.draft }, look: lookOf(bot) };
  }

  /**
   * Add N bots of a suggestion (D-109): at most PLAN_LIMITS.bots of them, at most PLAN_LIMITS.new on new templates, each
   * checked whole as Save and use checks one (422 with its problems otherwise), in the section the person named, in the
   * order given (make). A library bot named twice is made once.
   * @param {{ section?: unknown, bots?: unknown }} input
   * @param {string} displayName the person's, for the greetings
   * @param {import("./types.js").CallOptions} options
   */
  async function addBots(input = {}, displayName, options) {
    const sectionName = String(input.section ?? "").trim().slice(0, PLAN_LIMITS.name);
    if (!sectionName) throw new BotsError(400, "Name the section the bots go in.", { code: "bots_add_section" });
    const bots = Array.isArray(input.bots) ? input.bots : [];
    if (!bots.length) throw new BotsError(400, "Choose at least one bot to add.", { code: "bots_add_empty" });
    if (bots.length > PLAN_LIMITS.bots) {
      throw new BotsError(400, `Add at most ${PLAN_LIMITS.bots} bots at once.`, { code: "bots_add_too_many" });
    }
    if (bots.filter((bot) => bot?.draft !== undefined).length > PLAN_LIMITS.new) {
      throw new BotsError(400, `Add at most ${PLAN_LIMITS.new} new templates at once.`, { code: "bots_add_too_many_new" });
    }
    const entries = bots.map(suggested)
      .filter((entry, at, all) => !entry.choice.library || all.findIndex((other) => other.choice.library === entry.choice.library) === at);
    return make(sectionName, entries, displayName, options);
  }

  return Object.freeze({
    teamFor,
    addTeam,
    addBots
  });
}
