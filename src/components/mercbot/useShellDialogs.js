import { ref, watch } from "vue";
import { EVERYONE_SECTIONS } from "./settingsSections.js";

/**
 * The shell's dialogs and the link that opens Settings: ?settings=<section> opens that section of Settings (a link in
 * an email, or back from another site); it leaves the rest of the address for the section to read.
 * @param {{
 *   route: import("vue-router").RouteLocationNormalizedLoaded,
 *   router: import("vue-router").Router
 * }} options
 */
export function useShellDialogs({ route, router }) {
  const shortcutsOpen = ref(false);
  // Settings: opens on General unless a section is asked for.
  const settingsOpen = ref(false);
  const settingsSection = ref("general");
  // The bot Recurring tasks shows only (a bot's card's link, or ?settings=recurring-tasks&bot=<id>), or none (D-132).
  const settingsTaskBot = ref("");

  function openSettings(section = "general", { bot = "" } = {}) {
    settingsSection.value = EVERYONE_SECTIONS.some((entry) => entry.value === section) ? section : "general";
    settingsTaskBot.value = bot ? String(bot) : "";
    settingsOpen.value = true;
  }
  watch(() => route.query.settings, (section) => {
    if (!section) return;
    openSettings(String(section), { bot: typeof route.query.bot === "string" ? route.query.bot : "" });
    const { settings: _section, bot: _bot, ...rest } = route.query;
    router.replace({ query: rest });
  }, { immediate: true });
  const aboutOpen = ref(false);
  const findOpen = ref(false);
  return { shortcutsOpen, settingsOpen, settingsSection, settingsTaskBot, openSettings, aboutOpen, findOpen };
}
