<script setup>
import { computed, ref } from "vue";
import MercbotAvatar from "./MercbotAvatar.vue";
import { renderRichText } from "./richText.js";

// A request between bots (D-46), the same card in both chats: in the asking bot's, who it asked
// and how it stands, with the answer once it's back; in the asked bot's, who asked and for whom.
// Either side opens the other chat, and the person can cancel while it's open.
const props = defineProps({
  message: { type: Object, required: true }
});
const emit = defineEmits(["open-bot", "cancel"]);

const STATUS = {
  queued: "Starting",
  working: "Working",
  question: "Has a question",
  waiting_approval: "Waiting for your OK",
  done: "Done",
  failed: "Couldn't finish",
  cancelled: "Cancelled"
};
const body = computed(() => props.message.body);
const asker = computed(() => body.value.side === "asker");
const open = computed(() => ["queued", "working", "question", "waiting_approval"].includes(body.value.status));
const pass = computed(() => body.value.kind === "pass");
const title = computed(() => {
  const name = body.value.other?.name;
  if (asker.value) return pass.value ? `Passed to ${name}` : `Asked ${name}`;
  return pass.value ? `Passed on by ${name}` : `From ${name}, for ${body.value.person}`;
});
// What the person can do or should know right now.
const hint = computed(() => {
  const name = body.value.other?.name;
  if (body.value.status === "waiting_approval") return asker.value ? `Waiting for your OK in ${name}'s chat` : "Waiting for your OK below";
  if (body.value.status === "question") return asker.value ? `${name} asks: ${body.value.question}` : `Asked ${name}: ${body.value.question}`;
  return "";
});
const expanded = ref(false);
const answerOpen = ref(false);
const answer = computed(() => (asker.value && body.value.answer ? renderRichText(body.value.answer) : ""));
</script>

<template>
  <section class="mb-request" :aria-label="title">
    <div class="mb-request__head">
      <MercbotAvatar v-if="body.other" :bot="body.other" :size="22" still />
      <span class="mb-request__title">{{ title }}</span>
      <span class="mb-request__status" :class="`mb-request__status--${body.status}`">{{ STATUS[body.status] || body.status }}</span>
    </div>
    <button type="button" class="mb-request__brief" :class="{ 'mb-request__brief--open': expanded }" :aria-expanded="expanded" @click="expanded = !expanded">
      {{ body.brief }}
    </button>
    <p v-if="hint" class="mb-request__hint">{{ hint }}</p>
    <!-- eslint-disable-next-line vue/no-v-html -- markdown-it escapes raw HTML (html: false) -->
    <div v-if="answer" class="mb-request__answer mb-rich" :class="{ 'mb-request__answer--open': answerOpen }" v-html="answer" />
    <button v-if="answer" type="button" class="mb-request__more" :aria-expanded="answerOpen" @click="answerOpen = !answerOpen">
      {{ answerOpen ? "Show less" : "Show the whole answer" }}
    </button>
    <div class="mb-request__actions">
      <button v-if="open" type="button" class="mb-request__button" @click="emit('cancel', body.requestId)">Cancel</button>
      <button type="button" class="mb-request__button mb-request__button--dark" @click="emit('open-bot', body.other?.id)">
        Open {{ body.other?.name }}'s chat <v-icon icon="$arrowForward" size="14" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.mb-request {
  max-width: 486px;
  padding: 12px 14px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 16px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.mb-request__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mb-request__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-request__status {
  flex: none;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgb(var(--v-theme-surface-container-high));
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-request__status--working,
.mb-request__status--queued {
  background: rgba(var(--v-theme-info), 0.12);
  color: rgb(var(--v-theme-info));
}

.mb-request__status--question,
.mb-request__status--waiting_approval {
  background: rgba(var(--v-theme-warning), 0.15);
  color: rgb(var(--v-theme-warning));
}

.mb-request__status--done {
  background: rgba(var(--v-theme-success), 0.14);
  color: rgb(var(--v-theme-success));
}

.mb-request__status--failed {
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
}

.mb-request__brief {
  display: -webkit-box;
  width: 100%;
  margin: 8px 0 0;
  padding: 0;
  overflow: hidden;
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  font: inherit;
  font-size: 14px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.mb-request__brief--open {
  display: block;
}

.mb-request__hint {
  margin: 8px 0 0;
  font-size: 13px;
  color: rgb(var(--v-theme-warning));
}

.mb-request__answer {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgb(var(--v-theme-outline-variant));
  font-size: 14px;
}

.mb-request__answer:not(.mb-request__answer--open) {
  max-height: 84px;
  overflow: hidden;
  mask-image: linear-gradient(to bottom, black 55%, transparent);
}

.mb-request__more {
  margin-top: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  font: inherit;
  font-size: 13px;
  text-decoration: underline;
  cursor: pointer;
}

.mb-request__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.mb-request__button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 15px;
  background: rgb(var(--v-theme-surface-container-high));
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.mb-request__button--dark {
  background: rgb(var(--v-theme-on-surface));
  color: rgb(var(--v-theme-surface));
}

.mb-request__button:focus-visible,
.mb-request__brief:focus-visible {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}
</style>
