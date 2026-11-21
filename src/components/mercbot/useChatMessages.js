import { ref } from "vue";
import { chatsApi } from "./chatsApi.js";
import { toChatRow } from "./chatDirectory.js";

const previewOf = (message) => {
  if (message.kind === "choice") return message.body.question;
  if (message.kind === "connect") return `Connect ${message.body.app}`;
  return message.body.text || message.body.heading || "";
};

/**
 * The shell's chats and each one's loaded messages (D-8, D-112). `currentChatId` names the open chat, whose news is seen
 * straight away.
 * @param {object} options
 * @param {import("vue").Ref<Array<import("../../types.js").Chat>>} options.chats The list the sidebar shows.
 * @param {() => string} options.currentChatId
 */
export function useChatMessages({ chats, currentChatId }) {
  const messagesByChat = ref({});
  // Chats with older messages than the loaded ones: a chat opens on its newest page, and the page before comes as the
  // person scrolls up (loadOlder).
  const olderByChat = ref({});
  const setOlder = (chatId, more) => {
    olderByChat.value = { ...olderByChat.value, [chatId]: Boolean(more) };
  };
  // Where the loaded pages start: the first saved message (pending ones have no number yet), or null.
  const oldestLoaded = (chatId) =>
    (messagesByChat.value[chatId] || []).map((message) => String(message.id)).find((id) => /^\d+$/u.test(id)) ?? null;

  const knowsChat = (chatId) => chats.value.some((chat) => chat.id === chatId);
  const chatsNow = () => chats.value;
  const chatOf = (chatId) => chats.value.find((chat) => chat.id === chatId) ?? null;

  /**
   * A chat's new fields merged into the list: a ChatView from the server (read into a row) or a row's few fields. A
   * chat the list doesn't have yet (one just made, joined or opened) is added.
   */
  function updateChat(chat) {
    if (!chat?.id) return;
    const row = "place" in chat ? toChatRow(chat) : chat;
    chats.value = knowsChat(row.id)
      ? chats.value.map((existing) => (existing.id === row.id ? { ...existing, ...row } : existing))
      : [...chats.value, { preview: "", ...row }];
    if (row.unread && row.id === currentChatId()) markSeen(row.id);
  }

  /** A chat gone for this person (left, deleted, or one they can no longer open): off the list, its messages too. */
  function dropChat(chatId) {
    chats.value = chats.value.filter((chat) => chat.id !== chatId);
    const { [chatId]: _gone, ...rest } = messagesByChat.value;
    messagesByChat.value = rest;
    cursors.delete(chatId);
  }

  // Opening a chat clears its unread marker and its "@" (D-114) and says how far the person has read; anything posted
  // while it's open is seen straight away. A public chat the person isn't in has no place to mark.
  function markSeen(chatId) {
    const chat = chatOf(chatId);
    if (!chat?.place) return;
    chats.value = chats.value.map((existing) => (existing.id === chatId ? { ...existing, unread: false, mentioned: false } : existing));
    const latest = [...(messagesByChat.value[chatId] || [])].reverse().find((message) => /^\d+$/u.test(String(message.id)));
    chatsApi.markRead(chatId, latest?.id ?? null).catch(() => {});
  }

  // Where each loaded chat's messages were read up to: the server's cursor (D-15). News then reads only what changed
  // after it.
  const cursors = new Map();
  // One chat's reads run one at a time, so an older answer never lands over a newer one, and a catch-up asked for
  // while another waits shares it.
  const reads = new Map();
  const waiting = new Map();
  function inTurn(chatId, work) {
    const read = (reads.get(chatId) || Promise.resolve()).catch(() => {}).then(work);
    reads.set(chatId, read);
    return read;
  }

  // A chat's newest page replaces the messages shown, apart from those the page added while the read was on its way
  // (a message sent before the chat had loaded, its reply, a "Couldn't get a reply." line), which the read couldn't
  // know: they stay after it.
  function reloadMessages(chatId) {
    return inTurn(chatId, async () => {
      const shown = new Set((messagesByChat.value[chatId] || []).map((message) => message.id));
      const { messages, cursor, more } = await chatsApi.messages(chatId);
      const read = new Set(messages.map((message) => message.id));
      const added = (messagesByChat.value[chatId] || []).filter((message) => !shown.has(message.id) && !read.has(message.id));
      messagesByChat.value = { ...messagesByChat.value, [chatId]: [...messages, ...added] };
      setOlder(chatId, more);
      cursors.set(chatId, cursor);
    });
  }

  /**
   * The page before the oldest loaded message, put above it; resolves true when it read a page, false when there was
   * nothing older to read. Messages already loaded aren't added twice.
   */
  function loadOlder(chatId) {
    return inTurn(chatId, async () => {
      const oldest = oldestLoaded(chatId);
      if (!olderByChat.value[chatId] || oldest === null) return false;
      const { messages, more } = await chatsApi.messages(chatId, { before: oldest });
      const loaded = messagesByChat.value[chatId] || [];
      const known = new Set(loaded.map((message) => message.id));
      messagesByChat.value = { ...messagesByChat.value, [chatId]: [...messages.filter((message) => !known.has(message.id)), ...loaded] };
      setOlder(chatId, more);
      return true;
    });
  }

  /** Older pages until `messageId` is loaded (a message found in search), or none are left. */
  async function loadThrough(chatId, messageId) {
    await loadMessages(chatId);
    const loaded = () => (messagesByChat.value[chatId] || []).some((message) => String(message.id) === String(messageId));
    while (!loaded() && (await loadOlder(chatId)));
  }

  /**
   * Find in chat's matches in the pages not loaded yet, counted on the server: how many, and the newest and oldest
   * message holding one. Nothing is asked for while every page is loaded.
   */
  async function findOlder(chatId, text) {
    const oldest = oldestLoaded(chatId);
    if (!text || !olderByChat.value[chatId] || oldest === null) return { count: 0, newest: null, oldest: null };
    return chatsApi.find(chatId, text, oldest);
  }

  /**
   * News for a chat (D-15): if its messages are loaded here, only what was written or changed since the last read is
   * fetched and merged. A chat whose messages aren't loaded costs no read; its newest page is read when it's opened.
   * Messages shown before any read of the chat's own (the welcome chat's first ones) are merged with its newest page
   * instead. A changed message older than the loaded ones (a card answered further back) is left for its page to
   * bring, rather than shown at the bottom.
   */
  function catchUp(chatId) {
    if (waiting.has(chatId)) return waiting.get(chatId);
    const read = inTurn(chatId, async () => {
      waiting.delete(chatId);
      if (!messagesByChat.value[chatId]) return;
      const last = cursors.get(chatId);
      const { messages, cursor, more } = await chatsApi.messages(chatId, { since: last ?? null });
      if (last) {
        const oldest = olderByChat.value[chatId] ? Number(oldestLoaded(chatId)) : 0;
        appendMessages(chatId, messages.filter((message) => !(Number(message.id) < oldest)));
      } else {
        appendMessages(chatId, messages);
        setOlder(chatId, more);
      }
      cursors.set(chatId, cursor);
    });
    waiting.set(chatId, read);
    return read;
  }

  async function loadMessages(chatId) {
    if (messagesByChat.value[chatId]) return;
    await reloadMessages(chatId);
  }

  // When this page added each chat it made or opened itself (New chat, [Message]), for mergeChats.
  const addedAt = new Map();
  function addChat(view) {
    const row = toChatRow(view);
    addedAt.set(row.id, performance.now());
    chats.value = [...chats.value.filter((entry) => entry.id !== row.id), { preview: "", ...row }];
    return row;
  }

  /**
   * The list as a read answered it (ChatViews). `startedAt` is when that read began (chatsApi.list): news can read the
   * list while a chat is being made, and a chat this page added after the read began stays, since the read couldn't
   * know it. Without it, the list counts as read just now.
   * @param {object[]} list
   * @param {number} [startedAt]
   */
  function mergeChats(list, startedAt = Infinity) {
    const known = new Map(chats.value.map((chat) => [chat.id, chat]));
    const listed = new Set(list.map((chat) => String(chat.id)));
    const newer = chats.value.filter((chat) => !listed.has(chat.id) && addedAt.get(chat.id) > startedAt);
    chats.value = [...list.map((view) => ({ preview: "", ...known.get(String(view.id)), ...toChatRow(view) })), ...newer];
  }

  function appendMessages(chatId, messages) {
    if (!messages?.length) return;
    const existing = messagesByChat.value[chatId] || [];
    const byId = new Map(existing.map((message) => [message.id, message]));
    for (const message of messages) byId.set(message.id, message);
    messagesByChat.value = { ...messagesByChat.value, [chatId]: [...byId.values()] };
    const latest = [...messages].reverse().find((message) => message.kind !== "timestamp" && message.role !== "system");
    if (latest && knowsChat(chatId)) updateChat({ id: chatId, preview: previewOf(latest), lastActivityAt: latest.createdAt || new Date().toISOString() });
  }

  function replaceMessage(chatId, message) {
    messagesByChat.value = {
      ...messagesByChat.value,
      [chatId]: (messagesByChat.value[chatId] || []).map((existing) => (existing.id === message.id ? message : existing))
    };
  }

  function removeMessage(chatId, messageId) {
    messagesByChat.value = {
      ...messagesByChat.value,
      [chatId]: (messagesByChat.value[chatId] || []).filter((message) => message.id !== messageId)
    };
  }

  return {
    messagesByChat,
    olderByChat,
    knowsChat,
    chatsNow,
    chatOf,
    updateChat,
    dropChat,
    markSeen,
    reloadMessages,
    catchUp,
    loadMessages,
    loadOlder,
    loadThrough,
    findOlder,
    addChat,
    mergeChats,
    appendMessages,
    replaceMessage,
    removeMessage
  };
}
