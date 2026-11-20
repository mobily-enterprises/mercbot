import { computed, ref, watch } from "vue";
import { useShellPageClose } from "@jskit-ai/shell-web/client/composables/useShellPageClose";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { useShellNavigation, useShellNavigationRuntime } from "@jskit-ai/shell-web/client/navigation/useShellNavigation";
import { botsApi } from "@/components/mercbot/botsApi.js";
import { exitLabel, exitPlace, openerOf } from "./appExit.js";

/**
 * An app's way out (D-106): the shell's arrow in the app's bar becomes a close named for where it goes, which leaves
 * in one step for the Mercbot place the app was opened from (else the home's chat), whichever of the app's places is
 * open; Ctrl+[ does the same. It leaves through JSKIT's navigation (finish), which replaces the open place's entry and
 * starts the trail again there; the browser's Back from there goes to the app's places before it.
 * @param {import("vue").Ref<string>} slug The app's slug.
 */
export function useAppExit(slug) {
  const paths = usePaths();
  const { finish } = useShellNavigation();
  const { trail } = useShellNavigationRuntime();
  const opener = computed(() => openerOf(trail.value, paths.page(`/apps/${slug.value}`)));
  const place = computed(() => exitPlace(opener.value, paths.page("/")));
  const botName = ref("");
  watch(() => place.value.botId, async (botId) => {
    botName.value = "";
    if (!botId) return;
    const name = await botsApi.bot(botId).then((answer) => String(answer?.bot?.name || ""), () => "");
    if (place.value.botId === botId) botName.value = name;
  }, { immediate: true });
  const label = computed(() => exitLabel(place.value, botName.value));

  const leave = () => finish(opener.value || paths.page("/"));
  useShellPageClose({ label, close: leave });
  return { label, leave };
}
