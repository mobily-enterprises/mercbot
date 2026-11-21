<script setup>
// A bot's card's Details: whether it's the home's main bot (the one that can't be archived, archiveBot.js), and for the
// home's owners and admins, Make <Bot> the main bot on any other bot still on the team (plan 5.1).
defineProps({
  bot: { type: Object, required: true },
  // Whether the person is one of the home's owners or admins.
  manages: { type: Boolean, default: false }
});
const emit = defineEmits(["make-main"]);
</script>

<template>
  <section v-if="bot.isMain || (manages && !bot.archivedAt)" class="mb-bot-main" aria-label="Main bot">
    <p class="mb-bot-main__label">Main bot</p>
    <p v-if="bot.isMain" class="mb-bot-main__text">{{ bot.name }} is this home's main bot.</p>
    <template v-else>
      <p class="mb-bot-main__text">A home has one main bot, and its owners and admins choose which.</p>
      <button type="button" class="mb-set-pill" @click="emit('make-main')">
        <v-icon icon="$star" size="16" /> Make {{ bot.name }} the main bot
      </button>
    </template>
  </section>
</template>

<style scoped>
.mb-bot-main {
  margin: 22px 0 0;
}

.mb-bot-main__label {
  margin: 0 0 8px;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-bot-main__text {
  margin: 0 0 10px;
  font-size: 14px;
  line-height: 22px;
}
</style>
