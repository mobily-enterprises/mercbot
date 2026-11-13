// What a bot's turn reads and keeps beside its conversation (D-14, D-36, D-46, D-48): the person's
// memories, the home notebook, what its groups said lately, the agent-runtime planning store (a
// to-do card and job notes) and the few messages a reply or a tool looks back at. Every method
// takes the call's options last, so ownership keeps it in the call's home, for the call's person
// (person_memories is the person's own in the home), and the row policies decide which bots,
// conversations and messages it sees. Messages answer as records ({ id, kind, role, body,
// createdAt, ... }), whose kind, role and body read as a message row's do.
import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */
/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} ResourceHandle */

// Replies made before body.answers existed are taken as answering everything before them.
const ANSWERS_SINCE = "2026-10-25T07:40:00Z";

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
  // A bot's reply that saw the person's message `input` (its body.answers), or one from before
  // body.answers existed.
  answersFrom: onBody("integer", (query, body, input, column) => query.where((inner) => inner
    .whereRaw("(?? ->> 'answers')::bigint >= ?", [body, Number(input)])
    .orWhereRaw("?? ->> 'answers' is null and ?? < ?", [body, column("createdAt"), ANSWERS_SINCE]))),
  // A question card the person answered.
  answeredQuestion: onBody("boolean", (query, body) => query.whereRaw("?? ->> 'purpose' = 'question' and ?? ->> 'chosen' is not null", [body, body])),
  // The to-do card of one conversation (agent-runtime planning: body.list is its conversation id).
  todoList: onBody("string", (query, body, input) => query.whereRaw("?? ->> 'list' = ?", [body, String(input)]))
});

// A memory is one fact, compared in any case.
export const MEMORY_SEARCH = Object.freeze({
  factIs: Object.freeze({
    type: "string",
    applyFilter(query, input, { column }) {
      query.whereRaw("lower(??) = lower(?)", [column("fact"), String(input)]);
    }
  })
});

/**
 * @param {{
 *   resources: Record<string, ResourceHandle>,
 *   work: import("../types.js").WorkRepository
 * }} dependencies
 */
