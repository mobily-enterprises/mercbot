<script setup>
import { computed, ref } from "vue";
import MercbotAvatar from "./MercbotAvatar.vue";
import { renderRichText } from "./richText.js";

// A request between bots (D-46, O22), in the chat that asked: who was asked and how it stands, with the answer once
// it's back. The bot asked works on the brief alone, and its questions and cards come here; the person whose message
// asked it may cancel while it's open.
const props = defineProps({
  message: { type: Object, required: true },
  // Whom its OK is waiting for, when it isn't the person looking.
  waitingFor: { type: String, default: "" }
});
const emit = defineEmits(["cancel"]);

const STATUS = {
  queued: "Starting",
  working: "Working",
  question: "Has a question",
  done: "Done",
  failed: "Couldn't finish",
  cancelled: "Cancelled"
};
const body = computed(() => props.message.body);
const open = computed(() => ["queued", "working", "question", "waiting_approval"].includes(body.value.status));
const title = computed(() => `${body.value.kind === "pass" ? "Passed to" : "Asked"} ${body.value.other?.name}`);
const statusText = computed(() => {
  if (body.value.status !== "waiting_approval") return STATUS[body.value.status] || body.value.status;
  return props.waitingFor ? "Waiting for an OK" : "Waiting for your OK";
});
// What the person can do or should know right now.
const hint = computed(() => {
  if (body.value.status === "waiting_approval") return props.waitingFor ? `Waiting for ${props.waitingFor}'s OK` : "Waiting for your OK below";
  if (body.value.status === "question") return `${body.value.other?.name} asks: ${body.value.question}`;
  return "";
});
const expanded = ref(false);
const answerOpen = ref(false);
const answer = computed(() => (body.value.answer ? renderRichText(body.value.answer) : ""));
</script>

<template>
  <section class="mb-request" :aria-label="title">
    <div class="mb-request__head">
      <MercbotAvatar v-if="body.other" :bot="body.other" :size="22" still />
      <span class="mb-request__title">{{ title }}</span>
      <span class="mb-request__status" :class="`mb-request__status--${body.status}`">{{ statusText }}</span>
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
    <div v-if="open && !waitingFor" class="mb-request__actions">
      <button type="button" class="mb-request__button" @click="emit('cancel', body.requestId)">Cancel</button>
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

.mb-request__button:focus-visible,
.mb-request__brief:focus-visible {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}
</style>
