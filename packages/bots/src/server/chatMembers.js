import { mayChangeBot } from "./botAdditions.js";
import { BotsError } from "./botsError.js";
import { cleanName, cloudShape, isId, previewOf, toMessage, toSection } from "./botRows.js";
import { createCallerReaders } from "./records/recordRows.js";

// The most chats one person's list shows; a home's person rarely has more than a few dozen.
const LIST_LIMIT = 500;

/**
 * Chats and their members (D-112, R2), as the chat routes answer them: the person's chat list, one chat, making one,
 * joining and leaving, adding and removing people and bots, renaming, archiving and deleting, the person's own place in
 * each (pins, sections, hidden, muted, read), and the direct chat a bot's [Message] opens.
 *
 * Who may: anyone in the home makes a chat and joins a public one; anyone in a chat adds people of the home and bots
 * of the home; the chat's maker and the home's owners and admins remove members, rename, archive and delete; anyone
 * leaves. What a caller may read is the records' (rowPolicies.js): a chat they can't open is a 404 everywhere.
 * Everyone in a chat is told of each change, on any server, as a `chat` event naming the chat and what changed. A
 * deleted chat's computers and files go with it (computer.chatRemoved). The home's everyone chat counts as pinned for
 * everyone in it (O9), and has every active member of the home: a change of the home's people (homeChanged) seats
 * whoever joined and takes whoever left out of every chat.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 * @param {Pick<import("@local/computer/server/types").Computer, "chatRemoved">} dependencies.computer
 * @param {(reason: string) => object} dependencies.systemContext the bots' system context, for a change of the home's people
 */
