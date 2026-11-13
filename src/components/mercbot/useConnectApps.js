import { ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { botsApi } from "./botsApi.js";
import { openSignIn, pluginsApi } from "./pluginsApi.js";

/**
 * Connect apps: the catalogue modal, opened straight on one app or one skill,
 * and the explainer before signing in from a chat card. A sign-in started from a
 * bot's connect card tells the bot, which finishes its task once the app is connected.
 * `reportFailure` explains a step that failed; `currentBot` is the bot whose chat is open.
 * @param {{ reportFailure: import("../../types.js").ReportFailure, currentBot: import("vue").Ref<{ id: string } | null> }} options
 */
export function useConnectApps({ reportFailure, currentBot }) {
  const route = useRoute();
  const router = useRouter();
  const paths = usePaths();
  const appsOpen = ref(false);
  const appsSkillId = ref("");
  const appsAppId = ref("");
  const explainerOpen = ref(false);
  const explainerPlugin = ref(null);
  /** The connect card the explainer was opened from, while it waits for its app: { botId, messageId }. */
  let fromCard = null;

  watch(appsOpen, (open) => {
    if (open) return;
    appsSkillId.value = "";
    appsAppId.value = "";
  });

  function openApp(pluginId) {
    appsAppId.value = pluginId;
    appsOpen.value = true;
  }

  function openSkill(skillId) {
    appsSkillId.value = String(skillId);
    appsOpen.value = true;
  }

  // A shared app link (?connect=<app>) opens Connect apps on that app.
  watch(() => route.query.connect, (pluginId) => {
    if (!pluginId) return;
    openApp(String(pluginId));
    const { connect: _app, ...rest } = route.query;
    router.replace({ query: rest });
  }, { immediate: true });

  /** @param {{ id: string, body: { app: string, status?: string } }} card the chat's connect card */
  async function explainConnect(card) {
    const appName = card.body.app;
    fromCard = ["waiting", "connecting"].includes(card.body.status) && currentBot.value ? { botId: currentBot.value.id, messageId: card.id } : null;
    try {
      const { plugins } = await pluginsApi.list();
      explainerPlugin.value = plugins.find((plugin) => plugin.name === appName) || null;
    } catch (error) {
      reportFailure("Couldn't load that app. Try again.", error);
      return;
    }
    // An app that isn't connectable yet opens its page, where asking for it is noted (D-33).
    if (explainerPlugin.value?.soon) openApp(explainerPlugin.value.id);
    else if (explainerPlugin.value) explainerOpen.value = true;
    else appsOpen.value = true;
  }

  async function continueConnect(plugin) {
    explainerOpen.value = false;
    try {
      if (!plugin.installed) await pluginsApi.install(plugin.id);
      openSignIn(paths.page("/connect", { surface: "account" }), plugin);
    } catch (error) {
      reportFailure("Couldn't start the sign-in. Try again.", error);
      return;
    }
    if (!fromCard) return;
    const card = fromCard;
    fromCard = null;
    botsApi.connectFromCard(card.botId, card.messageId).catch((error) =>
      reportFailure("Your bot won't carry on by itself after you sign in. Ask it once you're connected.", error));
  }

  return { appsOpen, appsSkillId, appsAppId, explainerOpen, explainerPlugin, openApp, openSkill, explainConnect, continueConnect };
}
