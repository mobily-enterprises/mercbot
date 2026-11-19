import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { callbackUrl } from "./oauth.js";

// A sign-in belongs to the browser that started it (D-97): starting one gives that browser a cookie of its own, and the
// provider's callback finishes only in a browser that brings it back. The sign-in in progress (oauth_states.binding)
// keeps only the cookie's hash.

/** How long a sign-in may take, from its start to the provider's callback. */
export const SIGN_IN_MINUTES = 15;

const COOKIE_PREFIX = "mercbot_sign_in_";

/**
 * A new browser proof for a sign-in: the cookie its browser keeps (`name`, `value`) and the hash its row keeps.
 * @param {string} state the sign-in's state
 */
export function newBinding(state) {
  const value = randomBytes(32).toString("base64url");
  return { cookie: { name: cookieName(state), value }, binding: hashOf(value) };
}

/**
 * The cookie a sign-in's browser keeps, one per sign-in so several can run at once, named after its state.
 * @param {string} state
 */
export function cookieName(state) {
  return `${COOKIE_PREFIX}${String(state).slice(0, 16)}`;
}

/**
 * The cookie's attributes: HttpOnly, SameSite=Lax (the provider sends the browser back with a link from its own site),
 * Secure at an https address, sent only to the callback, and kept as long as the sign-in may take (`maxAge` 0 clears it).
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {number} [maxAge] seconds
 */
export function cookieOptions(env, maxAge = SIGN_IN_MINUTES * 60) {
  const callback = new URL(callbackUrl(env));
  return { path: callback.pathname, httpOnly: true, sameSite: "lax", secure: callback.protocol === "https:", maxAge };
}

/**
 * Whether the browser of a callback is the one its sign-in started in: it brings back the cookie whose hash the sign-in
 * keeps. A sign-in without one (a lent sign-in not yet begun, or one started before D-97) is no one's.
 * @param {{ id: string, binding?: string | null }} row the sign-in in progress
 * @param {Record<string, string | undefined> | null | undefined} cookies the callback request's cookies
 */
export function sameBrowser(row, cookies) {
  const value = cookies?.[cookieName(row.id)];
  if (!row.binding || !value) return false;
  const given = Buffer.from(hashOf(value));
  const kept = Buffer.from(String(row.binding));
  return given.length === kept.length && timingSafeEqual(given, kept);
}

function hashOf(value) {
  return createHash("sha256").update(String(value)).digest("base64url");
}
