import { computed, ref, watch } from "vue";

// Keyed by chat (D-112).
const DRAFTS_KEY = "mercbot.chatDrafts";

function readDrafts() {
  try {
    return JSON.parse(window.localStorage.getItem(DRAFTS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

/** Leaves a draft in a chat from outside the shell (Ask Builder, a view's Ask), for when the shell opens on it. */
export function saveDraft(chatId, line) {
  try {
    window.localStorage.setItem(DRAFTS_KEY, JSON.stringify({ ...readDrafts(), [chatId]: line }));
  } catch {
    // Without storage the chat opens empty.
  }
}

/**
 * Unsent messages, one per chat, kept on this device. `currentChatId` names the open chat, whose draft `currentDraft`
 * reads and writes.
 * @param {{ currentChatId: () => string }} options
 */
export function useDrafts({ currentChatId }) {
  const drafts = ref(readDrafts());

  watch(drafts, (value) => {
    try {
      window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(value));
    } catch {
      // Storage unavailable: drafts last for this visit.
    }
  }, { deep: true });

  const currentDraft = computed({
    get: () => drafts.value[currentChatId()] || "",
    set: (value) => {
      const next = { ...drafts.value };
      if (value) next[currentChatId()] = value;
      else delete next[currentChatId()];
      drafts.value = next;
    }
  });

  return { drafts, currentDraft };
}
