<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MercbotAvatar from "./MercbotAvatar.vue";
import MercbotTooltip from "./MercbotTooltip.vue";
import { currentLanguage, shellPreferences } from "./shellPreferences.js";
import { UNSUPPORTED, checkMicrophone, listen, microphoneProblem, speak, voiceSupported, voicesFor } from "./voice.js";
import { pageSpeechSynthesis } from "@/browser.js";

// A voice conversation: a call bar under the
// header chip. It connects (checking the microphone), then takes turns: listening until you
// stop speaking, sending what you said as an ordinary message, thinking while the bot replies,
// then reading the reply aloud and listening again. Tap the avatar while it speaks to interrupt.
// Captions show the words; mute pauses listening; the gear picks the voice and its speed.
const props = defineProps({
  bot: { type: Object, required: true },
  messages: { type: Array, required: true }
});
const emit = defineEmits(["say", "failed", "ended"]);

const phase = ref("connecting");
const muted = ref(false);
const captionsOn = ref(false);
const caption = ref("");
const startedAt = Date.now();
let session = null;
let speech = null;
let awaitingAfter = null;
let ended = false;

const lang = currentLanguage();
const voices = ref([]);
const synthesis = pageSpeechSynthesis();
function refreshVoices() {
  voices.value = voicesFor(lang);
}
const RATES = [0.8, 1, 1.25, 1.5];
const statusText = computed(() => ({
  connecting: "Connecting",
  listening: muted.value ? "Muted" : "Listening",
  thinking: `${props.bot.name} is thinking`,
  speaking: `${props.bot.name} is speaking`
})[phase.value]);
const mood = computed(() => ({ listening: "attention", thinking: "thinking", speaking: "working" })[phase.value] || "idle");

// A call that can't start still shows "connecting" for a moment before it closes.
const CONNECTING_MS = 750;
function fail(problem) {
  if (ended) return;
  ended = true;
  stopAll();
  setTimeout(() => emit("failed", problem), Math.max(0, CONNECTING_MS - (Date.now() - startedAt)));
}

function stopAll() {
  session?.abort();
  session = null;
  speech?.stop();
  speech = null;
}

function startListening() {
  if (ended || muted.value) return;
  phase.value = "listening";
  caption.value = "";
  session = listen({
    lang,
    continuous: false,
    onText: (finalText, interim) => { caption.value = `${finalText}${interim}`; },
    onError: (event) => fail(microphoneProblem(event)),
    onEnd: (finalText) => {
      session = null;
      if (ended || phase.value !== "listening") return;
      const said = finalText.trim();
      if (!said) {
        // Silence: keep listening until there's something to send.
        startListening();
        return;
      }
      phase.value = "thinking";
      caption.value = said;
      awaitingAfter = lastBotId();
      emit("say", said);
    }
  });
}

function lastBotId() {
  const last = [...props.messages].reverse().find((message) => message.role === "bot" && message.kind === "text");
  return last ? Number(last.id) || 0 : 0;
}

// The bot's reply arrives as ordinary messages; its text is read aloud.
watch(() => props.messages.length, () => {
  if (phase.value !== "thinking" || awaitingAfter === null) return;
  const reply = props.messages.filter((message) => message.role === "bot" && message.kind === "text" && (Number(message.id) || 0) > awaitingAfter);
  if (!reply.length) return;
  awaitingAfter = null;
  const text = reply.map((message) => message.body.text).join("\n\n");
  phase.value = "speaking";
  caption.value = text;
  speech = speak(text, {
    lang,
    voiceName: shellPreferences.voiceName,
    rate: shellPreferences.voiceRate,
    onEnd: () => {
      speech = null;
      if (!ended && phase.value === "speaking") startListening();
    }
  });
});

function interrupt() {
  if (phase.value !== "speaking") return;
  speech?.stop();
  speech = null;
  startListening();
}

function toggleMute() {
  muted.value = !muted.value;
  if (muted.value) {
    session?.abort();
    session = null;
    if (phase.value === "listening") caption.value = "";
  } else if (phase.value === "listening") {
    startListening();
  }
}

function end() {
  if (ended) return;
  ended = true;
  stopAll();
  emit("ended", Math.round((Date.now() - startedAt) / 1000));
}

onMounted(async () => {
  if (!voiceSupported()) {
    fail(UNSUPPORTED);
    return;
  }
  try {
    await checkMicrophone(shellPreferences.microphoneId);
  } catch (error) {
    fail(microphoneProblem(error));
    return;
  }
  refreshVoices();
  synthesis?.addEventListener("voiceschanged", refreshVoices);
  startListening();
});

onBeforeUnmount(() => {
  synthesis?.removeEventListener("voiceschanged", refreshVoices);
  if (!ended) end();
});

defineExpose({ end });
</script>

