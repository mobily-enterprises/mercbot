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

export { BotsError, archivedBotRefusal };
