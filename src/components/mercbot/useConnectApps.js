import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { botsApi } from "./botsApi.js";
import { openSignIn, pluginsApi } from "./pluginsApi.js";
import { listenForSignIns, signInInThisTab } from "./signInReturn.js";

/**
 * Connect apps: the catalogue modal, opened straight on one app or one skill, or on
 * the person's apps and skills for Skills, and the explainer before signing in from a chat card, which ends in the same
 * Add account step as Connect apps (D-110). A sign-in started from a bot's connect card tells the bot, which finishes its
 * task once the app is connected. While the shell is open it answers the sign-in windows that finish (signInReturn.js).
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
  /** The page the modal opens on when not on one app or skill: "manage" for Skills, else the catalogue. */
  const appsPage = ref("");
  const explainerOpen = ref(false);
  const explainerPlugin = ref(null);
  // Answers the sign-in windows that finish while the shell is open, so they close themselves.
  let stopListening = () => {};
  onMounted(() => {
    stopListening = listenForSignIns();
  });
  onBeforeUnmount(() => stopListening());
  /** The connect card the explainer was opened from, while it waits for its app: { botId, messageId }. */
  let fromCard = null;

  watch(appsOpen, (open) => {
    if (open) return;
    appsSkillId.value = "";
    appsAppId.value = "";
    appsPage.value = "";
  });

  function openApp(pluginId) {
    appsAppId.value = pluginId;
    appsOpen.value = true;
  }

  function openSkill(skillId) {
    appsSkillId.value = String(skillId);
    appsOpen.value = true;
  }

  /** Skills (Ctrl+Alt+W, the sidebar's button, the palette): Your apps and skills, at Private skills. */
  function openSkills() {
    appsPage.value = "manage";
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
    // An app that isn't connectable yet opens its page, where asking for it is noted (D-33); so does one connected with
    // API credentials (D-93), where an owner or admin enters them.
    if (explainerPlugin.value?.soon || explainerPlugin.value?.credentials) openApp(explainerPlugin.value.id);
    else if (explainerPlugin.value) explainerOpen.value = true;
    else appsOpen.value = true;
  }

  /** The Add account step's answer, from the explainer: the account is made, then signed in. */
  async function continueConnect({ plugin, label }) {
    explainerOpen.value = false;
    try {
      const { plugins, accountId } = await pluginsApi.addAccount(plugin.id, label);
      const added = plugins.find((entry) => entry.id === plugin.id);
      const card = fromCard;
      fromCard = null;
      const told = card && botsApi.connectFromCard(card.botId, card.messageId).catch((error) =>
        reportFailure("Your bot won't carry on by itself after you sign in. Ask it once you're connected.", error));
      // A sign-in that takes this tab (on a phone) waits until the bot is told, so leaving doesn't cut that off.
      if (signInInThisTab()) await told;
      openSignIn(paths.page("/connect", { surface: "account" }), added, added.accounts.find((account) => account.id === accountId), router);
    } catch (error) {
      reportFailure("Couldn't start the sign-in. Try again.", error);
    }
  }

  return {
    appsOpen, appsSkillId, appsAppId, appsPage, explainerOpen, explainerPlugin,
    openApp, openSkill, openSkills, explainConnect, continueConnect
  };
}
