import { computed, nextTick, ref, watch } from "vue";
import { botsApi } from "./botsApi.js";

/**
 * Details tab: the bot's always-on instructions (D-95). Read on the Details tab, and read again there as the bot's
 * activity changes (an approved card may have changed them), unless they're being edited. Its maker and the home's
 * owners and admins edit them in place: Save writes them, Cancel puts them back, and a refusal (too long, not allowed)
 * shows under the box in the server's words.
 * @param {{
 *   bot: () => import("../../types.js").Bot,
 *   isGroup: import("vue").ComputedRef<boolean>,
 *   tab: import("vue").ComputedRef<string>,
 *   onSaved: () => void,
 *   onFailure: (error: unknown) => void
 * }} options
 */
export function useBotInstructions({ bot, isGroup, tab, onSaved, onFailure }) {
  const instructions = ref(null);
  const editingInstructions = ref(false);
  const instructionsDraft = ref("");
  const savingInstructions = ref(false);
  const instructionsProblem = ref("");
  const instructionsBox = ref(null);
  const instructionsChanged = computed(() => instructions.value && instructionsDraft.value.trim() !== instructions.value.instructions);

  async function loadInstructions() {
    if (isGroup.value || editingInstructions.value) return;
    const botId = bot().id;
    try {
      const read = await botsApi.instructions(botId);
      if (bot().id === botId && !editingInstructions.value) instructions.value = read;
    } catch (error) {
      onFailure(error);
    }
  }

  async function editInstructions() {
    if (!instructions.value?.canChange) return;
    instructionsDraft.value = instructions.value.instructions;
    instructionsProblem.value = "";
    editingInstructions.value = true;
    await nextTick();
    instructionsBox.value?.focus();
  }

  function cancelInstructions() {
    editingInstructions.value = false;
    instructionsProblem.value = "";
  }

  async function saveInstructions() {
    const botId = bot().id;
    savingInstructions.value = true;
    instructionsProblem.value = "";
    try {
      await botsApi.update(botId, { instructions: instructionsDraft.value });
      instructions.value = await botsApi.instructions(botId);
      editingInstructions.value = false;
      onSaved();
    } catch (error) {
      instructionsProblem.value = error?.message || "That didn't save. Try again.";
    }
    savingInstructions.value = false;
  }

  let instructionsFor = null;
  watch([() => bot().id, () => bot().lastActivityAt, tab], () => {
    if (bot().id !== instructionsFor) {
      instructions.value = null;
      editingInstructions.value = false;
      instructionsProblem.value = "";
    }
    instructionsFor = bot().id;
    if (tab.value === "details") loadInstructions();
  }, { immediate: true });

  return {
    instructions,
    editingInstructions,
    instructionsDraft,
    savingInstructions,
    instructionsProblem,
    instructionsBox,
    instructionsChanged,
    editInstructions,
    cancelInstructions,
    saveInstructions
  };
}
