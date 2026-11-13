<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import { watchElementVisible } from "@/browser.js";
import ViewSurface from "./ViewSurface.vue";

// A view in the chat (D-55): the top of it, live, once it has scrolled into sight. Clicking opens it.
const props = defineProps({ message: { type: Object, required: true } });
const emit = defineEmits(["open"]);
const card = ref(null);
const seen = ref(false);
const visible = ref(false);
const missing = ref(false);
const title = ref(props.message.body.title);
const summary = ref(props.message.body.summary);

let stopWatching = () => {};
onMounted(() => {
  stopWatching = watchElementVisible(card.value, (now) => {
    visible.value = now;
    if (now) seen.value = true;
  });
});
onBeforeUnmount(() => stopWatching());

function loaded({ app, version }) {
  title.value = app.name;
  summary.value = version?.summary || summary.value;
}
</script>

<template>
  <button
    ref="card"
    type="button"
    class="mb-view-card"
    :aria-label="`Open view ${title}`"
    @click="emit('open', { path: message.body.path, title })"
  >
    <span class="mb-view-card__head">
      <v-icon icon="$dashboard" size="18" />
      <span class="mb-view-card__title">{{ title }}</span>
    </span>
    <span v-if="summary" class="mb-view-card__summary">{{ summary }}</span>
    <span v-if="missing" class="mb-view-card__summary">This view was retired.</span>
    <span v-else class="mb-view-card__preview" aria-hidden="true">
      <ViewSurface :slug="message.body.path" :shown="seen" :visible="visible" @loaded="loaded" @missing="missing = true" />
    </span>
  </button>
</template>

<style scoped>
.mb-view-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  max-width: 480px;
  padding: 12px 16px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 16px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.mb-view-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mb-view-card__title {
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-view-card__summary {
  font-size: 13px;
  opacity: 0.7;
}

/* Only a look: it's cut off with a fade, and the whole card opens the view. */
.mb-view-card__preview {
  display: block;
  max-height: 220px;
  margin-top: 8px;
  overflow: hidden;
  pointer-events: none;
  mask-image: linear-gradient(to bottom, black 70%, transparent);
}
</style>
