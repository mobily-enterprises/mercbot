import { computed, ref, watch } from "vue";

const DRAFTS_KEY = "mercbot.drafts";

function readDrafts() {
  try {
    return JSON.parse(window.localStorage.getItem(DRAFTS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

/**
 * Unsent messages, one per bot, kept on this device. `currentBotId` names the open bot, whose
 * draft `currentDraft` reads and writes.
 * @param {{ currentBotId: () => string }} options
 */
export function useDrafts({ currentBotId }) {
  const drafts = ref(readDrafts());

  watch(drafts, (value) => {
    try {
      window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(value));
    } catch {
      // Storage unavailable: drafts last for this visit.
    }
  }, { deep: true });

  const currentDraft = computed({
    get: () => drafts.value[currentBotId()] || "",
    set: (value) => {
      const next = { ...drafts.value };
      if (value) next[currentBotId()] = value;
      else delete next[currentBotId()];
      drafts.value = next;
    }
  });

  return { drafts, currentDraft };
}
