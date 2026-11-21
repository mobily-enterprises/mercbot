// A bot's seat in a chat as a turn uses it (D-112, R3–R5): the bot's own columns, its chat, its chat_bots row and the
// person it works for this turn. Every turn reads through the model's reader for that seat (D12), writes what it says
// into the chat under the bot's name, and tells the chat's people.

/**
 * A turn's seat: the bot's row (`id` is the bot's id, so what reads a bot row reads it), its chat (`chat`, `chat_id`),
 * its chat_bots id (`chat_bot_id`, and as agent-runtime's conversation `conversation_id`), its waiting hand-over and job
 * notes, and the person the turn works for (`user_id`). A request's bot not in the asking chat (O22) has no chat_bots
 * row: its `chat_bot_id` is null until it joins.
 * @param {object} bot records.bots row
 * @param {object} chat records.chats row
 * @param {object | null} chatBot records.chats.chatBotOf row
 * @param {string} askerId
 */
export function seatOf(bot, chat, chatBot, askerId) {
  const seated = chatBot ? String(chatBot.id) : null;
  return Object.freeze({
    ...bot,
    id: String(bot.id),
    workspace_id: String(chat.workspace_id ?? bot.workspace_id),
    chat,
    chat_id: String(chat.id),
    chat_bot_id: seated,
    conversation_id: seated,
    waiting_task: chatBot?.waiting_task ?? null,
    job_notes: chatBot?.job_notes ?? null,
    user_id: String(askerId)
  });
}

/** @typedef {ReturnType<typeof createChatSeats>} ChatSeats a bot's seats in chats, and what they say there */

/**
 * @param {object} dependencies
 * @param {import("./types.js").BotRecords} dependencies.records
 * @param {(reason: string) => object} dependencies.systemContext the bots' system context
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 */
export function createChatSeats({ records, systemContext, notices }) {
  /** The model's reader for a seat (D12): what everyone who can open its chat can open, for its person. */
  const readerOf = (seat) => ({
    context: records.readers.forBot({ homeId: seat.workspace_id, botId: seat.id, chatId: seat.chat_id, askerId: seat.user_id })
  });

  /** A bot's seat in a chat the call may read, for `askerId`, or null when the chat or the bot is gone. */
  async function seatIn(chatId, botId, askerId, options) {
    const [chat, bot] = await Promise.all([records.chats.find(String(chatId), options), records.bots.find(String(botId), options)]);
    if (!chat || !bot) return null;
    return seatOf(bot, chat, await records.chats.chatBotOf(String(botId), String(chatId), options), askerId);
  }

  /**
   * What the bot says in its chat: its messages under its name, Mercbot's lines (role system) under none. Each keeps the
   * bot's name as it was (`body.authorName`), so the chat still names it once the bot has left the chat or gone.
   */
  function say(seat, messages, options) {
    const asBot = (message) => ({ ...message, authorBotId: seat.id, body: { ...message.body, authorName: seat.name } });
    return records.messages.append(seat.chat_id, messages.map((message) => (message.role === "bot" ? asBot(message) : message)), options);
  }

  /** The chat's people hear of it on bot-events (R9): "messages" { chatId } and "working" { chatId, botId, working, status }. */
  async function tell(chatId, event, options) {
    try {
      const people = (await records.chats.people(String(chatId), options)).map((person) => person.user_id);
      if (people.length) await notices.publishEach("bots", people, { ...event, chatId: String(chatId) });
    } catch (error) {
      console.warn("Telling a chat's people failed; they see it on their next read.", error);
    }
  }

  const working = (seat, isWorking, status, options) =>
    tell(seat.chat_id, { type: "working", botId: seat.id, working: isWorking, ...(status ? { status } : {}) }, options);

  /**
   * A bot's seat for background work, as the person who set the work up (R4): a routine's maker, a watch's creator, an
   * app job's, a follow-up's or a request's person. Null when the seat, its chat or its bot is gone, the chat or the
   * bot is archived (D-101, D-108), or the person can no longer open the chat: nothing runs where nobody may write.
   * Answers the seat and its call, the model's reader.
   * @param {{ chatBotId: string, homeId: string, userId: string }} work
   * @param {string} why the system context's reason
   */
  async function backgroundSeat({ chatBotId, homeId, userId }, why) {
    if (!chatBotId || !userId) return null;
    const system = systemContext(why);
    const forPerson = { context: system.forWorkspaceUser(String(homeId), String(userId), { actorId: String(userId) }) };
    const chatBot = await records.chats.chatBot(String(chatBotId), { context: system.forWorkspace(String(homeId)) });
    if (!chatBot) return null;
    const chat = await records.chats.find(String(chatBot.conversation_id), forPerson);
    const bot = chat && await records.bots.find(String(chatBot.bot_id), forPerson);
    if (!chat || !bot || chat.archived_at || bot.archived_at) return null;
    const seat = seatOf(bot, chat, chatBot, userId);
    return { seat, call: readerOf(seat) };
  }

  return Object.freeze({
    seatOf,
    readerOf,
    seatIn,
    say,
    tell,
    working,
    backgroundSeat
  });
}
