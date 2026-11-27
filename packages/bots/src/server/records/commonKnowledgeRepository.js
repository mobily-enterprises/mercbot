import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { createCallerReaders, isId } from "./recordRows.js";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */
/**
 * An entry of the home's common knowledge as a turn and Settings read it: what every bot in the home knows, who asked
 * for it, the bot they asked and the chat they asked in (each null once gone), and when.
 * @typedef {{ id: string, text: string, byUserId: string | null, viaBotId: string | null, fromChatId: string | null, createdAt: string }} CommonKnowledgeEntry
 */

/** common_knowledge filters beyond its `search: true` fields: the entries not removed. */
export const COMMON_KNOWLEDGE_SEARCH = Object.freeze({
  live: Object.freeze({
    type: "boolean",
    applyFilter(query, live, { column }) {
      if (live) query.whereNull(column("removedAt"));
      else query.whereNotNull(column("removedAt"));
    }
  })
});

// The card an entry is written from (D-113, R11): an approval card for share_common_knowledge that its person said yes to.
const SHARE_COMMON_KNOWLEDGE = "share_common_knowledge";
const YES = "Go ahead";
const ENTRY_FIELDS = Object.freeze(["text", "byUserId", "viaBotId", "fromConversationId", "createdAt"]);

/**
 * The home's common knowledge (D-113): what a person asked a bot to tell every bot, written only from the card they
 * said yes to, in the caller's home; every turn of every bot reads the newest, and Settings lists them all.
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} resources
 */
export function createCommonKnowledgeRepository(resources) {
  const { commonKnowledge, messages } = resources;
  const { personOf } = createCallerReaders();
  const idOrNull = (value) => (value == null ? null : String(value));

  /** @returns {CommonKnowledgeEntry} */
  const asEntry = (record) => ({
    id: String(record.id),
    text: record.text,
    byUserId: idOrNull(record.byUserId),
    viaBotId: idOrNull(record.viaBotId),
    fromChatId: idOrNull(record.fromConversationId),
    createdAt: record.createdAt
  });

  /**
   * The entry a card asks for, written as the person who said yes to it, or why not (`refused`): the card must be the
   * caller's own (its person), a share_common_knowledge approval they said yes to, in a chat they can open; one entry
   * per card. Its text is the card's, so nothing but what the person saw on it is written.
   * @param {string} cardId the card's message id
   * @param {(text: string) => string | null} refusal what the text may never hold (contact or card details), or null
   * @param {CallOptions} options the person's
   * @returns {Promise<{ entry: CommonKnowledgeEntry } | { refused: string }>}
   */
  async function addFromCard(cardId, refusal, options) {
    const me = personOf(options);
    if (!isId(cardId)) return { refused: "There's no card for that." };
    const [card] = await messages.queryAll({ filters: { id: String(cardId), kinds: ["choice"] }, fields: ["conversationId", "authorBotId", "body"] }, passedOn(options));
    const body = card?.body || {};
    if (!card || body.purpose !== "approval" || body.action?.id !== SHARE_COMMON_KNOWLEDGE || card.authorBotId == null) {
      return { refused: "There's no card for that." };
    }
    if (String(body.for?.id ?? "") !== me) return { refused: "Only the person the card is for can say yes to it." };
    if (body.chosen !== YES) return { refused: "That card wasn't said yes to." };
    const text = String(body.action.args?.text ?? "").trim();
    const refused = text ? refusal(text) : "There's nothing to add.";
    if (refused) return { refused };
    const [found] = await commonKnowledge.queryAll({ filters: { cardId: String(card.id) }, fields: [...ENTRY_FIELDS] }, passedOn(options));
    if (found) return { entry: asEntry(found) };
    const made = await commonKnowledge.create({
      text: text.slice(0, 500),
      byUserId: me,
      viaBotId: String(card.authorBotId),
      fromConversationId: String(card.conversationId),
      cardId: String(card.id)
    }, { ...passedOn(options), returning: "record" });
    return { entry: asEntry(made) };
  }

  /**
   * The home's entries not removed, newest first, a page at a time (`after`: the page before's `next`, null after the
   * last). One read.
   * @param {{ after?: string | null, size: number }} page
   * @param {CallOptions} options
   */
  async function list({ after = null, size }, options) {
    const { records, page } = await commonKnowledge.query({
      filters: { live: true },
      sort: ["-id"],
      page: { size, ...(after ? { after: String(after) } : {}) },
      fields: [...ENTRY_FIELDS]
    }, passedOn(options));
    return { entries: records.map(asEntry), next: page.next ?? null };
  }

  /** One entry not removed, or null. */
  async function find(entryId, options) {
    if (!isId(entryId)) return null;
    const filters = { id: [String(entryId)], live: true };
    const [found] = await commonKnowledge.queryAll({ filters, fields: [...ENTRY_FIELDS] }, passedOn(options));
    return found ? asEntry(found) : null;
  }

  /** An entry removed by the caller: kept, with who removed it and when; answers whether it was still there. */
  async function remove(entryId, options) {
    const changed = await commonKnowledge.patchWhere(
      { id: [String(entryId)], live: true },
      { removedAt: commonKnowledge.raw("now()"), removedBy: personOf(options) },
      { ...passedOn(options), returning: "count" }
    );
    return changed > 0;
  }

  return Object.freeze({
    addFromCard,
    list,
    find,
    remove
  });
}
