import { botsApi } from "./botsApi.js";
import { copyPictureToClipboard } from "./messageMenus.js";

/**
 * What the person does in the open chat: send and retry, react, answer cards, settle drafts and
 * secure forms, cancel a request between bots, and copy a message or a picture. Each step that
 * reaches the server then asks the bot for its reply where the conversation goes on.
 * @param {{
 *   currentBot: import("vue").ComputedRef<import("../../types.js").Bot>,
 *   picker: import("vue").Ref<{ botIds: string[] } | null>,
 *   startGroup: (payload: Record<string, any>) => Promise<void>,
 *   store: import("../../types.js").BotMessages,
 *   work: import("../../types.js").BotWork,
 *   reportFailure: import("../../types.js").ReportFailure,
 *   notify: (message: string) => void
 * }} options
 */
export function useChatActions({ currentBot, picker, startGroup, store, work, reportFailure, notify }) {
  const { messagesByBot, updateBot, appendMessages, replaceMessage, removeMessage } = store;
  const { playMood, requestReply, describeWork } = work;

  async function send(payload, retryOf = null) {
    if (picker.value) {
      await startGroup(payload);
      return;
    }
    const bot = currentBot.value;
    const pending = retryOf || { id: `pending-${Date.now()}`, kind: "text", role: "user", body: { ...payload, text: payload.text } };
    const others = (messagesByBot.value[bot.id] || []).filter((message) => message.id !== pending.id);
    messagesByBot.value = { ...messagesByBot.value, [bot.id]: [...others, { ...pending, pending: true, failed: false }] };
    updateBot({ id: bot.id, lastActivityAt: new Date().toISOString() });
    let result;
    try {
      result = await botsApi.send(bot.id, { ...payload, clientId: pending.id, room: bot.roomId ?? null });
    } catch (error) {
      replaceMessage(bot.id, { ...pending, payload, pending: false, failed: true });
      reportFailure("Your message didn't send.", error);
      return;
    }
    removeMessage(bot.id, pending.id);
    appendMessages(bot.id, result.messages);
    updateBot(result.bot);
    const userMessage = result.messages[result.messages.length - 1];
    if (bot.kind !== "group") describeWork(bot.id, userMessage.id);
    await requestReply(bot.id);
  }

  function retry(message) {
    if (message.kind === "error") {
      removeMessage(currentBot.value.id, message.id);
      requestReply(currentBot.value.id);
    } else if (message.failed) {
      send(message.payload, message);
    }
  }

  async function react({ message, emoji }) {
    const botId = currentBot.value.id;
    replaceMessage(botId, { ...message, body: { ...message.body, reactions: { ...message.body.reactions, user: emoji || undefined } } });
    if (emoji) playMood(botId, [["happy", 2000]]);
    try {
      const result = await botsApi.react(botId, message.id, emoji);
      for (const updated of result.messages) replaceMessage(botId, updated);
    } catch (error) {
      replaceMessage(botId, message);
      reportFailure("That reaction didn't stick. Try again.", error);
    }
  }

  // Question cards: the picks are the answer, then the bot replies.
  async function answerChoice({ message, selected }) {
    const botId = currentBot.value.id;
    try {
      const result = await botsApi.answer(botId, message.id, selected);
      appendMessages(botId, result.messages);
      updateBot(result.bot);
    } catch (error) {
      reportFailure("That answer didn't go through. Try again.", error);
      return;
    }
    await requestReply(botId);
  }

  // Send or Discard on a draft the bot wrote. An email from a connected mailbox has
  // gone already; anything else the bot sends after Send. Discard has nothing to undo on failure.
  function keepDraftCard() {}
  async function settleDraft({ message, answer, onFail = keepDraftCard }) {
    const botId = currentBot.value.id;
    let result;
    try {
      result = await botsApi.settleDraft(botId, message.id, answer);
      appendMessages(botId, result.messages);
    } catch (error) {
      onFail();
      reportFailure(error?.message || "That didn't go through. Try again.", error);
      return;
    }
    if (answer.action === "send" && result.messages[0]?.body.status === "send") await requestReply(botId);
  }

  // The person's answer on a bot's secure form; then the bot carries on.
  async function answerSecureForm({ message, answer }) {
    const botId = currentBot.value.id;
    try {
      const result = await botsApi.settleSecureForm(botId, message.id, answer);
      appendMessages(botId, result.messages);
    } catch (error) {
      reportFailure(error?.message || "That didn't go through. Try again.", error);
      return;
    }
    await requestReply(botId);
  }

  // A voice conversation leaves a line in the chat with how long it lasted.
  async function endVoiceConversation(seconds) {
    const botId = currentBot.value.id;
    try {
      const result = await botsApi.voiceCall(botId, seconds);
      appendMessages(botId, result.messages);
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
