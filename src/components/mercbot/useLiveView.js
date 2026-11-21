import { computed, ref } from "vue";
import { chatsApi } from "./chatsApi.js";
import { computerApi } from "./computerApi.js";

/**
 * Why a take-over was refused, in plain words: someone else has the computer (the server names them), or it's gone
 * from the chat.
 */
function takeOverRefusal(error, botName) {
  if (error?.code === "computer_person_in_control") {
    return error.message || `Someone else has control of ${botName}'s computer. Wait until they hand it back.`;
  }
  if (error?.status === 404) return "This computer isn't in this chat any more.";
  return "You couldn't take over just now. Try again.";
}

/**
 * A bot's computer in a chat, full screen (D-13, D14, D16): watching it, a person taking it over and handing it back,
 * a hand-over card's "I'm done", and teaching a task. While a person has control, the bot doesn't act on that computer;
 * each take-over and hand-back posts its line in the chat. `chatBotFace(chatId, botId)` answers the bot's face as the
 * chat has it.
 * @param {{
 *   store: import("../../types.js").ChatMessages,
 *   work: import("../../types.js").ChatWork,
 *   chatBotFace: (chatId: string, botId: string) => object | null,
 *   reportFailure: import("../../types.js").ReportFailure
 * }} options
 */
export function useLiveView({ store, work, chatBotFace, reportFailure }) {
  // { botId, chatId, inControl, handover (the hand-over card, or null), teach } while the live view is open.
  const liveView = ref(null);
  const liveBot = computed(() => (liveView.value ? chatBotFace(liveView.value.chatId, liveView.value.botId) : null));

  /** Its screen, to watch. */
  function openComputer({ botId, chatId }) {
    liveView.value = { botId: String(botId), chatId: String(chatId), inControl: false, handover: null, teach: false };
  }

  /** The person takes the computer over: the bot leaves it alone until it's handed back. */
  async function takeOver({ botId, chatId, handover = null }) {
    const target = { id: String(botId), chat: String(chatId) };
    try {
      const result = await computerApi.takeOver(target);
      store.appendMessages(String(chatId), result.messages);
    } catch (error) {
      reportFailure(takeOverRefusal(error, chatBotFace(chatId, botId)?.name || "The bot"), error);
      return false;
    }
    liveView.value = { botId: String(botId), chatId: String(chatId), inControl: true, handover, teach: false };
    return true;
  }

  /** The person hands the computer back to its bot (from the live view, or from the chat's computers). */
  async function handBack({ botId, chatId } = liveView.value || {}) {
    if (!botId || !chatId) return;
    if (liveView.value?.botId === String(botId) && liveView.value?.chatId === String(chatId)) {
      liveView.value = { ...liveView.value, inControl: false };
    }
    try {
      const result = await computerApi.handBack({ id: String(botId), chat: String(chatId) });
      store.appendMessages(String(chatId), result.messages);
    } catch (error) {
      reportFailure("That didn't hand back. Try again.", error);
    }
  }

  /** A hand-over card's [Take over] (D-14): the computer the bot is waiting on, with the card's "I'm done". */
  const takeOverFor = ({ message, botId, chatId }) => takeOver({ botId, chatId, handover: message });

  /** A file opened in its app on the bot's desktop (D-23): the person works on it, so they take the computer over. */
  const workOnFile = ({ botId, chatId }) => takeOver({ botId, chatId });

  /**
   * Teach a task: the live view opens in control with the teach banner (teaching takes the computer over). Stopping
   * closes it, posts the "finished" message, and the bot learns in the background.
   */
  function teach({ botId, chatId }) {
    liveView.value = { botId: String(botId), chatId: String(chatId), inControl: true, handover: null, teach: true };
  }

  async function finishTeaching() {
    const { botId, chatId } = liveView.value;
    liveView.value = null;
    work.setWork(chatId, "Putting it together");
    try {
      const result = await chatsApi.teachStop(chatId, botId);
      store.appendMessages(chatId, result.messages);
    } catch (error) {
      work.setWork(chatId, "");
      reportFailure("The recording didn't save. Try teaching it again.", error);
    }
  }

  /** A hand-over card settled ("I'm done" or "Can't do it"): the bot has its computer back and carries on. */
  async function settleHandover({ message, outcome, chatId, botId }) {
    const where = liveView.value || { chatId, botId };
    liveView.value = null;
    try {
      const result = await chatsApi.settleHandover(where.chatId, message.id, outcome);
      store.appendMessages(where.chatId, result.messages);
      if (result.chat) store.updateChat(result.chat);
      await handBack({ botId: where.botId || message.authorBotId, chatId: where.chatId });
    } catch (error) {
      reportFailure("That didn't go through. Try again.", error);
      return;
    }
    if (outcome === "done") await work.requestReply(where.chatId, { afterCard: true });
  }

  /** The live view closed: a person still in control hands the computer back, so the bot isn't left waiting. */
  async function closeLive() {
    const open = liveView.value;
    liveView.value = null;
    if (open?.inControl && !open.teach && !open.handover) await handBack(open);
  }

  /**
   * The server says who has a computer now (its "computer" event, D16). The live view on it, in this person's control,
   * goes back to watching when someone else took it over; answers whether it did.
   */
  function computerChanged({ chatId, botId, control }, me) {
    const open = liveView.value;
    if (!open?.inControl || open.chatId !== String(chatId) || open.botId !== String(botId)) return false;
    if (control != null && String(control) === String(me)) return false;
    liveView.value = { ...open, inControl: false };
    return control != null;
  }

  return {
    liveView, liveBot, openComputer, takeOver, takeOverFor, handBack, workOnFile, teach, finishTeaching, settleHandover, closeLive,
    computerChanged
  };
}
