import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

const NO_OLDER = Object.freeze({ count: 0, newest: null, oldest: null });

/**
 * Where a step of find in chat lands. Matches are numbered oldest first: the `olderCount` ones in the pages
 * not loaded yet, then the `shownCount` ones on the page. A step to a shown match answers its index on the page; a step
 * into the pages not loaded yet answers which message to bring the pages down to: the newest older match (stepping back
 * from the oldest one shown) or the very first (wrapping round from the last).
 * @param {{ position: number, step: number, olderCount: number, shownCount: number }} where
 * @returns {{ index: number } | { bringDown: "newest" | "oldest" } | null}
 */
export function findStep({ position, step, olderCount, shownCount }) {
  const total = olderCount + shownCount;
  if (!total) return null;
  const next = (position + step + total) % total;
  if (next >= olderCount) return { index: next - olderCount };
  return { bringDown: next === olderCount - 1 ? "newest" : "oldest" };
}

/**
 * Find in chat: live, case-insensitive, highlighted with the CSS Custom Highlight API. The page searches the
 * messages it has; the server counts the matches in the pages not loaded yet (`older.matches`), and the pages come down
 * to one only when the person goes to it (`older.bringDown`), so opening find never reads the whole chat. The counter
 * covers both. `messageCount` is the timeline's length (new or older messages search again), `oldestLoaded` the oldest
 * message id the page has, and `close` asks the shell to close the bar.
 * @param {object} options
 * @param {import("vue").Ref<HTMLElement | null>} options.column Holds the messages.
 * @param {import("vue").Ref<HTMLElement | null>} options.scroller Scrolls them.
 * @param {import("vue").Ref<HTMLInputElement | null>} options.findInput The search field.
 * @param {import("vue").Ref<boolean>} options.open Whether the find bar shows.
 * @param {() => number} options.messageCount
 * @param {() => string | null} options.oldestLoaded
 * @param {{
 *   matches: (text: string) => Promise<{ count: number, newest: string | null, oldest: string | null }>,
 *   bringDown: (messageId: string) => Promise<unknown>
 * }} options.older
 * @param {() => void} options.close
 */
