<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MercbotVncScreen from "./MercbotVncScreen.vue";
import { refusedWork } from "./accountApi.js";
import { botsApi } from "./botsApi.js";
import { computerApi, useComputerStream } from "./computerApi.js";

// Live view of a bot's whole desktop, with taking control (D-13).
const props = defineProps({
  bot: { type: Object, required: true },
  startInControl: { type: Boolean, default: false },
  handover: { type: Boolean, default: false },
  teach: { type: Boolean, default: false }
});
const emit = defineEmits(["close", "done", "taught", "failure"]);

const active = ref(true);
// Its computer, or in a group its own one for that group (D-46: bot.group).
const target = computed(() => (props.bot.group ? { id: props.bot.id, group: props.bot.group } : props.bot.id));
const { state } = useComputerStream(target, active);
const inControl = ref(props.startInControl);

// If the computer stops while the view is open (it slept, or its server went), wake it again. A wake the copy refused is
// counted (accountApi.js refusedWork).
watch(state, (current, previous) => {
  if (current === "asleep" && previous && previous !== "asleep") computerApi.wake(target.value).catch(refusedWork);
});
const connected = ref(false);

// Teach a task: a banner offers Start recording; while recording, a
// counting timer chip stops it and a red outline marks the screen. × removes the banner, and
// during a recording it throws the recording away. Recording stops by itself after 10 minutes.
const MAX_SECONDS = 600;
const teachState = ref(props.teach ? "ready" : "off");
const elapsed = ref(0);
let startedAt = 0;
let ticker = null;

async function startRecording() {
  teachState.value = "starting";
  try {
    await botsApi.teachStart(props.bot.id);
  } catch (error) {
    teachState.value = "ready";
    emit("failure", error);
    return;
  }
  teachState.value = "recording";
  startedAt = Date.now();
  elapsed.value = 0;
  ticker = setInterval(() => {
    elapsed.value = Math.floor((Date.now() - startedAt) / 1000);
    if (elapsed.value >= MAX_SECONDS) stopRecording();
  }, 250);
}

function stopRecording() {
  clearInterval(ticker);
  teachState.value = "off";
  emit("taught");
}

function dismissTeach() {
  if (teachState.value === "recording") {
    clearInterval(ticker);
    botsApi.teachStop(props.bot.id, true).catch(() => {});
  }
  teachState.value = "off";
}

const timer = computed(() => `${Math.floor(elapsed.value / 60)}:${String(elapsed.value % 60).padStart(2, "0")}`);

// Escape is the one key we keep: it hands control back (or closes when only watching).
function onKey(event) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  // While the screen isn't showing, there's nothing to hand back: Escape closes the view.
  if (inControl.value && !props.handover && connected.value) inControl.value = false;
  else emit("close");
}

onMounted(() => {
  computerApi.wake(target.value).catch(refusedWork);
  window.addEventListener("keydown", onKey, true);
});

onBeforeUnmount(() => {
  if (teachState.value === "recording") dismissTeach();
  active.value = false;
  window.removeEventListener("keydown", onKey, true);
});
</script>

