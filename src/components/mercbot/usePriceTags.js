import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { accountApi, priceTag } from "./accountApi.js";
import { homeChanges } from "./homesApi.js";

// Each bot's price tag (D-73, D-56): what it cost this month, with all time a hover away; the whole home's for its
// owners and admins, a member's own use otherwise. One small read of the monthly totals for the whole list, separate
// from the bots, read again when a bot finishes working, when the home changes and when the page is shown again.

const BUSY = new Set(["attention", "thinking", "working"]);
// A finished reply's cost is recorded before its answer comes back; this waits a little for its last steps.
const AFTER_WORK_MS = 1500;

/**
 * @param {() => Record<string, string>} moods each bot's avatar mood
 */
export function usePriceTags(moods) {
  const tags = ref(null);
  let later = null;

  async function read() {
    try {
      const { bots } = await accountApi.priceTags();
      tags.value = Object.fromEntries(bots.map((bot) => [bot.botId, bot]));
    } catch {
      // Price tags are a nicety: the list works without them, and the next read tries again.
    }
  }

  function readSoon() {
    clearTimeout(later);
    later = setTimeout(read, AFTER_WORK_MS);
  }

  const busy = () => Object.keys(moods()).filter((botId) => BUSY.has(moods()[botId])).sort().join(",");
  watch(busy, (now, before) => {
    const still = new Set(now.split(","));
    if (before.split(",").some((botId) => botId && !still.has(botId))) readSoon();
  });
  watch(homeChanges, read);

  function shown() {
    if (document.visibilityState === "visible") read();
  }
  onMounted(() => {
    read();
    document.addEventListener("visibilitychange", shown);
  });
  onBeforeUnmount(() => {
    clearTimeout(later);
    document.removeEventListener("visibilitychange", shown);
  });

  /** A bot's tag, "$1.24", and its hover text; none for a group chat, a bot being made, or before the tags load. */
  function tagOf(bot) {
    if (!tags.value || bot.kind === "group" || bot.creating) return null;
    const tag = tags.value[bot.id] || { monthNano: 0, allNano: 0 };
    return { text: priceTag(tag.monthNano), hover: `${priceTag(tag.monthNano)} this month · ${priceTag(tag.allNano)} all time` };
  }

  return { tagOf, read };
}
