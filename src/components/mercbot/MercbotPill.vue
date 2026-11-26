<script setup>
import { computed } from "vue";
import { RouterLink } from "vue-router";

// Every filled button (docs/ui-style.md, section 6): a 30px pill in one of three tones, `neutral`, `dark` for the main
// action of a form or dialog, and `danger` for a destructive one. Its look is `.mb-set-pill` in src/styles/mercbot.css,
// disabled and pending (`v-pending`'s aria-disabled) included. With `to` it is a link in the app, with `href` a link
// elsewhere; a click, an aria label and the like pass through.
const props = defineProps({
  tone: { type: String, default: "neutral", validator: (tone) => ["neutral", "dark", "danger"].includes(tone) },
  type: { type: String, default: "button" },
  disabled: { type: Boolean, default: false },
  to: { type: [String, Object], default: null },
  href: { type: String, default: "" }
});
const classes = computed(() => ["mb-set-pill", props.tone === "neutral" ? null : `mb-set-pill--${props.tone}`]);
</script>

<template>
  <RouterLink v-if="to" :to="to" :class="classes"><slot /></RouterLink>
  <a v-else-if="href" :href="href" :class="classes"><slot /></a>
  <button v-else :type="type" :class="classes" :disabled="disabled"><slot /></button>
</template>
