import { computed, ref } from "vue";
import { BOT_COLOURS } from "@/theme/palettes.js";
import { chatsApi } from "./chatsApi.js";

/**
 * New chat (plan 4.3, D15): the chat panel shows who it's with, whether it's Public (the default) or Private, and an
 * optional title, with the composer below for its first message. [Start] or the first message makes it; Enter on an
 * empty composer starts it empty. Joining a public chat from its list opens that chat instead.
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
  // { kind: "public" | "private", people: userIds, bots: botIds, title } while New chat is open, else null.
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
    if (payload && (payload.text || payload.attachments?.length || payload.quotes?.length)) await send(payload);
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

  return { newChat, starting, accentColor, chatDraft, openNewChat, closeNewChat, changeNewChat, startNewChat, joinPublic };
}
