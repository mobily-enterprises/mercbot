<script setup>
// A bot's template tag (D-98), wherever its name shows: the tag of the template it points at, "+" when it has additions
// of its own, and the small Mercbot cloud when the template is from Mercbot's library, so a home's own is the plain one;
// "setting up" until it has a template. Hovering shows the template's line and the additions' first line. With
// `action` it's a button that opens the bot's Instructions; inside another button (a sidebar row, the chat header) it's
// part of that button.
import { computed } from "vue";
import MercbotTooltip from "./MercbotTooltip.vue";

const props = defineProps({
  bot: { type: Object, required: true },
  // small in lists and headers, medium in the Details panel's header.
  size: { type: String, default: "small" },
  action: { type: Boolean, default: false },
  // Off where a hover card says it already (a pinned tile's).
  tooltip: { type: Boolean, default: true }
});
const emit = defineEmits(["open"]);

const template = computed(() => props.bot.template || null);
const library = computed(() => template.value?.source === "library");
const plus = computed(() => Boolean(template.value && props.bot.hasAdditions));
const hoverText = computed(() => {
  if (!template.value) return "No template yet: it's finding out what it's for.";
  const from = library.value ? "Mercbot's template" : "Your home's template";
  return [`${from} ${template.value.tag}: ${template.value.description}`, plus.value ? `Its additions: ${props.bot.additionsLine}` : ""]
    .filter(Boolean)
    .join(" · ");
});
const label = computed(() => {
  if (!template.value) return "Template: setting up";
  return `Template ${template.value.tag}${library.value ? " from Mercbot's library" : ""}${plus.value ? ", with additions" : ""}`;
});
</script>

<template>
  <MercbotTooltip v-if="tooltip" :text="hoverText">
    <template #default="{ props: tooltipProps }">
      <component
        :is="action ? 'button' : 'span'"
        v-bind="tooltipProps"
        :type="action ? 'button' : undefined"
        class="mb-ttag"
        :class="[`mb-ttag--${size}`, { 'mb-ttag--waiting': !template, 'mb-ttag--action': action }]"
        :aria-label="action ? `${label}. Open its instructions` : label"
        @click="action && emit('open')"
      >
        <v-icon v-if="library" icon="$cloud" class="mb-ttag__cloud" :size="size === 'medium' ? 12 : 10" />
        <span class="mb-ttag__text">{{ template ? template.tag : "setting up" }}</span><span v-if="plus" class="mb-ttag__plus">+</span>
      </component>
    </template>
  </MercbotTooltip>
  <span v-else class="mb-ttag" :class="[`mb-ttag--${size}`, { 'mb-ttag--waiting': !template }]" :aria-label="label">
    <v-icon v-if="library" icon="$cloud" class="mb-ttag__cloud" :size="size === 'medium' ? 12 : 10" />
    <span class="mb-ttag__text">{{ template ? template.tag : "setting up" }}</span><span v-if="plus" class="mb-ttag__plus">+</span>
  </span>
</template>

<style>
/* The tag chip: the palette's chip, so a tag looks the same in the sidebar, the chat header, pickers and search. */
.mb-ttag {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 3px;
  max-width: 100%;
  height: 16px;
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  background: rgb(var(--v-theme-surface-container-high));
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  color: rgb(var(--v-theme-on-surface-variant));
  white-space: nowrap;
  vertical-align: middle;
}

.mb-ttag--medium {
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 22px;
}

.mb-ttag__text {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Mercbot's library: the small cloud, in the brand's primary. */
.mb-ttag__cloud {
  flex: none;
  color: rgb(var(--v-theme-primary));
}

.mb-ttag__plus {
  margin-left: -2px;
  font-weight: 700;
  color: rgb(var(--v-theme-primary));
}

/* No template yet: an outline only, as something still to come. */
.mb-ttag--waiting {
  background: transparent;
  box-shadow: inset 0 0 0 1px rgb(var(--v-theme-outline-variant));
  font-style: italic;
  font-weight: 400;
}

.mb-ttag--action {
  cursor: pointer;
  transition: background-color var(--md-sys-motion-duration-short4, 200ms) var(--md-sys-motion-easing-emphasized, ease);
}

.mb-ttag--action:hover {
  background: rgb(var(--v-theme-surface-container-highest));
}

.mb-ttag--action:focus-visible {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}
</style>
