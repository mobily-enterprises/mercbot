<script setup>
// One single-line row of the sidebar (plan 4.1, dense): a 24px face (the slot), the name, and small marks at the end:
// dots while someone else types there (`typing`, its line), a draft's pencil, then the position hint while Ctrl+Alt is
// held, else waiting for the person, "@" or the unread dot. Its accessible name is `label`; its full name and latest
// message are its description (`tip`), shown on hover. A bot's row shows its template's name (`detail`) after its own,
// muted and smaller, and cut short first when there's no room.
import MercbotTypingDots from "./MercbotTypingDots.vue";

defineProps({
  label: { type: String, required: true },
  name: { type: String, required: true },
  detail: { type: String, default: "" },
  tip: { type: String, default: "" },
  // A room's globe or lock ($language or $lock), with its word.
  kindIcon: { type: String, default: "" },
  kindLabel: { type: String, default: "" },
  selected: { type: Boolean, default: false },
  switching: { type: Boolean, default: false },
  dragging: { type: Boolean, default: false },
  // A public room the person isn't in, or an archived room or bot: quieter.
  faded: { type: Boolean, default: false },
  hint: { type: [String, Number], default: "" },
  draft: { type: Boolean, default: false },
  typing: { type: String, default: "" },
  waiting: { type: String, default: "" },
  mentioned: { type: Boolean, default: false },
  unread: { type: Boolean, default: false }
});
defineOptions({ inheritAttrs: false });
</script>

<template>
  <button
    v-bind="$attrs"
    type="button"
    class="mb-row"
    :class="{ 'mb-row--selected': selected, 'mb-switching': switching, 'mb-dragging': dragging, 'mb-row--faded': faded }"
    :aria-current="selected ? 'page' : undefined"
    :aria-label="label"
    :title="tip || undefined"
  >
    <span class="mb-row__avatar"><slot /></span>
    <slot name="name">
      <span class="mb-row__name">{{ name }}</span>
    </slot>
    <span v-if="detail" class="mb-row__detail text-body-small" aria-hidden="true">{{ detail }}</span>
    <v-icon v-if="kindIcon" :icon="kindIcon" size="12" class="mb-kind" :aria-label="kindLabel" />
    <span class="mb-row__marks">
      <span v-if="typing" class="mb-row__typing" role="img" :aria-label="typing"><MercbotTypingDots /></span>
      <v-icon v-if="draft" icon="$edit" size="12" class="mb-row__draft" aria-label="Draft" />
      <kbd v-if="hint" class="mb-hint">{{ hint }}</kbd>
      <span v-else-if="waiting" class="mb-row__unread mb-row__unread--waiting" :aria-label="`Waiting for you: ${waiting}`" />
      <span v-else-if="mentioned" class="mb-row__mention" aria-label="Mentioned you">@</span>
      <span v-else-if="unread" class="mb-row__unread" aria-label="Unread" />
    </span>
  </button>
</template>

<style scoped>
.mb-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.mb-row:hover {
  background: rgb(var(--v-theme-surface-container-highest));
}

.mb-row--selected,
.mb-row--selected:hover {
  background: rgb(var(--v-theme-secondary-container));
}

/* A public room the person isn't in yet, an archived room or bot: its name and face quieter. */
.mb-row--faded {
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-row--faded .mb-row__avatar {
  opacity: 0.6;
}

.mb-row__avatar {
  display: inline-flex;
  flex: none;
}

.mb-row__name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: 14px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The template's name: it shrinks long before the name does, so the bot's own name is cut last. */
.mb-row__detail {
  flex: 0 1000 auto;
  min-width: 0;
  overflow: hidden;
  color: rgb(var(--v-theme-on-surface-variant));
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-kind {
  flex: none;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-row__marks {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.mb-row__typing {
  display: inline-flex;
  color: rgb(var(--v-theme-link));
}

.mb-row__draft {
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-row__unread {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgb(var(--v-theme-link));
}

.mb-row__unread--waiting {
  background: rgb(var(--v-theme-warning));
}

/* Someone mentioned the person here, unread since (D-114): an "@" where the dot would be. */
.mb-row__mention {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgb(var(--v-theme-link));
  color: rgb(var(--v-theme-surface));
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.mb-hint {
  flex: none;
  min-width: 16px;
  padding: 0 4px;
  border-radius: 4px;
  background: rgb(var(--v-theme-surface-container-high));
  box-shadow: 0 0 0 1px rgb(var(--v-theme-outline-variant));
  font: 600 10px/16px var(--v-font-body);
  color: rgb(var(--v-theme-on-surface-variant));
  text-align: center;
}

.mb-switching {
  outline: 2px solid rgb(var(--v-theme-on-surface));
  outline-offset: -2px;
}

.mb-row:focus-visible {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: -2px;
}

.mb-dragging {
  opacity: 0.4;
}
</style>