export function createChatMembers({ records, notices, computer, systemContext }) {
  const { chats, messages } = records;
  const { homeOf, personOf } = createCallerReaders();

  /** Everyone named hears that a chat changed (`change`), on any server; a failure leaves it to their next read. */
  const tell = (people, chatId, change) => notices.publishEach("bots", people, { type: "chat", chatId: String(chatId), change })
    .catch((error) => console.warn("Telling people about a chat change failed; they see it on their next read.", error));

  /** Everyone in the chat now, and anyone given besides (someone who just left), hears of the change. */
  async function told(chatId, change, options, besides = []) {
    const people = (await chats.people(chatId, options)).map((person) => person.user_id);
    await tell([...new Set([...people, ...besides.map(String)])], chatId, change);
  }

  /**
   * A deleted chat's computers put to sleep and its files and its computers' files removed from the bucket, after the
   * chat itself is gone; a failure leaves them to the computers' hourly sweep.
   */
  const chatRemoved = (homeId, chatId, chatBotIds) => computer.chatRemoved({ homeId: String(homeId), chatId: String(chatId), chatBotIds })
    .catch((error) => console.warn("Removing a deleted chat's computers and files failed; the hourly sweep removes them.", error));

  /** The seats of a chat's bots, read before the chat goes. */
  const seatsIn = async (chatId, options) => (await chats.bots(chatId, options)).map((bot) => String(bot.chat_bot_id));

  /** Refused for the everyone chat, which has every active member of the home. */
  function requireNotEveryone(chat) {
    if (chat.everyone) throw new BotsError(409, "Everyone in the home is in this chat.", { code: "bots_chat_everyone" });
  }

  /** The chat, which the caller may open, or a 404. */
  async function openChat(chatId, options) {
    if (!isId(chatId)) throw new BotsError(404, "Chat not found.", { code: "bots_chat_not_found" });
    return chats.get(chatId, options);
  }

  /** Refused unless the caller is one of the chat's people: who adds members to a chat. */
  async function requireInChat(chat, options) {
    if (!(await chats.isPerson(chat.id, personOf(options), options))) {
      throw new BotsError(403, "Join the chat first to add someone to it.", { code: "bots_chat_join_first" });
    }
  }

  /** Refused unless the caller made the chat or is one of the home's owners and admins. */
  function requireManager(chat, options, verb) {
    if (!mayChangeBot(chat.made_by, personOf(options), options)) {
      throw new BotsError(403, `Only the person who started this chat and the home's owners and admins can ${verb} it.`, {
        code: "bots_chat_manage_forbidden"
      });
    }
  }

  /**
   * Chats as the page shows them, with their people, bots, latest message and the caller's place: four reads for any
   * number of chats.
   * @param {object[]} rows chat rows, each with its `place` when the caller is in it
   */
  async function viewsOf(rows, options) {
    const ids = rows.map((row) => String(row.id));
    const [people, bots, latest] = await Promise.all([
      chats.peopleOf(ids, options),
      chats.botsOf(ids, options),
      messages.latestPerConversation(ids, options)
    ]);
    const latestOf = new Map(latest.map((row) => [String(row.conversation_id), row]));
    return rows.map((row) => {
      const last = latestOf.get(String(row.id));
      return {
        id: String(row.id),
        kind: row.kind,
        title: row.title ?? null,
        everyone: Boolean(row.everyone),
        directBotId: row.direct_bot_id == null ? null : String(row.direct_bot_id),
        appId: row.app_id ?? null,
        madeBy: row.made_by == null ? null : String(row.made_by),
        onboardingStep: row.onboarding_step ?? null,
        archivedAt: row.archived_at ?? null,
        lastActivityAt: row.last_activity_at,
        people: (people.get(String(row.id)) ?? []).map((person) => ({ userId: person.user_id, name: person.name })),
        bots: (bots.get(String(row.id)) ?? []).map((bot) => ({
          chatBotId: bot.chat_bot_id,
          botId: bot.bot_id,
          name: bot.name,
          color: bot.color,
          shape: cloudShape(bot.shape),
          archived: Boolean(bot.archived_at),
          waitingTask: bot.waiting_task
        })),
        place: row.place ? placeOf(row.place) : null,
        latest: last ? { ...toMessage(last), preview: previewOf(last) } : null
      };
    });
  }

  /** One chat as the page shows it, with the caller's place in it (null when they aren't in it). */
  async function viewOf(chat, options) {
    const row = await chats.place(chat.id, options);
    const place = row && {
      readUpTo: row.read_up_to,
      unread: row.unread,
      pinPosition: row.pin_position,
      sectionId: row.section_id,
      hidden: row.hidden,
      muted: row.muted
    };
    const [view] = await viewsOf([{ ...chat, place }], options);
    return view;
  }

  /** The person's place in a chat (its chat_people fields), as the page reads it. */
  const placeOf = (place) => ({
    readUpTo: place.readUpTo == null ? null : String(place.readUpTo),
    unread: Boolean(place.unread),
    pinPosition: place.pinPosition ?? null,
    sectionId: place.sectionId == null ? null : String(place.sectionId),
    hidden: Boolean(place.hidden),
    muted: Boolean(place.muted)
  });

  /**
   * The person's chat list: the chats they're in (hidden ones with `hidden`, archived ones with `archived`), newest
   * activity first, and their sections.
   */
  async function list({ hidden = false, archived = false } = {}, options) {
    const rows = (await chats.ofPerson(options, { hidden, archived })).slice(0, LIST_LIMIT);
    const [views, sections] = await Promise.all([viewsOf(rows, options), chats.sections.list(options)]);
    // The everyone chat first, pinned for everyone (O9); the rest newest activity first.
    views.sort((a, b) => Number(b.everyone) - Number(a.everyone));
    return { chats: views, sections: sections.map(toSection) };
  }

  /** The public chats of the home the person isn't in, for New chat's "or join a public chat". */
  async function publicChats(options) {
    return { chats: await viewsOf(await chats.publicChats(options), options) };
  }

  /** One chat the person can open. */
  async function get(chatId, options) {
    return { chat: await viewOf(await openChat(chatId, options), options) };
  }

  /**
   * A new chat (New chat's [Start]): Public unless `kind` is "private" (D15), with the people and bots named, the
   * person who makes it among its people.
   */
  async function create({ kind, title, people = [], bots = [] } = {}, options) {
    const chat = await chats.create({ kind, title, people: [...people].map(String), bots: [...bots].map(String) }, options);
    await told(chat.id, "created", options);
    return get(chat.id, options);
  }

  /** The person's direct chat with a bot (its [Message]), made on first use. */
  async function direct(botId, options) {
    const chat = await chats.direct(String(botId), options);
    return get(chat.id, options);
  }

  /** A person of the home added to a chat by someone in it. */
  async function addPerson(chatId, userId, options) {
    const chat = await openChat(chatId, options);
    await requireInChat(chat, options);
    if (await chats.addPerson(chat.id, String(userId ?? ""), options)) await told(chat.id, "members", options);
    return get(chat.id, options);
  }

  /** A public chat joined by the person. */
  async function join(chatId, options) {
    const chat = await openChat(chatId, options);
    if (chat.kind !== "public") throw new BotsError(404, "Chat not found.", { code: "bots_chat_not_found" });
    if (await chats.addPerson(chat.id, personOf(options), options)) await told(chat.id, "members", options);
    return get(chat.id, options);
  }

  /**
   * A person out of a chat: the person themselves (leaving), or anyone by its maker or the home's owners and admins.
   * A private chat whose last person goes is deleted (D-112), with its computers and files. No one leaves the
   * everyone chat but by leaving the home. Answers the chat, or `{ deleted: true }`.
   */
  async function removePerson(chatId, userId, options) {
    const chat = await openChat(chatId, options);
    requireNotEveryone(chat);
    const leaving = String(userId) === personOf(options);
    if (!leaving) requireManager(chat, options, "remove people from");
    const seats = chat.kind === "private" ? await seatsIn(chat.id, options) : [];
    if (await chats.removePerson(chat.id, String(userId), options)) {
      await chatRemoved(homeOf(options), chat.id, seats);
      await tell([String(userId)], chat.id, "deleted");
      return { deleted: true };
    }
    await tell([String(userId)], chat.id, "members");
    // A public chat stays readable to someone who left it; a private one isn't theirs to read any more.
    if (leaving && chat.kind === "private") return { left: true };
    await told(chat.id, "members", options);
    return get(chat.id, options);
  }

  /** The person leaves a chat. */
  const leave = (chatId, options) => removePerson(chatId, personOf(options), options);

  /** A bot of the home added to a chat by someone in it (not an archived bot, D-108). */
  async function addBot(chatId, botId, options) {
    const chat = await openChat(chatId, options);
    await requireInChat(chat, options);
    await chats.addBot(chat.id, String(botId ?? ""), options);
    await told(chat.id, "members", options);
    return get(chat.id, options);
  }

  /** A bot out of a chat, with its computer, routines and runs there, by the chat's maker or an owner or admin. */
  async function removeBot(chatId, botId, options) {
    const chat = await openChat(chatId, options);
    requireManager(chat, options, "remove bots from");
    if (await chats.removeBot(chat.id, String(botId), options)) await told(chat.id, "members", options);
    return get(chat.id, options);
  }

  /** A chat's new title, by its maker or an owner or admin. */
  async function rename(chatId, title, options) {
    const chat = await openChat(chatId, options);
    requireManager(chat, options, "rename");
    await chats.rename(chat.id, title, options);
    await told(chat.id, "renamed", options);
    return get(chat.id, options);
  }

  /** A chat archived (read-only for everyone in it) or back in use, by its maker or an owner or admin. */
  async function archiving(chatId, archived, options) {
    const chat = await openChat(chatId, options);
    requireManager(chat, options, archived ? "archive" : "unarchive");
    await (archived ? chats.archive(chat.id, options) : chats.unarchive(chat.id, options));
    await told(chat.id, archived ? "archived" : "unarchived", options);
    return get(chat.id, options);
  }

  /** A chat archived: read-only for everyone in it. */
  const archive = (chatId, options) => archiving(chatId, true, options);

  /** An archived chat back in use. */
  const unarchive = (chatId, options) => archiving(chatId, false, options);

  /** A chat deleted with everything in it, its computers and files too, by its maker or an owner or admin. */
  async function remove(chatId, options) {
    const chat = await openChat(chatId, options);
    requireManager(chat, options, "delete");
    const [people, seats] = await Promise.all([chats.people(chat.id, options), seatsIn(chat.id, options)]);
    await chats.remove(chat.id, options);
    await chatRemoved(homeOf(options), chat.id, seats);
    await tell(people.map((person) => person.user_id), chat.id, "deleted");
    return { deleted: true };
  }

  /**
   * Changes to the person's own place in a chat: `pinned` (true pins it last, false unpins), `sectionId`, `hidden`,
   * `muted`, `unread`. Only for a chat they're in. The everyone chat is pinned already: `pinned` doesn't move it.
   */
  async function changePlace(chatId, changes = {}, options) {
    const chat = await openChat(chatId, options);
    const fields = {};
    if (changes.pinned !== undefined && !chat.everyone) fields.pinPosition = changes.pinned ? await chats.nextPinPosition(options) : null;
    if (changes.sectionId !== undefined) fields.sectionId = await sectionOrNull(changes.sectionId, options);
    for (const field of ["hidden", "muted", "unread"]) if (changes[field] !== undefined) fields[field] = Boolean(changes[field]);
    if (!(await chats.updatePlace(chat.id, fields, options))) {
      throw new BotsError(404, "You aren't in this chat.", { code: "bots_chat_not_in" });
    }
    return get(chat.id, options);
  }

  /** One of the person's sections by id, or null for none; another's or a made-up one is a 404. */
  async function sectionOrNull(sectionId, options) {
    if (sectionId == null || sectionId === "") return null;
    return String((await chats.sections.owned(String(sectionId), options)).id);
  }

  /** The person has read a chat up to a message. */
  async function markRead(chatId, messageId, options) {
    const chat = await openChat(chatId, options);
    await chats.markRead(chat.id, isId(messageId) ? String(messageId) : null, options);
    return { ok: true };
  }

  /** The person's pinned chats in a new order. */
  async function reorderPins(chatIds, options) {
    const ids = Array.isArray(chatIds) ? chatIds.filter(isId).map(String) : [];
    if (!(await chats.reorderPins(ids, options))) throw new BotsError(409, "Your pinned chats changed. Reload and try again.", { code: "bots_pins_changed" });
    return list({}, options);
  }

  /** A section of the person's chat list; made from a chat, it sits directly above the chat and holds it. */
  async function createSection({ name, chatId } = {}, options) {
    await chats.withTransaction(options, async (txOptions) => {
      const sections = await chats.sections.lock(txOptions);
      const place = chatId ? await chats.place(String(chatId), txOptions) : null;
      if (chatId && !place) throw new BotsError(404, "You aren't in this chat.", { code: "bots_chat_not_in" });
      const current = place?.section_id ? sections.find((section) => String(section.id) === String(place.section_id)) : null;
      const section = await chats.sections.insert(cleanName(name), current ? current.position : sections.length, sections, txOptions);
      if (place) await chats.updatePlace(String(chatId), { sectionId: String(section.id), pinPosition: null }, txOptions);
    });
    return list({}, options);
  }

  /** A section renamed, or collapsed and opened. */
  async function updateSection(sectionId, changes = {}, options) {
    const section = await chats.sections.owned(sectionId, options);
    const fields = {};
    if (changes.name !== undefined) fields.name = cleanName(changes.name);
    if (changes.collapsed !== undefined) fields.collapsed = Boolean(changes.collapsed);
    return { section: toSection(Object.keys(fields).length ? await chats.sections.update(section.id, fields, options) : section) };
  }

  /** A section moved one place up or down the list. */
  async function moveSection(sectionId, direction, options) {
    await chats.withTransaction(options, async (txOptions) => {
      const sections = await chats.sections.lock(txOptions);
      const index = sections.findIndex((section) => String(section.id) === String(sectionId));
      if (index < 0) throw new BotsError(404, "Section not found.", { code: "bots_section_not_found" });
      const other = sections[index + (direction === "up" ? -1 : 1)];
      if (other) await chats.sections.swap(sections[index], other, txOptions);
    });
    return list({}, options);
  }

  /** A section deleted; its chats go back to the list's main part. */
  async function deleteSection(sectionId, options) {
    const section = await chats.sections.owned(sectionId, options);
    await chats.sections.remove(section.id, options);
    return list({}, options);
  }

  /**
   * The home's people changed (someone joined, left or was removed): whoever joined is seated in the everyone chat, and
   * whoever left is taken out of every chat, their private chats with no one else deleted with their computers and
   * files and the routines they made paused (records.chats.personLeft). Everyone in a chat that changed hears, the
   * person who left too. In the bots' system context for the home; the members' list bounds it.
   * @param {string} homeId
   */
  async function homeChanged(homeId) {
    const home = { context: systemContext("the home's people join and leave its chats").forWorkspace(String(homeId)) };
    const { departed, joined, everyoneChatId } = await chats.syncMembers(home);
    if (joined.length) await told(everyoneChatId, "members", home);
    for (const userId of departed) {
      const { left, deleted } = await chats.personLeft(userId, home);
      for (const { chatId, chatBotIds } of deleted) {
        await chatRemoved(homeId, chatId, chatBotIds);
        await tell([userId], chatId, "deleted");
      }
      for (const chatId of left) await told(chatId, "members", home, [userId]);
    }
    return { joined, departed };
  }

  return Object.freeze({
    homeChanged,
    list,
    publicChats,
    get,
    create,
    direct,
    addPerson,
    join,
    removePerson,
    leave,
    addBot,
    removeBot,
    rename,
    archive,
    unarchive,
    remove,
    changePlace,
    markRead,
    reorderPins,
    createSection,
    updateSection,
    moveSection,
    deleteSection
  });
}
