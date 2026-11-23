import { mayChangeBot } from "./botAdditions.js";
import { BotsError, directChatRefusal } from "./botsError.js";
import { cleanName, cloudShape, isId, previewOf, toMessage, toSection } from "./botRows.js";
import { isDirect } from "./records/chatRepository.js";
import { BOT_WINDOW } from "./records/seatWindows.js";
import { createCallerReaders } from "./records/recordRows.js";

// The line in an archived chat naming the routines and watches its archiving paused.
const ARCHIVED_LINE = Object.freeze({
  text: "Paused while archived",
  detail: (paused) => `This chat was archived, so its ${paused} paused. They stay paused when it's unarchived: resume them here.`
});

/**
 * Chats and their members (D-112, R2), as the chat routes answer them: the person's chat list, the public rooms they
 * aren't in, one chat, making a room, joining and leaving, adding and removing people and bots, renaming, archiving and
 * deleting, the person's own place in each (pins, sections, hidden, muted, read), the direct chat a bot's [Message]
 * opens and the chat with another person.
 *
 * Who may: anyone in the home makes a room (named, with a first line from its maker) and joins a public one; anyone in
 * a chat adds people of the home; bots of the home are invited into a public room, and taken out, by anyone in the home,
 * and into a private one by its people; the chat's maker and the home's owners and admins remove people, rename,
 * switch whether its bots join in (D-115), archive and delete; anyone leaves. A direct chat (with a bot, or between two
 * people) takes nobody else and no title. A Public chat is archived for everyone (plan 5.1), never the everyone
 * chat: its bots' routines and watches there pause, with a line naming them, and stay paused when it's unarchived
 * (D-101). A Private chat isn't archived: each of
 * its people hides it for themselves (their place's `hidden`). What a caller may read is the records' (rowPolicies.js):
 * a chat they can't open is a 404 everywhere.
 * Everyone in a chat is told of each change, on any server, as a `chat` event naming the chat and what changed. A
 * deleted chat's computers and files go with it (computer.chatRemoved). The home's everyone chat counts as pinned for
 * everyone in it (O9), and has every active member of the home: a change of the home's people (homeChanged) seats
 * whoever joined and takes whoever left out of every chat.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 * @param {Pick<import("@local/computer/server/types").Computer, "chatRemoved">} dependencies.computer
 * @param {(reason: string) => object} dependencies.systemContext the bots' system context, for a change of the home's people
 * @param {(seats: Array<{ id: string, chatId: string }>, line: { text: string, detail: (paused: string) => string }, txOptions: object) => Promise<void>}
 *   dependencies.pauseWork the routines and watches of some bots in chats paused, with a line in each chat naming them
 *   (workPause.js)
 * @param {(botIds: string[], options: object) => Promise<void>} dependencies.forget a deleted public chat's bots forget
 *   it (roomsMemory.js forget, D-113, O23): their digests are made again from the chats left
 */
