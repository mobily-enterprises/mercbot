import { hasPermission } from "@jskit-ai/kernel/shared/support";
import { BotsError } from "./botsError.js";
import { toOwnTab, toRoom } from "./botRows.js";

// A home's default for new bots (D-100): the sharing every bot made in the home from then on gets, Private, Mixed or
// Shared, Mixed while nobody has chosen. Its owners and admins choose it, in the New home form, on the card the main
// bot's first conversation shows, in Settings → General, or when the first other person joins. Bots already there keep
// their mode, and group chats never read it. The same row keeps whether the home's bots decide when to join in a Shared
// bot's shared tabs (D-102, joiningIn.js), on unless an owner or admin turns it off.

const SHARING = Object.freeze(["private", "mixed", "shared"]);
// Whether a home's bots decide when to join in (D-102): on unless an owner or admin turned it off, nothing set included.
const joinsInOf = (settings) => settings?.botsJoinIn ?? true;
// The answers to the question asked once a home's people go from one to two.
const TEAM_ANSWERS = Object.freeze(["shared", "keep"]);

/**
 * Whether the call's person is one of the home's owners and admins (the call's own permissions, as a request has them).
 * @param {{ context?: { permissions?: string[] } }} options
 */
export function managesHome(options) {
  return hasPermission(options?.context?.permissions || [], "workspace.settings.update");
}

const forbidden = () => new BotsError(403, "Only the home's owners and admins change how its bots are set up.", {
  code: "bots_home_default_forbidden"
});
const unknownSharing = () => new BotsError(400, "Choose Private, Mixed or Shared.", { code: "bots_home_default_unknown" });

/**
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records: the home's settings, its people
 *   and the home's lock
 */
