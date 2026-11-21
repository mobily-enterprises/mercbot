<script setup>
import { computed } from "vue";
import { archivedBotLine } from "./archiveBot.js";

// In place of the composer in a direct chat with a bot that has left the home (D-108, plan 5.1): it no longer answers.
// That it has left, who archived it and when, and Resume for whoever may (its maker and the home's owners and admins).
const props = defineProps({
  bot: { type: Object, required: true },
  homeName: { type: String, default: "" }
});
const emit = defineEmits(["unarchive"]);

const title = computed(() => `${props.bot.name} has left ${props.homeName || "this home"}`);
const hint = computed(() => (props.bot.canArchive
  ? `${archivedBotLine(props.bot)}. Resume it to talk again.`
  : `${archivedBotLine(props.bot)}. The person who made ${props.bot.name} and the home's owners and admins can resume it.`));
</script>

<template>
  <div class="mb-archived-bot" role="status" aria-label="Left the home">
    <v-icon icon="$archive" size="20" class="mb-archived-bot__icon" />
    <span class="mb-archived-bot__text">
      <span class="mb-archived-bot__title">{{ title }}</span>
      <span class="mb-archived-bot__hint">{{ hint }}</span>
    </span>
    <button v-if="bot.canArchive" type="button" class="mb-set-pill mb-archived-bot__unarchive" :aria-label="`Resume ${bot.name}`" @click="emit('unarchive')">
      <v-icon icon="$unarchive" size="16" /> Resume
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
