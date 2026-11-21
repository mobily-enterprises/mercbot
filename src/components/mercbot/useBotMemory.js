import { computed, ref, watch } from "vue";
import { botsApi } from "./botsApi.js";

// What a bot remembers (D-113), on its card's Details: its memory of the home's public chats it's in, which everyone in
// the home may read as they may read those chats, and the home's notes, which every bot reads in every chat.

/** When a memory was made, in the reader's own time: "22 Nov, 14:05". */
export function madeLine(at) {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(when);
}

/** Who asked for a note, and through which bot: "Ben, via Chef". */
export function noteLine(note) {
  const who = note.by?.name || "Someone";
  return note.viaBot ? `${who}, via ${note.viaBot.name}` : who;
}

/**
 * The card's Memory and Notes, read while its Details tab is open and again when the bot changes.
 * @param {{ bot: () => { id: string, name: string }, tab: import("vue").Ref<string>, onFailure: (error: unknown) => void }} options
 */
export function useBotMemory({ bot, tab, onFailure }) {
  const memory = ref(null);
  const notes = ref([]);
  const next = ref(null);
  const loaded = ref(false);
  const loadFailed = ref(false);
  const removing = ref(null);
  const loadingMore = ref(false);
  const hasMemory = computed(() => Boolean(memory.value?.text));

  async function load() {
    const botId = bot().id;
    try {
      const [remembered, listed] = await Promise.all([botsApi.memory(botId), botsApi.homeNotes()]);
      if (bot().id !== botId) return;
      memory.value = remembered.memory;
      notes.value = listed.notes;
      next.value = listed.next;
      loaded.value = true;
      loadFailed.value = false;
    } catch (error) {
      if (bot().id === botId) loadFailed.value = true;
      onFailure(error);
    }
  }

  async function loadMore() {
    if (!next.value || loadingMore.value) return;
    loadingMore.value = true;
    try {
      const listed = await botsApi.homeNotes(next.value);
      notes.value = [...notes.value, ...listed.notes];
      next.value = listed.next;
    } catch (error) {
      onFailure(error);
    } finally {
      loadingMore.value = false;
    }
  }

  async function confirmRemove() {
    const note = removing.value;
    removing.value = null;
    if (!note) return;
    try {
      await botsApi.removeHomeNote(note.id);
      notes.value = notes.value.filter((kept) => kept.id !== note.id);
    } catch (error) {
      onFailure(error);
    }
  }

  let shownFor = null;
  watch([() => bot().id, tab], () => {
    if (bot().id !== shownFor) {
      memory.value = null;
      notes.value = [];
      next.value = null;
      loaded.value = false;
      loadFailed.value = false;
      removing.value = null;
    }
    shownFor = bot().id;
    if (tab.value === "details") load();
  }, { immediate: true });

  return { memory, notes, next, loaded, loadFailed, removing, loadingMore, hasMemory, load, loadMore, confirmRemove };
}
