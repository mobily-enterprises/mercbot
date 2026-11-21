import { ref } from "vue";
import { NEW_BOT_GREY } from "@/theme/palettes.js";
import { appsApi } from "../apps/appsApi.js";
import { botsApi, sleep } from "./botsApi.js";

/**
 * Add bots (D-109; MercbotNewBotDialog.vue). One bot: a "creating" row appears at once; the dialog closes when the bot
 * exists. It's made on the template chosen (D-98): none for the General helper, or one of the library's or the home's;
 * a bot a person shared (`link`) is added as they made it. A library template's app is set up after, as a draft, when
 * the dialog asked for it. A ready-made team (D-105) makes a team's bots together, in a section named after it, and
 * Suggested bots (D-109) the bots ticked on it, new templates with them, in the section the person named.
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

  // From the group picker, a new bot starts with the typed name; from a link, with its template chosen.
  const newBotName = ref("");
  const newBotTemplate = ref("");
  // The screen Add bots opens on: "start", or "teams" from a new home's first conversation (D-109).
  const newBotScreen = ref("start");
  function openNewBot(name = "", template = "", screen = "start") {
    createError.value = "";
    newBotName.value = typeof name === "string" ? name : "";
    newBotTemplate.value = template;
    newBotScreen.value = screen;
    newBotOpen.value = true;
  }
  const openTeams = () => openNewBot("", "", "teams");

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
    } catch {
      bots.value = bots.value.filter((entry) => entry.id !== placeholderId);
      createError.value = "Your bot couldn't be created. Try again.";
    } finally {
      creating.value = false;
    }
  }

  /**
   * Add N bots of a team (D-105): the team's bots chosen, made together in the team's section.
   * @param {{ teamId: string, name: string, templates: string[], apps: Array<{ key: string, name: string }> }} choice
   */
  async function addTeam({ teamId, name, templates, apps = [] }) {
    await addTogether(() => botsApi.addTeam(teamId, templates), name, apps, "The team couldn't be added. Try again.");
  }

  /**
   * Add N bots of a suggestion (D-109): the bots ticked, each new one with its template, made together in the section
   * named, as a team's are.
   * @param {{ section: string, bots: object[], apps: Array<{ key: string, name: string }> }} choice
   */
  async function addBots({ section, bots: chosen, apps = [] }) {
    await addTogether(() => botsApi.addBots({ section, bots: chosen }), section, apps, "The bots couldn't be added. Try again.");
  }

  /**
   * Bots made together (addTeam, addBots): the list and its sections come back as the server has them, with the new bots
   * in their section, and the first of them opens. Then the apps asked for are set up. A refusal says why: one of the
   * bots already in the home (409) or a new template's problems (422); anything else, `failed`.
   */
  async function addTogether(made, name, apps, failed) {
    creating.value = true;
    createError.value = "";
    try {
      const result = await made();
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
      createError.value = error?.status === 409 || error?.status === 422 ? error.message : failed;
    } finally {
      creating.value = false;
    }
  }

  return {
    newBotOpen,
    creating,
    createError,
    newBotName,
    newBotTemplate,
    newBotScreen,
    openNewBot,
    openTeams,
    createBot,
    addTeam,
    addBots
  };
}
