import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { appsApi } from "./appsApi.js";

// The person's pinned apps (D-35), in their pin order, for the sidebar: its Apps section (MercbotChatList) and the
// compact rail. Read as the sidebar opens and again whenever the home's apps change (mercbot:apps-changed).
export function usePinnedApps() {
  const router = useRouter();
  const route = useRoute();
  const paths = usePaths();
  const apps = ref([]);
  const pins = ref([]);

  async function load() {
    try {
      const result = await appsApi.list();
      apps.value = result.apps;
      pins.value = result.pins;
    } catch {
      apps.value = [];
    }
  }
  const addressOf = (app) => paths.page(`/apps/${app.slug}`);
  /** Each pinned app, with whether it's the one open now. */
  const pinned = computed(() => pins.value
    .map((id) => apps.value.find((app) => app.id === id))
    .filter(Boolean)
    .map((app) => ({ ...app, address: addressOf(app), selected: route?.path === addressOf(app) || route?.path?.startsWith(`${addressOf(app)}/`) })));
  const open = (app) => router.push(addressOf(app));

  onMounted(() => {
    load();
    window.addEventListener("mercbot:apps-changed", load);
  });
  onBeforeUnmount(() => window.removeEventListener("mercbot:apps-changed", load));
  return { pinned, open };
}
