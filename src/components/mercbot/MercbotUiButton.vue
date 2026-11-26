<script setup>
import { computed } from "vue";
import { vPending } from "@jskit-ai/shell-web/client/directives/vPending";
import MercbotPill from "./MercbotPill.vue";

// JSKIT's Button role (shell-web's UI kit) in Mercbot's look (docs/ui-style.md, section 6): a high-emphasis action is
// the dark pill, a medium or subtle one the neutral pill, a low one a text button, and the danger tone the danger pill
// (a low one in the error colour). Mercbot's pills have one height, so `size` changes nothing. While `pending` the
// button keeps its focus and ignores activation (v-pending). Other attributes (class, form, aria-*, a click) reach it.
const props = defineProps({
  emphasis: { type: String, default: "medium", validator: (value) => ["high", "medium", "subtle", "low"].includes(value) },
  tone: { type: String, default: "accent", validator: (value) => ["accent", "neutral", "danger"].includes(value) },
  size: { type: String, default: "default", validator: (value) => ["default", "large"].includes(value) },
  type: { type: String, default: "button" },
  disabled: { type: Boolean, default: false },
  pending: { type: Boolean, default: false },
  block: { type: Boolean, default: false },
  href: { type: String, default: undefined },
  icon: { type: String, default: undefined }
});
const pill = computed(() => (props.tone === "danger" ? "danger" : props.emphasis === "high" ? "dark" : "neutral"));
</script>

<template>
  <v-btn
    v-if="emphasis === 'low'"
    v-pending="pending"
    variant="text"
    :color="tone === 'danger' ? 'error' : undefined"
    :type="href ? undefined : type"
    :href="href"
    :disabled="disabled"
    :block="block"
    :prepend-icon="icon"
  >
    <slot />
  </v-btn>
  <MercbotPill v-else v-pending="pending" :tone="pill" :type="type" :href="href" :disabled="disabled" :class="{ 'mb-set-pill--block': block }">
    <v-progress-circular v-if="pending" indeterminate size="14" width="2" aria-hidden="true" />
    <v-icon v-else-if="icon" :icon="icon" size="16" />
    <slot />
  </MercbotPill>
</template>
