<script setup>
import { ref } from "vue";
import { useEscapeToClose } from "@/components/mercbot/useEscapeToClose.js";
import ViewActions from "./ViewActions.vue";
import ViewSurface from "./ViewSurface.vue";

// A view opened from its card, the Library or search (D-55): drawn live, with what people do with it.
const props = defineProps({
  slug: { type: String, required: true },
  title: { type: String, required: true }
});
const emit = defineEmits(["close"]);
const loaded = ref(null);
const missing = ref(false);
const reloads = ref(0);
useEscapeToClose(() => emit("close"));
</script>

<template>
  <div class="mb-view-viewer" role="dialog" :aria-label="loaded?.app.name || props.title" @click.self="emit('close')">
    <v-theme-provider theme="dark" with-background class="mb-view-viewer__bar">
      <v-icon icon="$dashboard" size="20" />
      <span class="mb-view-viewer__name">{{ loaded?.app.name || title }}</span>
      <ViewActions v-if="loaded" :loaded="loaded" @restored="reloads += 1" @retired="emit('close')" />
      <button type="button" class="mb-view-viewer__close" aria-label="Close" @click="emit('close')"><v-icon icon="$close" size="18" /></button>
    </v-theme-provider>
    <div class="mb-view-viewer__body" @click.self="emit('close')">
      <div class="mb-view-viewer__sheet">
        <p v-if="missing" class="text-body-1 mb-0">This view was retired.</p>
        <ViewSurface v-else :slug="slug" :reloads="reloads" @loaded="loaded = $event" @missing="missing = true" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.mb-view-viewer {
  position: fixed;
  inset: 0;
  z-index: 2400;
  display: flex;
  flex-direction: column;
  background: rgba(var(--v-theme-scrim), 0.85);
}

.mb-view-viewer__bar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  margin-bottom: 12px;
  padding: 4px 16px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.mb-view-viewer__name {
  flex: 1;
  min-width: 80px;
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-view-viewer__close {
  display: inline-flex;
  flex: none;
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

.mb-view-viewer__body {
  display: flex;
  flex: 1;
  justify-content: center;
  min-height: 0;
  padding: 0 24px 32px;
  overflow-y: auto;
}

.mb-view-viewer__sheet {
  width: 100%;
  max-width: 960px;
  height: max-content;
  padding: 24px;
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
}

@media (max-width: 600px) {
  .mb-view-viewer__body {
    padding: 0 8px 16px;
  }

  .mb-view-viewer__sheet {
    padding: 16px;
  }
}
</style>
