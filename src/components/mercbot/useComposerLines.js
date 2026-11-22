import { computed, nextTick, onBeforeUnmount, watch } from "vue";

// The composer's line height in pixels.
const LINE = 20;

/**
 * One line until the text needs more; then the text sits above the buttons and grows up to 6 lines.
 * `measure` is a hidden single-line copy of the composer that shows when text wraps. The lines are counted again
 * whenever the text changes or the composer's width does, as the page lays it out (the window narrowed to a phone's,
 * a column dragged), and once more when the count moves the text above the buttons or back, since the field is then
 * as wide as the composer, not as the space beside the buttons.
 * @param {{
 *   draft: import("vue").WritableComputedRef<string>,
 *   lines: import("vue").Ref<number>,
 *   stacked: import("vue").ComputedRef<boolean>,
 *   measure: import("vue").Ref<HTMLTextAreaElement | null>,
 *   input: import("vue").Ref<HTMLTextAreaElement | null>
 * }} options
 */
export function useComposerLines({ draft, lines, stacked, measure, input }) {
  function measureLines() {
    const mirror = measure.value;
    if (!mirror) return;
    mirror.value = draft.value || " ";
    const singleLine = mirror.scrollHeight <= 24 && !draft.value.includes("\n");
    if (singleLine) {
      lines.value = 1;
      return;
    }
    nextTick(countLines);
  }

  /** The lines the field's text takes at the field's width now; counted again once the layout follows a change. */
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

  // The copy's width follows the composer's once the page is laid out, whatever changed it; the props that size the
  // column change before that, so their change can't be what counts.
  let resizes = null;
  let width = null;
  watch(measure, (element, before) => {
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
