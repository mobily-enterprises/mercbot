import { onBeforeUnmount, onMounted, unref } from "vue";
import { homePath } from "@/components/mercbot/homeApi.js";

// One stream per page, however many views are open, and only while one is: which of the home's
// tables changed (D-55), heard from any server. Shared by every view on the page.
const stream = { source: null, path: "" };
const listeners = new Set();

function closeSource() {
  stream.source?.close();
  stream.source = null;
}

function subscribe(listener) {
  const path = homePath("/apps-events");
  if (stream.source && stream.path !== path) closeSource();
  if (!stream.source) {
    stream.source = new EventSource(path);
    stream.path = path;
    // After a reconnect (its server went away), everyone catches up on what it missed (D-19).
    let connectedBefore = false;
    stream.source.addEventListener("open", () => {
      if (connectedBefore) for (const each of listeners) each(null);
      connectedBefore = true;
    });
    stream.source.addEventListener("data", (event) => {
      const { tables } = JSON.parse(event.data);
      for (const each of listeners) each(tables);
    });
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) closeSource();
  };
}

const QUIET_MS = 1000;

/**
 * Keeps a running screen's figures current (D-55): it re-reads changed tables after a short pause,
 * and everything when the window comes back. Hidden or scrolled away (`isVisible()` false), it notes
 * what changed and catches up once it's seen again, through `catchUp()`.
 * @param {import("vue").Ref<import("../../types.js").ScreenRuntime | null> | import("../../types.js").ScreenRuntime} screen
 * @param {() => boolean} [isVisible]
 */
export function useLiveData(screen, isVisible = () => true) {
  const changed = new Set();
  let everything = false;
  let timer = null;
  let unsubscribe = null;

  const seen = () => !document.hidden && isVisible();
  function catchUp() {
    clearTimeout(timer);
    timer = null;
    const running = unref(screen);
    if (!running || !seen()) return;
    if (everything) running.loadAll({ quiet: true });
    else if (changed.size) running.reloadChanged([...changed]);
    everything = false;
    changed.clear();
  }
  function heard(tables) {
    if (tables) tables.forEach((table) => changed.add(table));
    else everything = true;
    timer ??= setTimeout(catchUp, QUIET_MS);
  }
  function backOnPage() {
    if (document.hidden) return;
    everything = true;
    catchUp();
  }

  onMounted(() => {
    unsubscribe = subscribe(heard);
    window.addEventListener("focus", backOnPage);
    document.addEventListener("visibilitychange", backOnPage);
  });
  onBeforeUnmount(() => {
    clearTimeout(timer);
    unsubscribe?.();
    window.removeEventListener("focus", backOnPage);
    document.removeEventListener("visibilitychange", backOnPage);
  });
  return { catchUp };
}
