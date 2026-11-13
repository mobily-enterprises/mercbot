import { computed } from "vue";

const PAGE_KEYS = new Set(["page", "pageBot", "pageGroup"]);

/**
 * The page open in place of the chat (D-74), named in the address so a reload or a shared
 * address keeps it: ?page=<path>&pageBot=<the bot whose folder holds it>, and &pageGroup= for an old
 * Markdown page a bot made in a group. Its title and the newest save (`stamp`) come from the chat's
 * newest card of it, when the chat has one.
 * @param {{
 *   route: import("vue-router").RouteLocationNormalizedLoaded,
 *   router: import("vue-router").Router,
 *   messages: import("vue").ComputedRef<any[]>,
 *   bots: import("vue").Ref<any[]>,
 *   currentBot: import("vue").ComputedRef<any>
 * }} options
 */
export function useOpenPage({ route, router, messages, bots, currentBot }) {
  /** The address's query without the open page, and with `extra`. */
  const chatQuery = (extra = {}) => ({
    ...Object.fromEntries(Object.entries(route.query).filter(([key]) => !PAGE_KEYS.has(key))),
    ...extra
  });

  const openPage = computed(() => {
    const path = typeof route.query.page === "string" ? route.query.page : "";
    if (!path) return null;
    const botId = String(route.query.pageBot || currentBot.value?.id || "");
    const card = [...messages.value].reverse().find((message) => message.kind === "page" && message.body?.path === path);
    const name = path.split("/").pop().replace(/\.(html|md)$/u, "").replace(/-/gu, " ");
    return {
      path,
      botId,
      group: route.query.pageGroup ? String(route.query.pageGroup) : null,
      title: card?.body.title || name,
      stamp: card ? String(card.id) : "",
      botName: bots.value.find((bot) => String(bot.id) === botId)?.name || "The bot"
    };
  });

  /** Opens a page; `chatBot` also opens that bot's chat under it (from search or the Library). */
  function showPage({ path, botId, group = null, chatBot = null }) {
    router.push({ query: chatQuery({ ...(chatBot ? { bot: chatBot } : {}), page: path, pageBot: botId, ...(group ? { pageGroup: group } : {}) }) });
  }

  const closePage = () => router.replace({ query: chatQuery() });

  return { openPage, showPage, closePage, chatQuery };
}
