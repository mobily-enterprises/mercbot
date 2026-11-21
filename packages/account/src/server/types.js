// The types of the `mercbot.account` and `mercbot.meter` capabilities, for features that require them, of
// `mercbot.provider-failures` and `mercbot.usage-recorder`, which the account feature reads when a feature provides them,
// and of `mercbot.media-check`, which the account and files features read when a feature provides it (D-90).

/** @typedef {ReturnType<typeof import("./accountService.js").createAccountService>} Account */

/**
 * Who reads a home's spending (spending.js readerOf): owners and admins (`manages`) see the whole home, a member their
 * own use; `from` and `to` are a report's days, "YYYY-MM-DD".
 * @typedef {{ userId: string, manages: boolean, from?: string, to?: string }} SpendingReader
 */

/**
 * A spending report's CSV: its file name and its lines, as they're read.
 * @typedef {{ fileName: string, stream: import("node:stream").Readable }} SpendingCsv
 */

/**
 * What a home has spent, for the routes /usage, /spending/bots, /spending and /spending/export: Mercbot's own
 * (spending.js and reports.js, what work cost at its providers), or a copy's (`UsageRecorder.spending`), which answers
 * the same shapes and may add to them.
 * @typedef {{
 *   summary: (homeId: string, reader: SpendingReader) => Promise<{
 *     scope: "home" | "own", month: string, monthNano: number, note: string | null, attention: boolean, action: string | null
 *   }>,
 *   report: (homeId: string, reader: SpendingReader) => Promise<object>,
 *   exportCsv: (homeId: string, reader: SpendingReader) => SpendingCsv | Promise<SpendingCsv>
 * }} Spending
 */

/**
 * How what work uses is recorded (`mercbot.usage-recorder`; Mercbot's own is usage.js createUsageRecorder, which a copy
 * built on Mercbot may replace). The meter calls the recording methods around every AI call, a computer's day and a
 * command's computation: `open`, `startComputerDay` and `startComputation` may refuse the work before it starts by
 * throwing meter.js `refuseWork`, and `renewComputation` by answering false. `pausedMessage` is what a bot says instead
 * of starting new work in a home (null: it starts), and `estimateNano` what some tokens of an AI call would cost a home
 * before any call is made, as the recorder would count them (a bot's Knowledge shows it, D-107). A copy's own also
 * answers what a home has spent (`spending`) and names the columns it adds to the daily totals, archived with
 * Mercbot's (`archivedColumns`).
 * @typedef {ReturnType<typeof import("./usage.js").createUsageRecorder> & {
 *   spending?: Spending,
 *   archivedColumns?: ReadonlyArray<string>
 * }} UsageRecorder
 */

/**
 * @typedef {ReturnType<typeof import("./meter.js").createMeter> & {
 *   spentSince: UsageRecorder["spentSince"],
 *   pausedMessage: UsageRecorder["pausedMessage"],
 *   estimateNano: UsageRecorder["estimateNano"]
 * }} Meter
 */

/**
 * Where the AI providers' failures are kept (`mercbot.provider-failures`): `record` gets each one, its message already
 * without the key; the meter doesn't wait for it.
 * @typedef {{ record: (failure: { kind: string, provider: string, status: number | null, message: string }) => Promise<void> }} AiFailures
 */

/**
 * Where a picture or video to check came from: a file the person uploaded or attached, a picture a bot made, a photo the
 * Vault reads, a profile picture, a bot's computer's screenshot or a file a bot saved in a turn.
 * @typedef {"upload" | "picture" | "vault_photo" | "profile_picture" | "screenshot" | "saved_file"} MediaOrigin
 */

/**
 * A checker's answer: `notice`, when given, is the sentence the person is shown in place of Mercbot's own for that
 * verdict; `ref` is the checker's own reference to its record of the check.
 * @typedef {{ verdict: "allow" | "block" | "unavailable", notice?: string, ref?: string }} MediaVerdict
 */

/**
 * A picture or video to check: the whole file, its type as its own first bytes say (mediaCheck.js sniffMedia, never its
 * name's or a browser's), where it came from, whose it is, where it would be kept (a virtual path such as
 * "/files/chat/Uploads/cat.jpg", or a computer's screenshot's name) and the address of the request that brought it in.
 * `conversationId` is the chat it came in (D-112), or for a screenshot its computer's chat_bots id (a bot in a chat);
 * the name stays, as checkers outside Mercbot read it. `place` is the files place that path is in, for an upload (the
 * chat's, the bot's or the home's) and a file a bot saved, and null for every other origin: an opaque, JSON-safe object
 * a checker may keep and give back to `files.media.remove` (D-90).
 * @typedef {{
 *   bytes: Buffer,
 *   mime: string,
 *   origin: MediaOrigin,
 *   workspaceId: string | null,
 *   userId: string | null,
 *   botId: string | null,
 *   conversationId: string | null,
 *   place: object | null,
 *   path: string | null,
 *   ip: string | null
 * }} MediaItem
 */

/**
 * What a picture is asked to show, before it's made.
 * @typedef {{
 *   text: string,
 *   origin: "picture_prompt",
 *   workspaceId: string | null,
 *   userId: string | null,
 *   botId: string | null,
 *   conversationId: string | null
 * }} MediaText
 */

/**
 * How a copy built on Mercbot checks every picture and video before it's kept or sent (`mercbot.media-check`, D-90;
 * Mercbot has none, and allows everything). A verdict of "block" or "unavailable" keeps nothing, except a screenshot a
 * reply shows or a file a bot saved, which is checked afterwards and removed only when blocked. A throw counts as
 * "unavailable". A copy whose own review later judges a file it allowed removes it with `files.media.remove(item)`.
 * @typedef {{
 *   check: (item: MediaItem) => Promise<MediaVerdict>,
 *   checkText: (item: MediaText) => Promise<MediaVerdict>
 * }} MediaCheck
 */

export {};
