import { onBeforeUnmount, onMounted, ref } from "vue";

/**
 * Add selection to chat: a pill above text selected in the chat, or Ctrl+L, quotes it in
 * the composer.
 * @param {{
 *   column: import("vue").Ref<HTMLElement | null>,
 *   scroller: import("vue").Ref<HTMLElement | null>,
 *   quotes: import("vue").Ref<string[]>,
 *   focusComposer: () => void
 * }} options
 */
export function useSelectionPill({ column, scroller, quotes, focusComposer }) {
  const selectionPill = ref(null);

  function selectedText() {
    const selection = window.getSelection();
    const text = String(selection || "").trim();
    if (!text || !selection.rangeCount || !column.value?.contains(selection.anchorNode)) return null;
    return { text, rect: selection.getRangeAt(0).getClientRects()[0] };
  }

  function updateSelectionPill() {
    const found = selectedText();
    if (!found?.rect) {
      selectionPill.value = null;
      return;
    }
    const panel = scroller.value.parentElement.getBoundingClientRect();
    selectionPill.value = { top: found.rect.top - panel.top - 34, left: Math.max(8, found.rect.left - panel.left) };
  }

  function addSelection() {
    const found = selectedText();
    if (!found) return;
    quotes.value = [...quotes.value, found.text.slice(0, 4000)];
    window.getSelection()?.removeAllRanges();
    selectionPill.value = null;
    focusComposer();
  }

  onMounted(() => document.addEventListener("selectionchange", updateSelectionPill));
  onBeforeUnmount(() => document.removeEventListener("selectionchange", updateSelectionPill));

  return { selectionPill, addSelection };
}
