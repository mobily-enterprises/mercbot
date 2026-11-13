import { ref, watch } from "vue";
import { botsApi, notebookChanges } from "./botsApi.js";

/** How long ago a note was written, in days: "today", "yesterday", "3 days ago". */
export const noteAge = (iso) => new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(Math.round((new Date(iso) - Date.now()) / 86400000), "day");

/**
 * A mixed bot's home notebook (D-36): read by everyone; each note's author, owners and admins
 * remove notes. It's read on the Details tab, where it shows, a page of the newest notes with Show
 * more for older ones, and read again there as the bot's activity changes, like the routines.
 * @param {{
 *   bot: () => import("../../types.js").Bot,
 *   isGroup: import("vue").ComputedRef<boolean>,
 *   tab: import("vue").ComputedRef<string>,
 *   onFailure: (error: unknown) => void
 * }} options
 */
export function useBotNotebook({ bot, isGroup, tab, onFailure }) {
  const notes = ref([]);
  const notesLoaded = ref(false);
  // The next older page's cursor, or null when every note is shown.
  const notesNext = ref(null);

  // The newest page again. Older notes already shown stay below it, with their cursor.
  async function loadNotes() {
    if (bot().sharing !== "mixed" || isGroup.value) return;
    const botId = bot().id;
    try {
      const page = await botsApi.notebook(botId);
      if (bot().id !== botId) return;
      const oldest = page.notes.at(-1);
      const older = oldest ? notes.value.filter((note) => Number(note.id) < Number(oldest.id)) : [];
      notes.value = [...page.notes, ...older];
      if (!older.length) notesNext.value = page.next;
    } catch (error) {
      onFailure(error);
    }
    notesLoaded.value = true;
  }

  async function moreNotes() {
    const botId = bot().id;
    try {
      const page = await botsApi.notebook(botId, notesNext.value);
      if (bot().id !== botId) return;
      const shown = new Set(notes.value.map((note) => note.id));
      notes.value = [...notes.value, ...page.notes.filter((note) => !shown.has(note.id))];
      notesNext.value = page.next;
    } catch (error) {
      onFailure(error);
    }
  }

  async function removeNote(note) {
    notes.value = notes.value.filter((entry) => entry.id !== note.id);
    try {
      await botsApi.removeNote(bot().id, note.id);
    } catch (error) {
      onFailure(error);
      loadNotes();
    }
  }

  let notesFor = null;
  watch([() => bot().id, () => bot().sharing, () => bot().lastActivityAt, notebookChanges, tab], () => {
    if (bot().id !== notesFor) {
      notesLoaded.value = false;
      notes.value = [];
      notesNext.value = null;
    }
    notesFor = bot().id;
    if (tab.value === "details") loadNotes();
  }, { immediate: true });

  return { notes, notesLoaded, notesNext, moreNotes, removeNote };
}
