import { computed, ref, watch } from "vue";
import { useShellPageClose } from "@jskit-ai/shell-web/client/composables/useShellPageClose";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { useShellNavigation, useShellNavigationRuntime } from "@jskit-ai/shell-web/client/navigation/useShellNavigation";
import { chatsApi } from "@/components/mercbot/chatsApi.js";
import { chatTitle } from "@/components/mercbot/chatView.js";
import { appsAreaOf, exitLabel, exitPlace, openerOf } from "./appExit.js";

/**
 * The way out of the apps area (D-106, D-123): the shell's arrow in an app's bar, and in the Apps page's, becomes a
 * close named for where it goes; Ctrl+[ does the same. It leaves in one step for the place the apps area was entered
 * from (a room or chat, Files, Mercbot), the nearest step of JSKIT's trail outside the area, else the home's chat,
 * through JSKIT's `finish`, which replaces the open entry. An app's own places replace each other's entries
 * (AppFrame.vue), so the browser's Back from where it lands goes at most to Apps, never into the app.
 */
export function useAppExit() {
  const paths = usePaths();
  // The person looking, so a chat named after its people leaves them out ("Anna and Chef", not "you, Anna and Chef").
  const { context: placementContext } = useWebPlacementContext();
  const me = computed(() => String(placementContext.value?.user?.id || ""));
  const { finish } = useShellNavigation();
  const { trail } = useShellNavigationRuntime();
  const home = computed(() => paths.page("/"));
  const opener = computed(() => openerOf(trail.value, appsAreaOf(home.value)));
  const place = computed(() => exitPlace(opener.value, home.value));
  const chatName = ref("");
  watch(() => place.value.chatId, async (chatId) => {
    chatName.value = "";
    if (!chatId) return;
    const name = await chatsApi.get(chatId).then((answer) => (answer?.chat ? chatTitle(answer.chat, me.value) : ""), () => "");
    if (place.value.chatId === chatId) chatName.value = name;
  }, { immediate: true });
  const label = computed(() => exitLabel(place.value, chatName.value));

  const leave = () => finish(opener.value || home.value);
  useShellPageClose({ label, close: leave });
  return { label, leave };
}
