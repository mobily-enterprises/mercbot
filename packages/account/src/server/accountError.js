import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

/**
 * A refusal an account route answers with its status, message and code (`{ error, code, params }`),
 * such as 400 "Send from 1 to 100 items at a time.".
 */
class AccountError extends AppError {
  /**
   * @param {number} status The HTTP status the route answers with.
   * @param {string} message The sentence the person sees.
   * @param {{ code: string, params?: object }} options The refusal's own code, and the values its sentence names.
   */
  constructor(status, message, options) {
    super(status, message, options);
    this.name = "AccountError";
  }
}

export { AccountError };
