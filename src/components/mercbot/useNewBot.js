import { ref } from "vue";
import { NEW_BOT_GREY } from "@/theme/palettes.js";
import { appsApi } from "../apps/appsApi.js";
import { botsApi, sleep } from "./botsApi.js";

/**
 * New bot: a "creating" row appears at once; the dialog closes when the bot exists. It's made on the template New bot
 * chose (D-98): none for the General helper, one of the library's or the home's, or a new one from its draft, made
 * with it; a bot a person shared (`link`) is added as they made it. A library template's app is set up after, as a
 * draft, when the dialog asked for it. Add a team (D-105) makes a team's bots together, in a section named after it.
 * @param {{
 *   bots: import("vue").Ref<Array<import("../../types.js").Bot>>,
 *   sections: import("vue").Ref<Array<object>>,
 *   store: import("../../types.js").BotMessages,
 *   picker: import("vue").Ref<{ botIds: string[] } | null>,
 *   selectBot: (botId: string) => void,
 *   notify: (text: string) => void
 * }} options
 */
export function useNewBot({ bots, sections, store, picker, selectBot, notify }) {
  const newBotOpen = ref(false);
  const creating = ref(false);
  const createError = ref("");
  // A new template's problems when the server refused it (422), for the draft screen.
  const createProblems = ref([]);

  // From the group picker, a new bot starts with the typed name; from a link, with its template chosen.
  const newBotName = ref("");
  const newBotTemplate = ref("");
  // From a new home's first conversation or its New home form, New bot opens on the team chosen (D-105).
  const newBotTeam = ref("");
  function openNewBot(name = "", template = "", team = "") {
    createError.value = "";
    createProblems.value = [];
    newBotName.value = typeof name === "string" ? name : "";
    newBotTemplate.value = template;
    newBotTeam.value = team;
    newBotOpen.value = true;
  }
  const openTeam = (teamId) => openNewBot("", "", teamId);

  /** The apps the dialog asked for set up after, as drafts, one at a time; what came of them, said once. */
  async function setUpApps(apps) {
    for (const app of apps) {
      notify(await appsApi.installTemplate(app.key, false)
        .then(() => `The ${app.name} app is set up as a draft in Apps for you to review and publish.`)
        .catch(() => `The ${app.name} app couldn't be set up; you can add it from Apps → Templates.`));
    }
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
      if (app) await setUpApps([app]);
    } catch (error) {
      bots.value = bots.value.filter((entry) => entry.id !== placeholderId);
      createProblems.value = error?.params?.problems || [];
      createError.value = createProblems.value.length ? "Put the template's problems right, then save it again." : "Your bot couldn't be created. Try again.";
    } finally {
      creating.value = false;
    }
  }

  /**
   * Add N bots (D-105): the team's bots chosen, made together; the list and its sections come back as the server has
   * them, with the new bots in the team's section, and the first of them opens. Then the apps asked for are set up.
   * @param {{ teamId: string, name: string, templates: string[], apps: Array<{ key: string, name: string }> }} choice
   */
  async function addTeam({ teamId, name, templates, apps = [] }) {
    creating.value = true;
    createError.value = "";
    try {
      const result = await botsApi.addTeam(teamId, templates);
      store.mergeBots(result.bots);
      sections.value = result.sections;
      newBotOpen.value = false;
      picker.value = null;
      if (result.added[0]) selectBot(result.added[0]);
      const [count, there] = [result.added.length, result.skipped.length];
      const leftOut = there ? ` ${there} already in this home ${there === 1 ? "was" : "were"} left out.` : "";
      notify(`${count} ${count === 1 ? "bot" : "bots"} added to ${name}.${leftOut}`);
      await setUpApps(apps);
    } catch (error) {
      createError.value = error?.status === 409 ? error.message : "The team couldn't be added. Try again.";
    } finally {
      creating.value = false;
    }
  }

  return {
    newBotOpen,
    creating,
    createError,
    createProblems,
    newBotName,
    newBotTemplate,
    newBotTeam,
    openNewBot,
    openTeam,
    createBot,
    addTeam
  };
}
