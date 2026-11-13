// The one way bots call Google's own APIs (D-31), with the person's hourly key from Connect apps,
// and what a refusal tells the bot.

import { ConnectedAppError } from "./connectedApps.js";

/**
 * A call to one of Google's APIs with the person's key; a refusal throws what the bot should say.
 * @param {string} key
 * @param {string} url
 * @param {RequestInit} [options]
 */
export async function call(key, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...options.headers },
    signal: AbortSignal.timeout(30000)
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 403 && /insufficient/iu.test(body.error?.message || "")) {
    throw new ConnectedAppError(
      "This account didn't allow this access when it was signed in (a box on Google's screen was left unticked). Ask the person to sign it in again in Connect apps and allow everything, or use another connected account."
    );
  }
  if (response.status === 401) throw new ConnectedAppError("Google refused: the connection may need signing in again in Connect apps.");
  // Any other refusal says what Google said, so the bot doesn't send the person to sign in for nothing.
  if (response.status === 403) {
    throw new ConnectedAppError(`Google refused: ${body.error?.message || "this isn't allowed for this account"}.`);
  }
  if (!response.ok) throw new ConnectedAppError(body.error?.message || `Google answered ${response.status}.`);
  return body;
}
