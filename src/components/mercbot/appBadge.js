import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { chatsApi } from "./chatsApi.js";
import { newsElsewhere } from "./useChatEvents.js";

/**
 * The number on the app's icon with the app open (D-133), where the device shows one (installed, on Android and
 * computers). The icon is one a device, so it counts the chats with news in every home, a muted one left out, as a
 * notification's number does: this home's from the page's own list, at once, and the person's other homes' from the
 * server (chats/unread-elsewhere), read as the page opens, as it's shown again (read elsewhere meanwhile) and as news
 * comes from another home (useChatEvents' newsElsewhere). A read that fails keeps the last count.
 * @param {() => Array<{ unread?: boolean, muted?: boolean }>} chats this home's chats, as the page has them
 */
export function useAppBadge(chats) {
  const elsewhere = ref(0);
  // One read at a time: an ask while one is under way reads once more after it.
  let reading = false;
  let again = false;
  async function readElsewhere() {
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    try {
      do {
        again = false;
        try {
          elsewhere.value = Number((await chatsApi.unreadElsewhere())?.chats) || 0;
        } catch {
          // The last count stays until the next read.
        }
      } while (again);
    } finally {
      reading = false;
    }
  }
  const shownAgain = () => {
    if (document.visibilityState === "visible") readElsewhere();
  };
  onMounted(() => {
    readElsewhere();
    document.addEventListener("visibilitychange", shownAgain);
  });
  onBeforeUnmount(() => document.removeEventListener("visibilitychange", shownAgain));
  watch(newsElsewhere, () => readElsewhere());

  const count = computed(() => chats().filter((chat) => chat.unread && !chat.muted).length + elsewhere.value);
  watch(count, (shown) => {
    if (!("setAppBadge" in navigator)) return;
    (shown ? navigator.setAppBadge(shown) : navigator.clearAppBadge()).catch(() => {});
  }, { immediate: true });
  return count;
}
