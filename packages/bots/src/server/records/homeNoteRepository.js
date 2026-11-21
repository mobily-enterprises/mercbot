import { passedOn } from "@jskit-ai/resource-core/shared/callOptions";
import { createCallerReaders } from "./recordRows.js";

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */
/**
 * A home note as the memory and a bot's card read it: what everyone in the home is told, who asked for it, the bot they asked
 * and the chat they asked in (each null once gone), and when.
 * @typedef {{ id: string, text: string, byUserId: string | null, viaBotId: string | null, fromChatId: string | null, createdAt: string }} HomeNote
 */

/** home_notes filters beyond its `search: true` fields: the notes not removed. */
export const HOME_NOTE_SEARCH = Object.freeze({
  live: Object.freeze({
    type: "boolean",
    applyFilter(query, live, { column }) {
      if (live) query.whereNull(column("removedAt"));
      else query.whereNotNull(column("removedAt"));
    }
  })
});

// The card a note is written from (D-113, R11): an approval card for tell_everyone that its person said yes to.
const TELL_EVERYONE = "tell_everyone";
const YES = "Go ahead";
const NOTE_FIELDS = Object.freeze(["text", "byUserId", "viaBotId", "fromConversationId", "createdAt"]);

/**
 * What everyone in the home is told (D-113): notes a person asked a bot to tell everyone, written only from the card
 * they said yes to, in the caller's home; every turn of every bot reads the newest, and every bot's card lists them all.
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} resources
 */
export function createHomeNoteRepository(resources) {
  const { homeNotes, messages } = resources;
  const { personOf } = createCallerReaders();
  const idOrNull = (value) => (value == null ? null : String(value));

  /** @returns {HomeNote} */
  const asNote = (record) => ({
    id: String(record.id),
    text: record.text,
    byUserId: idOrNull(record.byUserId),
    viaBotId: idOrNull(record.viaBotId),
    fromChatId: idOrNull(record.fromConversationId),
    createdAt: record.createdAt
  });

  /**
   * The note a card asks for, written as the person who said yes to it, or why not (`refused`): the card must be the
   * caller's own (its person), a tell_everyone approval they said yes to, in a chat they can open; one note per card.
   * Its text is the card's, so nothing but what the person saw on it is written.
   * @param {string} cardId the card's message id
   * @param {(text: string) => string | null} refusal what the text may never hold (contact or card details), or null
   * @param {CallOptions} options the person's
   * @returns {Promise<{ note: HomeNote } | { refused: string }>}
   */
  async function addFromCard(cardId, refusal, options) {
    const me = personOf(options);
    if (!/^\d+$/u.test(String(cardId ?? ""))) return { refused: "There's no card for that note." };
    const [card] = await messages.queryAll({ filters: { id: String(cardId), kinds: ["choice"] }, fields: ["conversationId", "authorBotId", "body"] }, passedOn(options));
    const body = card?.body || {};
    if (!card || body.purpose !== "approval" || body.action?.id !== TELL_EVERYONE || card.authorBotId == null) {
      return { refused: "There's no card for that note." };
    }
    if (String(body.for?.id ?? "") !== me) return { refused: "Only the person the card is for can say yes to it." };
    if (body.chosen !== YES) return { refused: "That card wasn't said yes to." };
    const text = String(body.action.args?.text ?? "").trim();
    const refused = text ? refusal(text) : "There's nothing to tell.";
    if (refused) return { refused };
    const [found] = await homeNotes.queryAll({ filters: { cardId: String(card.id) }, fields: [...NOTE_FIELDS] }, passedOn(options));
    if (found) return { note: asNote(found) };
    const made = await homeNotes.create({
      text: text.slice(0, 500),
      byUserId: me,
      viaBotId: String(card.authorBotId),
      fromConversationId: String(card.conversationId),
      cardId: String(card.id)
    }, { ...passedOn(options), returning: "record" });
    return { note: asNote(made) };
  }

  /**
   * The home's notes not removed, newest first, a page at a time (`after`: the page before's `next`, null after the
   * last). One read.
   * @param {{ after?: string | null, size: number }} page
   * @param {CallOptions} options
   */
  async function list({ after = null, size }, options) {
    const { records, page } = await homeNotes.query({
      filters: { live: true },
      sort: ["-id"],
      page: { size, ...(after ? { after: String(after) } : {}) },
      fields: [...NOTE_FIELDS]
    }, passedOn(options));
    return { notes: records.map(asNote), next: page.next ?? null };
  }

  /** One note not removed, or null. */
  async function find(noteId, options) {
    if (!/^\d+$/u.test(String(noteId ?? ""))) return null;
    const filters = { id: [String(noteId)], live: true };
    const [found] = await homeNotes.queryAll({ filters, fields: [...NOTE_FIELDS] }, passedOn(options));
    return found ? asNote(found) : null;
  }

  /** A note removed by the caller: kept, with who removed it and when; answers whether it was still there. */
  async function remove(noteId, options) {
    const changed = await homeNotes.patchWhere(
      { id: [String(noteId)], live: true },
      { removedAt: homeNotes.raw("now()"), removedBy: personOf(options) },
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