export function createHomeDefaults({ records }) {
  const { homeSettings: store, conversations } = records;

  /**
   * The sharing a bot made now in the call's home gets: the home's default, Mixed while none was chosen. Every way of
   * making a bot asks it at that moment. One read.
   * @param {import("./types.js").CallOptions} options
   */
  async function sharingOf(options) {
    return (await store.read(options))?.newBotSharing || "mixed";
  }

  /**
   * The first tabs of a bot just made, as the list gives them: none unless the home's default made it Shared. A Shared
   * one gets its General tab at once, for everyone in the home, and opens on its maker's own conversation, You only
   * (D-99), where its introduction or greeting is.
   * @param {{ id: string, sharing: string }} bot
   * @param {{ id: string, last_activity_at: string, unread?: boolean }} seat its maker's own conversation
   * @param {import("./types.js").CallOptions} options
   */
  async function firstTabs(bot, seat, options) {
    if (bot.sharing !== "shared") return null;
    const general = await conversations.createRoom(bot, { title: "General" }, options);
    await conversations.updateConversation(seat.id, { room_id: seat.id }, options);
    return [{ ...toRoom(general), unread: false }, toOwnTab(seat)];
  }

  /**
   * Whether the home's bots decide when to join in a Shared bot's shared tabs (D-102): on unless an owner or admin
   * turned it off, a home with nothing set included. One read.
   * @param {import("./types.js").CallOptions} options
   */
  async function joinsIn(options) {
    return joinsInOf(await store.read(options));
  }

  /**
   * Whether the home's default is still unchosen: its first conversation then asks.
   * @param {import("./types.js").CallOptions} options
   */
  async function unchosen(options) {
    return !(await store.read(options))?.newBotSharing;
  }

  /**
   * The home's default as the page shows it: the sharing new bots get, whether it was chosen, and for its owners and
   * admins the question asked once its people went from one to two (`teamQuestion`, naming who joined), until one of
   * them answers it; null otherwise, and while new bots are Shared. With it, whether its bots decide when to join in
   * (D-102). A read of the settings, and while the question may be asked one of the home's people: never one per bot.
   * @param {import("./types.js").CallOptions} options
   */
  async function asSeen(options) {
    const settings = await store.read(options);
    const newBotSharing = settings?.newBotSharing || "mixed";
    const asked = newBotSharing !== "shared" && !settings?.teamQuestionAnsweredAt && managesHome(options);
    const name = asked ? await store.joinedName(conversations.personOf(options), options) : "";
    return {
      newBotSharing,
      chosen: Boolean(settings?.newBotSharing),
      teamQuestion: name ? { name, sharing: newBotSharing } : null,
      botsJoinIn: joinsInOf(settings)
    };
  }

  /**
   * Sets the home's default (`private`, `mixed` or `shared`), for its owners and admins (403 for anyone else). It changes
   * no bot already there.
   * @param {unknown} sharing
   * @param {import("./types.js").CallOptions} options
   */
  async function set(sharing, options) {
    if (!managesHome(options)) throw forbidden();
    if (!SHARING.includes(sharing)) {
      throw unknownSharing();
    }
    await store.write({ newBotSharing: sharing }, conversations.personOf(options), options);
  }

  /**
   * Settings → General's home part: changes how new bots are shared (`newBotSharing`) and whether bots decide when to
   * join in (`botsJoinIn`, D-102), either or both, in one write, for owners and admins (403 for anyone else), and
   * answers the settings as the page shows them. Neither changes a bot already there.
   * @param {{ newBotSharing?: unknown, botsJoinIn?: unknown }} changes
   * @param {import("./types.js").CallOptions} options
   */
  async function change({ newBotSharing, botsJoinIn } = {}, options) {
    if (!managesHome(options)) throw forbidden();
    if (newBotSharing !== undefined && !SHARING.includes(newBotSharing)) {
      throw unknownSharing();
    }
    if (botsJoinIn !== undefined && typeof botsJoinIn !== "boolean") {
      throw new BotsError(400, "Turn joining in on or off.", { code: "bots_join_in_unknown" });
    }
    const changes = {
      ...(newBotSharing !== undefined ? { newBotSharing } : {}),
      ...(botsJoinIn !== undefined ? { botsJoinIn } : {})
    };
    if (!Object.keys(changes).length) throw new BotsError(400, "Nothing to change.", { code: "bots_home_settings_empty" });
    await store.write(changes, conversations.personOf(options), options);
    return asSeen(options);
  }

  /**
   * The New home form: sets the default, and answers it as the page shows it.
   * @param {unknown} sharing
   * @param {import("./types.js").CallOptions} options
   */
  async function choose(sharing, options) {
    return change({ newBotSharing: sharing }, options);
  }

  /**
   * The answer to the question asked once the home's people went from one to two: `shared` makes new bots Shared,
   * `keep` keeps the default as it is. Either is recorded, so nobody is asked again; an answer after another owner's or
   * admin's changes nothing. Bots already there keep their mode. The home is locked meanwhile, so two answers at once
   * record the first.
   * @param {unknown} answer
   * @param {import("./types.js").CallOptions} options
   */
  async function answerTeamQuestion(answer, options) {
    if (!managesHome(options)) throw forbidden();
    if (!TEAM_ANSWERS.includes(answer)) {
      throw new BotsError(400, "Answer Make them Shared or Keep.", { code: "bots_team_question_answer_unknown" });
    }
    await conversations.withTransaction(options, async (txOptions) => {
      await conversations.lockHome(txOptions);
      const settings = await store.read(txOptions);
      if (settings?.teamQuestionAnsweredAt) return;
      const newBotSharing = answer === "shared" ? "shared" : settings?.newBotSharing || "mixed";
      await store.write({ newBotSharing, teamQuestionAnsweredAt: new Date().toISOString() }, conversations.personOf(txOptions), txOptions);
    });
    return asSeen(options);
  }

  return Object.freeze({
    sharingOf,
    firstTabs,
    joinsIn,
    unchosen,
    asSeen,
    set,
    choose,
    change,
    answerTeamQuestion
  });
}
