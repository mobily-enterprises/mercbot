import { ref } from "vue";
import { botsApi } from "./botsApi.js";

// The home's common knowledge (D-113), in Settings → Bots' common knowledge: what people asked a bot to tell every bot,
// which every bot reads in every chat; newest first, a page at a time. An entry's author and the home's owners and
// admins remove it.

/** Who asked for an entry, and through which bot: "Ben, via Chef". */
export function entryLine(entry) {
  const who = entry.by?.name || "Someone";
  return entry.viaBot ? `${who}, via ${entry.viaBot.name}` : who;
}

/**
 * The list (`load`, when the section opens), its older pages, and removing an entry.
 * @param {{ onFailure: (error: unknown) => void }} options
 */
export function useCommonKnowledge({ onFailure }) {
  const entries = ref([]);
  const next = ref(null);
  const loaded = ref(false);
  const loadFailed = ref(false);
  const removing = ref(null);
  const loadingMore = ref(false);

  async function load() {
    try {
      const listed = await botsApi.commonKnowledge();
      entries.value = listed.entries;
      next.value = listed.next;
      loaded.value = true;
      loadFailed.value = false;
    } catch (error) {
      loadFailed.value = true;
      onFailure(error);
    }
  }

  async function loadMore() {
    if (!next.value || loadingMore.value) return;
    loadingMore.value = true;
    try {
      const listed = await botsApi.commonKnowledge(next.value);
      entries.value = [...entries.value, ...listed.entries];
      next.value = listed.next;
    } catch (error) {
      onFailure(error);
    } finally {
      loadingMore.value = false;
    }
  }

  async function confirmRemove() {
    const entry = removing.value;
    removing.value = null;
    if (!entry) return;
    try {
      await botsApi.removeCommonKnowledge(entry.id);
      entries.value = entries.value.filter((kept) => kept.id !== entry.id);
    } catch (error) {
      onFailure(error);
    }
  }

  return { entries, next, loaded, loadFailed, removing, loadingMore, load, loadMore, confirmRemove };
}
