import { computed, nextTick, onBeforeUnmount, watch } from "vue";

// The composer's line height in pixels.
const LINE = 20;

/**
 * How wide the field is beside the buttons: the row's width less every other part it lays out there and the gaps
 * between them. Stacked, the same buttons sit on a line of their own, so it reads the same either way; the spacer shows
 * only then, and the measure is out of the flow. Rounded down to the layout's 1/64 px, so a line never fits the
 * measure that wouldn't fit the field.
 * @param {HTMLElement} row The composer's row (.mb-composer__main).
 * @param {HTMLElement} field The composer's field, inside the row.
 */
function besideWidth(row, field) {
  const look = getComputedStyle(row);
  const gap = parseFloat(look.columnGap) || 0;
  let width = row.getBoundingClientRect().width - parseFloat(look.paddingLeft) - parseFloat(look.paddingRight) -
    parseFloat(look.borderLeftWidth) - parseFloat(look.borderRightWidth);
  for (const part of row.children) {
    const style = getComputedStyle(part);
    if (part.contains(field) || style.display === "none" || ["absolute", "fixed"].includes(style.position) || part.classList.contains("mb-composer__spacer")) continue;
    width -= part.getBoundingClientRect().width + parseFloat(style.marginLeft) + parseFloat(style.marginRight) + gap;
  }
  return Math.max(0, Math.floor(width * 64) / 64);
}

/**
 * One line until the text needs more; then the text sits above the buttons and grows up to 6 lines.
 * `measure` is a hidden single-line copy of the field, as wide as the field is beside the buttons (besideWidth), that
 * shows when text wraps there. The lines are counted again whenever the text changes or the composer's row's width
 * does, as the page lays it out (the window narrowed to a phone's, a column dragged), and once more when the count
 * moves the text above the buttons or back, since the field is then as wide as the composer, not as the space beside
 * the buttons.
 * @param {{
 *   draft: import("vue").WritableComputedRef<string>,
 *   lines: import("vue").Ref<number>,
 *   stacked: import("vue").ComputedRef<boolean>,
 *   measure: import("vue").Ref<HTMLTextAreaElement | null>,
 *   input: import("vue").Ref<HTMLTextAreaElement | null>,
 *   row: import("vue").Ref<HTMLElement | null>
 * }} options
 */
export function useComposerLines({ draft, lines, stacked, measure, input, row }) {
  function measureLines() {
    const copy = measure.value;
    if (!copy) return;
    if (row.value && input.value) copy.style.width = `${besideWidth(row.value, input.value)}px`;
    copy.value = draft.value || " ";
    const singleLine = copy.scrollHeight <= 24 && !draft.value.includes("\n");
    if (singleLine) {
      lines.value = 1;
      return;
    }
    nextTick(countLines);
  }

  /**
   * The lines the field's text takes at the field's width now; counted again once the layout follows a change. What it
   * reads is the layout as it is at once, since the parts that size the text never transition (MercbotChatPanel.css).
   */
  function countLines() {
    const field = input.value;
    if (!field) return;
    const wasStacked = stacked.value;
    const height = field.style.height;
    field.style.height = "0px";
    lines.value = Math.max(2, Math.round(field.scrollHeight / LINE));
    field.style.height = height;
    if (stacked.value !== wasStacked) nextTick(countLines);
  }
  watch(draft, () => nextTick(measureLines));

  // The row's width follows the composer's once the page is laid out, whatever changed it; the props that size the
  // column change before that, so their change can't be what counts. Stacked or not, the row is as wide.
  let resizes = null;
  let width = null;
  watch(row, (element, before) => {
    if (before) resizes?.unobserve(before);
    if (!element) return;
    resizes ??= new ResizeObserver(([entry]) => {
      const now = Math.round(entry.contentRect.width);
      if (width !== null && now !== width) measureLines();
      width = now;
    });
    resizes.observe(element);
  }, { immediate: true });
  onBeforeUnmount(() => resizes?.disconnect());

  const inputHeight = computed(() => (stacked.value ? `${Math.min(6, Math.max(1, lines.value)) * LINE}px` : "22px"));

  return { measureLines, inputHeight };
}
