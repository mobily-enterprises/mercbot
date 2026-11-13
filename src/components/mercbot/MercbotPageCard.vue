<script setup>
import { computed } from "vue";
import { PAPER } from "@/theme/palettes.js";
import { isHtmlPage } from "./filesApi.js";
import MercbotPageFrame from "./MercbotPageFrame.vue";

// A page in the chat (D-74): a live look at the page's top, sealed and fading out, which
// can't be clicked into, and a footer with its title. The whole card opens the page's viewer. An
// old Markdown page shows its summary instead. A page deleted from the Library keeps its
// card, marked Deleted, which no longer opens.
const props = defineProps({
  botId: { type: String, required: true },
  page: { type: Object, required: true }
});
const emit = defineEmits(["open"]);
const html = computed(() => isHtmlPage(props.page.path));
</script>

<template>
  <div class="mb-page-card" :class="{ 'mb-page-card--removed': page.removed }">
    <v-theme-provider theme="light" class="mb-page-card__preview" :style="{ background: PAPER }" aria-hidden="true">
      <MercbotPageFrame v-if="html && !page.removed" :bot-id="botId" :path="page.path" preview />
      <p v-else class="mb-page-card__summary">{{ page.summary || page.title }}</p>
    </v-theme-provider>
    <div class="mb-page-card__footer">
      <span class="mb-page-card__icon"><v-icon icon="$book2" size="18" /></span>
      <span class="mb-page-card__title">{{ page.title }}</span>
      <span class="mb-page-card__kind">{{ page.removed ? "Deleted" : "Page" }}</span>
    </div>
    <button
      type="button"
      class="mb-page-card__open"
      :disabled="page.removed"
      :aria-label="page.removed ? `Page ${page.title}, deleted` : `Open page ${page.title}`"
      @click="emit('open')"
    />
  </div>
</template>

<style scoped>
.mb-page-card {
  position: relative;
  width: 300px;
  max-width: 100%;
  overflow: hidden;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 14px;
  background: rgb(var(--v-theme-surface));
}

.mb-page-card:hover:not(.mb-page-card--removed) {
  border-color: rgb(var(--v-theme-outline));
}

.mb-page-card--removed {
  opacity: 0.6;
}

.mb-page-card__preview {
  display: block;
  height: 160px;
  overflow: hidden;
  pointer-events: none;
  mask-image: linear-gradient(to bottom, black 60%, transparent);
}

.mb-page-card__summary {
  margin: 0;
  padding: 16px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 13px;
  line-height: 18px;
}

.mb-page-card__footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid rgb(var(--v-theme-outline-variant));
}

.mb-page-card__icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(var(--v-theme-link), 0.12);
  color: rgb(var(--v-theme-link));
}

.mb-page-card__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-page-card__kind {
  flex: none;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
}

/* The card opens the page; the page under it is only a look. */
.mb-page-card__open {
  position: absolute;
  inset: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.mb-page-card__open:disabled {
  cursor: default;
}

.mb-page-card__open:focus-visible {
  outline: 2px solid rgb(var(--v-theme-link));
  outline-offset: -2px;
  border-radius: 14px;
}
</style>
