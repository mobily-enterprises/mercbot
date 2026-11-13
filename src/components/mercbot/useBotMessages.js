import { ref } from "vue";
import { botsApi } from "./botsApi.js";

const previewOf = (message) => {
  if (message.kind === "choice") return message.body.question;
  if (message.kind === "connect") return `Connect ${message.body.app}`;
  return message.body.text || message.body.heading || "";
};

/**
 * The shell's bots and each one's loaded messages (D-8). `currentBotId` names the open bot,
 * whose news is seen straight away.
 * @param {object} options
 * @param {import("vue").Ref<Array<Record<string, any>>>} options.bots The list the sidebar shows.
 */
export function useBotMessages({ bots, currentBotId }) {
  const messagesByBot = ref({});
  // Bots whose chat has older messages than the loaded ones: a chat opens on its newest
  // page, and the page before comes as the person scrolls up (loadOlder).
  const olderByBot = ref({});
  const setOlder = (botId, more) => {
    olderByBot.value = { ...olderByBot.value, [botId]: Boolean(more) };
  };
  // Where the loaded pages start: the first saved message (pending ones have no number yet), or null.
  const oldestLoaded = (botId) =>
    (messagesByBot.value[botId] || []).map((message) => String(message.id)).find((id) => /^\d+$/u.test(id)) ?? null;

  // The tab open in a shared bot (D-36); null for every other bot.
  const roomOf = (botId) => bots.value.find((bot) => bot.id === botId)?.roomId ?? null;

  function updateBot(bot) {
    bots.value = bots.value.map((existing) => (existing.id === bot.id ? { ...existing, ...bot } : existing));
    if (bot.unread && bot.id === currentBotId()) markSeen(bot.id);
  }

  // Opening a bot clears its unread marker; anything it posts while open is seen straight away.
  function markSeen(botId) {
    bots.value = bots.value.map((existing) => (existing.id === botId ? { ...existing, unread: false } : existing));
    botsApi.update(botId, { unread: false, roomId: roomOf(botId) }).catch(() => {});
  }

  const knowsBot = (botId) => bots.value.some((bot) => bot.id === botId);

  // Where each loaded bot's messages were read up to: the room they're from and the server's
  // cursor (D-15). News then reads only what changed after it.
  const cursors = new Map();
  // One bot's reads run one at a time, so an older answer never lands over a newer one, and a
  // catch-up asked for while another waits shares it.
  const reads = new Map();
  const waiting = new Map();
  function inTurn(botId, work) {
    const read = (reads.get(botId) || Promise.resolve()).catch(() => {}).then(work);
    reads.set(botId, read);
    return read;
  }

  // A chat's newest page replaces the messages shown, apart from those the page added while the read was on its way
  // (a message sent before the chat had loaded, its reply, a "Couldn't get a reply." line), which the read couldn't
  // know: they stay after it.
  function reloadMessages(botId) {
    return inTurn(botId, async () => {
      const room = roomOf(botId);
      const shown = new Set((messagesByBot.value[botId] || []).map((message) => message.id));
      const { messages, cursor, more } = await botsApi.messages(botId, room);
      if (roomOf(botId) !== room) return;
      const read = new Set(messages.map((message) => message.id));
      const added = (messagesByBot.value[botId] || []).filter((message) => !shown.has(message.id) && !read.has(message.id));
      messagesByBot.value = { ...messagesByBot.value, [botId]: [...messages, ...added] };
      setOlder(botId, more);
      cursors.set(botId, { room, cursor });
    });
  }

  /**
   * The page before the oldest loaded message, put above it; resolves true when it read a
   * page, false when there was nothing older to read. Messages already loaded aren't added twice.
   */
  function loadOlder(botId) {
    return inTurn(botId, async () => {
      const oldest = oldestLoaded(botId);
      if (!olderByBot.value[botId] || oldest === null) return false;
      const room = roomOf(botId);
      const { messages, more } = await botsApi.messages(botId, room, null, oldest);
      if (roomOf(botId) !== room) return false;
      const loaded = messagesByBot.value[botId] || [];
      const known = new Set(loaded.map((message) => message.id));
      messagesByBot.value = { ...messagesByBot.value, [botId]: [...messages.filter((message) => !known.has(message.id)), ...loaded] };
      setOlder(botId, more);
      return true;
    });
  }

  /** Older pages until `messageId` is loaded (a message found in search), or none are left. */
  async function loadThrough(botId, messageId) {
    await loadMessages(botId);
    const loaded = () => (messagesByBot.value[botId] || []).some((message) => String(message.id) === String(messageId));
    while (!loaded() && (await loadOlder(botId)));
  }

  /**
   * Find in chat's matches in the pages not loaded yet, counted on the server: how many, and the newest and
   * oldest message holding one. Nothing is asked for while every page is loaded.
   */
  async function findOlder(botId, text) {
    const oldest = oldestLoaded(botId);
    if (!text || !olderByBot.value[botId] || oldest === null) return { count: 0, newest: null, oldest: null };
    return botsApi.find(botId, roomOf(botId), text, oldest);
  }

  /**
   * News for a bot (D-15): if its messages are loaded here, from the room they were read in, only
   * what was written or changed since the last read is fetched and merged. A bot whose messages
   * aren't loaded costs no read; its newest page is read when it's opened. Messages shown before
   * any read of the bot's own (onboarding's first ones) are merged with its newest page instead. A
   * changed message older than the loaded ones (a card answered further back) is left for its page
   * to bring, rather than shown at the bottom.
   */
  function catchUp(botId) {
    if (waiting.has(botId)) return waiting.get(botId);
    const read = inTurn(botId, async () => {
      waiting.delete(botId);
      if (!messagesByBot.value[botId]) return;
      const room = roomOf(botId);
      const last = cursors.get(botId);
      const caughtUp = last?.room === room;
      const { messages, cursor, more } = await botsApi.messages(botId, room, caughtUp ? last.cursor : null);
      if (roomOf(botId) !== room) return;
      if (caughtUp) {
        // Older than the loaded pages: its own page brings it.
        const oldest = olderByBot.value[botId] ? Number(oldestLoaded(botId)) : 0;
        appendMessages(botId, messages.filter((message) => !(Number(message.id) < oldest)));
      } else {
        appendMessages(botId, messages);
        setOlder(botId, more);
      }
      cursors.set(botId, { room, cursor });
    });
    waiting.set(botId, read);
    return read;
  }

  async function loadMessages(botId) {
    if (messagesByBot.value[botId]) return;
    await reloadMessages(botId);
  }

  // When this page added each bot it made itself (New bot), for mergeBots.
  const addedAt = new Map();
  function addBot(bot) {
    addedAt.set(bot.id, performance.now());
    bots.value = [...bots.value.filter((entry) => entry.id !== bot.id), bot];
  }

  /**
   * The list as a read answered it. `startedAt` is when that read began (botsApi.list): news can read the
   * list while a bot is being made (useBotEvents), and a bot this page added after the read began stays,
   * since the read couldn't know it. Without it, the list counts as read just now.
   * @param {Array<import("../../types.js").Bot>} list
   * @param {number} [startedAt]
   */
  function mergeBots(list, startedAt = Infinity) {
    const known = new Map(bots.value.map((bot) => [bot.id, bot]));
    const listed = new Set(list.map((bot) => bot.id));
    const newer = bots.value.filter((bot) => !listed.has(bot.id) && addedAt.get(bot.id) > startedAt);
    bots.value = [...list.map((bot) => ({ preview: "", ...known.get(bot.id), ...bot })), ...newer];
  }

  function appendMessages(botId, messages) {
    if (!messages.length) return;
    const existing = messagesByBot.value[botId] || [];
    const byId = new Map(existing.map((message) => [message.id, message]));
    for (const message of messages) byId.set(message.id, message);
    messagesByBot.value = { ...messagesByBot.value, [botId]: [...byId.values()] };
    const latest = [...messages].reverse().find((message) => message.role === "bot" && message.kind !== "timestamp");
    if (latest) updateBot({ id: botId, preview: previewOf(latest) });
  }

  function replaceMessage(botId, message) {
    messagesByBot.value = {
      ...messagesByBot.value,
      [botId]: (messagesByBot.value[botId] || []).map((existing) => (existing.id === message.id ? message : existing))
    };
  }

  function removeMessage(botId, messageId) {
    messagesByBot.value = {
      ...messagesByBot.value,
      [botId]: (messagesByBot.value[botId] || []).filter((message) => message.id !== messageId)
    };
  }

  return {
    messagesByBot,
    olderByBot,
    roomOf,
    knowsBot,
    updateBot,
    markSeen,
    reloadMessages,
    catchUp,
    loadMessages,
    loadOlder,
    loadThrough,
    findOlder,
    addBot,
    mergeBots,
    appendMessages,
    replaceMessage,
    removeMessage
  };
}
