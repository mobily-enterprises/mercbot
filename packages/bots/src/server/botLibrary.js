import { BotsError } from "./botsError.js";
import { plainText } from "./botRows.js";
import { MADE_KINDS } from "./records/messageRepository.js";

// The Library's reach into what the bot made: the 400 newest things, and every pinned one however old.
const MADE_READ = 400;
// Search shows up to 5 made things by name.
const MADE_FOUND = 5;

/** One Library entry from a made message's kind and one of its parts: a files card's file, a pictures card's picture or the card. */
function entryOf(kind, part) {
  if (kind === "files") return { kind: "file", name: part.name, path: part.path, size: part.size, pinned: Boolean(part.pinned) };
  if (kind === "pictures") return { kind: "picture", name: part.title, path: part.path, summary: part.caption, pinned: Boolean(part.pinned) };
  return { kind, name: part.title, path: part.path, summary: part.summary || part.caption || "", pinned: Boolean(part.pinned) };
}

/** An entry with the message that made it. */
const placed = (entry, row) => ({
  ...entry,
  messageId: String(row.id),
  botId: String(row.bot_id),
  createdAt: new Date(row.created_at).toISOString()
});

/**
 * The Library and search: what the bots made, and what the person can find across their chats.
 * Every method takes the call's options last: the person and the home are its context.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("./types.js").BotConversations} dependencies.conversations
 * @param {import("@local/apps/server/types").Apps} dependencies.apps
 * @param {import("@local/files/server/types").Files} dependencies.files
 */
export function createBotLibrary({ records, conversations, apps, files }) {
  const { conversations: store, messages } = records;
  // The Library: everything the bot made (files, charts, pages), newest first, one
  // entry per path (a page updated later shows once), with pins kept on the message that made it.
  // A page deleted from the Library is left out.
  function madeItems(rows) {
    const seen = new Set();
    const items = [];
    for (const row of rows) {
      const parts = row.kind === "files" ? row.body.files : row.kind === "pictures" ? row.body.images : [row.body];
      for (const part of parts) {
        const entry = entryOf(row.kind, part);
        if (seen.has(entry.path)) continue;
        seen.add(entry.path);
        if (!part.removed) items.push(placed(entry, row));
      }
    }
    return items;
  }

  // The newest made things, then the pinned ones older than those, so a pin never drops out of Pinned.
  async function library(botId, options) {
    const row = await conversations.ownedSingleBot(botId, options);
    const newest = await messages.madeIn(row.conversation_id, MADE_READ, options);
    if (newest.length < MADE_READ) return { items: madeItems(newest) };
    const olderPinned = await messages.pinnedBefore(row.conversation_id, String(newest.at(-1).id), options);
    const read = new Set(newest.map((message) => String(message.id)));
    return { items: madeItems([...newest, ...olderPinned]).filter((item) => item.pinned || read.has(item.messageId)) };
  }

  async function pinItem(botId, { messageId, path, pinned } = {}, options) {
    const row = await conversations.ownedSingleBot(botId, options);
    const message = messageId ? await messages.messageIn(row.conversation_id, String(messageId), options) : null;
    if (!message || !MADE_KINDS.includes(message.kind)) {
      throw new BotsError(404, "That isn't in the Library.", { code: "bots_library_entry_not_found" });
    }
    const body =
      message.kind === "files"
        ? { ...message.body, files: message.body.files.map((file) => (file.path === path ? { ...file, pinned: Boolean(pinned) } : file)) }
        : message.kind === "pictures"
          ? {
              ...message.body,
              images: message.body.images.map((image) => (image.path === path ? { ...image, pinned: Boolean(pinned) } : image))
            }
          : null;
    // A card's own pin is merged in by the database, so a delete that marked it meanwhile isn't undone.
    if (body) await messages.setBody(message.id, body, options);
    else await messages.mergeBody(message.id, { pinned: Boolean(pinned) }, options);
    return library(botId, options);
  }

  /**
   * Deleting a page from the Library, after the person confirmed: its file goes (one already
   * gone is fine), with its versions and its link (D-74), and every card of it says it was deleted,
   * wherever the same file shows: the home's shared folder is everyone's, the bot's folder (and a shared
   * bot's every folder) is the bot's in all its chats and groups, and the person's own folder is only
   * this chat's. Answers the Library and those cards.
   */
  async function deletePage(botId, messageId, options) {
    const row = await conversations.ownedSingleBot(botId, options);
    const page = /^\d+$/u.test(String(messageId)) ? await messages.messageIn(row.conversation_id, String(messageId), options, { kind: "page" }) : null;
    if (!page || page.body.removed) throw new BotsError(404, "That page isn't in the Library.", { code: "bots_library_page_not_found" });
    const pagePath = String(page.body.path);
    const place = files.store.placeFor(row, row.user_id);
    try {
      await files.store.remove(place, pagePath);
    } catch (error) {
      if (error?.code !== "files_file_gone") throw error;
    }
    await files.store.settle(place.homeId);
    await files.pages.pathChanged({ homeId: place.homeId, botId: String(botId), from: pagePath, to: null });
    const where = pagePath.startsWith("/files/shared/")
      ? {}
      : pagePath.startsWith("/files/bot/") || row.sharing === "shared"
        ? { madeBy: String(botId) }
        : { conversationId: row.conversation_id };
    const cards = await messages.markPageRemoved(where, pagePath, row.conversation_id, options);
    return { ...(await library(botId, options)), messages: cards };
  }

  /**
   * Search palette: with no query, every routine, for the page to match as the person types;
   * with a query, up to 5 messages containing it, across chats and groups, earliest match in the text first, and the
   * made things and views whose name holds it. Conversations a person may search: their own and the home's shared
   * rooms (D-36), a group's room only for the people in it (D-46), a group computer's row never
   * (messages.searchedConversations).
   */
  async function search(query, options) {
    const text = String(query || "").trim().slice(0, 100);
    // The palette reads the routines once, as it opens; each query then reads only what matches it.
    const routines = text ? [] : await messages.searchRoutines(options);
    const found = text.length >= 2 ? await messages.searchText(text, options) : [];
    // Made files come first in search, matched by name.
    const made = text.length >= 2 ? await messages.searchMade(text, MADE_FOUND, options) : [];
    const bots = await store.botsById([...routines, ...found, ...made].map((row) => row.bot_id), options);
    const nameOf = (botId) => bots.get(String(botId))?.name;
    const messagesFound = found.map((row) => ({
      id: String(row.id),
      conversationId: String(row.bot_id),
      conversationName: nameOf(row.bot_id),
      conversationKind: bots.get(String(row.bot_id))?.kind,
      role: row.role,
      speaker: row.body.speaker || null,
      text: plainText(row.body.text, row.body.mentions),
      createdAt: new Date(row.created_at).toISOString()
    }));
    let files = [];
    if (text.length >= 2) {
      files = made.map((row) => ({ ...placed(entryOf(row.kind, row.part), row), botName: nameOf(row.bot_id) }));
      // Views (D-55): every one in the home, whoever's chat made it (D-66).
      const views = await apps.apps.searchViews(text, options, { limit: 5 });
      files = [...views.map((view) => ({ kind: "view", name: view.name, path: view.slug })), ...files];
    }
    return {
      routines: routines.map((row) => ({
        id: String(row.id),
        name: row.name,
        schedule: row.enabled ? row.schedule : "Paused",
        botId: String(row.bot_id),
        botName: nameOf(row.bot_id)
      })),
      files,
      messages: messagesFound
    };
  }

  return Object.freeze({
    library,
    pinItem,
    deletePage,
    search
  });
}
