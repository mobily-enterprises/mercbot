import { ref } from "vue";
import { appsApi } from "../apps/appsApi.js";
import { botsApi } from "./botsApi.js";

/**
 * Add bots (D-109; MercbotNewBotDialog.vue), on Team and in New bot. One bot is made on the template chosen (D-98):
 * none for the General helper, or one of the library's or the home's; a bot a person shared (`link`) is added as they
 * made it. It joins the team, and its direct chat with the person, where it has said hello, opens. A library
 * template's app is set up after, as a draft, when the dialog asked for it. A ready-made team (D-105) and Suggested bots
 * (D-109) add several bots together: they join the team and make no chats (plan 5.2).
 * @param {{
 *   team: { updateBot: (bot: object) => void, loadBots: () => Promise<void> },
 *   openDirect: (botId: string) => Promise<void>,
 *   notify: (text: string) => void
 * }} options `team` is the shell's (useTeam.js); `openDirect` opens the person's direct chat with a bot (the shell's)
 */
export function useNewBot({ team, openDirect, notify }) {
  const newBotOpen = ref(false);
  const creating = ref(false);
  const createError = ref("");

  // From New chat, a new bot starts with the name typed; from a link, with its template chosen.
  const newBotName = ref("");
  const newBotTemplate = ref("");
  // The screen Add bots opens on: "start", or "teams" from the welcome chat (D-109).
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

  /** One bot: it joins the team, and the person's direct chat with it opens on its greeting. */
  async function createBot({ link = "", app = null, ...input }) {
    creating.value = true;
    createError.value = "";
    let made = null;
    try {
      ({ bot: made } = await (link ? botsApi.fromTemplate(link) : botsApi.create(input)));
      team.updateBot(made);
      newBotOpen.value = false;
    } catch {
      createError.value = "Your bot couldn't be created. Try again.";
    } finally {
      creating.value = false;
    }
    if (!made) return;
    await openDirect(String(made.id));
    if (app) await setUpApps([app]);
  }

  /**
   * Add N bots of a team (D-105): the team's bots chosen.
   * @param {{ teamId: string, templates: string[], apps?: Array<{ key: string, name: string }> }} choice
   */
  async function addTeam({ teamId, templates, apps = [] }) {
    await addTogether(() => botsApi.addTeam(teamId, templates), apps, "The team couldn't be added. Try again.");
  }

  /**
   * Add N bots of a suggestion (D-109): the bots ticked, each new one with its template.
   * @param {{ bots: object[], apps?: Array<{ key: string, name: string }> }} choice
   */
  async function addBots({ bots: chosen, apps = [] }) {
    await addTogether(() => botsApi.addBots({ bots: chosen }), apps, "The bots couldn't be added. Try again.");
  }

  /**
   * Bots made together (addTeam, addBots), answered as { bots, added, skipped }: Team takes the bots as the server has
   * them, and the person is told how many joined. No chat opens. Then the apps asked for are set up. A refusal says why:
   * every bot already in the home (409) or a new template's problems (422); anything else, `failed`.
   */
  async function addTogether(made, apps, failed) {
    creating.value = true;
    createError.value = "";
    let result = null;
    try {
      result = await made();
      if (Array.isArray(result.bots)) for (const bot of result.bots) team.updateBot(bot);
      else team.loadBots();
      newBotOpen.value = false;
    } catch (error) {
      createError.value = error?.status === 409 || error?.status === 422 ? error.message : failed;
    } finally {
      creating.value = false;
    }
    if (!result) return;
    const [count, there] = [result.added?.length || 0, result.skipped?.length || 0];
    const leftOut = there ? ` ${there} already in this home ${there === 1 ? "was" : "were"} left out.` : "";
    notify(`Added ${count} ${count === 1 ? "bot" : "bots"} to your team.${leftOut}`);
    await setUpApps(apps);
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
