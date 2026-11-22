import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

/**
 * A refusal a bots route answers with its status, message and code (`{ error, code, params }`), such as 404 "Bot not found.".
 */
class BotsError extends AppError {
  /**
   * @param {number} status The HTTP status the route answers with.
   * @param {string} message The sentence the person sees.
   * @param {{ code: string, params?: object }} options The refusal's own code, and the values its sentence names.
   */
  constructor(status, message, options) {
    super(status, message, options);
    this.name = "BotsError";
  }
}

/**
 * What writing to an archived bot answers (D-108): its chats are read-only until it's unarchived.
 * @param {{ name: string }} bot
 */
const archivedBotRefusal = (bot) =>
  new BotsError(409, `${bot.name} is archived. Unarchive it to continue.`, { code: "bots_bot_archived", params: { name: bot.name } });

/**
 * What a direct chat answers to anyone added to it, and to a new title: a person's chat with a bot is theirs with that
 * bot, and a chat between two people is theirs alone.
 * @param {{ direct_person_id?: string | null }} chat
 */
const directChatRefusal = (chat) => (chat.direct_person_id
  ? new BotsError(409, "A private chat between two people takes nobody else.", { code: "bots_chat_direct" })
  : new BotsError(409, "A direct chat is one person's with one bot. Continue with others to bring others in.", { code: "bots_chat_direct" }));

export { BotsError, archivedBotRefusal, directChatRefusal };
