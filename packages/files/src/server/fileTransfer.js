import path from "node:path";
import { BOT, CHAT, FilesError, SHARED } from "./fileStore.js";

// Copy to… and Move to… between any two places a person can open in a home (D-120): the home's files, a bot's files and
// a chat's. Each place is named as `{ kind: "home" } | { kind: "bot", botId } | { kind: "chat", chatId }`, and its
// files by the paths the file routes use, under the place's own folder: /files/shared/… for the home's, /files/bot/…
// for a bot's, /files/chat/… for a chat's. A place is resolved with the caller's rights, as the file routes' placeOf is:
// one they can't open is a 404. What a person does is their own doing, so a private chat's place is widened (D13), but
// taking a file out of a private chat to where someone who can't open that chat could see it needs their yes first
// (409 files_wider_needs_confirm, then `confirmed`). A bot's transfer_file reaches the same work through a card its
// person says yes to.

const ID = /^\d+$/u;
// The files that arrive are queued for a copy's check this many at a time (D-90).
const QUEUE_BATCH = 200;

const notFound = () => new FilesError(404, "That chat or bot isn't here.", { code: "files_place_not_found" });
const archived = () => new FilesError(409, "This chat is archived. Unarchive it to continue.", { code: "bots_chat_archived" });
const invalid = (message) => new FilesError(400, message, { code: "files_transfer_invalid" });

/** A chat row of the records (snake_case) as the places name a chat. */
const asChat = (row) => ({
  id: String(row.id),
  kind: row.kind,
  title: row.title ?? null,
  directBotId: row.direct_bot_id == null ? null : String(row.direct_bot_id),
  directUserId: row.direct_user_id == null ? null : String(row.direct_user_id),
  directPersonId: row.direct_person_id == null ? null : String(row.direct_person_id),
  archivedAt: row.archived_at ?? null
});

/** "/files/chat/a/../b" as it is when it's normal and under `root` (the root itself only for a folder), else null. */
function underRoot(value, root, { folder = false } = {}) {
  const given = String(value ?? "").trim().replace(/(?<=.)\/+$/u, "");
  if (path.posix.normalize(given) !== given) return null;
  if (given === root) return folder ? given : null;
  return given.startsWith(`${root}/`) ? given : null;
}

/**
 * The places and the transfer between them.
 * @param {object} dependencies
 * @param {Pick<import("./types.js").Files, "store" | "pages" | "media">} dependencies.files
 * @param {{ directory: object, chats: object }} dependencies.records mercbot.bots.records: the chats and bots the caller
 *   may read
 */
