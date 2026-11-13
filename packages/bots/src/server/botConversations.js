import { BotsError } from "./botsError.js";

/**
 * A person's bots and conversations as they see them (D-36, D-46): their own conversation with a bot, a shared bot's rooms,
 * a group's room and seats, and the news each change sends to open pages. The reads and writes are the bots records'
 * repositories (records/conversationRepository.js, records/messageRepository.js); every method takes the call's options last.
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records mercbot.bots.records
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 */
export function createBotConversations({ records, notices }) {
  const { conversations, messages } = records;

  /**
   * A bot working for one person in a group that has others in it: like a shared room, nothing of
   * that person's own (memories, accounts, saved logins, private files) is reachable (D-46).
   */
  const groupView = (own, group) => ({ ...own, room: { id: group.conversation_id, title: group.name, group: true, app_id: null } });

  /**
   * Who a card in a group acts for: only the person whose request made it may settle it, and the
   * bot that made it acts for them, on its computer for this group (D-46).
   */
  async function groupActor(group, message, options) {
    const person = conversations.personOf(options);
    if (message.body.for && String(message.body.for.id) !== person) {
      const { name } = message.body.for;
      throw new BotsError(403, `This is waiting for ${name}'s OK.`, { code: "bots_waiting_for_other", params: { name } });
    }
    const [bot] = message.body.speaker?.id ? await conversations.homeBotsOf([String(message.body.speaker.id)], options) : [];
    if (!bot) throw new BotsError(404, "That bot isn't in this group any more.", { code: "bots_group_member_gone" });
    const own = await conversations.seenBy(bot, options);
    const several = await conversations.severalPeopleIn(group.id, options);
    const seat = await conversations.groupSeatFor(group, bot, options);
    return { actor: several ? groupView(own, group) : own, computerId: seat.id };
  }

  /**
   * News about a conversation for open pages on any server: a room's goes to everyone in the
   * home, a private conversation's to its person (D-15, D-36).
   */
  const publish = (people, news) => notices.publishEach("bots", people, news)
    .catch((error) => console.warn("Telling people about a bot change failed; they see it on their next read.", error));

  async function tell(row, event, options) {
    const people = row.kind === "group"
      ? await conversations.groupPeople(row.id, options)
      : row.room ? await conversations.everyoneIn(options) : [row.user_id];
    await publish(people, { botId: String(row.id), ...(row.room ? { roomId: String(row.conversation_id) } : {}), ...event });
  }

  /**
   * Whose connected accounts a conversation may use (D-37): the person's own and the home's, or in
   * a shared bot's room only the home's.
   */
  const reachOf = (row) => ({ userId: row.user_id, homeId: row.workspace_id, personal: !row.room });

  /** One message of the person's conversation with a bot, or a 404. */
  async function ownedMessage(botId, messageId, options) {
    const row = await conversations.ownedBot(botId, options);
    const message = await messages.messageIn(row.conversation_id, messageId, options);
    if (!message) throw new BotsError(404, "Message not found.", { code: "bots_message_not_found" });
    return message;
  }

  return Object.freeze({
    withTransaction: conversations.withTransaction,
    asSeen: conversations.asSeen,
    isShared: conversations.isShared,
    personOf: conversations.personOf,
    roomsOf: conversations.roomsOf,
    groupPeople: conversations.groupPeople,
    inGroup: conversations.inGroup,
    groupSeatFor: conversations.groupSeatFor,
    groupView,
    groupActor,
    seenBy: conversations.seenBy,
    everyoneIn: conversations.everyoneIn,
    publish,
    tell,
    conversationOf: conversations.conversationOf,
    ownedBot: conversations.ownedBot,
    refresh: conversations.refresh,
    ownedSingleBot: conversations.ownedSingleBot,
    append: messages.append,
    timeline: messages.timeline,
    rowOf: conversations.rowOf,
    fromOf: conversations.fromOf,
    namesOf: conversations.namesOf,
    reachOf,
    membersOf: conversations.membersOf,
    peopleOf: conversations.peopleOf,
    ownedMessage
  });
}
