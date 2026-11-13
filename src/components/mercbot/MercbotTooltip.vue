<script setup>
// The app's tooltip; optional key chips follow the text.
defineProps({
  text: { type: String, required: true },
  location: { type: String, default: "bottom" },
  keys: { type: Array, default: () => [] }
});
</script>

<template>
  <v-tooltip
    :text="text"
    :location="location"
    :offset="8"
    :open-delay="330"
    content-class="mb-tooltip"
  >
    <template #activator="{ props: activatorProps }">
      <slot :props="activatorProps" />
    </template>
    <span class="mb-tooltip__text">{{ text }}</span>
    <kbd v-for="key in keys" :key="key" class="mb-tooltip__key">{{ key }}</kbd>
  </v-tooltip>
</template>

<style>
.mb-tooltip__key {
  display: inline-block;
  min-width: 18px;
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 4px;
  background: rgb(var(--v-theme-surface-container-high));
  font: inherit;
  font-size: 11px;
  line-height: 16px;
  color: rgb(var(--v-theme-on-surface-variant));
  text-align: center;
}
</style>
