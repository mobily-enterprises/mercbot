<script setup>
import { computed, ref } from "vue";
import MercbotVncScreen from "./MercbotVncScreen.vue";
import { screenshotUrl, useComputerStream } from "./computerApi.js";

// "Your turn" card when a bot needs the person on its computer, which belongs to this chat (D14, D16): it names that
// bot's computer. Only the person it asked settles it (D-46); anyone who can open the chat may take the computer over.
const props = defineProps({
  // The bot whose computer it is, the card's author: { id, name }.
  bot: { type: Object, required: true },
  chatId: { type: String, required: true },
  message: { type: Object, required: true },
  me: { type: String, default: "" }
});
const emit = defineEmits(["take-over", "settle"]);

const pending = computed(() => props.message.body.status === "pending");
const target = computed(() => ({ id: String(props.bot.id), chat: props.chatId }));
const mine = computed(() => !props.message.body.for || String(props.message.body.for.id) === props.me);
const { state } = useComputerStream(target, pending);
const expanded = ref(false);
const computerName = computed(() => `${props.bot.name}'s computer`);
const image = computed(() => (props.message.body.screenshot ? screenshotUrl(String(props.bot.id), props.message.body.screenshot, props.chatId) : ""));
const summary = computed(() => `${props.message.body.status === "skipped" ? "Skipped" : "Done"} · ${props.message.body.task}`);
</script>

<template>
  <section v-if="pending || expanded" class="mb-handover">
    <div class="mb-handover__body">
      <p class="mb-handover__label"><v-icon icon="$laptop" size="14" /> {{ computerName }}</p>
      <p class="mb-handover__title">{{ pending ? (mine ? "Your turn" : `${message.body.for.name}'s turn`) : summary }}</p>
      <p class="mb-handover__task">{{ message.body.task }}, then hand the screen back.</p>
    </div>
    <div class="mb-handover__screen">
      <MercbotVncScreen v-if="pending && state === 'awake'" :bot-id="target" awake />
      <img v-else-if="image" :src="image" alt="">
    </div>
    <div v-if="pending" class="mb-handover__actions">
      <p v-if="!mine" class="mb-handover__waiting">Waiting for {{ message.body.for.name }}</p>
      <template v-else>
        <button type="button" class="mb-handover__button" @click="emit('settle', 'skipped')">Skip</button>
        <button type="button" class="mb-handover__button" @click="emit('settle', 'done')">I'm done</button>
      </template>
      <button type="button" class="mb-handover__button mb-handover__button--dark" @click="emit('take-over')">Take over</button>
    </div>
    <button v-else type="button" class="mb-handover__collapse" aria-label="Collapse" @click="expanded = false">
      <v-icon icon="$collapse" size="16" />
    </button>
  </section>
  <button v-else type="button" class="mb-handover-row" @click="expanded = true">
    <v-icon icon="$laptop" size="14" />
    <span class="mb-handover-row__label">{{ computerName }}</span>
    <span class="mb-handover-row__summary">{{ summary }}</span>
    <v-icon icon="$expand" size="16" />
  </button>
</template>

<style scoped>
.mb-handover {
  position: relative;
  max-width: 486px;
  overflow: hidden;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 16px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.mb-handover__body {
  padding: 14px 16px 12px;
}

.mb-handover__label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-handover__title {
  margin: 6px 0 2px;
  font-size: 16px;
  font-weight: 700;
}

.mb-handover__task {
  margin: 0;
  font-size: 14px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-handover__screen {
  height: 300px;
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-handover__screen img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top;
}

/* Someone else's turn: who it waits for, on the left of Take over. */
.mb-handover__waiting {
  flex: 1;
  align-self: center;
  margin: 0;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-handover__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
}

.mb-handover__button {
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 15px;
  background: rgb(var(--v-theme-surface-container-high));
  font: inherit;
  font-size: 13px;
  color: inherit;
  cursor: pointer;
}

.mb-handover__button--dark {
  background: rgb(var(--v-theme-inverse-surface));
  color: rgb(var(--v-theme-inverse-on-surface));
}

.mb-handover__collapse {
  position: absolute;
  top: 10px;
  right: 10px;
  border: 0;
  background: none;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.mb-handover-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  max-width: 486px;
  height: 40px;
  padding: 0 14px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  font: inherit;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface));
  text-align: left;
  cursor: pointer;
}

.mb-handover-row__label {
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-handover-row__summary {
  flex: 1;
  overflow: hidden;
  color: rgb(var(--v-theme-on-surface-variant));
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
