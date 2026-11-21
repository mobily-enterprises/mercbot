import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { BotsError } from "./botsError.js";
import { lookOf } from "./botList.js";
import { PLAN_LIMITS } from "./botPlans.js";
import { GENERAL, LIBRARY } from "./templates.js";
import { teamById } from "./teams.js";
import { createCallerReaders } from "./records/recordRows.js";

/**
 * Teams (D-105): the first step towards a home that comes with help. A team is a few of Mercbot's templates for one
 * purpose (teams.js), which the team screen shows with their looks and lines, and Add N bots makes into bots at once,
 * as One bot makes one: the same makeBots. Add bots' suggestions (D-109) are made the same way, with the home's
 * templates and new ones beside Mercbot's. A template the home's bots already follow isn't added again. The bots join
 * the home (D-112): they're on Team and open no chats of their own; the main bot introduces them in the person's
 * welcome chat, with a [Message] for each. Whoever may add a bot may add a team: anyone in the home (JSKIT refuses
 * everyone else). Every method takes the call's options last.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records: the home's lock and the templates
 *   its bots follow
 * @param {import("./botList.js").BotList} dependencies.botList makeBots, New bot's own way of
 *   making bots, the Team list, and the home told
 * @param {{ startOn: Function }} dependencies.templates what a bot made on a template starts with (botTemplates.js)
 * @param {{ introduce: (bots: object[], txOptions: object) => Promise<string | null> }} dependencies.onboarding the main
 *   bot's introduction of new bots in the welcome chat (onboarding.js)
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 */
export function createBotTeams({ records, botList, templates, onboarding, notices }) {
  const { bots, chats, newBots } = records;
  const { personOf } = createCallerReaders();

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
   * Makes the bots `entries` name, each `{ choice, look }` (a choice as startOn takes it: `{ library }`, `{ home }` or
   * `{ draft }`), in the order given, in one transaction through makeBots, so either all of them are made or none is, in
   * the same statements however many library bots there are (each new template adds its own). The home is locked
   * meanwhile, so a library template its bots follow, read then, is never added twice (`skipped`); 409 when every one
   * is there already. None starts any AI work; each greets with its template's greeting when someone first opens a
   * chat with it. Answers the Team list after, the new bots' ids (`added`) and the welcome chat that introduces them
   * (`chatId`).
   */
  async function make(entries, options) {
    // A new template's tag lost to a race runs the whole transaction again.
    const done = await retryLostInsertRace(options, () => chats.withTransaction(options, async (txOptions) => {
      await bots.lockHome(txOptions);
      const slugs = entries.filter((entry) => entry.choice.library).map((entry) => entry.choice.library);
      const followed = await newBots.followedOf(slugs, txOptions);
      const adding = entries.filter((entry) => !followed.has(entry.choice.library));
      if (!adding.length) {
        throw new BotsError(409, "Every bot you chose is already in this home.", { code: "bots_team_all_in_home" });
      }
      const starts = [];
      for (const { choice, look } of adding) {
        starts.push({ ...look, start: await templates.startOn({ choice, botName: look.name, firstName: "" }, txOptions) });
      }
      const made = await botList.makeBots(starts, txOptions);
      const chatId = await onboarding.introduce(made, txOptions);
      return { made, chatId, skipped: slugs.filter((slug) => followed.has(slug)) };
    }));
    const added = done.made.map((bot) => String(bot.id));
    await botList.tellHome(added, "created", options);
    if (done.chatId) {
      await notices.publishEach("bots", [personOf(options)], { type: "messages", chatId: done.chatId })
        .catch((error) => console.warn("Telling the person about their team's introduction failed; they see it on their next read.", error));
    }
    return { ...(await botList.listBots(options)), added, skipped: done.skipped, chatId: done.chatId };
  }

  /**
   * Add N bots of a team: the team's bots on the templates chosen (slugs of the team's; 400 for none, or for one the
   * team hasn't got), in the team's order (make). Each takes its template's name and look; Mercbot's own templates are
   * read from the library, with no statement.
   * @param {string} teamId
   * @param {unknown} chosen
   * @param {import("./types.js").CallOptions} options
   */
  async function addTeam(teamId, chosen, options) {
    const team = knownTeam(teamId);
    const slugs = Array.isArray(chosen) ? [...new Set(chosen.map(String))] : [];
    if (!slugs.length) throw new BotsError(400, "Choose at least one bot to add.", { code: "bots_team_empty" });
    const strange = slugs.find((slug) => !team.templates.includes(slug));
    if (strange) {
      throw new BotsError(400, `${team.name} has no ${strange} bot.`, { code: "bots_team_template_unknown", params: { template: strange } });
    }
    const entries = team.templates.filter((slug) => slugs.includes(slug))
      .map((slug) => ({ choice: { library: slug }, look: lookOf(LIBRARY.get(slug)) }));
    return make(entries, options);
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
   * checked whole as Save and use checks one (422 with its problems otherwise), in the order given (make). A library
   * bot named twice is made once.
   * @param {{ bots?: unknown }} input
   * @param {import("./types.js").CallOptions} options
   */
  async function addBots(input = {}, options) {
    const chosen = Array.isArray(input.bots) ? input.bots : [];
    if (!chosen.length) throw new BotsError(400, "Choose at least one bot to add.", { code: "bots_add_empty" });
    if (chosen.length > PLAN_LIMITS.bots) {
      throw new BotsError(400, `Add at most ${PLAN_LIMITS.bots} bots at once.`, { code: "bots_add_too_many" });
    }
    if (chosen.filter((bot) => bot?.draft !== undefined).length > PLAN_LIMITS.new) {
      throw new BotsError(400, `Add at most ${PLAN_LIMITS.new} new templates at once.`, { code: "bots_add_too_many_new" });
    }
    const entries = chosen.map(suggested)
      .filter((entry, at, all) => !entry.choice.library || all.findIndex((other) => other.choice.library === entry.choice.library) === at);
    return make(entries, options);
  }

  return Object.freeze({
    teamFor,
    addTeam,
    addBots
  });
}
