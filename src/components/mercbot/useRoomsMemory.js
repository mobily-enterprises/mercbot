import { computed, ref, watch } from "vue";
import { botsApi } from "./botsApi.js";

// A bot's Rooms memory (D-113), on its card's Details: its memory of the home's public rooms it's in, which everyone in
// the home may read as they may read those rooms, and how much of the home's common knowledge it also knows (which is
// the home's, in Settings).

/** When a memory or an entry was made, in the reader's own time: "22 Nov, 14:05". */
export function madeLine(at) {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(when);
}

/**
 * The card's Rooms memory and the count of the home's common knowledge, read while its Details tab is open and again
 * when the bot changes. The count is the first page's: "50+" when there are more.
 * @param {{ bot: () => { id: string, name: string }, tab: import("vue").Ref<string>, onFailure: (error: unknown) => void }} options
 */
export function useRoomsMemory({ bot, tab, onFailure }) {
  const roomsMemory = ref(null);
  const common = ref({ count: 0, more: false });
  const loaded = ref(false);
  const loadFailed = ref(false);
  const hasRoomsMemory = computed(() => Boolean(roomsMemory.value?.text));
  const commonCount = computed(() => (common.value.more ? `${common.value.count}+` : String(common.value.count)));

  async function load() {
    const botId = bot().id;
    try {
      const [remembered, listed] = await Promise.all([botsApi.roomsMemory(botId), botsApi.commonKnowledge()]);
      if (bot().id !== botId) return;
      roomsMemory.value = remembered.roomsMemory;
      common.value = { count: listed.entries.length, more: Boolean(listed.next) };
      loaded.value = true;
      loadFailed.value = false;
    } catch (error) {
      if (bot().id === botId) loadFailed.value = true;
      onFailure(error);
    }
  }

  let shownFor = null;
  watch([() => bot().id, tab], () => {
    if (bot().id !== shownFor) {
      roomsMemory.value = null;
      common.value = { count: 0, more: false };
      loaded.value = false;
      loadFailed.value = false;
    }
    shownFor = bot().id;
    if (tab.value === "details") load();
  }, { immediate: true });

  return { roomsMemory, commonCount, loaded, loadFailed, hasRoomsMemory, load };
}
