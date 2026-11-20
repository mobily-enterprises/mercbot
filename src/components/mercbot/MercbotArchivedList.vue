<script setup>
import { ref, watch } from "vue";
import { botsApi } from "./botsApi.js";
import { archivedLine } from "./archiveConversation.js";

// A Shared bot's archived conversations the person sees (D-101): its archived shared tabs and their own archived You
// only, each with who archived it and when, and Resume where they may. Read when it shows, and again when the bot's
// count of them changes (one archived or resumed anywhere). The tab strip's Archived (N) and Details → Conversations
// both show it.
const props = defineProps({
  botId: { type: String, required: true },
  count: { type: Number, default: 0 }
});
const emit = defineEmits(["resume"]);

const entries = ref([]);
const loaded = ref(false);
const failed = ref(false);

async function load() {
  // With none archived there's nothing to read.
  if (!props.count) {
    entries.value = [];
    loaded.value = true;
    return;
  }
  try {
    entries.value = (await botsApi.archived(props.botId)).conversations;
    failed.value = false;
  } catch {
    failed.value = true;
  } finally {
    loaded.value = true;
  }
}

watch(() => [props.botId, props.count], load, { immediate: true });
</script>

<template>
  <div class="mb-archived" role="list" aria-label="Archived conversations">
    <div v-if="!loaded" class="mb-archived__skeleton" aria-hidden="true" />
    <p v-else-if="failed" class="mb-archived__empty" role="alert">
      The archived conversations couldn't be read. Try again in a moment.
    </p>
    <p v-else-if="!entries.length" class="mb-archived__empty">
      Nothing archived. Right-click a tab, or press and hold it on a phone, to archive it.
    </p>
    <div v-for="entry in entries" :key="entry.id" class="mb-archived__row" role="listitem">
      <span class="mb-archived__text">
        <span class="mb-archived__title">
          <v-icon v-if="entry.own" icon="$lock" size="12" class="mb-archived__lock" />
          {{ entry.title }}
        </span>
        <span class="mb-archived__line">{{ archivedLine(entry) }}</span>
      </span>
      <button
        v-if="entry.canResume"
        type="button"
        class="mb-archived__resume"
        :aria-label="`Resume ${entry.title}`"
        @click="emit('resume', entry.id)"
      >
        Resume
      </button>
    </div>
  </div>
</template>

<style scoped>
.mb-archived {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mb-archived__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 10px;
}

.mb-archived__row:hover {
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-archived__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.mb-archived__title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  color: rgb(var(--v-theme-on-surface));
  font-size: 13px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-archived__lock {
  opacity: 0.8;
}

.mb-archived__line,
.mb-archived__empty {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
}

.mb-archived__empty {
  margin: 0;
  padding: 8px 10px;
}

.mb-archived__resume {
  flex: none;
  height: 28px;
  padding: 0 12px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 14px;
  background: transparent;
  color: rgb(var(--v-theme-primary));
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.mb-archived__resume:hover {
  background: rgb(var(--v-theme-surface-container-highest));
}

.mb-archived__resume:focus-visible {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 1px;
}

.mb-archived__skeleton {
  height: 44px;
  border-radius: 10px;
  background: rgb(var(--v-theme-surface-container-high));
}
</style>
