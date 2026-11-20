<script setup>
import { computed, ref, watch } from "vue";
import { answerTeamQuestion, homeDefault, readHere, teamQuestionWords } from "./homeDefault.js";
import { homeChanges } from "./homesApi.js";

// The question a home's owners and admins see at the top of the bot list once its people go from one to two, while its
// new bots aren't Shared (D-100): make new bots Shared, or keep them as they are. Either answer is kept, so it shows
// once; bots already there keep their mode. The bot list's read brings it. An answer that didn't go through says so here.
const question = computed(() => homeDefault.value.teamQuestion);
const words = computed(() => (question.value ? teamQuestionWords(question.value) : null));
const busy = ref(false);
const problem = ref("");

// Someone joining is heard as the home's people changing: the default is read again, and the question shows at once.
watch(homeChanges, () => readHere().catch(() => {
  // The bot list's next read brings it.
}));

async function answer(choice) {
  if (busy.value) return;
  busy.value = true;
  problem.value = "";
  try {
    await answerTeamQuestion(choice);
  } catch (error) {
    problem.value = error?.message || "That answer didn't go through. Try again.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section v-if="words" class="mb-team-question" aria-label="New bots in this home">
    <p class="mb-team-question__text">{{ words.text }}</p>
    <p class="mb-team-question__note">{{ words.note }}</p>
    <p v-if="problem" class="mb-team-question__problem" role="alert">{{ problem }}</p>
    <div class="mb-team-question__actions">
      <button type="button" class="mb-set-pill mb-set-pill--dark" :disabled="busy" @click="answer('shared')">Make them Shared</button>
      <button type="button" class="mb-set-pill" :disabled="busy" @click="answer('keep')">{{ words.keep }}</button>
    </div>
  </section>
</template>

<style scoped>
.mb-team-question {
  margin: 0 12px 14px;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface-container-high));
  font-size: 13px;
  line-height: 1.4;
}

.mb-team-question__text {
  margin: 0;
  color: rgb(var(--v-theme-on-surface));
}

.mb-team-question__note {
  margin: 6px 0 0;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-team-question__problem {
  margin: 6px 0 0;
  font-size: 12px;
  color: rgb(var(--v-theme-error));
}

.mb-team-question__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.mb-team-question__actions .mb-set-pill {
  height: 28px;
  padding: 0 12px;
  font-size: 12px;
}
</style>
