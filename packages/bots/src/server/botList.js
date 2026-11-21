import { BOT_PALETTE, BRAND_COLOR } from "./botPalette.js";
import { BotsError } from "./botsError.js";
import { mayChangeBot } from "./botAdditions.js";
import { cleanName, cloudShape, toBot } from "./botRows.js";
import { createCallerReaders } from "./records/recordRows.js";

const BRAND_SHAPE = "mercbot";

/**
 * What a new bot starts with: the template columns pointing it at its template, and the greeting it opens its maker's
 * direct chat with, "" for a general one, which introduces itself when the person first opens it.
 * @typedef {{ columns: Record<string, unknown>, greeting: string }} NewBotStart
 */

/**
 * A new bot's name, cloud and colour as New bot gives them, checked: Mercbot's own cloud always in its orange, any other
 * in one of the palette's colours (400 otherwise).
 * @param {{ name?: unknown, shape?: unknown, color?: unknown }} input
 */
export function lookOf(input) {
  const name = cleanName(input.name);
  const shape = cloudShape(input.shape);
  const color = shape === BRAND_SHAPE ? BRAND_COLOR : String(input.color || "").toUpperCase();
  if (!BOT_PALETTE.includes(color)) throw new BotsError(400, "Pick one of the colours.", { code: "bots_colour_unknown" });
  return { name, shape, color };
}

/**
 * The home's bots as the Team page lists them (D-112: members of the home, as its people are, in any number of chats),
 * and new bots made (botTemplates.js and botTeams.js choose their templates). Every method takes the call's options
 * last: the person and the home are its context.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("@local/apps/server/types").Apps} dependencies.apps which bot builds the home's apps
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 */
export function createBotList({ records, apps, notices }) {
  const { bots, chats, messages, newBots } = records;
  const { personOf } = createCallerReaders();

  /**
   * The home's bots, archived ones too, each with who made it and, when it's archived, who did (D-108, "you" for the
   * person), whether it builds the home's apps and whether the person may archive and unarchive it: its maker and the
   * home's owners and admins (the main bot and the Builder aren't archived either way; the page says why). With
   * `botId`, just that bot, or a 404. Three reads, whatever the number of bots.
   * @param {import("./types.js").CallOptions} options
   * @param {{ botId?: string }} [only]
   */
  async function listBots(options, { botId } = {}) {
    const person = personOf(options);
    const rows = botId === undefined ? await bots.list(options) : [await bots.get(botId, options)];
    const others = rows.flatMap((row) => [row.made_by, row.archived_by]).filter((id) => id != null && String(id) !== person);
    const [builder, names] = await Promise.all([apps.apps.builder(options), chats.names(others, options)]);
    const nameOf = (id) => (id == null ? null : String(id) === person ? "you" : names.get(String(id)) || "Someone");
    return {
      bots: rows.map((row) => ({
        ...toBot(row),
        isBuilder: String(builder?.id) === String(row.id),
        madeByName: nameOf(row.made_by),
        archivedBy: row.archived_at ? nameOf(row.archived_by) : null,
        canArchive: mayChangeBot(row.made_by, person, options)
      }))
    };
  }

  /** One bot as the Team page lists it, or a 404: what an open page reads again when that bot changes. */
  async function listedBot(botId, options) {
    const [bot] = (await listBots(options, { botId })).bots;
    return bot;
  }

  /** Everyone in the home hears that some bots changed (`change`), on any server; a failure leaves it to their next read. */
  async function tellHome(botIds, change, options) {
    const people = (await chats.everyoneIn(options)).map(String);
    for (const botId of botIds) {
      await notices.publishEach("bots", people, { type: "bot", botId: String(botId), change })
        .catch((error) => console.warn("Telling the home about a bot failed; they see it on their next read.", error));
    }
  }

  /** A chat's people hear it has new messages, as a turn tells them (chatSeats.js tell); a failure leaves it to their next read. */
  async function tellMessages(chatId, options) {
    try {
      const people = (await chats.people(String(chatId), options)).map((person) => person.user_id);
      if (people.length) await notices.publishEach("bots", people, { type: "messages", chatId: String(chatId) });
    } catch (error) {
      console.warn("Telling a chat's people of its new messages failed; they see them on their next read.", error);
    }
  }

  /**
   * The person who made a bot hears of their new direct chat with it (openWith), on every page they have open, once it
   * is saved; a failure leaves it to their next read.
   */
  async function tellOpened(chatId, options) {
    await notices.publishEach("bots", [personOf(options)], { type: "chat", chatId: String(chatId), change: "created" })
      .catch((error) => console.warn("Telling the person about their new chat failed; they see it on their next read.", error));
  }

  /**
   * New bots, made together in the call's transaction: New bot's one, or a team's several (D-105), through the same
   * statements, so six cost what one does. Each `{ name, shape, color, start }` (lookOf, and NewBotStart) is the
   * person's, a member of the home in no chat yet: it's on Team, and someone's [Message] opens a chat with it. Nothing
   * starts any AI work as it's made. Answers their rows, in the order given.
   * @param {Array<{ name: string, shape: string, color: string, start: NewBotStart }>} entries
   * @param {import("./types.js").CallOptions} txOptions
   */
  async function makeBots(entries, txOptions) {
    const person = personOf(txOptions);
    return newBots.createBots(entries.map(({ name, shape, color, start }) =>
      ({ made_by: person, name, shape, color, ...start.columns })), txOptions);
  }

  /**
   * A new bot's first chat with the person who made it: their direct chat with it, opening with its template's
   * greeting, or for a general bot with none, its introduction to come (onboarding.js intro-greet). Answers the chat.
   * @param {{ id: string }} bot
   * @param {string} greeting
   */
  async function openWith(bot, greeting, txOptions) {
    const chat = await chats.direct(bot.id, txOptions, { onboardingStep: greeting ? null : "intro-greet" });
    await messages.append(chat.id, [
      { kind: "timestamp", role: "system", body: { at: new Date().toISOString() } },
      ...(greeting ? [{ kind: "text", role: "bot", authorBotId: String(bot.id), body: { text: greeting } }] : [])
    ], txOptions);
    return chat;
  }

  return Object.freeze({
    listBots,
    listedBot,
    tellHome,
    tellMessages,
    tellOpened,
    makeBots,
    openWith
  });
}
