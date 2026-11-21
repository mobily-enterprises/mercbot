<script setup>
import { computed, inject, ref, watch } from "vue";
import MercbotAvatar from "./MercbotAvatar.vue";
import { botFace, computerLine, controlLine } from "./chatView.js";
import { computerApi } from "./computerApi.js";
import { MERCBOT_CHAT_KEY } from "./shellChat.js";
import { COMPUTER_GREY } from "@/theme/palettes.js";

// One bot's computer in a chat (D14, D16): "<Bot>'s computer", that it belongs to the chat and who can use it, what's
// signed in on it, and Watch, Take over and Hand back. While a person has it, its bot leaves it alone; another person
// waits until it's handed back. `news` changes when the server says the computer changed, and its status is read again.
const props = defineProps({
  chat: { type: Object, required: true },
  member: { type: Object, required: true },
  me: { type: String, default: "" },
  homeName: { type: String, default: "this home" },
  news: { type: Number, default: 0 }
});
const emit = defineEmits(["open-live", "failure"]);
/** @type {import("./shellChat.js").ShellChat} */
const shellChat = inject(MERCBOT_CHAT_KEY);

const bot = computed(() => botFace(props.member));
const target = computed(() => ({ id: String(props.member.botId), chat: String(props.chat.id) }));
const status = ref(null);
const failed = ref(false);
const handingBack = ref(false);

async function read() {
  try {
    status.value = await computerApi.status(target.value);
    failed.value = false;
  } catch (error) {
    failed.value = true;
    emit("failure", error);
  }
}
watch(() => [target.value.id, target.value.chat, props.news], read, { immediate: true });

const STATES = { asleep: "Asleep", awake: "Awake" };
const stateLine = computed(() => (status.value ? STATES[status.value.state] || "Starting up" : ""));
const control = computed(() => status.value?.control || null);
const mine = computed(() => Boolean(control.value) && String(control.value.userId) === String(props.me));
const someoneElse = computed(() => Boolean(control.value) && !mine.value);
const signIns = computed(() => status.value?.signIns || []);
const signInName = (signIn) => (signIn.kind === "coding" ? `${signIn.label} (coding)` : signIn.label);

function watchIt() {
  emit("open-live", { botId: target.value.id, chatId: target.value.chat, control: false });
}

function takeOver() {
  emit("open-live", { botId: target.value.id, chatId: target.value.chat, control: true });
}

async function handBack() {
  handingBack.value = true;
  try {
    const result = await computerApi.handBack(target.value);
    shellChat.appendMessages(target.value.chat, result.messages || []);
    await read();
  } catch (error) {
    shellChat.reportFailure("That didn't hand back. Try again.", error);
  } finally {
    handingBack.value = false;
  }
}
</script>

<template>
  <li class="mb-chat-computer" :aria-label="`${bot.name}'s computer`">
    <MercbotAvatar :bot="{ ...bot, color: COMPUTER_GREY }" :size="32" :state="status?.state === 'asleep' ? 'asleep' : 'idle'" still />
    <div class="mb-chat-computer__body">
      <p class="mb-chat-computer__name">{{ bot.name }}'s computer</p>
      <p class="mb-chat-computer__line">{{ computerLine(chat, homeName) }}</p>
      <p v-if="failed" class="mb-chat-computer__state">Its status didn't load.</p>
      <p v-else-if="status" class="mb-chat-computer__state">
        {{ stateLine }}<template v-if="control"> · {{ controlLine(control, me) }}</template>
      </p>
      <template v-if="status">
        <p class="mb-chat-computer__label">Signed in on it</p>
        <ul v-if="signIns.length" class="mb-chat-computer__signins">
          <li v-for="signIn in signIns" :key="`${signIn.kind}-${signIn.label}`">{{ signInName(signIn) }}</li>
        </ul>
        <p v-else class="mb-chat-computer__none">Nothing yet.</p>
      </template>
      <div class="mb-chat-computer__actions">
        <v-btn size="small" variant="tonal" prepend-icon="$visibility" @click="watchIt">Watch</v-btn>
        <v-btn v-if="mine" size="small" variant="flat" color="primary" :loading="handingBack" @click="handBack">Hand back</v-btn>
        <v-btn v-else size="small" variant="flat" color="primary" :disabled="someoneElse || !status" @click="takeOver">Take over</v-btn>
      </div>
      <p v-if="someoneElse" class="mb-chat-computer__wait">
        {{ controlLine(control, me) }} of {{ bot.name }}'s computer. Wait until they hand it back.
      </p>
    </div>
  </li>
</template>

<style scoped>
.mb-chat-computer {
  display: flex;
  gap: 12px;
  padding: 12px 0;
  border-top: 1px solid rgb(var(--v-theme-outline-variant));
}

.mb-chat-computer:first-child {
  border-top: 0;
}

.mb-chat-computer__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.mb-chat-computer__name {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.mb-chat-computer__line,
.mb-chat-computer__state,
.mb-chat-computer__none,
.mb-chat-computer__wait {
  margin: 0;
  font-size: 12px;
  line-height: 17px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-chat-computer__label {
  margin: 4px 0 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-chat-computer__signins {
  margin: 0;
  padding-left: 16px;
  font-size: 13px;
  line-height: 18px;
}

.mb-chat-computer__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
</style>
