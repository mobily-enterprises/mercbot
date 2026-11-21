import { computed } from "vue";

/**
 * The page open in place of the chat (D-74), named in the address so a reload or a shared address keeps it:
 * ?page=<path>&pageBot=<the bot that made it>&pageChat=<the chat whose folder holds it, for a /files/chat page>. Its
 * title and the newest save (`stamp`) come from the open chat's newest card of it, when it has one.
 * @param {{
 *   route: import("vue-router").RouteLocationNormalizedLoaded,
 *   router: import("vue-router").Router,
 *   messages: import("vue").ComputedRef<any[]>,
 *   botName: (botId: string) => string,
 *   chatQuery: (extra?: Record<string, string>) => Record<string, any>,
 *   currentChatId: () => string
 * }} options
 */
export function useOpenPage({ route, router, messages, botName, chatQuery, currentChatId }) {
  const openPage = computed(() => {
    const path = typeof route.query.page === "string" ? route.query.page : "";
    if (!path) return null;
    const botId = String(route.query.pageBot || "");
    const card = [...messages.value].reverse().find((message) => message.kind === "page" && message.body?.path === path);
    const name = path.split("/").pop().replace(/\.(html|md)$/u, "").replace(/-/gu, " ");
    return {
      path,
      botId,
      chatId: route.query.pageChat ? String(route.query.pageChat) : null,
      title: card?.body.title || name,
      stamp: card ? String(card.id) : "",
      botName: botName(botId) || "The bot"
    };
  });

  /** Opens a page over a chat: the one it's in (`chatId`), else the open one. */
  function showPage({ path, botId, chatId = null }) {
    const chat = chatId || currentChatId() || "";
    router.push({ query: chatQuery({ ...(chat ? { chat } : {}), page: path, pageBot: botId, ...(chatId ? { pageChat: chatId } : {}) }) });
  }

  const closePage = () => router.replace({ query: chatQuery() });

  return { openPage, showPage, closePage };
}
