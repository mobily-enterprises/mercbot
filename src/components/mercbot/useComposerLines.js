import { computed, nextTick, watch } from "vue";

// The composer's line height in pixels.
const LINE = 20;

/**
 * One line until the text needs more; then the text sits above the buttons and grows up to 6 lines.
 * `measure` is a hidden single-line copy of the composer that shows when text wraps.
 * @param {{
 *   draft: import("vue").WritableComputedRef<string>,
 *   lines: import("vue").Ref<number>,
 *   stacked: import("vue").ComputedRef<boolean>,
 *   measure: import("vue").Ref<HTMLTextAreaElement | null>,
 *   input: import("vue").Ref<HTMLTextAreaElement | null>,
 *   columnWidth: () => number
 * }} options
 */
export function useComposerLines({ draft, lines, stacked, measure, input, columnWidth }) {
  function measureLines() {
    const mirror = measure.value;
    if (!mirror) return;
    mirror.value = draft.value || " ";
    const singleLine = mirror.scrollHeight <= 24 && !draft.value.includes("\n");
    if (singleLine) {
      lines.value = 1;
      return;
    }
    nextTick(() => {
      const field = input.value;
      if (!field) return;
      const height = field.style.height;
      field.style.height = "0px";
      lines.value = Math.max(2, Math.round(field.scrollHeight / LINE));
      field.style.height = height;
    });
  }
  watch(draft, () => nextTick(measureLines));
  watch(columnWidth, () => nextTick(measureLines));

  const inputHeight = computed(() => (stacked.value ? `${Math.min(6, Math.max(1, lines.value)) * LINE}px` : "22px"));

  return { measureLines, inputHeight };
}
