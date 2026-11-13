/**
 * Whether a server listening at `host` (HOST) is reachable from this computer only: 127.0.0.1 or ::1.
 * @param {string | undefined} host
 */
export function isLoopbackHost(host) {
  return ["127.0.0.1", "::1"].includes(String(host || "").trim());
}

/** The one person of a copy of Mercbot (D-81), who runs it. */
export const SINGLE_USER_EMAIL = "you@mercbot.localhost";
