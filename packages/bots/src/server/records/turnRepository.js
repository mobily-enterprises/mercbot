// What a bot's turn reads and keeps beside its chat (D-14, D-48, D-112): the agent-runtime planning store (a to-do
// card in the chat and job notes on the bot's seat there) and the few messages a reply or a tool looks back at. The
// agent engine's conversation id is the bot's seat in the chat (chat_bots.id): one run, goal and to-do list per bot
// per chat. Every method takes the call's options last, so ownership keeps it in the call's home and the row policies
// decide which chats and messages it reads (the model's reader, for a turn). Messages answer as records ({ id, kind,
// role, body, createdAt, ... }), whose kind, role and body read as a message row's do.
import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */
/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} ResourceHandle */

/** A message filter on a value kept in its body (a JSON object), compared in SQL. */
const onBody = (type, compare) => Object.freeze({
  type,
  applyFilter(query, input, { column }) {
    compare(query, column("body"), input, column);
  }
});

// The message filters a turn reads by, beside the bots' own (searchSchemas.js MESSAGE_SEARCH:
// afterId, kinds, bodyStatus); the notebook's removedAt is searchSchemas.js NOTEBOOK_SEARCH.
export const TURN_MESSAGE_SEARCH = Object.freeze({
  // Anything but this kind: the last turn in a group is its last message that isn't an event line.
  notKind: Object.freeze({ type: "string", actualField: "kind", filterOperator: "!=" }),
  // A bot's reply that saw the person's message `input` (its body.answers).
  answersFrom: onBody("integer", (query, body, input) => query.whereRaw("(?? ->> 'answers')::bigint >= ?", [body, Number(input)])),
  // A question card the person answered.
  answeredQuestion: onBody("boolean", (query, body) => query.whereRaw("?? ->> 'purpose' = 'question' and ?? ->> 'chosen' is not null", [body, body])),
  // The to-do card of one bot in a chat (agent-runtime planning: body.list is its chat_bots id).
  todoList: onBody("string", (query, body, input) => query.whereRaw("?? ->> 'list' = ?", [body, String(input)]))
});

/**
 * @param {{
 *   resources: Record<string, ResourceHandle>,
 *   work: import("../types.js").WorkRepository
 * }} dependencies
 */
export function createTurnRepository({ resources, work }) {
  const { messages: chatMessages, chatBots } = resources;
  /**
   * A chat's messages matching `filters`, oldest first (or newest first, up to `limit`).
   * @param {string} conversationId the chat
   * @param {object} filters
   * @param {{ newestFirst?: boolean, limit?: number }} order
   * @param {CallOptions} options
   */
  async function messages(conversationId, filters, { newestFirst = false, limit } = {}, options) {
    const query = { filters: { ...filters, conversationId: String(conversationId) }, sort: [newestFirst ? "-id" : "id"] };
    const records = limit
      ? (await chatMessages.query({ ...query, page: { size: limit } }, passedOn(options))).records
      : await chatMessages.queryAll(query, passedOn(options));
    return records;
  }

  /**
   * The chat's newest message matching `filters`, or null.
   * @param {string} conversationId
   * @param {object} filters
   * @param {CallOptions} options
   */
  async function latestMessage(conversationId, filters, options) {
    const [latest = null] = await messages(conversationId, filters, { newestFirst: true, limit: 1 }, options);
    return latest;
  }

  /**
   * The agent-runtime planning store (AgentPlanning) for one call, keyed by the bot's seat in the chat (chat_bots.id):
   * the to-do card among the chat's messages, and the job notes kept on the seat.
   * @param {CallOptions} options
   * @returns {import("@jskit-ai/agent-runtime/server/types").AgentPlanning}
   */
  function planning(options) {
    /** A bot's seat in a chat, as the engine names it (its conversation id), or null. */
    const seatOf = (chatBotId) => chatBots.get(String(chatBotId), { fields: ["conversationId", "jobNotes"] }, { ...passedOn(options), missing: "skip" });
    return Object.freeze({
      async currentTodos(chatBotId) {
        const seat = await seatOf(chatBotId);
        if (!seat) return undefined;
        const card = await latestMessage(String(seat.conversationId), { kind: "todos", todoList: String(chatBotId) }, options);
        return card ? { id: card.id, body: card.body } : undefined;
      },
      mergeTodos: (cardId, body) => work.patchCards([String(cardId)], body, options),
      async jobNotes(chatBotId) {
        return (await seatOf(chatBotId))?.jobNotes ?? null;
      },
      // readable-check: allow setter-seam - not a slot: saves a bot's job notes in a chat, as the agent engine's store names it
      setJobNotes: (chatBotId, notes) =>
        chatBots.patchWhere({ id: String(chatBotId) }, { jobNotes: notes }, { ...passedOn(options), returning: "none" })
    });
  }

  return Object.freeze({
    messages,
    latestMessage,
    planning
  });
}
