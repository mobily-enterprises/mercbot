<script setup>
import { testedBadge, testedMeaning } from "./templatesApi.js";

// A template's tested badge (D-43, D-79): "Tested <date>" while its end-to-end check passed for the template and
// Mercbot as they are now, otherwise "Not tested yet". Shown in the gallery, on a template's page and in the preview
// before Add bot.
defineProps({ template: { type: Object, required: true } });
</script>

<template>
  <span class="mb-tested" :class="{ 'mb-tested--yes': template.tested }" :title="testedMeaning(template)" data-tested-badge>
    <v-icon v-if="template.tested" icon="$check" size="14" />{{ testedBadge(template) }}
  </span>
</template>

<style scoped>
.mb-tested {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 8px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 10px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 11px;
  font-weight: 500;
  line-height: 18px;
  white-space: nowrap;
  vertical-align: middle;
}

.mb-tested--yes {
  border-color: transparent;
  background: rgba(var(--v-theme-success), 0.14);
  color: rgb(var(--v-theme-success));
}
</style>
