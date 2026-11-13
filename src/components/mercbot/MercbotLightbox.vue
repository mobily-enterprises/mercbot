<script setup>
import { useEscapeToClose } from "./useEscapeToClose.js";

// A screenshot shown large: caption below, download and close at the top right.
const props = defineProps({
  src: { type: String, required: true },
  caption: { type: String, default: "" },
  fileName: { type: String, default: "screenshot.jpg" }
});
const emit = defineEmits(["close"]);

useEscapeToClose(() => emit("close"));
</script>

<template>
  <v-theme-provider theme="dark" with-background class="mb-lightbox" role="dialog" aria-label="Screenshot" @click.self="emit('close')">
    <div class="mb-lightbox__buttons">
      <a class="mb-lightbox__button" :href="props.src" :download="fileName" aria-label="Download"><v-icon icon="$download" size="18" /></a>
      <button type="button" class="mb-lightbox__button" aria-label="Close" @click="emit('close')"><v-icon icon="$close" size="18" /></button>
    </div>
    <figure class="mb-lightbox__figure">
      <img :src="src" :alt="caption">
      <figcaption v-if="caption">{{ caption }}</figcaption>
    </figure>
  </v-theme-provider>
</template>

<style scoped>
.mb-lightbox {
  position: fixed;
  inset: 0;
  z-index: 2500;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 64px 48px 48px;
  background: rgba(var(--v-theme-scrim), 0.85);
}

.mb-lightbox__buttons {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  gap: 8px;
}

.mb-lightbox__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 50%;
  background: rgba(var(--v-theme-on-surface), 0.16);
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
}

.mb-lightbox__figure {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  max-width: 100%;
  max-height: 100%;
  margin: 0;
}

.mb-lightbox__figure img {
  max-width: 100%;
  max-height: calc(100vh - 160px);
  border-radius: 6px;
}

.mb-lightbox__figure figcaption {
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
