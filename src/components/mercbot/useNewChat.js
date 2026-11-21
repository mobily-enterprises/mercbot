import { computed, ref } from "vue";
import { BOT_COLOURS } from "@/theme/palettes.js";
import { chatsApi } from "./chatsApi.js";
import { uploadAttached } from "./useComposerFiles.js";

/**
 * New chat (plan 4.3, D15): the chat panel shows who it's with, whether it's Public (the default) or Private, and an
 * optional title, with the composer below for its first message. [Start] or the first message makes it; Enter on an
 * empty composer starts it empty, and files attached go in the new chat's folder once it's made. Joining a public chat
 * from its list opens that chat instead. Continue with others (D-114) opens it from a direct chat: Public, its bot on
 * the To: line, and the bot's hand-over note as the first message, which the person changes and sends themselves.
 * @param {{
 *   currentChat: import("vue").ComputedRef<import("../../types.js").Chat | null>,
 *   currentDraft: import("vue").WritableComputedRef<string>,
 *   store: import("../../types.js").ChatMessages,
 *   showChat: (chatId: string) => Promise<unknown>,
 *   send: (payload: Record<string, any>) => Promise<void>,
 *   botById: (botId: string) => object | null,
 *   reportFailure: import("../../types.js").ReportFailure
 * }} options `send` sends the first message in the open chat once it's made (useChatActions)
 */
export function useNewChat({ currentChat, currentDraft, store, showChat, send, botById, reportFailure }) {
  // { kind: "public" | "private", people: userIds, bots: botIds, title, continuing? } while New chat is open, else null:
  // `continuing` ({ chatId, botId, writing }) the direct chat it carries on.
  const newChat = ref(null);
  const newChatDraft = ref("");
  const starting = ref(false);

  // The composer takes the colour of a chat's one bot; New chat's of the one bot chosen, or neutral black for more.
  const accentColor = computed(() => {
    if (!newChat.value) {
      const bots = currentChat.value?.bots || [];
      return bots.length === 1 ? bots[0].color : BOT_COLOURS.Black;
    }
    const bots = newChat.value.bots.map(botById).filter(Boolean);
    return bots.length === 1 ? bots[0].color : BOT_COLOURS.Black;
  });

  const chatDraft = computed({
    get: () => (newChat.value ? newChatDraft.value : currentDraft.value),
    set: (value) => {
      if (newChat.value) newChatDraft.value = value;
      else currentDraft.value = value;
    }
  });

  /** New chat, with whoever's given already on its To: line (a person's [Message] on Team). Public unless asked. */
  function openNewChat({ people = [], bots = [], kind = "public" } = {}) {
    newChat.value = { kind, people: people.map(String), bots: bots.map(String), title: "" };
    newChatDraft.value = "";
  }

  /** Continue with others from a direct chat: New chat with its bot, and its note in the composer while that's empty. */
  async function continueWithOthers(chat) {
    const chatId = String(chat.id);
    const botId = String(chat.directBotId);
    newChat.value = { kind: "public", people: [], bots: [botId], title: "", continuing: { chatId, botId, writing: true } };
    newChatDraft.value = "";
    const stillOpen = () => newChat.value?.continuing?.chatId === chatId;
    try {
      const { note } = await chatsApi.handOverNote(chatId);
      if (stillOpen() && !newChatDraft.value.trim()) newChatDraft.value = note;
    } catch (error) {
      if (stillOpen()) reportFailure(error?.message || "The note didn't come. Write the first message yourself.", error);
    } finally {
      if (stillOpen()) newChat.value = { ...newChat.value, continuing: { ...newChat.value.continuing, writing: false } };
    }
  }

  function closeNewChat() {
    newChat.value = null;
    newChatDraft.value = "";
  }

  /** New chat's choices changed: { kind, people, bots, title }, each optional. */
  function changeNewChat(changes) {
    if (newChat.value) newChat.value = { ...newChat.value, ...changes };
  }

  /**
   * The chat made from New chat's choices, then its first message sent there, if there is one. Who's on the To: line
   * and the person themselves are its members.
   * @param {Record<string, any>} [payload] the composer's message, or none to start it empty
   */
  async function startNewChat(payload = null) {
    const choice = newChat.value;
    if (!choice || starting.value) return;
    if (!choice.people.length && !choice.bots.length) {
      reportFailure("Add someone to the chat first: a person or a bot.", null);
      return;
    }
    if (choice.continuing && !choice.people.length && choice.bots.every((id) => id === choice.continuing.botId)) {
      reportFailure("Add the people or bots to continue with first.", null);
      return;
    }
    starting.value = true;
    let made;
    try {
      made = await chatsApi.create({ kind: choice.kind, title: choice.title.trim() || null, people: choice.people, bots: choice.bots });
    } catch (error) {
      reportFailure(error?.status === 403 && error.message ? error.message : "The chat didn't start. Try again.", error);
      return;
    } finally {
      starting.value = false;
    }
    store.addChat(made.chat);
    store.messagesByChat.value = { ...store.messagesByChat.value, [String(made.chat.id)]: [] };
    closeNewChat();
    await showChat(String(made.chat.id));
    // Files attached before the chat was made go in its folder now; one refused is left out, saying why.
    const attachments = await uploadAttached(payload?.attachments || [], made.chat, (error) => reportFailure(error?.message || "That file didn't upload.", error));
    if (payload && (payload.text || attachments.length || payload.quotes?.length)) await send(payload.attachments ? { ...payload, attachments } : payload);
  }

  /** A public chat joined from New chat's list: it's the person's now, and it opens. */
  async function joinPublic(chatId) {
    try {
      const { chat } = await chatsApi.join(chatId);
      store.addChat(chat);
      closeNewChat();
      await showChat(String(chat.id));
    } catch (error) {
      reportFailure("You couldn't join that chat just now. Try again.", error);
    }
  }

  return { newChat, starting, accentColor, chatDraft, openNewChat, continueWithOthers, closeNewChat, changeNewChat, startNewChat, joinPublic };
}
