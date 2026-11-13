import { computed, ref } from "vue";
import { BOT_COLOURS } from "@/theme/palettes.js";
import { botsApi } from "./botsApi.js";

/**
 * Starting a group chat: the chat panel becomes a recipient picker. One chosen bot lends
 * its colour; two or more are neutral black. The first message creates the group.
 * @param {{
 *   bots: import("vue").Ref<Array<import("../../types.js").Bot>>,
 *   currentBot: import("vue").ComputedRef<import("../../types.js").Bot>,
 *   currentDraft: import("vue").WritableComputedRef<string>,
 *   store: import("../../types.js").BotMessages,
 *   work: import("../../types.js").BotWork,
 *   selectBot: (botId: string) => void,
 *   reportFailure: import("../../types.js").ReportFailure
 * }} options
 */
export function useGroupPicker({ bots, currentBot, currentDraft, store, work, selectBot, reportFailure }) {
  const picker = ref(null);
  const pickerDraft = ref("");
  const pickerBots = computed(() => (picker.value?.botIds || []).map((id) => bots.value.find((bot) => bot.id === id)).filter(Boolean));
  const accentColor = computed(() => {
    if (!picker.value) return currentBot.value.color;
    return pickerBots.value.length === 1 ? pickerBots.value[0].color : BOT_COLOURS.Black;
  });
  const chatDraft = computed({
    get: () => (picker.value ? pickerDraft.value : currentDraft.value),
    set: (value) => {
      if (picker.value) pickerDraft.value = value;
      else currentDraft.value = value;
    }
  });

  function openGroupPicker() {
    picker.value = { botIds: [] };
    pickerDraft.value = "";
  }

  async function startGroup(payload) {
    const botIds = picker.value.botIds;
    if (!botIds.length) {
      reportFailure("Pick who to chat with first.", null);
      return;
    }
    let result;
    try {
      result = await botsApi.createGroup({ ...payload, botIds });
    } catch (error) {
      reportFailure("The group chat didn't start. Try again.", error);
      return;
    }
    bots.value = [...bots.value, result.bot];
    store.messagesByBot.value = { ...store.messagesByBot.value, [result.bot.id]: result.messages };
    picker.value = null;
    pickerDraft.value = "";
    selectBot(result.bot.id);
    // A group started without a message waits for one.
    if (result.messages.some((message) => message.role === "user")) await work.requestReply(result.bot.id);
  }

  return { picker, pickerBots, accentColor, chatDraft, openGroupPicker, startGroup };
}