<template>
  <v-theme-provider theme="dark" with-background class="mb-live" role="dialog" :aria-label="`${bot.name}'s computer`">
    <button type="button" class="mb-live__collapse" aria-label="Close the live view" @click="emit('close')">
      <v-icon icon="$collapseContent" size="18" />
    </button>

    <div v-if="teachState !== 'off'" class="mb-teach" role="region" aria-label="Teach a task">
      <span class="mb-teach__text">
        {{ teachState === "recording"
          ? `Recording. Go through the whole task, then press the timer to stop and hand it to ${bot.name}.`
          : `Show ${bot.name} a task once. The recording is only used to learn the steps, then deleted.` }}
      </span>
      <button
        v-if="teachState === 'recording'"
        type="button"
        class="mb-teach__timer"
        aria-label="Stop recording"
        @click="stopRecording"
      >
        <span class="mb-teach__stop" />{{ timer }}
      </button>
      <button
        v-else
        type="button"
        class="mb-teach__record"
        :disabled="!connected || teachState === 'starting'"
        @click="startRecording"
      >
        <v-icon icon="$radioOn" size="16" /> Start recording
      </button>
      <button
        type="button"
        class="mb-teach__close"
        :class="{ 'mb-teach__close--recording': teachState === 'recording' }"
        :aria-label="teachState === 'recording' ? 'Cancel the recording' : 'Close the teach banner'"
        @click="dismissTeach"
      >
        <v-icon icon="$close" size="16" />
      </button>
    </div>

    <div
      class="mb-live__stage"
      :class="{ 'mb-live__stage--control': inControl, 'mb-live__stage--recording': teachState === 'recording' }"
    >
      <MercbotVncScreen
        :bot-id="target"
        :awake="state === 'awake'"
        :control="inControl"
        @connected="connected = true"
        @disconnected="connected = false"
      />
    </div>

    <v-theme-provider theme="light" with-background class="mb-live__control">
      <template v-if="inControl">
        <v-icon icon="$arrowSelectorTool" size="16" />
        <span class="mb-live__label">You're driving</span>
        <button v-if="handover" type="button" class="mb-live__button mb-live__button--dark" @click="emit('done')">I'm done</button>
        <button v-else type="button" class="mb-live__button" @click="inControl = false">Stop</button>
      </template>
      <template v-else>
        <v-icon icon="$visibility" size="16" />
        <span class="mb-live__label">Watching</span>
        <button type="button" class="mb-live__button mb-live__button--dark" :disabled="!connected" @click="inControl = true">Take control</button>
      </template>
    </v-theme-provider>
  </v-theme-provider>
</template>

<style scoped>
.mb-live {
  position: fixed;
  inset: 0;
  z-index: 2400;
  background: rgb(var(--v-theme-surface));
}

.mb-live__collapse {
  position: absolute;
  top: 12px;
  right: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.mb-live__collapse:hover {
  background: rgba(var(--v-theme-on-surface), 0.1);
}

.mb-live__stage {
  position: absolute;
  inset: 52px 102px 60px;
  overflow: hidden;
  border-radius: 8px;
}

.mb-live__stage--control {
  outline: 2px solid rgb(var(--v-theme-link));
}

.mb-live__stage--recording {
  outline: 2px solid rgb(var(--v-theme-error));
}

.mb-teach {
  position: absolute;
  top: 6px;
  right: 102px;
  left: 102px;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 6px 0 14px;
  border-radius: 8px;
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-teach__text {
  flex: 1;
  overflow: hidden;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface));
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-teach__record,
.mb-teach__timer {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 14px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.mb-teach__record {
  background: rgb(var(--v-theme-error-container));
  color: rgb(var(--v-theme-on-error-container));
}

.mb-teach__record:disabled {
  opacity: 0.5;
  cursor: default;
}

.mb-teach__timer {
  background: rgba(var(--v-theme-error), 0.18);
  color: rgb(var(--v-theme-error));
  font-variant-numeric: tabular-nums;
}

.mb-teach__stop {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: rgb(var(--v-theme-error));
}

.mb-teach__close {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.mb-teach__close:hover {
  background: rgba(var(--v-theme-on-surface), 0.1);
}

.mb-teach__close--recording {
  color: rgb(var(--v-theme-error));
}

.mb-live__control {
  position: absolute;
  bottom: 35px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 4px 0 14px;
  border-radius: 18px;
  background: rgb(var(--v-theme-surface-container-lowest));
  box-shadow: 0 4px 12px rgba(var(--v-theme-shadow), 0.3);
  color: rgb(var(--v-theme-on-surface));
  transform: translateX(-50%) translateY(50%);
}

.mb-live__label {
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
  white-space: nowrap;
}

.mb-live__button {
  height: 28px;
  padding: 0 14px;
  border: 0;
  border-radius: 14px;
  background: rgb(var(--v-theme-surface-container-high));
  font: inherit;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
}

.mb-live__button--dark {
  background: rgb(var(--v-theme-inverse-surface));
  color: rgb(var(--v-theme-inverse-on-surface));
}

.mb-live__button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
