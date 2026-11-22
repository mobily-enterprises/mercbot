import { computed, watch } from "vue";
import { shellPreferences } from "./shellPreferences.js";

// The address's keys the shell reads: the open chat, a member's card beside it, and an open page (useOpenPage).
const PAGE_KEYS = new Set(["page", "pageBot", "pageChat"]);

/**
 * What the shell shows, named in the address so a reload or a shared link keeps it (D-112): ?chat=<id> for a chat, and
 * &member=bot:<id> or person:<id> for a member's card beside it. Links from elsewhere name a bot: ?bot=<id> opens the
 * person's direct chat with it (Ask Builder, a view's Ask, a template), and ?bot=<id>&files=1 that chat with the bot's
 * card at its Files (the home's Files page). An old ?team=1 is ignored: the chat opens as without it. A member the
 * address names opens their card in Details (`showDetails`), from a reload or a link as from a tap; `shownChatId` is the
 * chat shown, which an address without ?chat= shows too (the list's first).
 * @param {{
 *   route: import("vue-router").RouteLocationNormalizedLoaded,
 *   router: import("vue-router").Router,
 *   openDirect: (botId: string, replace: boolean) => Promise<void>,
 *   showDetails: () => void,
 *   shownChatId: () => string
 * }} options
 */
export function useShellAddress({ route, router, openDirect, showDetails, shownChatId }) {
  /** The address's query without an open page, and with `extra`. */
  const chatQuery = (extra = {}) => ({
    ...Object.fromEntries(Object.entries(route.query).filter(([key]) => !PAGE_KEYS.has(key))),
    ...extra
  });

  const addressedChatId = computed(() => (typeof route.query.chat === "string" ? route.query.chat : ""));
  const memberKey = computed(() => (typeof route.query.member === "string" ? route.query.member : ""));

  /**
   * A chat opened: named in place when it's the one shown already, so Back never lands on the same chat. Resolves once
   * the address names it.
   */
  function showChat(chatId, { replace = false } = {}) {
    const query = { chat: chatId };
    const shown = (route.query.chat || shownChatId()) === chatId;
    return replace || shown ? router.replace({ query }) : router.push({ query });
  }

  /** A member's card beside the chat shown, in place of the one open. */
  function showMember(member) {
    const chat = addressedChatId.value || shownChatId();
    router.replace({ query: { ...(chat ? { chat } : {}), member } });
  }

  watch(memberKey, (member) => {
    if (member) showDetails();
  }, { immediate: true });

  // A link naming a bot opens its direct chat, with its card at its Files when it asks, and leaves the address.
  watch(() => [route.query.bot, route.query.files], ([botId, files]) => {
    if (!botId) return;
    if (files) {
      shellPreferences.detailsTab = "files";
      showDetails();
    }
    openDirect(String(botId), true);
  }, { immediate: true });

  return { addressedChatId, memberKey, chatQuery, showChat, showMember };
}
