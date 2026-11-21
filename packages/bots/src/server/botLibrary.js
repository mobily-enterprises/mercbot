import { BotsError } from "./botsError.js";
import { isId, plainText } from "./botRows.js";
import { createCallerReaders } from "./records/recordRows.js";
import { MADE_KINDS } from "./records/messageRepository.js";

// The Library's reach into what a bot made: the 400 newest things, and every pinned one however old.
const MADE_READ = 400;
// Search shows up to 5 made things by name.
const MADE_FOUND = 5;

/** One Library entry from a made message's kind and one of its parts: a files card's file, a pictures card's picture or the card. */
function entryOf(kind, part) {
  if (kind === "files") return { kind: "file", name: part.name, path: part.path, size: part.size, pinned: Boolean(part.pinned) };
  if (kind === "pictures") return { kind: "picture", name: part.title, path: part.path, summary: part.caption, pinned: Boolean(part.pinned) };
  return { kind, name: part.title, path: part.path, summary: part.summary || part.caption || "", pinned: Boolean(part.pinned) };
}

/** An entry with the message that made it: its bot and its chat. */
const placed = (entry, row) => ({
  ...entry,
  messageId: String(row.id),
  botId: row.author_bot_id == null ? null : String(row.author_bot_id),
  chatId: String(row.conversation_id),
  createdAt: new Date(row.created_at).toISOString()
});

/**
 * A bot's Library and the search palette (D-112, R11): what a bot made in the chats the person can open, and what the
 * person finds across them. Every method takes the call's options last: the person and the home are its context, and
 * the records' row policies keep every read to the chats the person may open.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("@local/apps/server/types").Apps} dependencies.apps the home's views, which search finds by name
 * @param {import("@local/files/server/types").Files} dependencies.files a page's file, removed from the Library
 */
