import { ref, watch } from "vue";
import { EVERYONE_SECTIONS } from "./settingsSections.js";
import { shellPreferences } from "./shellPreferences.js";

/**
 * The shell's dialogs and the links that open them: ?files=1 opens a bot's Details on Files (D-47), and
 * ?settings=<section> opens that section of Settings (a link in an email, or back from another site); it leaves the
 * rest of the address for the section to read.
 * @param {{
 *   route: import("vue-router").RouteLocationNormalizedLoaded,
 *   router: import("vue-router").Router
 * }} options
 */
export function useShellDialogs({ route, router }) {
  const shortcutsOpen = ref(false);
  // The home's Files page leads to a bot's files (?bot=<id>&files=1, D-47): its Details on Files.
  watch(() => route.query.files, (files) => {
    if (!files) return;
    shellPreferences.detailsOpen = true;
    shellPreferences.detailsTab = "files";
    const { files: _files, ...rest } = route.query;
    router.replace({ query: rest });
  }, { immediate: true });
  // Settings: opens on General unless a section is asked for.
  const settingsOpen = ref(false);
  const settingsSection = ref("general");

  function openSettings(section = "general") {
    settingsSection.value = EVERYONE_SECTIONS.some((entry) => entry.value === section) ? section : "general";
    settingsOpen.value = true;
  }
  watch(() => route.query.settings, (section) => {
    if (!section) return;
    openSettings(String(section));
    const { settings: _section, ...rest } = route.query;
    router.replace({ query: rest });
  }, { immediate: true });
  const aboutOpen = ref(false);
  const findOpen = ref(false);
  return { shortcutsOpen, settingsOpen, settingsSection, openSettings, aboutOpen, findOpen };
}
