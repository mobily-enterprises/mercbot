/**
 * The chat's event line for a change a tool made ("Archived 2 emails"), with the detail the bot
 * is told and the result it gets back.
 * @param {string} text
 * @param {string} detail
 * @param {object} [result]
 */
export const eventMessage = (text, detail, result) => ({ kind: "event", role: "system", body: { text, detail }, result });
