// The type of the `mercbot.computer` capability, for features that require it, and of `mercbot.computer-placement`, which
// the computer feature reads when a feature provides it.

/** @typedef {ReturnType<typeof import("./computers.js").createComputers>} Computer */

/**
 * A live server, as a computer's placement sees it: its id, and how many computers it holds that aren't asleep.
 * @typedef {{ id: string, awake: number }} LiveServer
 */

/**
 * Where bots' computers run (`mercbot.computer-placement`, D-85). Mercbot runs a computer on the server that needs it
 * (`PLACE_HERE`); a copy built on Mercbot may run them on servers of its own choosing instead.
 * `choose(computerId, servers)` names the server to run a computer that no live server holds, or null when none can
 * take it: `servers.here` is the server asking, and `servers.live()` answers the live servers. `secret` is what servers
 * sign their calls to each other with, or null for the one Mercbot keeps in its database.
 * @typedef {{
 *   choose: (computerId: string, servers: { here: string, live: () => Promise<LiveServer[]> }) => Promise<string | null>,
 *   secret: string | null
 * }} ComputerPlacement
 */

export {};