export function useFindInChat({ column, scroller, findInput, open, messageCount, oldestLoaded, older, close }) {
  const findQuery = ref("");
  // The matches on the page, as ranges in document order, and the current one's index among them.
  const findMatches = ref([]);
  const findIndex = ref(-1);
  // The matches in the pages not loaded yet, before the oldest message the page had when they were counted.
  const olderMatches = ref(NO_OLDER);
  const findTotal = computed(() => olderMatches.value.count + findMatches.value.length);
  const findPosition = computed(() => olderMatches.value.count + findIndex.value);
  const highlightsSupported = typeof CSS !== "undefined" && "highlights" in CSS;
  // Each question to the server gets a number, so an answer for an older query or older pages is dropped.
  let asked = 0;
  // The oldest message the page had when the older matches were counted.
  let countedFrom = null;
  // While the pages come down to a match, the step that asked for them places the current match.
  let moving = false;
  let olderTimer = null;

  function clearHighlights() {
    if (!highlightsSupported) return;
    CSS.highlights.delete("mb-find");
    CSS.highlights.delete("mb-find-current");
  }

  /** The page's matches for the query, in document order. */
  function rangesOnPage() {
    const query = findQuery.value.toLowerCase();
    const ranges = [];
    if (query && column.value) {
      const walker = document.createTreeWalker(column.value, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.nodeValue.toLowerCase();
        for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + query.length)) {
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + query.length);
          ranges.push(range);
        }
      }
    }
    return ranges;
  }

  const sameRange = (a, b) => a.startContainer === b.startContainer && a.startOffset === b.startOffset;

  /** The page's matches again; typing jumps to the last one (n/n), other changes keep the current one while it's there. */
  function runFind({ keep = false } = {}) {
    const current = keep ? findMatches.value[findIndex.value] : null;
    clearHighlights();
    const ranges = rangesOnPage();
    findMatches.value = ranges;
    const kept = current ? ranges.findIndex((range) => sameRange(range, current)) : -1;
    findIndex.value = kept === -1 ? ranges.length - 1 : kept;
    showCurrentMatch();
  }

  function showCurrentMatch() {
    if (!highlightsSupported) return;
    const ranges = findMatches.value;
    CSS.highlights.delete("mb-find-current");
    if (!ranges.length || findIndex.value < 0) return;
    CSS.highlights.set("mb-find", new Highlight(...ranges));
    const current = ranges[findIndex.value];
    CSS.highlights.set("mb-find-current", new Highlight(current));
    const rect = current.getBoundingClientRect();
    const view = scroller.value.getBoundingClientRect();
    if (rect.top < view.top + 60 || rect.bottom > view.bottom - 100) {
      scroller.value.scrollBy({ top: rect.top - view.top - view.height / 2, behavior: "smooth" });
    }
  }

  /** The server's count of the matches before the oldest message the page has, or null when a newer question replaced it. */
  async function askOlder() {
    const ask = ++asked;
    countedFrom = oldestLoaded();
    const text = findQuery.value;
    const found = open.value && text ? await older.matches(text).catch(() => NO_OLDER) : NO_OLDER;
    return ask === asked ? found : null;
  }

  /**
   * Goes to a match in the pages not loaded yet: the pages come down to its message, then the current match is the one
   * just before the match that was the oldest on the page (stepping back), or the very first (wrapping round).
   * @param {"newest" | "oldest"} which
   */
  async function bringDown(which) {
    const target = olderMatches.value[which];
    if (moving || !target) return;
    moving = true;
    const previous = findMatches.value[0] || null;
    try {
      await older.bringDown(target);
      await nextTick();
      const found = await askOlder();
      if (!found) {
        runFind({ keep: true });
        return;
      }
      olderMatches.value = found;
      clearHighlights();
      const ranges = rangesOnPage();
      findMatches.value = ranges;
      const after = previous ? ranges.findIndex((range) => sameRange(range, previous)) : -1;
      if (which === "oldest") findIndex.value = Math.min(0, ranges.length - 1);
      else findIndex.value = after === -1 ? ranges.length - 1 : Math.max(0, after - 1);
      showCurrentMatch();
    } finally {
      moving = false;
    }
  }

  /**
   * The older matches for the query just typed. When the page shows none but older pages hold some, typing still jumps
   * to the last match: the pages come down to it.
   */
  async function countOlder() {
    const found = await askOlder();
    if (!found) return;
    olderMatches.value = found;
    if (!findMatches.value.length && found.newest) await bringDown("newest");
  }

  function search() {
    runFind();
    olderMatches.value = NO_OLDER;
    clearTimeout(olderTimer);
    // The server is asked a moment after typing stops.
    olderTimer = setTimeout(countOlder, 150);
  }

  function stepFind(step) {
    if (moving) return;
    const landing = findStep({
      position: findPosition.value,
      step,
      olderCount: olderMatches.value.count,
      shownCount: findMatches.value.length
    });
    if (!landing) return;
    if ("bringDown" in landing) {
      bringDown(landing.bringDown);
      return;
    }
    findIndex.value = landing.index;
    showCurrentMatch();
  }

  function onFindKeydown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      stepFind(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  watch(findQuery, search);
  watch(open, (isOpen) => {
    if (isOpen) {
      nextTick(() => {
        findInput.value?.focus();
        findInput.value?.select();
        search();
      });
    } else {
      clearTimeout(olderTimer);
      asked += 1;
      clearHighlights();
      findMatches.value = [];
      olderMatches.value = NO_OLDER;
    }
  });
  // New messages, or older pages read as the person scrolls up: the page searches again, and when the oldest message
  // it has changed, the server counts the older matches again from there, so none counts twice.
  watch(messageCount, () => {
    if (!open.value || moving) return;
    nextTick(async () => {
      if (moving) return;
      if (oldestLoaded() !== countedFrom) {
        const found = await askOlder();
        if (!found || moving) return;
        olderMatches.value = found;
      }
      runFind({ keep: true });
    });
  });
  onBeforeUnmount(() => {
    clearTimeout(olderTimer);
    clearHighlights();
  });

  return { findQuery, findTotal, findPosition, stepFind, onFindKeydown };
}
