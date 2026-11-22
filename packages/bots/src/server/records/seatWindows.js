import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */
/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} ResourceHandle */

// How many of a room's latest messages a bot invited into it reads (and its memory starts from); the rest it reads
// further back only when asked (read_further_back).
export const BOT_WINDOW = 30;

/**
 * Where a bot's seat reads its chat from (`chat_bots.reads_from_message_id`): a bot invited into a room with a long
 * history reads its latest BOT_WINDOW messages and what is said after, so it stays quick and cheap, and reads further
 * back when someone asks it to. Null reads the chat from its beginning. Every read goes through the caller's options:
 * the inviter's when a bot joins, the model's reader for the bot in its chat in a turn.
 * @param {Record<string, ResourceHandle>} resources the records feature's handles
 */
export function createSeatWindows({ messages, chatBots }) {
  /**
   * Where a bot joining a chat now reads it from: its BOT_WINDOW-th newest message, or null (its beginning) when it has
   * no more than that. One read of at most BOT_WINDOW ids, whatever the chat's length.
   * @param {string} chatId
   * @param {CallOptions} options
   * @returns {Promise<string | null>}
   */
  async function startFor(chatId, options) {
    const { records: latest, page } = await messages.query({
      filters: { conversationId: String(chatId) },
      sort: ["-id"],
      fields: ["conversationId"],
      page: { size: BOT_WINDOW }
    }, passedOn(options));
    return page.hasMore ? String(latest.at(-1).id) : null;
  }

  /**
   * A bot's seat in a chat reading `count` more of the chat's messages before where it reads from now
   * (read_further_back): one count of the messages before its start, one read of the new start when some are left
   * before it, and one write. Answers how many more it reads (`moved`) and how many are still before it (`left`), or
   * `whole` when it already read the whole chat.
   * @param {{ id: string, conversation_id: string, reads_from_message_id: string | null }} seat the seat's chat_bots row
   * @param {number} count
   * @param {CallOptions} options the model's reader for the bot in its chat
   * @returns {Promise<{ whole: boolean, moved: number, left: number }>}
   */
  async function readFurtherBack(seat, count, options) {
    const start = seat.reads_from_message_id == null ? null : String(seat.reads_from_message_id);
    if (!start) return { whole: true, moved: 0, left: 0 };
    const before = { conversationId: String(seat.conversation_id), beforeId: start };
    const [totals] = await messages.aggregate({ measures: { earlier: { count: "*" } }, filters: before }, passedOn(options));
    const earlier = Number(totals?.earlier || 0);
    let readsFrom = null;
    if (earlier > count) {
      const { records } = await messages.query({ filters: before, sort: ["-id"], fields: ["conversationId"], page: { size: count } }, passedOn(options));
      readsFrom = String(records.at(-1).id);
    }
    await chatBots.patch(String(seat.id), { readsFromMessageId: readsFrom }, { ...passedOn(options), returning: "none" });
    return { whole: false, moved: Math.min(earlier, count), left: Math.max(0, earlier - count) };
  }

  /**
   * How much of a chat a bot's seat leaves out (when its start was written, and how many messages are before it), or
   * null when it reads the whole chat: the turn's state note. Two reads.
   * @param {{ conversation_id: string, reads_from_message_id: string | null }} seat
   * @param {CallOptions} options
   * @returns {Promise<{ from: string, earlier: number } | null>}
   */
  async function windowOf(seat, options) {
    if (seat.reads_from_message_id == null) return null;
    const start = String(seat.reads_from_message_id);
    const first = await messages.get(start, { fields: ["createdAt"] }, { ...passedOn(options), missing: "skip" });
    if (!first) return null;
    const filters = { conversationId: String(seat.conversation_id), beforeId: start };
    const [totals] = await messages.aggregate({ measures: { earlier: { count: "*" } }, filters }, passedOn(options));
    return { from: first.createdAt, earlier: Number(totals?.earlier || 0) };
  }

  return Object.freeze({
    startFor,
    readFurtherBack,
    windowOf
  });
}
