import { computed, ref, watch } from "vue";
import { botsApi } from "./botsApi.js";
import { fileKind, formatSize, isHtmlPage } from "./filesApi.js";

/** "Today", "Yesterday", or the day as "Mon 3 Nov". */
function dayLabel(iso) {
  const day = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (day.toDateString() === today.toDateString()) return "Today";
  if (day.toDateString() === yesterday.toDateString()) return "Yesterday";
  return day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** A Library row's icon. */
export function itemIcon(item) {
  if (item.kind === "page") return "$book2";
  if (item.kind === "view") return "$dashboard";
  if (item.kind === "chart") return "$barChart";
  return fileKind(item.name).icon;
}

/** What a Library entry is, as its hover card names it. */
export function itemType(item) {
  return { page: "Page", view: "View", chart: "Chart", picture: "Picture" }[item.kind] || "File";
}

/**
 * Who can open a page, as its hover card and Share… say: a web page is the home's (D-74).
 * For an older Markdown page, where its file is kept decides (D-36): the person's own folder with a
 * private or mixed bot is theirs alone; the bot's folder is everyone's who uses the bot; the home's
 * shared folder, and a shared bot's every folder, the home's.
 * @param {{ name: string, sharing?: string }} bot
 * @param {string} path the page's file, as /files/mine/…, /files/bot/… or /files/shared/…
 * @param {string} homeName
 */
export function pageAccess(bot, path, homeName) {
  const home = `Everyone in ${homeName || "the home"}`;
  if (isHtmlPage(path) || bot.sharing === "shared" || path.startsWith("/files/shared/")) {
    return { icon: "$group", title: home, text: `${home} can open it.`, onlyYou: false };
  }
  if (path.startsWith("/files/bot/")) {
    return { icon: "$group", title: `Everyone using ${bot.name}`, text: `Everyone who uses ${bot.name} can open it.`, onlyYou: false };
  }
  return { icon: "$lock", title: "Only you", text: "Only you can open this page.", onlyYou: true };
}

/** How long ago a Library entry was made, as its row shows it: "now", "5m", "3h", "4d", "2w", "1y". */
export function itemAge(iso, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return days < 365 ? `${Math.floor(days / 7)}w` : `${Math.floor(days / 365)}y`;
}

/**
 * A Library entry's "…" menu: Pin or Unpin; a page also opens, shares and is deleted
 * (after a confirmation).
 * @param {object} item
 * @param {{ open: (item: object) => void, share: (item: object) => void, pin: (item: object) => void, remove: (item: object) => void }} actions
 */
export function libraryMenuItems(item, { open, share, pin, remove }) {
  const pinItem = { title: item.pinned ? "Unpin" : "Pin", icon: item.pinned ? "$keepOff" : "$keepFilled", run: () => pin(item) };
  if (item.kind !== "page") return [pinItem];
  return [
    { title: "Open", icon: "$openInNew", run: () => open(item) },
    { title: "Share…", icon: "$iosShare", run: () => share(item) },
    pinItem,
    { divider: true },
    { title: "Delete", icon: "$delete", danger: true, run: () => remove(item) }
  ];
}

/** A Library row's second line: its kind, or a file's type and size. */
export function itemMeta(item) {
  if (item.kind === "page") return item.summary || "Page";
  if (item.kind === "view") return item.summary || "View";
  if (item.kind === "chart") return "Chart";
  if (item.kind === "picture") return "Picture";
  return `${fileKind(item.name).label} · ${formatSize(item.size || 0)}`;
}

/**
 * Library tab: what the bot made, pinned first, then by day with five per day
 * until "Show more". Each row opens its viewer; "…" pins or unpins it, and for a page opens, shares
 * or deletes it. It's read while the tab is open, again as the bot's activity changes.
 * @param {{
 *   bot: () => import("../../types.js").Bot,
 *   isGroup: import("vue").ComputedRef<boolean>,
 *   tab: import("vue").ComputedRef<string>,
 *   onFailure: (error: unknown) => void,
 *   onMessages: (changed: { botId: string, messages: object[] }) => void
 * }} options `onMessages` gets the chat's cards a change rewrote (a deleted page's), with their bot.
 */
export function useBotLibrary({ bot, isGroup, tab, onFailure, onMessages }) {
  const libraryItems = ref([]);
  const libraryLoaded = ref(false);
  const expandedDays = ref(new Set());
  const openItem = ref(null);
  // The page whose Share dialog is open, and the one waiting for its delete to be confirmed.
  const sharingItem = ref(null);
  const pendingDelete = ref(null);
  const itemMenu = ref({ open: false, target: [0, 0], path: "", items: [] });

  async function loadLibrary() {
    if (isGroup.value) return;
    try {
      libraryItems.value = (await botsApi.library(bot().id)).items;
    } catch (error) {
      libraryItems.value = [];
      onFailure(error);
    }
    libraryLoaded.value = true;
  }

  const libraryGroups = computed(() => {
    const groups = [];
    const pinned = libraryItems.value.filter((item) => item.pinned);
    if (pinned.length) groups.push({ label: "Pinned", items: pinned, more: 0 });
    for (const item of libraryItems.value.filter((entry) => !entry.pinned)) {
      const label = dayLabel(item.createdAt);
      let group = groups.find((entry) => entry.label === label);
      if (!group) groups.push(group = { label, items: [], more: 0 });
      group.items.push(item);
    }
    return groups.map((group) => {
      const all = group.label === "Pinned" || expandedDays.value.has(group.label);
      return { ...group, shown: all ? group.items : group.items.slice(0, 5), more: all ? 0 : Math.max(0, group.items.length - 5) };
    });
  });

  async function togglePin(item) {
    try {
      libraryItems.value = (await botsApi.pinItem(bot().id, item, !item.pinned)).items;
    } catch (error) {
      onFailure(error);
    }
  }

  async function deletePage() {
    const item = pendingDelete.value;
    pendingDelete.value = null;
    if (!item) return;
    const botId = bot().id;
    try {
      const answer = await botsApi.deletePage(botId, item);
      if (bot().id === botId) libraryItems.value = answer.items;
      onMessages({ botId, messages: answer.messages });
    } catch (error) {
      onFailure(error);
    }
  }

  /** An entry's menu, under its "…" button or at the pointer on a right-click. */
  function openItemMenu(event, item) {
    const box = event.currentTarget.getBoundingClientRect();
    const target = event.type === "contextmenu" ? [event.clientX, event.clientY] : [box.left, box.bottom];
    itemMenu.value = {
      open: true,
      target,
      path: item.path,
      items: libraryMenuItems(item, {
        open: (chosen) => { openItem.value = chosen; },
        share: (chosen) => { sharingItem.value = chosen; },
        pin: togglePin,
        remove: (chosen) => { pendingDelete.value = chosen; }
      })
    };
  }

  watch([() => bot().id, tab, () => bot().lastActivityAt], () => {
    if (tab.value === "library") loadLibrary();
  }, { immediate: true });
  watch(() => bot().id, () => {
    libraryLoaded.value = false;
    libraryItems.value = [];
    expandedDays.value = new Set();
    sharingItem.value = null;
    pendingDelete.value = null;
  });

  return { libraryItems, libraryLoaded, expandedDays, openItem, libraryGroups, sharingItem, pendingDelete, itemMenu, openItemMenu, deletePage };
}
