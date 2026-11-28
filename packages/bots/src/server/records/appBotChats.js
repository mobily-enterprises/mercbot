// A person's own chats with apps' bots (D-147), made and read with the chat repository's own parts (chatRepository.js).

/**
 * A person's own chat with an app's bot (D-147), which the chat button inside the app opens: made once per person and
 * app (ux_conversations_bot_app), Private, the person and the bot its members, named after the app. When the app's bot
 * changes (its template brings one, its own is archived), the new one joins it; the old one stays a member until
 * someone removes it, as a new Builder joins the apps' chats (D-41). The chat repository's own parts do the work.
 */
export function appBotChatOf({ conversations, chatBots, chatPeople }, { firstOf, asRow, personOf, madeOnce, create, seatBots, get }) {
  /**
   * The person's chat with the app's bot as the app's chat button shows it: its id and whether it has something they
   * haven't read; null before they have one. Two reads.
   */
  async function appBotChatNews({ appId }, options) {
    const chat = await firstOf(conversations, { botAppId: String(appId), madeBy: personOf(options) }, options);
    if (!chat) return null;
    const place = await firstOf(chatPeople, { conversationId: String(chat.id), userId: personOf(options) }, options);
    return { chatId: String(chat.id), unread: Boolean(place?.unread) };
  }
  async function appBotChat({ appId, botId, title }, options) {
    const mine = { botAppId: String(appId), madeBy: personOf(options) };
    const findIt = async (callOptions) => asRow(await firstOf(conversations, mine, callOptions), callOptions);
    const chat = await madeOnce(findIt, () => create({ kind: "private", botAppId: String(appId), title, bots: [String(botId)] }, options), options);
    if (await firstOf(chatBots, { conversationId: String(chat.id), botId: String(botId) }, options)) return chat;
    await seatBots(chat.id, [String(botId)], personOf(options), options);
    return get(chat.id, options);
  }
  return { appBotChat, appBotChatNews };
}
