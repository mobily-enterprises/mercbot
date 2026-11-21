<script setup>
import { computed, ref } from "vue";
import { builderBotId } from "./builderBot.js";
import { archiveBotQuestion, archiveRefusal, archivedBotLine } from "./archiveBot.js";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";

// A bot's Archive on its card's Details (D-108, plan 5.1): Archive for its maker and the home's owners and admins,
// asking first, or why it can't be (the main bot, the Builder, someone else's); once archived, who did it and when, and
// Resume.
const props = defineProps({
  bot: { type: Object, required: true }
});
const emit = defineEmits(["archive", "unarchive"]);

const refusal = computed(() => archiveRefusal(props.bot, builderBotId.value));
const asking = ref(false);
const question = computed(() => archiveBotQuestion(props.bot));
</script>

<template>
  <section class="mb-bot-archive" aria-label="Archive">
    <p class="mb-bot-archive__label">Archive</p>
    <template v-if="bot.archivedAt">
      <p class="mb-bot-archive__text">
        {{ archivedBotLine(bot) }}. It's under Archived on Team, and its chats are kept. Its routines and watches stay paused
        when it's resumed: switch them back on under Routines.
      </p>
      <button v-if="bot.canArchive" type="button" class="mb-set-pill" @click="emit('unarchive')">
        <v-icon icon="$unarchive" size="16" /> Resume {{ bot.name }}
      </button>
      <p v-else class="mb-bot-archive__text">The person who made {{ bot.name }} and the home's owners and admins can resume it.</p>
    </template>
    <template v-else>
      <p class="mb-bot-archive__text">
        Archiving {{ bot.name }} takes it off the team for everyone in this home. Its chats are kept, and it stays in them
        without answering.
      </p>
      <p v-if="refusal" class="mb-bot-archive__text mb-bot-archive__refusal">{{ refusal }}</p>
      <button v-else type="button" class="mb-set-pill" @click="asking = true">
        <v-icon icon="$archive" size="16" /> Archive {{ bot.name }}
      </button>
    </template>
    <MercbotConfirmDialog
      v-model="asking"
      :title="question.title"
      :text="question.text"
      :confirm-label="question.confirmLabel"
      :danger="false"
      @confirm="emit('archive')"
    />
  </section>
</template>

<style scoped>
.mb-bot-archive {
  margin: 22px 0 0;
}

.mb-bot-archive__label {
  margin: 0 0 8px;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-bot-archive__text {
  margin: 0 0 10px;
  font-size: 14px;
  line-height: 22px;
}

.mb-bot-archive__refusal {
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
