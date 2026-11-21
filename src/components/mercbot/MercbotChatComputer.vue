<script setup>
import { computed, ref } from "vue";
import MercbotAvatar from "./MercbotAvatar.vue";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import { botFace, computerLine, controlLine } from "./chatView.js";
import { COMPUTER_GREY } from "@/theme/palettes.js";

// One bot's computer in a chat (D14, D16), as MercbotChatComputers reads it: "<Bot>'s computer", that it belongs to the
// chat and who can use it, what's signed in on it, and Watch, Take over and Hand back. While a person has it, its bot
// leaves it alone; another person waits until it's handed back. `status` is computerApi.status's answer, null until it
// comes. Reset, for whoever may (`canReset`), asks first and starts this computer afresh.
const props = defineProps({
  chat: { type: Object, required: true },
  member: { type: Object, required: true },
  me: { type: String, default: "" },
  homeName: { type: String, default: "this home" },
  status: { type: Object, default: null },
  failed: { type: Boolean, default: false },
  handingBack: { type: Boolean, default: false },
  canReset: { type: Boolean, default: false },
  resetting: { type: Boolean, default: false }
});
const emit = defineEmits(["open-live", "hand-back", "reset"]);
const askingReset = ref(false);

const bot = computed(() => botFace(props.member));
const where = computed(() => ({ botId: String(props.member.botId), chatId: String(props.chat.id) }));

const STATES = { asleep: "Asleep", awake: "Awake" };
const stateLine = computed(() => (props.status ? STATES[props.status.state] || "Starting up" : ""));
const control = computed(() => props.status?.control || null);
const mine = computed(() => Boolean(control.value) && String(control.value.userId) === String(props.me));
const someoneElse = computed(() => Boolean(control.value) && !mine.value);
const signIns = computed(() => props.status?.signIns || []);
const signInName = (signIn) => (signIn.kind === "coding" ? `${signIn.label} (coding)` : signIn.label);
</script>

<template>
  <li class="mb-chat-computer" :aria-label="`${bot.name}'s computer`">
    <MercbotAvatar :bot="{ ...bot, color: COMPUTER_GREY }" :size="32" :state="status?.state === 'asleep' ? 'asleep' : 'idle'" still />
    <div class="mb-chat-computer__body">
      <p class="mb-chat-computer__name">{{ bot.name }}'s computer</p>
      <p class="mb-chat-computer__line">{{ computerLine(chat, homeName) }}</p>
      <p v-if="failed" class="mb-chat-computer__state">Its status didn't load.</p>
      <p v-else-if="!status" class="mb-chat-computer__state">Loading…</p>
      <p v-else class="mb-chat-computer__state">
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
        <v-btn size="small" variant="tonal" prepend-icon="$visibility" @click="emit('open-live', { ...where, control: false })">Watch</v-btn>
        <v-btn v-if="mine" size="small" variant="flat" color="primary" :loading="handingBack" @click="emit('hand-back', where)">Hand back</v-btn>
        <v-btn
          v-else
          size="small"
          variant="flat"
          color="primary"
          :disabled="someoneElse || !status"
          @click="emit('open-live', { ...where, control: true })"
        >
          Take over
        </v-btn>
        <v-btn
          v-if="canReset"
          size="small"
          variant="text"
          :disabled="someoneElse || !status"
          :loading="resetting"
          @click="askingReset = true"
        >
          Reset
        </v-btn>
      </div>
      <p v-if="someoneElse" class="mb-chat-computer__wait">
        {{ controlLine(control, me) }} of {{ bot.name }}'s computer. Wait until they hand it back.
      </p>
    </div>
    <MercbotConfirmDialog
      v-model="askingReset"
      :title="`Reset ${bot.name}'s computer?`"
      text="Its browser closes, and what's signed in on it and its website data are cleared. This chat and its files stay."
      confirm-label="Reset"
      @confirm="emit('reset', where)"
    />
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
