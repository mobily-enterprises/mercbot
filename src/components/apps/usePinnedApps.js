import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { appsApi } from "./appsApi.js";

/**
 * The sidebar's Apps section: the person's pinned apps in their order, then the apps whose bot they talk to (D-147), the
 * newest chat first, one row an app, with its chat's news (its id, unread, the last words). A row opens the app, with its
 * chat open when the chat put it there (an app not pinned) or has something new.
 * @param {{ apps: object[], pins: string[], chats: object[], here: string, addressOf: (app: object) => string }} home
 *   `chats` the person's app chats (chatDirectory's appChats), `here` the page's path
 */
export function sidebarApps({ apps, pins, chats, here, addressOf }) {
  const byId = new Map(apps.map((app) => [app.id, app]));
  const chatOf = new Map(chats.map((chat) => [String(chat.botAppId), chat]));
  const ids = [...new Set([...pins, ...chats.map((chat) => String(chat.botAppId))])].filter((id) => byId.has(id));
  return ids.map((id) => {
    const app = byId.get(id);
    const chat = chatOf.get(id) || null;
    const address = addressOf(app);
    const unread = Boolean(chat?.unread);
    return {
      ...app,
      address,
      selected: here === address || here?.startsWith(`${address}/`),
      chatId: chat?.id ?? null,
      unread,
      mentioned: Boolean(chat?.mentioned),
      detail: chat?.preview || "",
      opensChat: Boolean(chat) && (!pins.includes(id) || unread)
    };
  });
}

/**
 * The person's pinned apps (D-35), in their pin order, and the apps whose bot they talk to (D-147), for the sidebar: its
 * Apps section (MercbotChatList) and the compact rail. Read as the sidebar opens and again whenever the home's apps
 * change (mercbot:apps-changed).
 * @param {{ appChats: () => object[] }} chats the person's app chats as the sidebar has them (chatDirectory's appChats),
 *   none for the rail, which shows pinned apps only
 */
export function usePinnedApps({ appChats }) {
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
  /** Each app the section lists, with whether it's the one open now. */
  const pinned = computed(() => sidebarApps({ apps: apps.value, pins: pins.value, chats: appChats(), here: route?.path || "", addressOf }));
  const open = (app) => router.push({ path: addressOf(app), query: app.opensChat ? { chat: "1" } : {} });

  onMounted(() => {
    load();
    window.addEventListener("mercbot:apps-changed", load);
  });
  onBeforeUnmount(() => window.removeEventListener("mercbot:apps-changed", load));
  return { pinned, open };
}
