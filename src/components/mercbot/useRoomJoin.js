import { watch } from "vue";
import { chatsApi } from "./chatsApi.js";
import { isRoom } from "./chatDirectory.js";

/** Whether opening a chat joins the person: a faded public room (not the everyone chat, not archived). */
export const joinsOnOpen = (chat) =>
  Boolean(chat?.visiting) && chat.kind === "public" && isRoom(chat) && !chat.everyone && !chat.archivedAt;

/**
 * Opening a faded public room joins it (the owner, 23 Nov 2026): a room someone isn't in sends them nothing, so the room
 * they open becomes theirs, and its messages and its bots at work reach them live from then on. It follows the chat
 * shown, not the row, so a room just left while it's still open stays left until it's opened again.
 * @param {{
 *   currentChat: import("vue").Ref<import("../../types.js").Chat | null>,
 *   store: { updateChat: (chat: object) => void },
 *   reportFailure: (message: string, error: unknown) => void
 * }} options
 */
export function useRoomJoin({ currentChat, store, reportFailure }) {
  watch(() => currentChat.value?.id || "", async (chatId) => {
    const chat = currentChat.value;
    if (!chatId || !joinsOnOpen(chat)) return;
    try {
      store.updateChat((await chatsApi.join(chatId)).chat);
    } catch (error) {
      reportFailure("That room couldn't be joined. Try again.", error);
    }
  }, { immediate: true });
}
