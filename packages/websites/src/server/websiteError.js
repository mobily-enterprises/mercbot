import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

/** A refusal about a home's website or a page published to it (D-84), with the sentence the person sees. */
export class WebsiteError extends AppError {
  /**
   * @param {number} status The HTTP status the route answers with.
   * @param {string} message The sentence the person sees.
   * @param {{ code: string, params?: object }} options The refusal's own code, and the values its sentence names.
   */
  constructor(status, message, options) {
    super(status, message, options);
    this.name = "WebsiteError";
  }
}
