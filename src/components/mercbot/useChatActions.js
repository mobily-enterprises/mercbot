import { botsApi } from "./botsApi.js";
import { chatsApi } from "./chatsApi.js";
import { copyPictureToClipboard } from "./messageMenus.js";

/**
 * How a chat's bots answer what's written (R3): none in a chat of people only; in a chat of one person, every bot, so
 * the page shows them working at once; with several people only the bots called, so the page shows one working only
 * once the server says it started.
 */
const answering = (chat) => {
  const bots = (chat.bots || []).filter((bot) => !bot.archived);
  if (!bots.length) return "none";
  return (chat.people || []).length > 1 ? "called" : "all";
};

/**
 * What the person does in the open chat: send and retry, react, answer cards, settle drafts and secure forms, cancel a
 * request between bots, and copy a message or a picture. Each step that reaches the server then asks the chat's bots
 * for their reply where the chat goes on.
 * @param {{
 *   currentChat: import("vue").ComputedRef<import("../../types.js").Chat | null>,
 *   newChat: import("vue").Ref<object | null>,
 *   startNewChat: (payload: Record<string, any>) => Promise<void>,
 *   store: import("../../types.js").ChatMessages,
 *   work: import("../../types.js").ChatWork,
 *   reportFailure: import("../../types.js").ReportFailure,
 *   notify: (message: string) => void,
 *   openAddBots: (screen: "describe" | "teams") => void,
 *   me: () => string
 * }} options `openAddBots` opens Add bots on Describe what you need or its ready-made teams (D-105, D-109); `me` is the person
 */