export function createChatMembers({ records, notices, computer, systemContext, pauseWork, forget }) {
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
   * A room's change everyone who can open it hears: a public room's every active member of the home (one read of them),
   * so a room they aren't in appears, changes and goes in their list without a reload; any other chat's own people.
   */
  async function toldWhoCanOpen(chat, change, options) {
    if (chat.kind !== "public" || isDirect(chat)) return told(chat.id, change, options);
    return tell((await chats.everyoneIn(options)).map(String), chat.id, change);
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

  /** Who invites a bot into a chat and takes one out: in a public room anyone in the home, else one of its people. */
  async function requireMayInviteBots(chat, options) {
    if (isDirect(chat)) throw directChatRefusal(chat);
    if (chat.kind !== "public") await requireInChat(chat, options);
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
   * The other person of each chat between two people among `rows`, as the caller sees it: the one of the pair who
   * isn't them. One read of their names, for any number of chats, and none without such a chat.
   * @returns {Promise<(row: object) => { userId: string, name: string } | null>}
   */
  async function otherPeople(rows, options) {
    const me = String(personOf(options));
    const otherOf = (row) => (String(row.direct_user_id) === me ? String(row.direct_person_id) : String(row.direct_user_id));
    const pairs = rows.filter((row) => row.direct_person_id != null);
    const named = pairs.length ? await chats.names(pairs.map(otherOf), options) : new Map();
    return (row) => (row.direct_person_id == null ? null : { userId: otherOf(row), name: named.get(otherOf(row)) || "Someone" });
  }

  /**
   * Chats as the page shows them, with their people, bots, latest message and the caller's place: four reads for any
   * number of chats, and one more for the names of the other people of chats between two people.
   * @param {object[]} rows chat rows, each with its `place` when the caller is in it
   */
  async function viewsOf(rows, options) {
    const ids = rows.map((row) => String(row.id));
    const [people, bots, latest, directPerson] = await Promise.all([
      chats.peopleOf(ids, options),
      chats.botsOf(ids, options),
      messages.latestPerConversation(ids, options),
      otherPeople(rows, options)
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
        directPerson: directPerson(row),
        appId: row.app_id ?? null,
        madeBy: row.made_by == null ? null : String(row.made_by),
        botsJoinIn: Boolean(row.bots_join_in),
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
      mentionedAt: row.mentioned_at,
      pinPosition: row.pin_position,
      sectionId: row.section_id,
      hidden: row.hidden,
      muted: row.muted
    };
    const [view] = await viewsOf([{ ...chat, place }], options);
    return view;
  }

  /**
   * The person's place in a chat (its chat_people fields), as the page reads it: `mentioned` while someone's message
   * there mentions them and they haven't read it since (D-114), the chat list's "@".
   */
  const placeOf = (place) => ({
    readUpTo: place.readUpTo == null ? null : String(place.readUpTo),
    unread: Boolean(place.unread),
    mentioned: place.mentionedAt != null,
    pinPosition: place.pinPosition ?? null,
    sectionId: place.sectionId == null ? null : String(place.sectionId),
    hidden: Boolean(place.hidden),
    muted: Boolean(place.muted)
  });

  /**
   * A page of the person's chat list: the chats they're in (hidden ones added with `hidden`, archived ones with
   * `archived`), newest made first, and their sections. `next` is the `after` of the page after it, null on the last:
   * the page reads them all and arranges the chats itself.
   */
  async function list({ hidden = false, archived = false, after = null } = {}, options) {
    const page = await chats.ofPerson(options, { hidden, archived, after });
    const [views, sections] = await Promise.all([viewsOf(page.chats, options), chats.sections.list(options)]);
    // The everyone chat first in its page, pinned for everyone (O9): the whole list when it's one page.
    views.sort((a, b) => Number(b.everyone) - Number(a.everyone));
    return { chats: views, sections: sections.map(toSection), next: page.next };
  }

  /**
   * A page of the home's public rooms the person isn't in, newest made first (`after`: the page before's `next`, null on
   * the last): what the list shows faded. The same reads for every page, whatever its rooms.
   */
  async function publicRooms({ after = null } = {}, options) {
    const page = await chats.publicRooms(options, { after: isId(after) ? String(after) : null });
    return { chats: await viewsOf(page.chats, options), next: page.next };
  }

  /**
   * A page of the person's hidden and archived chats that one bot (`withBot`) or one person (`withPerson`) is in too,
   * newest chat first, 20 at a time (`after`: the page before's `next`, null on the last): what a card adds under "Show
   * hidden and archived". 400 unless exactly one is named; 404 for a bot or person who isn't the home's. The same reads
   * for every page, whatever its chats.
   */
  async function sharedTuckedAway({ withBot = null, withPerson = null, after = null } = {}, options) {
    if (Boolean(withBot) === Boolean(withPerson)) {
      throw new BotsError(400, "Name one bot or one person.", { code: "bots_shared_needs_one" });
    }
    if (withBot && !(await records.directory.findBot(String(withBot), options))) {
      throw new BotsError(404, "Bot not found.", { code: "bots_bot_not_found" });
    }
    if (withPerson && !(await chats.isHomeMember(withPerson, options))) {
      throw new BotsError(404, "Person not found.", { code: "bots_person_not_found" });
    }
    const page = await chats.tuckedAwayWith(options, {
      botId: withBot ? String(withBot) : null,
      userId: withPerson ? String(withPerson) : null,
      after: isId(after) ? String(after) : null
    });
    return { chats: await viewsOf(page.chats, options), next: page.next };
  }

  /** One chat the person can open. */
  async function get(chatId, options) {
    return { chat: await viewOf(await openChat(chatId, options), options) };
  }

  /**
   * A new room (New room's [Create]): Public unless `kind` is "private" (D15), named (400 `bots_chat_needs_title`), the
   * person who makes it among its people with any people and bots named, and its first line, by its maker, written in
   * the same transaction: "<Name> started this room.", an event line that counts as its activity and that no bot
   * answers or judges (only a person's text message starts a reply). A room a bot's card starts (start_room, D-122) has
   * that bot's brief (`opening`) as its next message, in the same transaction; the route never passes one.
   * @param {{ kind?: string, title?: string, people?: string[], bots?: string[] }} room
   * @param {object} options
   * @param {{ opening?: { botId: string, botName: string, text: string, mentions?: Array<{ id: string, name: string }> } | null }} [made]
   */
  async function create({ kind, title, people = [], bots = [] } = {}, options, { opening = null } = {}) {
    const name = String(title ?? "").trim().slice(0, 80);
    if (!name) throw new BotsError(400, "Give the room a name.", { code: "bots_chat_needs_title" });
    const chat = await chats.withTransaction(options, async (txOptions) => {
      const made = await chats.create({ kind, title: name, people: [...people].map(String), bots: [...bots].map(String) }, txOptions);
      const maker = personOf(txOptions);
      const makerName = (await chats.names([maker], txOptions)).get(String(maker)) || "Someone";
      const text = `${makerName} started this room.`;
      const started = { kind: "event", role: "user", body: { event: "room_started", text, authorName: makerName } };
      const brief = opening
        ? [{
            kind: "text",
            role: "bot",
            authorBotId: String(opening.botId),
            body: {
              text: opening.text,
              authorName: opening.botName,
              brief: true,
              ...(opening.mentions?.length ? { mentions: opening.mentions } : {})
            }
          }]
        : [];
      await messages.append(made.id, [started, ...brief], txOptions);
      return made;
    });
    await toldWhoCanOpen(chat, "created", options);
    return get(chat.id, options);
  }

  /**
   * The person's direct chat with a bot (its [Message]), made on first use: then the bot introduces itself to them there
   * (onboarding.js's intro-greet step).
   */
  async function direct(botId, options) {
    const chat = await chats.direct(String(botId), options, { onboardingStep: "intro-greet" });
    return get(chat.id, options);
  }

  /**
   * The person's chat with another person of the home (People), made on first use: private, the two of them in it, no
   * bot. 404 `bots_person_not_found` for someone who isn't an active member of the home, 400 `bots_direct_self` for
   * themselves. Both of them hear of it.
   */
  async function personDirect(userId, options) {
    const chat = await chats.personDirect(String(userId ?? ""), options);
    await told(chat.id, "members", options);
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
    // A chat between two people is theirs: each may leave it, and neither takes the other out.
    if (!leaving && chat.direct_person_id) throw directChatRefusal(chat);
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

  /**
   * A bot of the home invited into a room (not an archived bot, D-108): a public room by anyone in the home, a private
   * one by its people. It reads the room's last BOT_WINDOW messages and what's said after; when there were more, a line
   * of Mercbot's own (no one's, so it marks nothing unread) says so, in the same transaction.
   */
  async function addBot(chatId, botId, options) {
    const chat = await openChat(chatId, options);
    await requireMayInviteBots(chat, options);
    await chats.withTransaction(options, async (txOptions) => {
      const { seat, windowed } = await chats.addBot(chat.id, String(botId ?? ""), txOptions);
      if (!windowed) return;
      const [bot] = (await chats.bots(chat.id, txOptions)).filter((entry) => String(entry.chat_bot_id) === String(seat.id));
      const text = `${bot?.name || "The bot"} joined. It reads the last ${BOT_WINDOW} messages; ask it to read further back.`;
      await messages.append(chat.id, [{ kind: "event", role: "system", body: { event: "bot_window", text } }], txOptions);
    });
    const people = (await chats.people(chat.id, options)).map((person) => person.user_id);
    await tell(people, chat.id, "members");
    // Its people's open pages read the joined line.
    await notices.publishEach("bots", people, { type: "messages", chatId: String(chat.id) })
      .catch((error) => console.warn("Telling people about a chat's new line failed; they see it on their next read.", error));
    return get(chat.id, options);
  }

  /**
   * A bot out of a room, with its computer, routines and runs there: a public room's by anyone in the home, a private
   * one's by its people.
   */
  async function removeBot(chatId, botId, options) {
    const chat = await openChat(chatId, options);
    await requireMayInviteBots(chat, options);
    if (await chats.removeBot(chat.id, String(botId), options)) await told(chat.id, "members", options);
    return get(chat.id, options);
  }

  /** A chat's new title, by its maker or an owner or admin. */
  async function rename(chatId, title, options) {
    const chat = await openChat(chatId, options);
    if (isDirect(chat)) throw directChatRefusal(chat);
    requireManager(chat, options, "rename");
    await chats.rename(chat.id, title, options);
    await toldWhoCanOpen(chat, "renamed", options);
    return get(chat.id, options);
  }

  /**
   * Whether a chat's bots join in when useful (D-115), by its maker or an owner or admin: true or false, never in a
   * direct chat (409, it has one person). Everyone in it hears of it.
   */
  async function switchJoinIn(chatId, on, options) {
    const chat = await openChat(chatId, options);
    requireManager(chat, options, "change who answers in");
    if (typeof on !== "boolean") throw new BotsError(400, "Say whether the bots join in: true or false.", { code: "bots_join_in_invalid" });
    await chats.switchJoinIn(chat.id, on, options);
    await told(chat.id, "settings", options);
    return get(chat.id, options);
  }

  /** A chat's settings changed: `title` renames it and `botsJoinIn` switches joining in (D-115), each only when given. */
  async function change(chatId, changes = {}, options) {
    if (Object.hasOwn(changes, "botsJoinIn")) await switchJoinIn(chatId, changes.botsJoinIn, options);
    if (Object.hasOwn(changes, "title") || !Object.hasOwn(changes, "botsJoinIn")) return rename(chatId, changes.title, options);
    return get(chatId, options);
  }

  /**
   * A Public chat archived (read-only for everyone in it) or back in use, by its maker or an owner or admin; never the
   * everyone chat, nor a Private room, which each of its people hides for themselves instead (changePlace's `hidden`):
   * its view is each member's own, so no one puts it away for the others (plan 5.1); nor a chat with a person or a bot,
   * which stays in the sidebar as their row in People or Bots. Archiving pauses its bots' routines
   * and watches there with a line, before it's read-only; unarchiving leaves them paused, to be resumed there. A chat
   * already as asked is left as it is.
   */
  async function archiving(chatId, archived, options) {
    const chat = await openChat(chatId, options);
    // Someone who may not manage the chat hears that first, whatever its kind.
    requireManager(chat, options, archived ? "archive" : "unarchive");
    if (archived && chat.kind === "private") {
      const message = isDirect(chat)
        ? "A chat with a person or a bot isn't archived: it stays in your sidebar."
        : "A Private room isn't archived: hide it from your sidebar instead.";
      throw new BotsError(409, message, { code: "bots_chat_private_archive" });
    }
    if (archived) requireNotEveryone(chat);
    if (Boolean(chat.archived_at) === archived) return get(chat.id, options);
    await chats.withTransaction(options, async (txOptions) => {
      if (!archived) return chats.unarchive(chat.id, txOptions);
      const seats = (await chats.bots(chat.id, txOptions)).map((bot) => ({ id: String(bot.chat_bot_id), chatId: String(chat.id) }));
      await pauseWork(seats, ARCHIVED_LINE, txOptions);
      return chats.archive(chat.id, txOptions);
    });
    await toldWhoCanOpen(chat, archived ? "archived" : "unarchived", options);
    return get(chat.id, options);
  }

  /** A Public chat archived: read-only for everyone in it. */
  const archive = (chatId, options) => archiving(chatId, true, options);

  /** An archived chat back in use. */
  const unarchive = (chatId, options) => archiving(chatId, false, options);

  /**
   * A chat deleted with everything in it, its computers and files too, by its maker or an owner or admin; never the
   * everyone chat (409), the home's for as long as it has people.
   */
  async function remove(chatId, options) {
    const chat = await openChat(chatId, options);
    requireManager(chat, options, "delete");
    requireNotEveryone(chat);
    const publicRoom = chat.kind === "public" && !isDirect(chat);
    const [people, bots] = await Promise.all([
      publicRoom ? chats.everyoneIn(options) : chats.people(chat.id, options),
      chats.bots(chat.id, options)
    ]);
    await chats.remove(chat.id, options);
    // What was said in a public chat is in its bots' memories: they forget it at once (D-113, O23).
    if (chat.kind === "public") await forget(bots.map((bot) => String(bot.bot_id)), options);
    await chatRemoved(homeOf(options), chat.id, bots.map((bot) => String(bot.chat_bot_id)));
    // A public room's deletion reaches everyone in the home, who may list it faded; another chat's, its people.
    await tell(publicRoom ? people.map(String) : people.map((person) => person.user_id), chat.id, "deleted");
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

  /**
   * The person started or stopped typing in a chat: everyone else in it hears it at once (a `typing` event { chatId,
   * userId, typing }), and nothing is kept. Only one of the chat's people may say it: someone who can read a public room
   * without being in it is refused, as its people never hear of them. Pages show it a few seconds unless told again.
   */
  async function typing(chatId, isTyping, options) {
    if (typeof isTyping !== "boolean") throw new BotsError(400, "Say typing as true or false.", { code: "bots_typing_invalid" });
    const chat = await openChat(chatId, options);
    const me = String(personOf(options));
    const people = (await chats.people(chat.id, options)).map((person) => String(person.user_id));
    if (!people.includes(me)) throw new BotsError(403, "Join the chat first.", { code: "bots_chat_join_first" });
    const others = people.filter((userId) => userId !== me);
    if (others.length) {
      await notices.publishEach("bots", others, { type: "typing", chatId: String(chat.id), userId: me, typing: isTyping });
    }
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
   * whoever left is taken out of every chat (records.chats.personLeft), their private chats with no one else deleted
   * with their computers and files, after what they made is paused (`leaving`). Everyone in a chat that changed hears, the
   * person who left too. In the bots' system context for the home; the members' list bounds it.
   * @param {string} homeId
   * @param {{ leaving?: (userId: string, home: object) => Promise<unknown> }} [steps] `leaving` runs for each person who
   *   left before they're taken out, so when it fails they're still there to leave at the home's next change
   */
  async function homeChanged(homeId, { leaving = async () => {} } = {}) {
    const home = { context: systemContext("the home's people join and leave its chats").forWorkspace(String(homeId)) };
    const { departed, joined, everyoneChatId } = await chats.syncMembers(home);
    if (joined.length) await told(everyoneChatId, "members", home);
    for (const userId of departed) {
      await leaving(userId, home);
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
    publicRooms,
    sharedTuckedAway,
    get,
    create,
    direct,
    personDirect,
    addPerson,
    join,
    removePerson,
    leave,
    addBot,
    removeBot,
    rename,
    change,
    archive,
    unarchive,
    remove,
    changePlace,
    markRead,
    typing,
    reorderPins,
    createSection,
    updateSection,
    moveSection,
    deleteSection
  });
}
