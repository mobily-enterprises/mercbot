<script setup>
import { computed } from "vue";
import { archivedBotLine } from "./archiveBot.js";

// In place of the composer while the open bot is archived (D-108): its chats are read, never written to. Who archived it
// and when, what that means, and Unarchive for whoever may (its maker and the home's owners and admins).
const props = defineProps({
  bot: { type: Object, required: true }
});
const emit = defineEmits(["unarchive"]);

const line = computed(() => archivedBotLine(props.bot));
const hint = computed(() => (props.bot.canArchive
  ? "Its chats are read-only, and its routines and watches are paused. Unarchive it to talk to it again."
  : `Its chats are read-only. The person who made ${props.bot.name} and the home's owners and admins can unarchive it.`));
</script>

<template>
  <div class="mb-archived-bot" role="status" aria-label="Archived">
    <v-icon icon="$archive" size="20" class="mb-archived-bot__icon" />
    <span class="mb-archived-bot__text">
      <span class="mb-archived-bot__title">{{ line }}</span>
      <span class="mb-archived-bot__hint">{{ hint }}</span>
    </span>
    <button v-if="bot.canArchive" type="button" class="mb-set-pill mb-archived-bot__unarchive" @click="emit('unarchive')">
      <v-icon icon="$unarchive" size="16" /> Unarchive
    </button>
  </div>
</template>

<style scoped>
.mb-archived-bot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 24px;
  background: rgb(var(--v-theme-surface-container));
  color: rgb(var(--v-theme-on-surface));
}

.mb-archived-bot__icon {
  flex: none;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-archived-bot__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.mb-archived-bot__title {
  font-size: 14px;
  line-height: 20px;
}

.mb-archived-bot__hint {
  font-size: 13px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
}

@media (max-width: 599px) {
  .mb-archived-bot {
    flex-wrap: wrap;
  }

  .mb-archived-bot__unarchive {
    margin-left: 32px;
  }
}
</style>