export function useChatActions({ currentChat, newChat, startNewChat, store, work, reportFailure, notify, openAddBots, me }) {
  const { messagesByChat, updateChat, appendMessages, replaceMessage, removeMessage } = store;
  const { playMood, requestReply, describeWork } = work;

  /** The bots' reply to what the person just wrote, as R3 has them answer. */
  function replyTo(chat, userMessage) {
    const how = answering(chat);
    if (how === "none") return null;
    if (how === "called") return requestReply(chat.id, { untilStarted: true, onStart: () => userMessage && describeWork(chat.id, userMessage.id) });
    if (userMessage && chat.bots.length === 1) describeWork(chat.id, userMessage.id);
    return requestReply(chat.id);
  }

  async function send(payload, retryOf = null) {
    if (newChat.value) {
      await startNewChat(payload);
      return;
    }
    const chat = currentChat.value;
    if (!chat) return;
    const pending = retryOf || { id: `pending-${Date.now()}`, kind: "text", role: "user", authorUserId: me(), authorBotId: null, body: { ...payload, text: payload.text } };
    const others = (messagesByChat.value[chat.id] || []).filter((message) => message.id !== pending.id);
    messagesByChat.value = { ...messagesByChat.value, [chat.id]: [...others, { ...pending, pending: true, failed: false }] };
    updateChat({ id: chat.id, lastActivityAt: new Date().toISOString() });
    let result;
    try {
      result = await chatsApi.send(chat.id, { ...payload, clientId: pending.id });
    } catch (error) {
      replaceMessage(chat.id, { ...pending, payload, pending: false, failed: true });
      // A chat archived meanwhile says so: unarchive it to write there.
      reportFailure(error?.code === "bots_chat_archived" ? error.message : "Your message didn't send.", error);
      return;
    }
    removeMessage(chat.id, pending.id);
    appendMessages(chat.id, result.messages);
    if (result.chat) updateChat(result.chat);
    await replyTo(chat, result.messages[result.messages.length - 1]);
  }

  function retry(message) {
    const chat = currentChat.value;
    if (!chat) return;
    if (message.kind === "error") {
      removeMessage(chat.id, message.id);
      replyTo(chat, null);
    } else if (message.failed) {
      send(message.payload, message);
    }
  }

  async function react({ message, emoji }) {
    const chatId = currentChat.value.id;
    // Shown at once under the person's own key, as the server keeps it ("user:<id>"), till its answer replaces it.
    const reactions = { ...message.body.reactions };
    if (emoji) reactions[`user:${me()}`] = emoji;
    else delete reactions[`user:${me()}`];
    replaceMessage(chatId, { ...message, body: { ...message.body, reactions } });
    if (emoji) playMood(chatId, [["happy", 2000]]);
    try {
      const result = await chatsApi.react(chatId, message.id, emoji);
      for (const updated of result.messages) replaceMessage(chatId, updated);
    } catch (error) {
      replaceMessage(chatId, message);
      reportFailure("That reaction didn't stick. Try again.", error);
    }
  }

  // Question cards: the picks are the answer, then the bots reply.
  async function answerChoice({ message, selected }) {
    const chatId = currentChat.value.id;
    try {
      const result = await chatsApi.answer(chatId, message.id, selected);
      appendMessages(chatId, result.messages);
      if (result.chat) updateChat(result.chat);
      // What the home is for (D-109): the welcome chat carries on by itself, and Add bots opens on Describe what you need
      // ("describe") or its ready-made teams ("teams"), where nothing is added until Add; null is Not now.
      if ("addBots" in result) {
        if (result.addBots) openAddBots(result.addBots);
        return;
      }
      if (currentChat.value?.onboardingStep) return;
    } catch (error) {
      reportFailure("That answer didn't go through. Try again.", error);
      return;
    }
    await requestReply(chatId, { afterCard: true });
  }

  // Send or Discard on a draft the bot wrote. An email from a connected mailbox has gone already; anything else the bot
  // sends after Send. Discard has nothing to undo on failure.
  function keepDraftCard() {}
  async function settleDraft({ message, answer, onFail = keepDraftCard }) {
    const chatId = currentChat.value.id;
    let result;
    try {
      result = await chatsApi.settleDraft(chatId, message.id, answer);
      appendMessages(chatId, result.messages);
    } catch (error) {
      onFail();
      reportFailure(error?.message || "That didn't go through. Try again.", error);
      return;
    }
    if (answer.action === "send" && result.messages[0]?.body.status === "send") await requestReply(chatId, { afterCard: true });
  }

  // The person's answer on a bot's secure form; then the bot carries on.
  async function answerSecureForm({ message, answer }) {
    const chatId = currentChat.value.id;
    try {
      const result = await chatsApi.settleSecureForm(chatId, message.id, answer);
      appendMessages(chatId, result.messages);
    } catch (error) {
      reportFailure(error?.message || "That didn't go through. Try again.", error);
      return;
    }
    await requestReply(chatId, { afterCard: true });
  }

  // A voice conversation (with a direct chat's bot) leaves a line in the chat it was in, with how long it lasted: the
  // chat the call started in, even if another is open by the time it ends.
  async function endVoiceConversation({ chatId, botId, seconds }) {
    try {
      const result = await chatsApi.voiceCall(chatId, botId, seconds);
      appendMessages(chatId, result.messages);
    } catch (error) {
      reportFailure("The conversation's record didn't save.", error);
    }
  }

  // The person stops a request between bots from its card (D-46); the cards update on their own.
  async function cancelRequest(requestId) {
    try {
      await botsApi.cancelRequest(requestId);
    } catch (error) {
      reportFailure("That request couldn't be cancelled. Try again.", error);
    }
  }

  async function copyToClipboard(text, done) {
    try {
      await navigator.clipboard.writeText(text);
      notify(done);
    } catch (error) {
      reportFailure("Couldn't copy to the clipboard.", error);
    }
  }

  const copyMessage = ({ text, what }) => copyToClipboard(text, `${what} copied`);

  // A picture's "Copy image".
  async function copyPicture(src) {
    try {
      await copyPictureToClipboard(src);
      notify("Image copied");
    } catch (error) {
      reportFailure("Couldn't copy the image.", error);
    }
  }

  return { send, retry, react, answerChoice, settleDraft, answerSecureForm, endVoiceConversation, cancelRequest, copyToClipboard, copyMessage, copyPicture };
}
