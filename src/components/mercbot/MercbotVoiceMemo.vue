<script setup>
import { computed, onBeforeUnmount, ref } from "vue";
import { fileUrl } from "./filesApi.js";

// A bot's voice memo: play, a speed pill, the waveform filling as it plays, the
// length, and an arrow that shows the transcript underneath.
const props = defineProps({
  botId: { type: String, required: true },
  group: { type: String, default: null },
  memo: { type: Object, required: true }
});
const SPEEDS = [1, 1.5, 2];
const audio = new Audio(fileUrl(props.botId, props.memo.path, { download: false, group: props.group }));
audio.preload = "none";
const playing = ref(false);
const position = ref(0);
const speed = ref(1);
const showTranscript = ref(false);
audio.addEventListener("timeupdate", () => { position.value = audio.currentTime; });
audio.addEventListener("ended", () => { playing.value = false; position.value = 0; });
audio.addEventListener("pause", () => { playing.value = false; });
audio.addEventListener("play", () => { playing.value = true; });

const progress = computed(() => (props.memo.seconds ? position.value / props.memo.seconds : 0));
const shown = computed(() => {
  const total = Math.round(playing.value || position.value ? props.memo.seconds - position.value : props.memo.seconds);
  return `${Math.floor(total / 60)}:${String(Math.max(0, total % 60)).padStart(2, "0")}`;
});

function toggle() {
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

function nextSpeed() {
  speed.value = SPEEDS[(SPEEDS.indexOf(speed.value) + 1) % SPEEDS.length];
  audio.playbackRate = speed.value;
}

onBeforeUnmount(() => audio.pause());
</script>

<template>
  <div class="mb-memo" role="group" aria-label="Voice memo">
    <div class="mb-memo__bar">
      <button type="button" class="mb-memo__play" :aria-label="playing ? 'Pause' : 'Play'" @click="toggle">
        <v-icon :icon="playing ? '$pause' : '$play'" size="18" />
      </button>
      <button type="button" class="mb-memo__speed" aria-label="Playback speed" @click="nextSpeed">{{ speed }}×</button>
      <span class="mb-memo__wave" aria-hidden="true">
        <span
          v-for="(level, index) in memo.waveform"
          :key="index"
          class="mb-memo__level"
          :class="{ 'mb-memo__level--played': index / memo.waveform.length < progress }"
          :style="{ height: `${Math.max(12, level * 100)}%` }"
        />
      </span>
      <span class="mb-memo__time">{{ shown }}</span>
      <button type="button" class="mb-memo__expand" :aria-label="showTranscript ? 'Hide transcript' : 'Show transcript'" :aria-expanded="showTranscript" @click="showTranscript = !showTranscript">
        <v-icon :icon="showTranscript ? '$collapse' : '$expand'" size="18" />
      </button>
    </div>
    <p v-if="showTranscript" class="mb-memo__transcript">{{ memo.words }}</p>
  </div>
</template>

<style scoped>
.mb-memo {
  max-width: 400px;
  padding: 8px 10px;
  border-radius: 18px;
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-memo__bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mb-memo__play {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 16px;
  background: rgb(var(--v-theme-inverse-surface));
  color: rgb(var(--v-theme-inverse-on-surface));
  cursor: pointer;
}

.mb-memo__speed {
  flex: none;
  height: 22px;
  padding: 0 7px;
  border: 0;
  border-radius: 11px;
  background: rgb(var(--v-theme-surface));
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.mb-memo__wave {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 2px;
  height: 26px;
  min-width: 120px;
}

.mb-memo__level {
  flex: 1;
  border-radius: 2px;
  background: rgba(var(--v-theme-on-surface), 0.25);
}

.mb-memo__level--played {
  background: rgb(var(--v-theme-link));
}

.mb-memo__time {
  flex: none;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-memo__expand {
  display: inline-flex;
  flex: none;
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.mb-memo__transcript {
  margin: 8px 4px 2px;
  font-size: 13px;
  line-height: 19px;
}
</style>
