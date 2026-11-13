// A model call's failure, as the AI SDK throws it, and how Mercbot keeps it: the provider's own status (401 for a
// refused key, 429 for its limit, 5xx) is never the page's answer, which would read it as its own (signed out,
// asking too often); it's kept in the log only.

// The AI SDK marks every error of its own with this symbol (AISDKError.isInstance): a refused key, a used-up limit,
// a provider that fails, retries that ran out.
const AI_SDK_ERROR = Symbol.for("vercel.ai.error");

/**
 * Whether `error` is a model call's failure, as the AI SDK throws it.
 * @param {unknown} error
 */
export function isModelFailure(error) {
  return typeof error === "object" && error !== null && /** @type {Record<symbol, unknown>} */ (error)[AI_SDK_ERROR] === true;
}

/**
 * A failed model call in a few words for the log: its message and the provider's status (the last attempt's, after
 * retries), never the error itself, which carries the request, the person's message included.
 * @param {any} error
 */
export function modelFailure(error) {
  const code = error?.statusCode ?? error?.lastError?.statusCode;
  return `its model call failed${code ? ` (status ${code})` : ""}: ${error?.message || error}`;
}
