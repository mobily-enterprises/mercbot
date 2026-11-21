import { computed, onBeforeUnmount, watch } from "vue";
import { ONBOARDING_TIMING, botsApi } from "./botsApi.js";

/**
 * Onboarding runs on the server one step at a time; the client waits each step's delay.
 * Opening a bot loads its messages. `currentBot` is the open bot, `store` holds the messages
 * (useBotMessages), `focusComposer` puts the caret in the message box when the bot asks for its
 * name, and `reportFailure` explains a step that failed or a chat that didn't load.
 * @param {{ currentBot: import("vue").ComputedRef<import("../../types.js").Bot>, store: import("../../types.js").BotMessages, focusComposer: () => void, reportFailure: import("../../types.js").ReportFailure }} options
 */
export function useOnboarding({ currentBot, store, focusComposer, reportFailure }) {
  let onboardingTimer = null;
  // An archived bot's onboarding waits until it's unarchived (D-108): its chat is read-only.
  const stepOf = (bot) => (bot.archivedAt ? null : bot.onboardingStep);
  const onboardingTiming = computed(() => ONBOARDING_TIMING[stepOf(currentBot.value)] || null);

  function scheduleOnboarding() {
    clearTimeout(onboardingTimer);
    const bot = currentBot.value;
    const timing = ONBOARDING_TIMING[stepOf(bot)];
    if (!timing) return;
    const step = bot.onboardingStep;
    onboardingTimer = setTimeout(async () => {
      try {
        const result = await botsApi.advance(bot.id, step);
        store.appendMessages(bot.id, result.messages);
        store.updateBot(result.bot);
      } catch (error) {
        reportFailure("Your bot couldn't continue just now. Reload to try again.", error);
      }
    }, timing.delay);
  }

  // A chat that doesn't load says so like any other failure. Left to Vue, it would be a modal that
  // takes every click on the page until it's closed.
  watch(() => [currentBot.value.id, stepOf(currentBot.value)], async () => {
    try {
      await store.loadMessages(currentBot.value.id);
    } catch (error) {
      reportFailure("This chat didn't load. Reload to try again.", error);
      return;
    }
    scheduleOnboarding();
    if (stepOf(currentBot.value) === "ask-name") focusComposer();
  }, { immediate: true });
  onBeforeUnmount(() => clearTimeout(onboardingTimer));

  async function chooseName(name) {
    const bot = currentBot.value;
    try {
      const result = await botsApi.chooseName(bot.id, name);
      store.appendMessages(bot.id, result.messages);
      store.updateBot(result.bot);
    } catch (error) {
      reportFailure("That choice didn't go through. Try again.", error);
    }
  }

  return { onboardingTiming, chooseName };
}
