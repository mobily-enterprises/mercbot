<script setup>
import { computed } from "vue";
import { ON_IDENTITY, PAPER } from "@/theme/palettes.js";

// Plugin tiles: the app's own logo on its brand colour (D-33), or, when we have no logo we may use,
// a generic icon for the kind of app.
const props = defineProps({
  plugin: { type: Object, required: true },
  size: { type: Number, default: 40 }
});

const ICONS = {
  email: "$mail",
  calendar: "$calendarToday",
  folder: "$folder",
  chat: "$chat",
  notes: "$stickyNote2",
  code: "$dataObject",
  crm: "$handshake",
  finance: "$showChart",
  search: "$search",
  data: "$database",
  slides: "$coPresent",
  support: "$headphones",
  marketing: "$trendingUp",
  vault: "$encrypted",
  inbox: "$inbox",
  contacts: "$accountBox"
};
const icon = computed(() => ICONS[props.plugin.icon] || "$extension");
// A maker's own icon is full colour, so it sits on a white tile with a thin border (D-34).
const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  borderRadius: `${Math.round(props.size / 4)}px`,
  background: !props.plugin.logo && props.plugin.logoImage ? PAPER : props.plugin.color,
  ...(!props.plugin.logo && props.plugin.logoImage ? { boxShadow: "inset 0 0 0 1px rgba(var(--v-theme-on-surface), 0.08)" } : {})
}));
</script>

<template>
  <span class="mb-plugin-logo" :style="style" aria-hidden="true">
    <img v-if="plugin.logo" :src="`/api/plugins/${plugin.id}/logo.svg`" alt="" :width="Math.round(size * 0.55)" :height="Math.round(size * 0.55)">
    <img v-else-if="plugin.logoImage" :src="plugin.logoImage" alt="" :width="Math.round(size * 0.7)" :height="Math.round(size * 0.7)">
    <v-icon v-else :icon="icon" :size="Math.round(size * 0.5)" :color="ON_IDENTITY" />
  </span>
</template>

<style scoped>
.mb-plugin-logo {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
}
</style>
