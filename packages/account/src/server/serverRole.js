/**
 * What a server of a copy of Mercbot does (D-131), which its start is given (server.js `serve` and `startServer`).
 * - `web` serves the pages and the API, and claims the work every web server shares, each piece once across them: due
 *   routines, Apps' jobs and watches, bots' requests, goals and replies to carry on, what the bots know and remember,
 *   files' checks and moves, and the usage tables' upkeep.
 * - `computers` runs only bots' computers for the other servers (a copy that places them on servers of their own,
 *   D-85): it answers its health and the work other servers pass to the computers it runs, keeps their files in the
 *   files bucket, and claims none of that work.
 */
export const SERVER_ROLES = Object.freeze({
  web: "pages, the API and the bots' work",
  computers: "only bots' computers, for the other servers"
});

/** The runtime setting the server sets from the role its start was given, which features read; never set by hand. */
export const SERVER_ROLE = "MERCBOT_SERVER_ROLE";

/**
 * `role` when it is one of SERVER_ROLES; otherwise an error naming them and how to give one, since a server that ran
 * as the wrong one would claim work it can't do, or leave it undone.
 * @param {unknown} role
 * @returns {keyof typeof SERVER_ROLES}
 */
export function checkServerRole(role) {
  if (typeof role === "string" && Object.hasOwn(SERVER_ROLES, role)) return /** @type {keyof typeof SERVER_ROLES} */ (role);
  const roles = Object.entries(SERVER_ROLES).map(([name, what]) => `"${name}" (${what})`).join(" or ");
  const given = role === undefined || role === "" ? "none was given" : `${JSON.stringify(role)} isn't one`;
  throw new Error(`A Mercbot server needs its role: ${roles}, and ${given}. Its start gives it: serve({ role: "web" }).`);
}

/**
 * This server's role, as its start set it; `web` where no start set one (a test that builds the features itself).
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv | Record<string, unknown>} env
 * @returns {keyof typeof SERVER_ROLES}
 */
export function serverRoleOf(env) {
  const role = env?.[SERVER_ROLE];
  return role === undefined || role === "" ? "web" : checkServerRole(role);
}

/**
 * Whether this server claims the work every web server shares (SERVER_ROLES): only a web server does.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv | Record<string, unknown>} env
 */
export const claimsSharedWork = (env) => serverRoleOf(env) === "web";
