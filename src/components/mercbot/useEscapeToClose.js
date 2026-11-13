import { onBeforeUnmount, onMounted } from "vue";

/**
 * Escape closes a full-screen viewer, before anything under it hears the key.
 * @param {() => void} close
 */
export function useEscapeToClose(close) {
  function onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  onMounted(() => window.addEventListener("keydown", onKey, true));
  onBeforeUnmount(() => window.removeEventListener("keydown", onKey, true));
}
