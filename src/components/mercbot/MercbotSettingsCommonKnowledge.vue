<script setup>
import { computed, onMounted } from "vue";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import MercbotIconButton from "./MercbotIconButton.vue";
import { entryLine, useCommonKnowledge } from "./useCommonKnowledge.js";
import { madeLine } from "./useRoomsMemory.js";

// Settings → Bots' common knowledge (D-113, D-119): the home's, not a bot's. What people asked a bot to tell every
// bot, which every bot reads in every chat; newest first, a page at a time, each with who asked, through which bot and
// when. Its author and the home's owners and admins remove one. Each bot's card links here.
const emit = defineEmits(["failure", "notify"]);

const { entries, next, loaded, loadFailed, removing, loadingMore, load, loadMore, confirmRemove } = useCommonKnowledge({
  onFailure: (error) => emit("failure", error)
});
onMounted(load);
const removeOpen = computed({ get: () => Boolean(removing.value), set: (value) => { if (!value) removing.value = null; } });
</script>

<template>
  <section aria-label="Bots' common knowledge">
    <p class="mb-set-group">Every bot in this home reads it in every chat.</p>
    <div v-if="!loaded && !loadFailed" class="mb-common__skeleton" aria-label="Loading common knowledge" />
    <p v-else-if="loadFailed" class="mb-common__note" role="alert">
      The home's common knowledge couldn't be loaded.
      <button type="button" class="mb-common__link" @click="load">Try again</button>
    </p>
    <template v-else>
      <ul v-if="entries.length" class="mb-set-card mb-common__list" aria-label="Common knowledge">
        <li v-for="entry in entries" :key="entry.id" class="mb-set-row" :data-entry="entry.text">
          <span class="mb-set-row__text">
            <span class="mb-set-row__label mb-common__text">{{ entry.text }}</span>
            <span class="mb-set-row__description">{{ entryLine(entry) }} · {{ madeLine(entry.createdAt) }}</span>
          </span>
          <MercbotIconButton
            v-if="entry.canRemove"
            icon="$delete"
            :label="`Remove from common knowledge: ${entry.text}`"
            size="x-small"
            :icon-size="16"
            @click="removing = entry"
          />
        </li>
      </ul>
      <p v-else class="mb-common__note">No common knowledge yet. Ask a bot to tell every bot something, such as a date or an allergy; it asks you first.</p>
      <button v-if="next" type="button" class="mb-common__link" :disabled="loadingMore" @click="loadMore">Show older</button>
    </template>

    <MercbotConfirmDialog
      v-model="removeOpen"
      title="Remove from common knowledge?"
      :text="`Every bot stops reading it from its next reply: “${removing?.text || ''}”`"
      confirm-label="Remove"
      @confirm="confirmRemove"
    />
  </section>
</template>

<style scoped>
.mb-common__list {
  margin-top: 0;
  padding: 0;
  list-style: none;
}

.mb-common__text {
  overflow-wrap: anywhere;
}

.mb-common__note {
  max-width: 636px;
  margin: 0 0 12px;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-common__skeleton {
  max-width: 636px;
  height: 58px;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-common__link {
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
}

.mb-common__link:disabled {
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: default;
}
</style>
