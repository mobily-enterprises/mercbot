// The types of the `mercbot.account` and `mercbot.meter` capabilities, for features that require them, and of
// `mercbot.provider-failures` and `mercbot.usage-recorder`, which the account feature reads when a feature provides them.

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
 *   priceTags: (homeId: string, reader: SpendingReader) => Promise<{ bots: Array<{ botId: string, monthNano: number, allNano: number }> }>,
 *   report: (homeId: string, reader: SpendingReader) => Promise<object>,
 *   exportCsv: (homeId: string, reader: SpendingReader) => SpendingCsv | Promise<SpendingCsv>
 * }} Spending
 */

/**
 * How what work uses is recorded (`mercbot.usage-recorder`; Mercbot's own is usage.js createUsageRecorder, which a copy
 * built on Mercbot may replace). The meter calls the recording methods around every AI call, a computer's day and a
 * command's computation: `open`, `startComputerDay` and `startComputation` may refuse the work before it starts by
 * throwing meter.js `refuseWork`, and `renewComputation` by answering false. `pausedMessage` is what a bot says instead
 * of starting new work in a home (null: it starts). A copy's own also answers what a home has spent (`spending`) and
 * names the columns it adds to the daily totals, archived with Mercbot's (`archivedColumns`).
 * @typedef {ReturnType<typeof import("./usage.js").createUsageRecorder> & {
 *   spending?: Spending,
 *   archivedColumns?: ReadonlyArray<string>
 * }} UsageRecorder
 */

/**
 * @typedef {ReturnType<typeof import("./meter.js").createMeter> & {
 *   spentSince: UsageRecorder["spentSince"],
 *   pausedMessage: UsageRecorder["pausedMessage"]
 * }} Meter
 */

/**
 * Where the AI providers' failures are kept (`mercbot.provider-failures`): `record` gets each one, its message already
 * without the key; the meter doesn't wait for it.
 * @typedef {{ record: (failure: { kind: string, provider: string, status: number | null, message: string }) => Promise<void> }} AiFailures
 */

export {};
