import { ref } from "vue";
import { chatsApi } from "./chatsApi.js";

/**
 * New room (plan 4.3, D15): Public (the default) or Private, and its name, which it needs. Create makes the room with
 * the person in it, with its start line and no one else, and opens it; a private room then opens Invite (`onPrivate`).
 * Continue with others (D-114) opens it from a direct chat: Public, the chat's bot coming along, and the bot's hand-over
 * note put in the new room's composer once it's open, unless the person has written there already.
 * @param {{
 *   currentChat: import("vue").ComputedRef<import("../../types.js").Chat | null>,
 *   currentDraft: import("vue").WritableComputedRef<string>,
 *   store: import("../../types.js").ChatMessages,
 *   showChat: (chatId: string) => Promise<unknown>,
 *   onPrivate: (chat: import("../../types.js").Chat) => void,
 *   reportFailure: import("../../types.js").ReportFailure
 * }} options
 */
export function useNewChat({ currentChat, currentDraft, store, showChat, onPrivate, reportFailure }) {
  // { kind: "public" | "private", name, problem, continuing? } while New room is open, else null: `problem` what the
  // server said of the name, `continuing` ({ chatId, botId }) the direct chat it carries on.
  const newChat = ref(null);
  const starting = ref(false);
  // The hand-over note on its way, while Continue with others is open: resolves to the note, or "" when it didn't come.
  let note = null;

  /** New room: Public unless asked. */
  function openNewChat({ kind = "public" } = {}) {
    newChat.value = { kind, name: "", problem: "" };
    note = null;
  }

  /** Continue with others from a direct chat: New room, Public, with its bot, while the bot writes its note. */
  function continueWithOthers(chat) {
    const chatId = String(chat.id);
    newChat.value = { kind: "public", name: "", problem: "", continuing: { chatId, botId: String(chat.directBotId) } };
    note = chatsApi.handOverNote(chatId).then(({ note: written }) => written || "", (error) => {
      reportFailure(error?.message || "The note didn't come. Write the first message yourself.", error);
      return "";
    });
  }

  function closeNewChat() {
    if (!starting.value) newChat.value = null;
  }

  /** New room's choices changed: { kind, name }, each optional. A changed name clears what the server said of it. */
  function changeNewChat(changes) {
    if (newChat.value) newChat.value = { ...newChat.value, ...changes, problem: "name" in changes ? "" : newChat.value.problem };
  }

  /** The room made from New room's choices, then opened; a private one opens Invite, a continued one gets the note. */
  async function startNewChat() {
    const choice = newChat.value;
    if (!choice || starting.value) return;
    const title = choice.name.trim();
    if (!title) {
      newChat.value = { ...choice, problem: "Give the room a name." };
      return;
    }
    starting.value = true;
    let made;
    try {
      made = await chatsApi.create({ kind: choice.kind, title, people: [], bots: choice.continuing ? [choice.continuing.botId] : [] });
    } catch (error) {
      // What the server says of the name shows under it; anything else, as a failure.
      if (error?.status === 400 && error.message) newChat.value = { ...choice, problem: error.message };
      else reportFailure(error?.status === 403 && error.message ? error.message : "The room didn't start. Try again.", error);
      return;
    } finally {
      starting.value = false;
    }
    const chatId = String(made.chat.id);
    store.addChat(made.chat);
    newChat.value = null;
    await showChat(chatId);
    if (made.chat.kind === "private") onPrivate(made.chat);
    if (choice.continuing && note) {
      const written = await note;
      if (written && currentChat.value?.id === chatId && !currentDraft.value.trim()) currentDraft.value = written;
    }
  }

  return { newChat, starting, openNewChat, continueWithOthers, closeNewChat, changeNewChat, startNewChat };
}
