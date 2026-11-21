import { computed, onBeforeUnmount, watch } from "vue";
import { ONBOARDING_TIMING, chatsApi } from "./chatsApi.js";

/**
 * The welcome chat runs on the server one step at a time; the client waits each step's delay. Opening a chat loads its
 * messages. `currentChat` is the open chat (or null), `store` holds the messages (useChatMessages), `focusComposer`
 * puts the caret in the message box when Mercbot asks for a name, and `reportFailure` explains a step that failed or a
 * chat that didn't load.
 * @param {{
 *   currentChat: import("vue").ComputedRef<import("../../types.js").Chat | null>,
 *   store: import("../../types.js").ChatMessages,
 *   focusComposer: () => void,
 *   reportFailure: import("../../types.js").ReportFailure
 * }} options
 */
export function useOnboarding({ currentChat, store, focusComposer, reportFailure }) {
  let onboardingTimer = null;
  // An archived chat's steps wait until it's back in use: it's read-only.
  const stepOf = (chat) => (!chat || chat.archivedAt ? null : chat.onboardingStep);
  const onboardingTiming = computed(() => ONBOARDING_TIMING[stepOf(currentChat.value)] || null);

  function scheduleOnboarding() {
    clearTimeout(onboardingTimer);
    const chat = currentChat.value;
    const timing = ONBOARDING_TIMING[stepOf(chat)];
    if (!timing) return;
    const step = chat.onboardingStep;
    onboardingTimer = setTimeout(async () => {
      try {
        const result = await chatsApi.advance(chat.id, step);
        store.appendMessages(chat.id, result.messages);
        if (result.chat) store.updateChat(result.chat);
      } catch (error) {
        reportFailure("Mercbot couldn't continue just now. Reload to try again.", error);
      }
    }, timing.delay);
  }

  // A chat that doesn't load says so like any other failure. Left to Vue, it would be a modal that takes every click on
  // the page until it's closed.
  watch(() => [currentChat.value?.id, stepOf(currentChat.value)], async ([chatId]) => {
    if (!chatId) return;
    try {
      await store.loadMessages(chatId);
    } catch (error) {
      reportFailure("This chat didn't load. Reload to try again.", error);
      return;
    }
    scheduleOnboarding();
    if (stepOf(currentChat.value) === "ask-name") focusComposer();
  }, { immediate: true });
  onBeforeUnmount(() => clearTimeout(onboardingTimer));

  async function chooseName(name) {
    const chat = currentChat.value;
    if (!chat) return;
    try {
      const result = await chatsApi.chooseName(chat.id, name);
      store.appendMessages(chat.id, result.messages);
      if (result.chat) store.updateChat(result.chat);
    } catch (error) {
      reportFailure("That choice didn't go through. Try again.", error);
    }
  }

  return { onboardingTiming, chooseName };
}
