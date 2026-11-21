import { computed, watch } from "vue";
import { shellPreferences } from "./shellPreferences.js";

// The address's keys the shell reads: the open chat, Team and its open member, and an open page (useOpenPage).
const PAGE_KEYS = new Set(["page", "pageBot", "pageChat"]);

/**
 * What the shell shows, named in the address so a reload or a shared link keeps it (D-112): ?chat=<id> for a chat,
 * ?team=1 for the Team page, and &member=bot:<id> or person:<id> for a member's card beside it. Links from elsewhere
 * name a bot: ?bot=<id> opens the person's direct chat with it (Ask Builder, a view's Ask, a template), and
 * ?bot=<id>&files=1 its card on Team at its Files (the home's Files page). A member the address names opens their card
 * in Details (`showDetails`), from a reload or a link as from a tap; `shownChatId` is the chat shown, which an address
 * without ?chat= shows too (the list's first).
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

  const view = computed(() => (route.query.team ? "team" : "chat"));
  const addressedChatId = computed(() => (typeof route.query.chat === "string" ? route.query.chat : ""));
  const memberKey = computed(() => (typeof route.query.member === "string" ? route.query.member : ""));

  /**
   * A chat opened: named in place when it's the one shown already, so Back never lands on the same chat. Resolves once
   * the address names it.
   */
  function showChat(chatId, { replace = false } = {}) {
    const query = { chat: chatId };
    const shown = !route.query.team && (route.query.chat || shownChatId()) === chatId;
    return replace || shown ? router.replace({ query }) : router.push({ query });
  }

  /** The Team page, with a member's card open when `member` names one. */
  function showTeam(member = "") {
    router.push({ query: { team: "1", ...(member ? { member } : {}) } });
  }

  /** A member's card on Team: shown beside the list, in place of the one open. */
  function showMember(member) {
    router.replace({ query: { team: "1", member } });
  }

  watch(memberKey, (member) => {
    if (member) showDetails();
  }, { immediate: true });

  // A link naming a bot opens its direct chat, or its card at its Files, and leaves the address.
  watch(() => [route.query.bot, route.query.files], ([botId, files]) => {
    if (!botId) return;
    if (files) {
      shellPreferences.detailsOpen = true;
      shellPreferences.detailsTab = "files";
      router.replace({ query: { team: "1", member: `bot:${botId}` } });
      return;
    }
    openDirect(String(botId), true);
  }, { immediate: true });

  return { view, addressedChatId, memberKey, chatQuery, showChat, showTeam, showMember };
}