<template>
  <div class="mb-call" role="region" :aria-label="`Voice conversation with ${bot.name}`">
    <div class="mb-call__bar">
      <button type="button" class="mb-call__avatar" :aria-label="phase === 'speaking' ? 'Interrupt' : bot.name" @click="interrupt">
        <MercbotAvatar :bot="bot" :size="36" :state="mood" />
      </button>
      <span class="mb-call__middle">
        <span v-if="phase === 'connecting' || phase === 'thinking'" class="mb-call__progress" aria-hidden="true"><span /></span>
        <span v-else class="mb-call__level" :class="{ 'mb-call__level--off': muted && phase === 'listening' }" aria-hidden="true"><span /><span /><span /></span>
        <span class="mb-call__status" role="status">{{ statusText }}</span>
      </span>
      <v-menu location="bottom" :offset="8" content-class="mb-popover" :close-on-content-click="false">
        <template #activator="{ props: menuProps }">
          <button v-bind="menuProps" type="button" class="mb-call__button" aria-label="Voice settings"><v-icon icon="$settings" size="20" /></button>
        </template>
        <div class="mb-call__settings">
          <label class="mb-call__field">Voice
            <select v-model="shellPreferences.voiceName">
              <option value="">Default</option>
              <option v-for="voice in voices" :key="voice.name" :value="voice.name">{{ voice.name }}</option>
            </select>
          </label>
          <label class="mb-call__field">Speed
            <select v-model.number="shellPreferences.voiceRate">
              <option v-for="rate in RATES" :key="rate" :value="rate">{{ rate === 1 ? "Normal" : `${rate}×` }}</option>
            </select>
          </label>
        </div>
      </v-menu>
      <MercbotTooltip :text="captionsOn ? 'Hide captions' : 'Show captions'">
        <template #default="{ props: tooltipProps }">
          <button v-bind="tooltipProps" type="button" class="mb-call__button" :class="{ 'mb-call__button--on': captionsOn }" :aria-pressed="captionsOn" aria-label="Captions" @click="captionsOn = !captionsOn">
            <v-icon icon="$sms" size="20" />
          </button>
        </template>
      </MercbotTooltip>
      <MercbotTooltip :text="muted ? 'Unmute' : 'Mute'">
        <template #default="{ props: tooltipProps }">
          <button v-bind="tooltipProps" type="button" class="mb-call__button" :class="{ 'mb-call__button--on': muted }" :aria-pressed="muted" aria-label="Mute" @click="toggleMute">
            <v-icon :icon="muted ? '$micOff' : '$mic'" size="20" />
          </button>
        </template>
      </MercbotTooltip>
      <MercbotTooltip text="End the conversation">
        <template #default="{ props: tooltipProps }">
          <button v-bind="tooltipProps" type="button" class="mb-call__button mb-call__button--end" aria-label="End the conversation" @click="end">
            <v-icon icon="$close" size="20" />
          </button>
        </template>
      </MercbotTooltip>
    </div>
    <p v-if="captionsOn && caption" class="mb-call__caption" aria-live="polite">{{ caption }}</p>
  </div>
</template>

<style scoped>
.mb-call {
  position: absolute;
  top: 62px;
  left: 50%;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  transform: translateX(-50%);
}

.mb-call__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 400px;
  height: 60px;
  padding: 0 8px 0 12px;
  border-radius: 30px;
  background: rgb(var(--v-theme-surface));
  box-shadow: var(--mb-shadow-popover);
}

.mb-call__avatar {
  display: inline-flex;
  flex: none;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.mb-call__middle {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.mb-call__progress {
  position: relative;
  width: 96px;
  height: 3px;
  overflow: hidden;
  border-radius: 2px;
  background: rgb(var(--v-theme-surface-container-highest));
}

.mb-call__progress span {
  position: absolute;
  top: 0;
  left: -30px;
  width: 30px;
  height: 100%;
  border-radius: 2px;
  background: rgb(var(--v-theme-link));
  animation: mb-call-slide 1.1s ease-in-out infinite;
}

@keyframes mb-call-slide {
  from { left: -30px; }
  to { left: 96px; }
}

.mb-call__level {
  display: inline-flex;
  gap: 3px;
  align-items: center;
  height: 12px;
}

.mb-call__level span {
  width: 3px;
  height: 100%;
  border-radius: 2px;
  background: rgb(var(--v-theme-link));
  animation: mb-call-level 0.9s ease-in-out infinite;
}

.mb-call__level span:nth-child(2) { animation-delay: 0.15s; }
.mb-call__level span:nth-child(3) { animation-delay: 0.3s; }

.mb-call__level--off span {
  background: rgb(var(--v-theme-on-surface-variant));
  animation: none;
  height: 4px;
}

@keyframes mb-call-level {
  0%, 100% { transform: scaleY(0.35); }
  50% { transform: scaleY(1); }
}

.mb-call__status {
  overflow: hidden;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-call__button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 22px;
  background: rgb(var(--v-theme-surface-container-high));
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.mb-call__button--on {
  background: rgb(var(--v-theme-surface-container-highest));
  color: rgb(var(--v-theme-on-surface));
}

.mb-call__button--end {
  background: rgb(var(--v-theme-error));
  color: rgb(var(--v-theme-on-error));
}

.mb-call__caption {
  max-width: 400px;
  margin: 0;
  padding: 8px 14px;
  border-radius: 14px;
  background: rgb(var(--v-theme-surface));
  box-shadow: var(--mb-shadow-soft);
  font-size: 13px;
  line-height: 19px;
  max-height: 120px;
  overflow-y: auto;
}

.mb-call__settings {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 240px;
  padding: 12px;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
}

.mb-call__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-call__field select {
  height: 30px;
  padding: 0 8px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 8px;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface));
}
</style>
