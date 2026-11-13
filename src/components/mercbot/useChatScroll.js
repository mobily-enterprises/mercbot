import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

/**
 * How many of the messages after `lastId` are news for the reader: everything but
 * timestamps and their own messages. Null when `lastId` isn't among them: the chat shows another
 * conversation now (another bot, or another room of a shared bot).
 * @param {Array<{ id: string, kind: string, role: string, body?: { from?: { id: string } } }>} messages
 * @param {string | null} lastId the message that was last before
 * @param {string} me the signed-in person's id
 * @returns {number | null}
 */
export function newMessagesAfter(messages, lastId, me) {
  const at = messages.findIndex((message) => message.id === lastId);
  if (at < 0) return null;
  const own = (message) => message.role === "user" && (!message.body?.from || message.body.from.id === me);
  return messages.slice(at + 1).filter((message) => message.kind !== "timestamp" && !own(message)).length;
}

/**
 * Following the newest message: the chat follows while the reader is at the bottom, and
 * stops only when they scroll up themselves. The chat's own gliding never counts as that, and
 * content that grows afterwards (a picture, a reply landing) is followed too. The space under the
 * last message matches the message box, whatever its height. While the reader is scrolled up,
 * what arrives leaves the view where it is and is counted in `unseen`, for the "new messages" pill;
 * reaching the bottom clears it.
 * @param {{
 *   scroller: import("vue").Ref<HTMLElement | null>,
 *   column: import("vue").Ref<HTMLElement | null>,
 *   dock: import("vue").Ref<HTMLElement | null>,
 *   messages: () => Array<object>,
 *   status: () => string,
 *   me: () => string
 * }} options
 */
export function useChatScroll({ scroller, column, dock, messages, status, me }) {
  const awayFromBottom = ref(false);
  const following = ref(true);
  const unseen = ref(0);
  let gliding = 0;

  function updateScrollState() {
    const element = scroller.value;
    if (!element) return;
    awayFromBottom.value = element.scrollHeight - element.scrollTop - element.clientHeight > 4;
    if (!awayFromBottom.value) {
      following.value = true;
      unseen.value = 0;
    } else if (Date.now() > gliding) following.value = false;
  }

  function scrollToBottom(behavior = "smooth") {
    if (!scroller.value) return;
    gliding = Date.now() + 900;
    following.value = true;
    unseen.value = 0;
    scroller.value.scrollTo({ top: scroller.value.scrollHeight, behavior });
  }

  // The newest message changes as messages arrive (older pages go in above it), or as the chat shows
  // another conversation, whose messages are no news: a room switch keeps the reader where they were.
  watch(() => messages().at(-1)?.id ?? null, (lastId, previousId) => {
    if (following.value || lastId === previousId) return;
    const news = newMessagesAfter(messages(), previousId, me());
    unseen.value = news === null ? 0 : unseen.value + news;
  });

  watch(() => [messages().length, status()], () => {
    if (!following.value) {
      nextTick(updateScrollState);
      return;
    }
    nextTick(() => {
      const last = column.value?.querySelector(".mb-timeline > :last-child");
      if (last && last.offsetHeight > scroller.value.clientHeight - 120) {
        // A long message shows from its start; the reader carries on from there.
        gliding = Date.now() + 900;
        last.scrollIntoView({ block: "start", behavior: "smooth" });
        following.value = false;
      } else {
        scrollToBottom();
      }
    });
  });

  const dockHeight = ref(96);
  let resizes = null;
  onMounted(() => {
    resizes = new ResizeObserver(() => {
      if (dock.value) dockHeight.value = dock.value.offsetHeight;
      if (following.value) scrollToBottom("auto");
    });
    if (column.value) resizes.observe(column.value);
    if (dock.value) resizes.observe(dock.value);
  });
  onBeforeUnmount(() => resizes?.disconnect());

  // A message chosen in the search palette: scrolled to the top, under the header, and ringed in
  // grey for about 1.2s before fading.
  function showMessage(id) {
    const item = column.value?.querySelector(`[data-message-id="${CSS.escape(String(id))}"]`);
    if (!item || !scroller.value) return;
    const top = item.getBoundingClientRect().top - scroller.value.getBoundingClientRect().top + scroller.value.scrollTop;
    scroller.value.scrollTo({ top: Math.max(0, top - 64) });
    item.classList.remove("mb-timeline__item--found");
    void item.offsetWidth;
    item.classList.add("mb-timeline__item--found");
    setTimeout(() => item.classList.remove("mb-timeline__item--found"), 2000);
  }

  return { awayFromBottom, unseen, dockHeight, updateScrollState, scrollToBottom, showMessage };
}
