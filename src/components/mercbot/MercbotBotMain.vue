<script setup>
import { computed } from "vue";
import { builderBotId } from "./builderBot.js";

// A bot's card's Details: a chip when it's the home's main bot (the one that can't be archived, archiveBot.js) or its
// Builder (D-35), and, for the home's owners and admins, a link to Settings → Main bot and Builder, where they choose
// (D-119).
const props = defineProps({
  bot: { type: Object, required: true },
  // Whether the person is one of the home's owners or admins.
  manages: { type: Boolean, default: false }
});
const emit = defineEmits(["open-settings"]);

const isBuilder = computed(() => builderBotId.value != null && String(builderBotId.value) === String(props.bot.id));
const changes = computed(() => props.manages && !props.bot.archivedAt);
</script>

<template>
  <section v-if="bot.isMain || isBuilder || changes" class="mb-bot-main" aria-label="Main bot and Builder">
    <span v-if="bot.isMain" class="mb-bot-main__chip" data-chip="main"><v-icon icon="$star" size="14" /> Main bot</span>
    <span v-if="isBuilder" class="mb-bot-main__chip" data-chip="builder"><v-icon icon="$deployedCode" size="14" /> Builder</span>
    <button v-if="changes" type="button" class="mb-bot-main__link" @click="emit('open-settings', 'main-bot')">
      {{ bot.isMain || isBuilder ? "Change in Settings →" : "Main bot and Builder in Settings →" }}
    </button>
  </section>
</template>

<style scoped>
.mb-bot-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 18px 0 0;
}

.mb-bot-main__chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 10px;
  border-radius: 8px;
  background: rgb(var(--v-theme-secondary-container));
  font-size: 12px;
  color: rgb(var(--v-theme-on-secondary-container));
}

.mb-bot-main__link {
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
}
</style>