export function createTurnRepository({ resources, work }) {
  const { bots, botConversations, botMessages, botGroupMembers, botGroupPeople, botNotebook, personMemories } = resources;
  /**
   * A conversation's messages matching `filters`, oldest first (or newest first, up to `limit`).
   * @param {string} conversationId
   * @param {object} filters
   * @param {{ newestFirst?: boolean, limit?: number }} order
   * @param {CallOptions} options
   */
  async function messages(conversationId, filters, { newestFirst = false, limit } = {}, options) {
    const query = { filters: { ...filters, conversationId: String(conversationId) }, sort: [newestFirst ? "-id" : "id"] };
    const records = limit
      ? (await botMessages.query({ ...query, page: { size: limit } }, passedOn(options))).records
      : await botMessages.queryAll(query, passedOn(options));
    return records;
  }

  /**
   * The conversation's newest message matching `filters`, or null.
   * @param {string} conversationId
   * @param {object} filters
   * @param {CallOptions} options
   */
  async function latestMessage(conversationId, filters, options) {
    const [latest = null] = await messages(conversationId, filters, { newestFirst: true, limit: 1 }, options);
    return latest;
  }

  /**
   * Lasting facts the person's bots saved in this home, the newest `limit`, newest last.
   * @param {number} limit
   * @param {CallOptions} options
   */
  async function memoryFacts(limit, options) {
    const { records } = await personMemories.query({ sort: ["-id"], fields: ["fact"], page: { size: limit } }, passedOn(options));
    return records.map((record) => record.fact).reverse();
  }

  /**
   * Saves a fact for the person in this home unless it is already there, in any case.
   * @param {string} fact
   * @param {string} botId the bot that saved it
   * @param {CallOptions} options
   */
  async function rememberFact(fact, botId, options) {
    const { records } = await personMemories.query({ filters: { factIs: fact }, fields: ["fact"], page: { size: 1 } }, passedOn(options));
    if (!records.length) await personMemories.create({ fact, botId: String(botId) }, { ...passedOn(options), returning: "none" });
  }

  /**
   * Forgets the person's facts worded like this, in any case; answers whether there was one.
   * @param {string} fact
   * @param {CallOptions} options
   */
  async function forgetFact(fact, options) {
    return Number(await personMemories.deleteWhere({ factIs: fact }, { ...passedOn(options), returning: "count" })) > 0;
  }

  /**
   * A note in the home notebook from the person's chat with a mixed bot (D-36); answers its id.
   * @param {{ botId: string, text: string, sourceUserId: string, sourceConversationId: string }} note
   * @param {CallOptions} options
   */
  async function addNote(note, options) {
    return String(await botNotebook.create(note, { ...passedOn(options), returning: "id" }));
  }

  /**
   * The newest `limit` notes still in a bot's notebook, newest first, as their text.
   * @param {string} botId
   * @param {number} limit
   * @param {CallOptions} options
   */
  async function recentNotes(botId, limit, options) {
    const { records } = await botNotebook.query({
      filters: { botId: String(botId), removedAt: null },
      sort: ["-id"],
      fields: ["text"],
      page: { size: limit }
    }, passedOn(options));
    return records.map((record) => record.text);
  }

  /**
   * The person's group chats this bot is in that were active in the last 14 days, newest first, up
   * to `limit` (D-36): each group's id and name and its shared conversation.
   * @param {string} botId
   * @param {string} userId the person
   * @param {number} limit
   * @param {CallOptions} options
   */
  async function recentGroupsOf(botId, userId, limit, options) {
    const memberOf = (await botGroupMembers.queryAll({ filters: { botId: String(botId) }, fields: ["groupId"] }, passedOn(options)))
      .map((member) => String(member.groupId));
    if (!memberOf.length) return [];
    const theirs = (await botGroupPeople.queryAll({ filters: { groupIds: memberOf, userId: String(userId) }, fields: ["groupId"] }, passedOn(options)))
      .map((person) => String(person.groupId));
    if (!theirs.length) return [];
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    // A group's own conversation has neither a person nor a group: the bots' seats in it do.
    const { records: shared } = await botConversations.query({
      filters: { botIds: theirs, userId: null, groupId: null, lastActivityAfter: since },
      sort: ["-lastActivityAt"],
      fields: ["botId"],
      page: { size: limit }
    }, passedOn(options));
    if (!shared.length) return [];
    const names = new Map((await bots.queryAll({ filters: { id: shared.map((conversation) => String(conversation.botId)) }, fields: ["name"] }, passedOn(options)))
      .map((group) => [String(group.id), group.name]));
    return shared.map((conversation) => ({ id: String(conversation.botId), name: names.get(String(conversation.botId)) || "", conversationId: String(conversation.id) }));
  }

  /**
   * The agent-runtime planning store (AgentPlanning) for one call: the to-do card among the
   * conversation's messages and the job notes kept on the conversation.
   * @param {CallOptions} options
   * @returns {import("@jskit-ai/agent-runtime/server/types").AgentPlanning}
   */
  function planning(options) {
    return Object.freeze({
      async currentTodos(conversationId) {
        const card = await latestMessage(String(conversationId), { kind: "todos", todoList: String(conversationId) }, options);
        return card ? { id: card.id, body: card.body } : undefined;
      },
      mergeTodos: (cardId, body) => work.patchCards([String(cardId)], body, options),
      async jobNotes(conversationId) {
        const conversation = await botConversations.get(String(conversationId), { fields: ["jobNotes"] }, { ...passedOn(options), missing: "skip" });
        return conversation?.jobNotes ?? null;
      },
      // readable-check: allow setter-seam - not a slot: saves a conversation's job notes, as the agent engine's store names it
      setJobNotes: (conversationId, notes) =>
        botConversations.patchWhere({ id: String(conversationId) }, { jobNotes: notes }, { ...passedOn(options), returning: "none" })
    });
  }

  return Object.freeze({
    messages,
    latestMessage,
    memoryFacts,
    rememberFact,
    forgetFact,
    addNote,
    recentNotes,
    recentGroupsOf,
    planning
  });
}