export function createBotLibrary({ records, apps, files }) {
  const { bots, chats, messages } = records;
  const { personOf } = createCallerReaders();

  // Everything made (files, charts, pages), newest first, one entry per path (a page updated later shows once), with
  // pins kept on the message that made it. A page deleted from the Library is left out.
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

  /**
   * A bot's Library, its card's on Team: what it made in every chat the person can open, and nothing from the others.
   * The newest made things, then the pinned ones older than those, so a pin never drops out of Pinned. Two reads.
   */
  async function library(botId, options) {
    const bot = await bots.get(botId, options);
    const newest = await messages.madeIn(null, MADE_READ, options, { botId: bot.id });
    if (newest.length < MADE_READ) return { items: madeItems(newest) };
    const olderPinned = await messages.pinnedBefore(null, String(newest.at(-1).id), options, { botId: bot.id });
    const read = new Set(newest.map((message) => String(message.id)));
    return { items: madeItems([...newest, ...olderPinned]).filter((item) => item.pinned || read.has(item.messageId)) };
  }

  /** A made message of the bot's in a chat the person can open, of one of `kinds`, or null. */
  async function madeMessage(botId, messageId, options, kinds = MADE_KINDS) {
    const message = isId(messageId) ? await messages.messageById(String(messageId), options) : null;
    if (!message || String(message.author_bot_id) !== String(botId) || !kinds.includes(message.kind)) return null;
    return message;
  }

  /** A Library entry pinned or unpinned, by anyone who can open the chat it was made in. Answers the Library. */
  async function pinItem(botId, { messageId, path, pinned } = {}, options) {
    const bot = await bots.get(botId, options);
    const message = await madeMessage(bot.id, messageId, options);
    if (!message) throw new BotsError(404, "That isn't in the Library.", { code: "bots_library_entry_not_found" });
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
    return library(bot.id, options);
  }

  /**
   * Deleting a page from the Library, after the person confirmed, by anyone who can open the chat it was made in: its
   * file goes (one already gone is fine), with its versions and its link (D-74), and every card of it says it was
   * deleted, wherever the same file shows: the home's shared folder is everyone's, the bot's folder the bot's in all
   * its chats, and a chat's folder that chat's (R6). It's the person's own action, so the chat's place reaches the
   * bot's and the home's folders even from a private chat (D13). Answers the Library and the cards in the page's chat.
   */
  async function deletePage(botId, messageId, options) {
    const bot = await bots.get(botId, options);
    const page = await madeMessage(bot.id, messageId, options, ["page"]);
    if (!page || page.body.removed) throw new BotsError(404, "That page isn't in the Library.", { code: "bots_library_page_not_found" });
    const chat = await chats.get(page.conversation_id, options);
    const pagePath = String(page.body.path);
    const homeId = String(bot.workspace_id);
    const chatPlace = files.store.placeFor({ homeId, chatId: String(chat.id), chatKind: chat.kind, botId: String(bot.id) });
    const place = files.store.widened(chatPlace);
    try {
      await files.store.remove(place, pagePath);
    } catch (error) {
      if (error?.code !== "files_file_gone") throw error;
    }
    await files.store.settle(homeId);
    await files.pages.pathChanged({ homeId, botId: String(bot.id), from: pagePath, to: null });
    const where = pagePath.startsWith("/files/shared/")
      ? {}
      : pagePath.startsWith("/files/bot/")
        ? { madeBy: String(bot.id) }
        : { conversationId: String(chat.id) };
    const cards = await messages.markPageRemoved(where, pagePath, String(chat.id), options);
    return { ...(await library(bot.id, options)), messages: cards };
  }

  /**
   * How search names a chat: its title, or a direct chat by its bot, with the person's name when it's someone else's.
   * @param {Map<string, object>} chatOf chat rows by id
   */
  function chatNames(chatOf, botNames, peopleNames, person) {
    return (chatId) => {
      const chat = chatOf.get(String(chatId));
      if (!chat) return null;
      if (chat.title) return chat.title;
      const bot = botNames.get(String(chat.direct_bot_id)) || "A bot";
      if (chat.direct_user_id == null || String(chat.direct_user_id) === person) return bot;
      return `${bot} and ${peopleNames.get(String(chat.direct_user_id)) || "Someone"}`;
    };
  }

  /**
   * The search palette, in the chats the person can open that aren't archived (messages.searchedConversations): with
   * no query, every routine there, for the page to match as the person types; with a query, up to 5 messages
   * containing it, earliest match in the text first, and the made things and views whose name holds it. Each result
   * names its chat, which it opens. A fixed number of reads, whatever it finds.
   */
  async function search(query, options) {
    const person = personOf(options);
    const text = String(query || "").trim().slice(0, 100);
    // The palette reads the routines once, as it opens; each query then reads only what matches it.
    const routines = text ? [] : await messages.searchRoutines(options);
    const found = text.length >= 2 ? await messages.searchText(text, options) : [];
    // Made files come first in search, matched by name.
    const made = text.length >= 2 ? await messages.searchMade(text, MADE_FOUND, options) : [];
    const chatIds = [...new Set([...routines, ...found, ...made].map((row) => String(row.conversation_id)))];
    const chatRows = await chats.byIds(chatIds, options);
    const chatOf = new Map(chatRows.map((row) => [String(row.id), row]));
    const botIds = [
      ...routines.map((row) => row.bot_id),
      ...found.map((row) => row.author_bot_id),
      ...made.map((row) => row.author_bot_id),
      ...chatRows.map((row) => row.direct_bot_id)
    ].filter((id) => id != null);
    const userIds = [...found.map((row) => row.author_user_id), ...chatRows.map((row) => row.direct_user_id)]
      .filter((id) => id != null && String(id) !== person);
    const [botRows, peopleNames] = await Promise.all([bots.byIds(botIds, options), chats.names(userIds, options)]);
    const botNames = new Map(botRows.map((bot) => [String(bot.id), bot.name]));
    const chatName = chatNames(chatOf, botNames, peopleNames, person);
    const authorOf = (row) => {
      if (row.author_bot_id != null) return botNames.get(String(row.author_bot_id)) || null;
      if (row.author_user_id == null) return null;
      return String(row.author_user_id) === person ? "you" : peopleNames.get(String(row.author_user_id)) || "Someone";
    };
    let filesFound = [];
    if (text.length >= 2) {
      filesFound = made.map((row) => ({
        ...placed(entryOf(row.kind, row.part), row),
        botName: botNames.get(String(row.author_bot_id)) || null,
        chatName: chatName(row.conversation_id)
      }));
      // Views (D-55): every one in the home, whichever chat made it (D-66).
      const views = await apps.apps.searchViews(text, options, { limit: 5 });
      filesFound = [...views.map((view) => ({ kind: "view", name: view.name, path: view.slug })), ...filesFound];
    }
    return {
      routines: routines.map((row) => ({
        id: String(row.id),
        name: row.name,
        schedule: row.enabled ? row.schedule : "Paused",
        botId: String(row.bot_id),
        botName: botNames.get(String(row.bot_id)) || null,
        chatId: String(row.conversation_id),
        chatName: chatName(row.conversation_id)
      })),
      files: filesFound,
      messages: found.map((row) => ({
        id: String(row.id),
        chatId: String(row.conversation_id),
        chatName: chatName(row.conversation_id),
        chatKind: chatOf.get(String(row.conversation_id))?.kind ?? null,
        role: row.role,
        authorName: authorOf(row),
        text: plainText(row.body.text, row.body.mentions, row.body.mentionedPeople),
        createdAt: new Date(row.created_at).toISOString()
      }))
    };
  }

  return Object.freeze({
    library,
    pinItem,
    deletePage,
    search
  });
}
