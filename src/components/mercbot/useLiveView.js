import { computed, ref } from "vue";
import { botsApi } from "./botsApi.js";
import { computerApi } from "./computerApi.js";

/**
 * The bot's computer: the live view, handing the screen to the person, and teaching a task.
 * `currentBot` is the open bot, `store` the shell's messages (useBotMessages), `work` the
 * status line and replies (useBotWork), and `reportFailure` explains a step that failed.
 * @param {object} options
 * @param {import("vue").Ref<Array<Record<string, any>>>} options.bots The shell's list.
 */
export function useLiveView({ currentBot, bots, store, work, reportFailure }) {
  const liveView = ref(null);

  // The live view shows the open bot's computer; for a hand-over in a group, the computer of the
  // bot that asked, for this group (D-46).
  const liveBot = computed(() => {
    const speaker = liveView.value?.handover?.body?.speaker;
    if (currentBot.value?.kind !== "group" || !speaker) return currentBot.value;
    return { ...(bots.value.find((bot) => bot.id === String(speaker.id)) || speaker), id: String(speaker.id), group: currentBot.value.id };
  });

  function openComputer() {
    liveView.value = { inControl: false, handover: null };
  }

  function takeOver(message) {
    liveView.value = { inControl: true, handover: message };
  }

  // A file opened in its app on the bot's desktop (D-23): the person works on it in the live view.
  function workOnFile() {
    liveView.value = { inControl: true, handover: null };
  }

  // Teach a task: the live view opens in control with the teach banner. Stopping closes it,
  // posts the "finished" message, and the bot learns in the background.
  function teach() {
    liveView.value = { inControl: true, handover: null, teach: true };
  }

  async function finishTeaching() {
    const botId = currentBot.value.id;
    liveView.value = null;
    work.setWork(botId, "Putting it together");
    try {
      const result = await botsApi.teachStop(botId);
      store.appendMessages(botId, result.messages);
      store.updateBot(result.bot);
    } catch (error) {
      work.setWork(botId, "");
      reportFailure("The recording didn't save. Try teaching it again.", error);
    }
  }

  async function settleHandover({ message, outcome }) {
    const botId = currentBot.value.id;
    liveView.value = null;
    try {
      const result = await computerApi.settleHandover(botId, message.id, outcome);
      store.appendMessages(botId, result.messages);
      store.updateBot(result.bot);
    } catch (error) {
      reportFailure("That didn't go through. Try again.", error);
      return;
    }
    if (outcome === "done") await work.requestReply(botId);
  }

  return { liveView, liveBot, openComputer, takeOver, workOnFile, teach, finishTeaching, settleHandover };
}