export function createFileTransfer({ files, records }) {
  const { store, pages, media } = files;

  /** The other person of a chat between two people, as `me` sees it. */
  const otherOf = (chat, me) => (chat.directUserId === String(me) ? chat.directPersonId : chat.directUserId);

  /** A chat's name as the caller sees it: its title, or a direct chat's other side. */
  function titleOf(chat, me, botNames, peopleNames) {
    if (chat.directBotId) return botNames.get(chat.directBotId) || "Bot";
    if (chat.directPersonId) return peopleNames.get(otherOf(chat, me)) || "Someone";
    return chat.title || "Chat";
  }

  /** What a direct chat is: with a bot, between two people, or neither. */
  const directOf = (chat) => (chat.directBotId ? "bot" : chat.directPersonId ? "person" : null);

  /**
   * Every place the caller can open in the home, for the file browser and Copy to…: the home's files, its bots that
   * aren't archived (`main` on the home's main bot), and every chat they can open (their own, hidden and archived ones
   * too, and the public rooms they aren't in), each chat named as they see it. Three reads (the bots, the chats, the
   * other people's names) however many chats the home has.
   * @param {{ userId: string }} caller
   * @param {object} options the caller's call options
   */
  async function places({ userId }, options) {
    const [bots, chats] = await Promise.all([records.directory.homeBotFaces(options), records.directory.openableChats(options)]);
    const botNames = new Map(bots.map((bot) => [bot.id, bot.name]));
    const others = chats.filter((chat) => chat.directPersonId).map((chat) => otherOf(chat, userId));
    const peopleNames = others.length ? await records.chats.names(others, options) : new Map();
    return {
      places: [
        { kind: "home", label: "Home files" },
        ...bots.filter((bot) => !bot.archived).map((bot) => ({
          kind: "bot",
          botId: bot.id,
          name: bot.name,
          color: bot.color,
          shape: bot.shape,
          main: bot.main
        })),
        ...chats.map((chat) => ({
          kind: "chat",
          chatId: chat.id,
          title: titleOf(chat, userId, botNames, peopleNames),
          private: chat.kind !== "public",
          direct: directOf(chat),
          archived: Boolean(chat.archivedAt)
        }))
      ]
    };
  }

  /**
   * The chat the caller can open by the name they see it by (a room's title, a direct chat's other side), in any case:
   * where a bot's transfer_file card names a room. One not archived wins over archived ones; none, or two of the same
   * name, is a refusal that says so.
   * @param {string} name
   * @param {{ userId: string }} caller
   * @param {object} options the caller's call options
   */
  async function chatNamed(name, caller, options) {
    const wanted = String(name ?? "").trim().toLowerCase();
    const named = (await places(caller, options)).places
      .filter((place) => place.kind === "chat" && place.title.toLowerCase() === wanted);
    const open = named.filter((place) => !place.archived);
    const found = open.length ? open : named;
    if (!found.length) throw new FilesError(404, `There's no room or chat called "${name}" here.`, { code: "files_place_not_found" });
    if (found.length > 1) {
      throw new FilesError(409, `More than one room or chat is called "${name}".`, { code: "files_place_ambiguous", params: { name } });
    }
    return found[0].chatId;
  }

  /**
   * A place named by the caller, with what the transfer needs of it: the store's place, its own folder, a key that's
   * the same for the same place, its words for a sentence, and a chat's row. A place they can't open is a 404.
   */
  async function resolve(given, { homeId, userId }, options) {
    const kind = given?.kind;
    if (kind === "home") return { kind, key: "home", place: store.homePlace(homeId), root: SHARED, words: "Home files" };
    if (kind === "bot") {
      const botId = String(given.botId ?? "");
      const bot = ID.test(botId) ? await records.directory.findBot(botId, options) : null;
      if (!bot) throw notFound();
      return { kind, key: `bot:${botId}`, botId, place: store.botPlace({ homeId, botId }), root: BOT, words: `${bot.name}'s files` };
    }
    if (kind === "chat") {
      const chatId = String(given.chatId ?? "");
      const row = ID.test(chatId) ? await records.chats.find(chatId, options) : null;
      if (!row) throw notFound();
      const chat = asChat(row);
      const words = await chatWords(chat, userId, options);
      const place = store.widened(store.placeFor({ homeId, chatId, chatKind: chat.kind }));
      return { kind, key: `chat:${chatId}`, chatId, chat, place, root: CHAT, words };
    }
    throw invalid("Name a place: the home's files, a bot's or a chat's.");
  }

  /** A chat in a sentence: "Family", "your chat with Tripbot". */
  async function chatWords(chat, userId, options) {
    if (chat.directBotId) return `your chat with ${(await records.directory.findBot(chat.directBotId, options))?.name || "a bot"}`;
    if (chat.directPersonId) {
      const other = otherOf(chat, userId);
      return `your chat with ${(await records.chats.names([other], options)).get(other) || "someone"}`;
    }
    return chat.title || "that chat";
  }

  /**
   * Whether a file of `from` would reach someone who can't open it at `to`: `from` is a private chat (a private room, a
   * chat with a bot or between two people), and `to` is the home's files, a bot's, a public room, or a private chat with
   * someone who isn't among `from`'s people.
   */
  async function widens(from, to, options) {
    if (from.kind !== "chat" || from.chat.kind === "public" || from.key === to.key) return false;
    if (to.kind !== "chat" || to.chat.kind === "public") return true;
    const people = await records.chats.peopleOf([from.chatId, to.chatId], options);
    const sources = new Set((people.get(from.chatId) ?? []).map((person) => person.user_id));
    return (people.get(to.chatId) ?? []).some((person) => !sources.has(person.user_id));
  }

  /**
   * Copies or moves a file or a whole folder from one place to a folder of another (or the same) place, as the caller.
   * Answers the destination's path, renamed " (2)" and on when the name is taken there. Pictures and videos that arrive
   * wait for a copy's check like the files a bot saves (D-90); a page that moves keeps its versions and link (D-74), and
   * a copied page is a page of its own.
   * @param {{ homeId: string, userId: string, mode: "copy" | "move", from: { place: object, path: string },
   *   to: { place: object, folder: string }, confirmed?: boolean }} transfer
   * @param {object} options the caller's call options
   */
  async function transfer({ homeId, userId, mode, from, to, confirmed = false }, options) {
    if (mode !== "copy" && mode !== "move") throw invalid("Say whether to copy or move it.");
    const caller = { homeId: String(homeId), userId: String(userId) };
    const [source, destination] = await Promise.all([resolve(from?.place, caller, options), resolve(to?.place, caller, options)]);
    const fromPath = underRoot(from?.path, source.root);
    const folder = underRoot(to?.folder, destination.root, { folder: true });
    if (!fromPath) throw new FilesError(400, `Name a file or folder in ${source.root}.`, { code: "files_path_outside" });
    if (!folder) throw new FilesError(400, `Name a folder in ${destination.root}.`, { code: "files_path_outside" });
    if (destination.chat?.archivedAt || (mode === "move" && source.chat?.archivedAt)) throw archived();
    if (!confirmed && await widens(source, destination, options)) {
      const place = destination.words;
      throw new FilesError(409, `Everyone who can open ${place} will see this file. Continue?`, {
        code: "files_wider_needs_confirm",
        params: { place }
      });
    }
    // The pictures and videos that arrived wait for a copy's check, queued a batch at a time, each once it has reached
    // where the home's files are kept, so whichever server checks it finds it (D-91).
    const arrived = [];
    const queue = async () => {
      if (!arrived.length) return;
      await store.settle(caller.homeId);
      await media.filesLater({ place: destination.place, paths: arrived.splice(0), workspaceId: caller.homeId, userId: caller.userId });
    };
    const moving = mode === "move";
    const { path: landed } = await store.transfer({
      from: { place: source.place, path: fromPath },
      to: { place: destination.place, folder },
      move: moving,
      async each(inner, at) {
        const was = inner ? `${fromPath}/${inner}` : fromPath;
        const now = inner ? `${at}/${inner}` : at;
        if (media.on) {
          arrived.push(now);
          if (arrived.length >= QUEUE_BATCH) await queue();
        }
        const toBotId = destination.botId ?? null;
        if (moving) await pages.pathChanged({ homeId: caller.homeId, botId: source.botId ?? null, from: was, to: now, toBotId });
        else await pages.copied({ place: destination.place, path: now });
      }
    });
    await store.settle(caller.homeId);
    await queue();
    return { path: landed };
  }

  return Object.freeze({
    places,
    chatNamed,
    transfer
  });
}
