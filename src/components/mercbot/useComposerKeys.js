import { nextTick } from "vue";

/**
 * The composer's keys: the skill and mention menus' arrows, Enter, Tab and
 * Escape; Backspace and Delete take a token as a whole; Enter sends, Shift+Enter starts a line;
 * Escape leaves a reply, then the field; Backspace at the start takes the last quote.
 * @param {{
 *   draft: import("vue").WritableComputedRef<string>,
 *   input: import("vue").Ref<HTMLTextAreaElement | null>,
 *   quotes: import("vue").Ref<string[]>,
 *   replyTarget: import("vue").Ref<{ id: string, text: string } | null>,
 *   tokens: ReturnType<typeof import("./useComposerTokens.js").useComposerTokens>,
 *   send: () => void
 * }} options `tokens` is the composer's mentions and skills (useComposerTokens).
 */
export function useComposerKeys({ draft, input, quotes, replyTarget, tokens: composerTokens, send }) {
  const { tokens, mention, slash, skillRows, mentionRows, insertSkill, insertMention, tokenSpans } = composerTokens;

  function onComposerKeydown(event) {
    if (slash.value && skillRows.value.length) {
      const count = skillRows.value.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        slash.value = { ...slash.value, active: (slash.value.active + (event.key === "ArrowDown" ? 1 : -1) + count) % count };
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
        event.preventDefault();
        insertSkill(skillRows.value[slash.value.active] || skillRows.value[0]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        slash.value = null;
        return;
      }
    }
    if (mention.value && mentionRows.value.length) {
      const count = mentionRows.value.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        mention.value = { ...mention.value, active: (mention.value.active + (event.key === "ArrowDown" ? 1 : -1) + count) % count };
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
        event.preventDefault();
        insertMention(mentionRows.value[mention.value.active] || mentionRows.value[0]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        mention.value = null;
        return;
      }
    }
    // A token goes as a whole.
    if ((event.key === "Backspace" || event.key === "Delete") && tokens.value.length && event.target.selectionStart === event.target.selectionEnd) {
      const caret = event.target.selectionStart;
      const span = tokenSpans().find((entry) => (event.key === "Backspace" ? caret > entry.start && caret <= entry.end : caret >= entry.start && caret < entry.end));
      if (span) {
        event.preventDefault();
        draft.value = `${draft.value.slice(0, span.start)}${draft.value.slice(span.end)}`;
        nextTick(() => event.target.setSelectionRange(span.start, span.start));
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    } else if (event.key === "Escape") {
      if (replyTarget.value) replyTarget.value = null;
      else input.value?.blur();
    } else if (event.key === "Backspace" && quotes.value.length && event.target.selectionStart === 0 && event.target.selectionEnd === 0) {
      quotes.value = quotes.value.slice(0, -1);
    }
  }

  return { onComposerKeydown };
}
