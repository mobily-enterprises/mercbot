// The type of the `mercbot.computer` capability, for features that require it, and of `mercbot.computer-placement` and
// `mercbot.computer-events`, which the computer feature reads when a feature provides them.

/** @typedef {ReturnType<typeof import("./computers.js").createComputers>} Computer */
/** @typedef {ReturnType<typeof import("./computerRecords.js").createComputerRecords>} ComputerRecords */

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

/**
 * A server Mercbot knows, as `servers()` answers it: its id and address, when it was last seen, whether that was in the
 * last 45 seconds, and how many computers it holds that aren't asleep.
 * @typedef {{ id: string, url: string, seenAt: string, alive: boolean, awake: number }} KnownServer
 */

/**
 * Who hears when computers run out of room (`mercbot.computer-events`, D-88): `record` gets a computer put to sleep to
 * make room for another on its server (`made_room`), and a computer that couldn't start (`refused`), with why:
 * `computer_none_free` when no server could take it, `computer_all_busy` when every computer on its server stayed busy
 * for 90 seconds. `serverId` is the server it happened on. The computer feature doesn't wait for it; without a feature
 * that listens, each is a line in the server log (`LOG_COMPUTER_EVENTS`).
 * @typedef {{
 *   record: (event: { kind: "made_room" | "refused", computerId: string, serverId: string, code: string | null }) => Promise<void>
 * }} ComputerEvents
 */

export {};
