import { ref, watch } from "vue";
import { botsApi } from "./botsApi.js";

/**
 * Details tab: the bot's routines with on/off switches. Routine rows: a click only
 * highlights; right-click offers Pause or Resume, Edit and Delete. Edit goes through the chat, so the
 * composer gets a request naming the routine. Routines are created and changed from chat, so
 * they're read again as the bot's activity changes.
 * @param {{
 *   bot: () => import("../../types.js").Bot,
 *   tab: import("vue").ComputedRef<string>,
 *   onEdit: (routine: Record<string, any>) => void,
 *   onFailure: (error: unknown) => void
 * }} options
 */
export function useBotRoutines({ bot, tab, onEdit, onFailure }) {
  const routines = ref([]);
  const routinesLoaded = ref(false);

  async function loadRoutines() {
    routinesLoaded.value = false;
    try {
      routines.value = (await botsApi.routines(bot().id)).routines;
    } catch (error) {
      routines.value = [];
      onFailure(error);
    }
    routinesLoaded.value = true;
  }

  async function toggleRoutine(routine) {
    const enabled = !routine.enabled;
    routines.value = routines.value.map((entry) => (entry.id === routine.id ? { ...entry, enabled } : entry));
    try {
      await botsApi.setRoutine(bot().id, routine.id, enabled);
    } catch (error) {
      routines.value = routines.value.map((entry) => (entry.id === routine.id ? routine : entry));
      onFailure(error);
    }
  }

  const highlightedRoutineId = ref("");
  const routineMenu = ref({ open: false, target: [0, 0], items: [] });
  const pendingRoutineDelete = ref(null);

  function openRoutineMenu(event, routine) {
    highlightedRoutineId.value = routine.id;
    routineMenu.value = {
      open: true,
      target: [event.clientX, event.clientY],
      items: [
        routine.enabled
          ? { title: "Pause", icon: "$pause", run: () => toggleRoutine(routine) }
          : { title: "Resume", icon: "$play", run: () => toggleRoutine(routine) },
        { title: "Edit", icon: "$edit", run: () => onEdit(routine) },
        { divider: true },
        { title: "Delete", icon: "$delete", danger: true, run: () => { pendingRoutineDelete.value = routine; } }
      ]
    };
  }

  async function deleteRoutine() {
    const routine = pendingRoutineDelete.value;
    pendingRoutineDelete.value = null;
    routines.value = routines.value.filter((entry) => entry.id !== routine.id);
    try {
      await botsApi.removeRoutine(bot().id, routine.id);
    } catch (error) {
      loadRoutines();
      onFailure(error);
    }
  }

  async function refreshRoutines() {
    try {
      routines.value = (await botsApi.routines(bot().id)).routines;
    } catch {
      // The list stays as it was.
    }
  }

  watch(() => bot().id, () => {
    highlightedRoutineId.value = "";
    loadRoutines();
  }, { immediate: true });
  watch(() => bot().lastActivityAt, () => {
    if (tab.value === "details") refreshRoutines();
  });

  return { routines, routinesLoaded, toggleRoutine, highlightedRoutineId, routineMenu, pendingRoutineDelete, openRoutineMenu, deleteRoutine };
}
