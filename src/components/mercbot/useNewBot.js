import { ref } from "vue";
import { NEW_BOT_GREY } from "@/theme/palettes.js";
import { appsApi } from "../apps/appsApi.js";
import { botsApi, sleep } from "./botsApi.js";

/**
 * New bot: a "creating" row appears at once; the dialog closes when the bot exists. It's made on the template New bot
 * chose (D-98): none for the General helper, one of the library's or the home's, or a new one from its draft, made
 * with it; a bot a person shared (`link`) is added as they made it. A library template's app is set up after, as a
 * draft, when the dialog asked for it.
 * @param {{
 *   bots: import("vue").Ref<Array<import("../../types.js").Bot>>,
 *   store: import("../../types.js").BotMessages,
 *   picker: import("vue").Ref<{ botIds: string[] } | null>,
 *   selectBot: (botId: string) => void,
 *   notify: (text: string) => void
 * }} options
 */
export function useNewBot({ bots, store, picker, selectBot, notify }) {
  const newBotOpen = ref(false);
  const creating = ref(false);
  const createError = ref("");
  // A new template's problems when the server refused it (422), for the draft screen.
  const createProblems = ref([]);

  // From the group picker, a new bot starts with the typed name; from a link, with its template chosen.
  const newBotName = ref("");
  const newBotTemplate = ref("");
  function openNewBot(name = "", template = "") {
    createError.value = "";
    createProblems.value = [];
    newBotName.value = typeof name === "string" ? name : "";
    newBotTemplate.value = template;
    newBotOpen.value = true;
  }

  async function createBot({ link = "", app = null, ...input }) {
    creating.value = true;
    createError.value = "";
    createProblems.value = [];
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
      const [{ bot }] = await Promise.all([link ? botsApi.fromTemplate(link) : botsApi.create(input), sleep(900)]);
      // The bot takes the placeholder's place. News can read the whole list again meanwhile (useBotEvents),
      // which leaves the placeholder out and may already bring the bot, so it's added either way, once; a
      // read that began before it existed and answers later keeps it (mergeBots).
      bots.value = bots.value.filter((entry) => entry.id !== placeholderId);
      store.addBot(bot);
      newBotOpen.value = false;
      // From the group picker, the new bot opens in its own chat and the picker is left.
      picker.value = null;
      selectBot(bot.id);
      if (app) {
        notify(await appsApi.installTemplate(app.key, false)
          .then(() => `The ${app.name} app is set up as a draft in Apps for you to review and publish.`)
          .catch(() => `The ${app.name} app couldn't be set up; you can add it from Apps → Templates.`));
      }
    } catch (error) {
      bots.value = bots.value.filter((entry) => entry.id !== placeholderId);
      createProblems.value = error?.params?.problems || [];
      createError.value = createProblems.value.length ? "Put the template's problems right, then save it again." : "Your bot couldn't be created. Try again.";
    } finally {
      creating.value = false;
    }
  }

  return { newBotOpen, creating, createError, createProblems, newBotName, newBotTemplate, openNewBot, createBot };
}
