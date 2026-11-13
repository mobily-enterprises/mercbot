import { ref } from "vue";
import { NEW_BOT_GREY } from "@/theme/palettes.js";
import { botsApi, sleep } from "./botsApi.js";

/**
 * New bot: a "creating" row appears at once; the dialog closes when the bot exists.
 * @param {{
 *   bots: import("vue").Ref<Array<import("../../types.js").Bot>>,
 *   store: import("../../types.js").BotMessages,
 *   picker: import("vue").Ref<{ botIds: string[] } | null>,
 *   selectBot: (botId: string) => void
 * }} options
 */
export function useNewBot({ bots, store, picker, selectBot }) {
  const newBotOpen = ref(false);
  const creating = ref(false);
  const createError = ref("");

  // From the group picker, a new bot starts with the typed name.
  const newBotName = ref("");
  function openNewBot(name = "") {
    createError.value = "";
    newBotName.value = typeof name === "string" ? name : "";
    newBotOpen.value = true;
  }

  async function createBot(input) {
    creating.value = true;
    createError.value = "";
    const placeholderId = `creating-${Date.now()}`;
    bots.value = [...bots.value, {
      id: placeholderId,
      name: input.name,
      color: NEW_BOT_GREY,
      creating: true,
      pinPosition: null,
      sectionId: null,
      hidden: false,
      preview: "Creating…",
      lastActivityAt: new Date().toISOString()
    }];
    try {
      const [{ bot }] = await Promise.all([botsApi.create(input), sleep(900)]);
      // The bot takes the placeholder's place. News can read the whole list again meanwhile (useBotEvents),
      // which leaves the placeholder out and may already bring the bot, so it's added either way, once; a
      // read that began before it existed and answers later keeps it (mergeBots).
      bots.value = bots.value.filter((entry) => entry.id !== placeholderId);
      store.addBot(bot);
      newBotOpen.value = false;
      // From the group picker, the new bot opens in its own chat and the picker is left.
      picker.value = null;
      selectBot(bot.id);
    } catch {
      bots.value = bots.value.filter((entry) => entry.id !== placeholderId);
      createError.value = "Your bot couldn't be created. Try again.";
    } finally {
      creating.value = false;
    }
  }

  return { newBotOpen, creating, createError, newBotName, openNewBot, createBot };
}
