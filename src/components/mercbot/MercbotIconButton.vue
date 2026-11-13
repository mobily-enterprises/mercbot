<script setup>
// A circle icon button with the shell's surface or secondary styles and an app tooltip.
import MercbotTooltip from "./MercbotTooltip.vue";

defineProps({
  icon: { type: String, required: true },
  label: { type: String, required: true },
  tooltip: { type: String, default: "" },
  // JSKIT's button sizes (default 40dp; small and x-small for the chat's tighter rows), never a fixed height.
  size: { type: String, default: "default" },
  iconSize: { type: Number, default: 16 },
  tone: { type: String, default: "surface" },
  tooltipLocation: { type: String, default: "bottom" },
  tooltipKeys: { type: Array, default: () => [] }
});
defineOptions({ inheritAttrs: false });
defineEmits(["click"]);
</script>

<template>
  <MercbotTooltip :text="tooltip || label" :location="tooltipLocation" :keys="tooltipKeys">
    <template #default="{ props: tooltipProps }">
      <v-btn
        v-bind="{ ...tooltipProps, ...$attrs }"
        icon
        :ripple="false"
        variant="text"
        :size="size"
        :aria-label="label"
        :class="['mb-icon-button', `mb-icon-button--${tone}`]"
        @click="$emit('click', $event)"
      >
        <v-icon :icon="icon" :size="iconSize" />
      </v-btn>
    </template>
  </MercbotTooltip>
</template>

<style scoped>
.mb-icon-button {
  --v-hover-opacity: 0;
  --v-focus-opacity: 0;
  --v-pressed-opacity: 0;
  flex: none;
  transition: none;
}

.mb-icon-button--surface {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgb(var(--v-theme-outline-variant));
  color: rgb(var(--v-theme-on-surface));
}

.mb-icon-button--surface:hover {
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-icon-button--secondary {
  background: rgb(var(--v-theme-surface-container-high));
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-icon-button--secondary:hover {
  background: rgb(var(--v-theme-surface-container-highest));
}

.mb-icon-button--bare {
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-icon-button--bare:hover {
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-icon-button--primary {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.mb-icon-button:focus-visible {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}
</style>
