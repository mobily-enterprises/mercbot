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

export { BotsError };
