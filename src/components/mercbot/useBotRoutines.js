import { ref, watch } from "vue";
import { chatsApi } from "./chatsApi.js";

/** Whether the person can switch a routine: anyone can pause one that's on; only its maker resumes it (`canResume`). */
export const canSwitchRoutine = (routine) => Boolean(routine.enabled || routine.canResume);

/**
 * A routine's menu: Pause, or Resume for its maker (`canResume`: it runs as them); Edit, through its chat; and Delete,
 * which is anyone's who can open its chat, after a confirmation.
 * @param {{ enabled: boolean, canResume?: boolean }} routine
 * @param {{ toggle: () => void, edit: () => void, remove: () => void }} actions
 */
export function routineMenuItems(routine, { toggle, edit, remove }) {
  const items = [];
  if (routine.enabled) items.push({ title: "Pause", icon: "$pause", run: toggle });
  else if (routine.canResume) items.push({ title: "Resume", icon: "$play", run: toggle });
  items.push({ title: "Edit", icon: "$edit", run: edit }, { divider: true }, { title: "Delete", icon: "$delete", danger: true, run: remove });
  return items;
}

/**
 * A bot card's routines (D-112: a routine belongs to a bot in a chat), with on/off switches. From a chat, this bot's
 * routines in that chat; on Team, its routines in every chat the person can open, each naming its chat. A click only
 * highlights a row; right-click offers what routineMenuItems allows. Edit goes through the routine's chat, so the
 * composer gets a request naming it. Routines are made and changed in chats, so they're read again as the open chat's
 * activity changes.
 * @param {{
 *   bot: () => import("../../types.js").Bot,
 *   chat: () => import("../../types.js").Chat | null,
 *   tab: import("vue").ComputedRef<string>,
 *   onEdit: (routine: Record<string, any>) => void,
 *   onFailure: (error: unknown) => void
 * }} options
 */
export function useBotRoutines({ bot, chat, tab, onEdit, onFailure }) {
  const routines = ref([]);
  const routinesLoaded = ref(false);

  /** The bot's routines where the card is: in the open chat, or everywhere the person can open. */
  async function read() {
    const botId = String(bot().id);
    const chatId = chat()?.id ?? null;
    if (!chatId) return (await chatsApi.routinesOf(botId)).routines;
    return (await chatsApi.routinesIn(chatId)).routines.filter((routine) => String(routine.botId) === botId);
  }

  async function loadRoutines() {
    routinesLoaded.value = false;
    try {
      routines.value = await read();
    } catch (error) {
      routines.value = [];
      onFailure(error);
    }
    routinesLoaded.value = true;
  }

  async function toggleRoutine(routine) {
    if (!canSwitchRoutine(routine)) return;
    const enabled = !routine.enabled;
    routines.value = routines.value.map((entry) => (entry.id === routine.id ? { ...entry, enabled } : entry));
    try {
      const { routine: changed } = await chatsApi.switchRoutine(routine.id, enabled);
      routines.value = routines.value.map((entry) => (entry.id === changed.id ? changed : entry));
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
      items: routineMenuItems(routine, {
        toggle: () => toggleRoutine(routine),
        edit: () => onEdit(routine),
        remove: () => { pendingRoutineDelete.value = routine; }
      })
    };
  }

  async function deleteRoutine() {
    const routine = pendingRoutineDelete.value;
    pendingRoutineDelete.value = null;
    if (!routine) return;
    routines.value = routines.value.filter((entry) => entry.id !== routine.id);
    try {
      await chatsApi.removeRoutine(routine.id);
    } catch (error) {
      loadRoutines();
      onFailure(error);
    }
  }

  async function refreshRoutines() {
    try {
      routines.value = await read();
    } catch {
      // The list stays as it was.
    }
  }

  // Read when Details shows them, again when the bot or chat changes; a card with no bot (a person's) reads nothing.
  let readFor = null;
  watch([() => bot().id, () => chat()?.id ?? null, tab], ([botId, chatId]) => {
    const where = `${botId}:${chatId ?? ""}`;
    if (where === readFor || !botId || tab.value !== "details") return;
    readFor = where;
    highlightedRoutineId.value = "";
    loadRoutines();
  }, { immediate: true });
  watch(() => chat()?.lastActivityAt, () => {
    if (tab.value === "details" && bot().id) refreshRoutines();
  });

  return { routines, routinesLoaded, toggleRoutine, highlightedRoutineId, routineMenu, pendingRoutineDelete, openRoutineMenu, deleteRoutine };
}
