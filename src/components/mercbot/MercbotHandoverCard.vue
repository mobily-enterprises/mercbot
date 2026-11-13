<script setup>
import { computed, ref } from "vue";
import MercbotVncScreen from "./MercbotVncScreen.vue";
import { screenshotUrl, useComputerStream } from "./computerApi.js";

// "Your turn" card when the bot needs the person on its computer.
const props = defineProps({
  bot: { type: Object, required: true },
  message: { type: Object, required: true },
  // In a group the card belongs to the bot that made it, on its computer for the group, and only
  // the person it asked settles it (D-46).
  me: { type: String, default: "" }
});
const emit = defineEmits(["take-over", "settle"]);

const pending = computed(() => props.message.body.status === "pending");
const speakerId = computed(() => (props.bot.kind === "group" && props.message.body.speaker ? String(props.message.body.speaker.id) : null));
const target = computed(() => (speakerId.value === null ? props.bot.id : { id: speakerId.value, group: String(props.bot.id) }));
const mine = computed(() => !props.message.body.for || String(props.message.body.for.id) === props.me);
const { state } = useComputerStream(target, pending);
const expanded = ref(false);
const image = computed(() => {
  if (!props.message.body.screenshot) return "";
  return speakerId.value === null
    ? screenshotUrl(props.bot.id, props.message.body.screenshot, null)
    : screenshotUrl(speakerId.value, props.message.body.screenshot, String(props.bot.id) || null);
});
const summary = computed(() => `${props.message.body.status === "skipped" ? "Skipped" : "Done"} · ${props.message.body.task}`);
</script>

<template>
  <section v-if="pending || expanded" class="mb-handover">
    <div class="mb-handover__body">
      <p class="mb-handover__label"><v-icon icon="$laptop" size="14" /> Computer</p>
      <p class="mb-handover__title">{{ pending ? "Your turn" : summary }}</p>
      <p class="mb-handover__task">{{ message.body.task }}, then hand the screen back.</p>
    </div>
    <div class="mb-handover__screen">
      <MercbotVncScreen v-if="pending && state === 'awake'" :bot-id="target" awake />
      <img v-else-if="image" :src="image" alt="">
    </div>
    <p v-if="pending && !mine" class="mb-handover__waiting">Waiting for {{ message.body.for.name }}</p>
    <div v-else-if="pending" class="mb-handover__actions">
      <button type="button" class="mb-handover__button" @click="emit('settle', 'skipped')">Skip</button>
      <button type="button" class="mb-handover__button" @click="emit('settle', 'done')">I'm done</button>
      <button type="button" class="mb-handover__button mb-handover__button--dark" @click="emit('take-over')">Take over</button>
    </div>
    <button v-else type="button" class="mb-handover__collapse" aria-label="Collapse" @click="expanded = false">
      <v-icon icon="$collapse" size="16" />
    </button>
  </section>
  <button v-else type="button" class="mb-handover-row" @click="expanded = true">
    <v-icon icon="$laptop" size="14" />
    <span class="mb-handover-row__label">Computer</span>
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

.mb-handover__waiting {
  margin: 0;
  padding: 12px 16px;
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
