import { passedOn } from "@jskit-ai/resource-runtime/server";
import { appGuide } from "../shared/appGuide.js";
import { briefOf } from "../shared/botBrief.js";
import { mapBots, toNames } from "../shared/definitions.js";
import { homeIdOf } from "./callOptions.js";
import { RegistryError } from "./registry.js";
import { templateDescription } from "./templates.js";

// Every app has a bot to talk to (D-147): its own (D-144) or the home's main bot, in each person's own chat with it
// inside the app, told the app's guide and brief in the cached start of its prompt.

/**
 * A version's guide (appGuide.js), as it's saved or published: from its definition by names, the home's tables and the
 * version's scripts. `app` is the app's row (its name and template).
 */
export function versionGuide(app, definition, tables, scripts = []) {
  return appGuide({
    name: app.name,
    description: templateDescription(app.templateKey),
    definition,
    tables,
    scripts: scripts.map(({ key, kind, summary, settings }) => ({ key, kind, summary, settings }))
  });
}

/**
 * The bot an app's chat is with, of the home's bots (records.directory.homeBotFaces): its own while it's in the home and
 * not archived, else the home's main bot; null in a home with neither.
 * @param {{ botId?: string | null }} app
 * @param {Array<{ id: string, name: string, color?: string, shape?: string, main: boolean, archived: boolean }>} faces
 */
export function appBotOf(app, faces) {
  const own = app.botId ? faces.find((bot) => bot.id === String(app.botId) && !bot.archived) : null;
  const bot = own || faces.find((face) => face.main && !face.archived) || null;
  return bot ? { id: bot.id, name: bot.name, color: bot.color, shape: bot.shape } : null;
}

/**
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources the
 *   apps feature's handles
 * @param {{ directory: { homeBotFaces: Function }, chats: { appBotChat: Function } }} dependencies.records mercbot.bots.records
 * @param {import("./types.js").Registry} dependencies.registry
 * @param {import("./types.js").AppStore} dependencies.apps
 * @param {import("@jskit-ai/resource-runtime/server/types").SystemContext} dependencies.systemContext AppsFeature's
 */
export function createAppBots({ resources, records, registry, apps, systemContext }) {
  const { apps: appRows, appVersions } = resources;

  /** The bot an app's chat is with (appBotOf), in one read of the home's bots. */
  const botFor = async (app, options) => appBotOf(app, await records.directory.homeBotFaces(passedOn(options)));

  /**
   * The person's own chat with the app's bot, which the chat button in the app opens: made the first time they ask,
   * private, the person and the bot in it, named after the app, and found again after that (records.chats.appBotChat).
   * Answers it with the bot. An app of another home is a 404; a view has none.
   */
  async function botChat(slug, options) {
    const app = await apps.find(slug, options);
    apps.notAView(app, "have a bot to talk to");
    const bot = await botFor(app, options);
    if (!bot) {
      throw new RegistryError(409, "This home has no main bot yet: an owner or admin chooses one in Settings, under Main bot and Builder.", {
        code: "apps_bot_missing"
      });
    }
    const chat = await records.chats.appBotChat({ appId: String(app.id), botId: bot.id, title: app.name }, passedOn(options));
    return { chat, bot };
  }

  /** What the app's chat button shows (D-147): the person's chat with its bot, { chatId, unread }, or null before they have one. */
  const chatNews = (app, options) => records.chats.appBotChatNews({ appId: String(app.id) }, passedOn(options));

  /**
   * A live version's guide: the one kept with it, or, for a version made before guides were kept, written now and
   * kept, once (as the home's system, for whoever's turn first needs it).
   */
  async function guideOf(app, version, options) {
    if (version.guide) return version.guide;
    const tables = await registry.loadTables(options);
    const names = new Map((await records.directory.homeBotFaces(passedOn(options))).map((bot) => [String(bot.id), bot.name]));
    const definition = mapBots(toNames(version.definition, tables), (id) => names.get(String(id)) ?? "(removed bot)").definition;
    const guide = versionGuide(app, definition, tables, version.scripts || []);
    const home = { context: systemContext("an app's guide, written once for a version made before guides").forWorkspace(homeIdOf(options)) };
    await appVersions.patch(String(version.id), { guide }, { ...home, returning: "none" });
    return guide;
  }

  /**
   * What the app's bot is told in its chat for the app, in the cached start of its prompt (D-147): the app's name, its
   * live version's guide and its brief. Null for an app that's gone; an app not published yet has its brief only.
   */
  async function forTurn(appId, options) {
    const query = { filters: { id: String(appId), retired: false }, page: { size: 1 } };
    const { records: [app] } = await appRows.query(query, passedOn(options));
    if (!app) return null;
    const about = { name: app.name, description: templateDescription(app.templateKey) };
    const version = app.liveVersionId
      ? await appVersions.get(String(app.liveVersionId), { fields: ["definition", "guide", "scripts"] }, { ...passedOn(options), missing: "skip" })
      : null;
    if (!version) return { name: app.name, slug: app.slug, guide: "", brief: briefOf(null, about) };
    return { name: app.name, slug: app.slug, guide: await guideOf(app, version, options), brief: briefOf(version.definition, about) };
  }

  return Object.freeze({
    botFor,
    botChat,
    chatNews,
    forTurn
  });
}
