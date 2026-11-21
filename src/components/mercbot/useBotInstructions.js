import { computed, nextTick, ref, watch } from "vue";
import { botsApi } from "./botsApi.js";

/**
 * A bot card's Instructions (D-98), its template and its additions. Read on the Details tab, and read again there as the
 * open chat's activity changes (an approved card may have changed its additions), unless they're being edited.
 * Its maker and the home's owners and admins edit the additions in place: Save writes them, Cancel puts them back, and a
 * refusal (too long, not allowed) shows under the box in the server's words. The template is read-only here.
 * @param {{
 *   bot: () => import("../../types.js").Bot,
 *   tab: import("vue").ComputedRef<string>,
 *   activity: () => string | null,
 *   onSaved: (bot: import("../../types.js").Bot) => void,
 *   onFailure: (error: unknown) => void
 * }} options `activity` is the open chat's last activity, or nothing on Team
 */
export function useBotInstructions({ bot, tab, activity, onSaved, onFailure }) {
  const instructions = ref(null);
  const editingAdditions = ref(false);
  const additionsDraft = ref("");
  const savingAdditions = ref(false);
  const additionsProblem = ref("");
  const additionsBox = ref(null);
  const additionsChanged = computed(() => instructions.value && additionsDraft.value.trim() !== instructions.value.additions);

  async function loadInstructions() {
    if (editingAdditions.value) return;
    const botId = bot().id;
    try {
      const read = await botsApi.instructions(botId);
      if (bot().id === botId && !editingAdditions.value) instructions.value = read;
    } catch (error) {
      onFailure(error);
    }
  }

  async function editAdditions() {
    if (!instructions.value?.canChange) return;
    additionsDraft.value = instructions.value.additions;
    additionsProblem.value = "";
    editingAdditions.value = true;
    await nextTick();
    additionsBox.value?.focus();
  }

  function cancelAdditions() {
    editingAdditions.value = false;
    additionsProblem.value = "";
  }

  async function saveAdditions() {
    const botId = bot().id;
    savingAdditions.value = true;
    additionsProblem.value = "";
    try {
      const { bot: changed } = await botsApi.update(botId, { additions: additionsDraft.value });
      instructions.value = await botsApi.instructions(botId);
      editingAdditions.value = false;
      onSaved(changed);
    } catch (error) {
      additionsProblem.value = error?.message || "That didn't save. Try again.";
    }
    savingAdditions.value = false;
  }

  let instructionsFor = null;
  watch([() => bot().id, activity, tab], () => {
    if (bot().id !== instructionsFor) {
      instructions.value = null;
      editingAdditions.value = false;
      additionsProblem.value = "";
    }
    instructionsFor = bot().id;
    if (tab.value === "details") loadInstructions();
  }, { immediate: true });

  return {
    instructions,
    loadInstructions,
    editingAdditions,
    additionsDraft,
    savingAdditions,
    additionsProblem,
    additionsBox,
    additionsChanged,
    editAdditions,
    cancelAdditions,
    saveAdditions
  };
}
